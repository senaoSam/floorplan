import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Layer, Image as KonvaImage } from 'react-konva'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { buildScenario } from '@/features/heatmap/buildScenario'
import { sampleField } from '@/features/heatmap/sampleField'
import { sampleFieldGL } from '@/features/heatmap/sampleFieldGL'
import { getModeConfig } from '@/features/heatmap/modes'
import { computeFloorElevations } from '@/features/viewer3d/floorStacking'
import { createHeatmapGL } from '@/features/heatmap/heatmapGL.js'

// Module-level stable empty array. Used as the fallback for per-floor selectors
// (scopes / walls / APs / holes) when a floor has no entries. Returning a fresh
// `[]` from a Zustand selector triggers a useMemo cache miss on every render,
// which—on hover—cascades into a full sampleFieldGL recompute every frame.
const EMPTY = Object.freeze([])

// Heatmap render layer. Sits between the floor image and the wall layer so
// the plan is still visible underneath and wall strokes cut across the heat
// on top.
//
// Recompute policy (per task.md HM-8): recompute on ANY change to walls / APs
// / scopes / floor.scale, including while dragging. Optimising drag freeze is
// tracked as HM-F6.
export default function HeatmapLayer({ floorId }) {
  const floors       = useFloorStore((s) => s.floors)
  const floor        = floors.find((f) => f.id === floorId) ?? null
  const walls        = useWallStore((s) => s.wallsByFloor[floorId] ?? EMPTY)
  const aps          = useAPStore((s) => s.apsByFloor[floorId] ?? EMPTY)
  const scopes       = useScopeStore((s) => s.scopesByFloor[floorId] ?? EMPTY)
  // Subscribe to the full apsByFloor map so cross-floor APs drive recompute.
  const apsByFloor   = useAPStore((s) => s.apsByFloor)
  // Same for walls — other floors' walls attenuate cross-floor rays (HM-F2c).
  const wallsByFloor = useWallStore((s) => s.wallsByFloor)
  // Same for floor holes — any floor's hole can bypass a slab boundary.
  const holesByFloor = useFloorHoleStore((s) => s.floorHolesByFloor)

  const enabled     = useHeatmapStore((s) => s.enabled)
  const mode        = useHeatmapStore((s) => s.mode)
  const engine      = useHeatmapStore((s) => s.engine)
  const dragMode    = useHeatmapStore((s) => s.dragMode)
  const reflections = useHeatmapStore((s) => s.reflections)
  const diffraction = useHeatmapStore((s) => s.diffraction)
  const gridStepM   = useHeatmapStore((s) => s.gridStepM)
  const blur        = useHeatmapStore((s) => s.blur)
  const showContours= useHeatmapStore((s) => s.showContours)

  // Live drag overlays — subscribe so any change retriggers compute immediately.
  const dragAP    = useDragOverlayStore((s) => s.ap)
  const dragWall  = useDragOverlayStore((s) => s.wall)
  const dragScope = useDragOverlayStore((s) => s.scope)

  const glRef = useRef(null)
  // Konva node ref — used to imperatively redraw after the WebGL canvas has new
  // pixels, without forcing a React re-render. The previous `setVersion + key`
  // trick triggered a render loop: the post-render setState scheduled another
  // commit, and during that commit any subscriber that returned a different
  // ref (anywhere in the Editor2D tree) re-fired this useEffect, which called
  // setVersion again. Hover-rate mousemove fed that loop, producing the
  // "Timer fired → run → sampleFieldGL → renderAp → readPixels" stack the user
  // saw in DevTools every frame.
  const imageNodeRef = useRef(null)
  // HM-drag-solo: separate offscreen canvas holding the snapshot taken at
  // dragstart. Acts as the visible base layer while the drag is in progress so
  // (a) drag-AP can render only the dragged AP into gl.canvas without losing
  // the rest of the field's visual context, (b) drag-wall/scope can freeze
  // the heatmap entirely while dragging.
  const snapshotCanvasRef = useRef(null)
  const snapshotImageNodeRef = useRef(null)
  // displayMode controls which Konva Image is visible:
  //   'main'        — main gl.canvas (default; live mode + idle)
  //   'solo-ap'     — snapshot at 0.3 opacity + main (single-AP render) on top
  //   'solo-frozen' — snapshot at 1.0 opacity, main hidden
  const [displayMode, setDisplayMode] = useState('main')

  const getGL = () => {
    if (!glRef.current) {
      try { glRef.current = createHeatmapGL() }
      catch (e) { console.warn('[Heatmap] WebGL2 init failed:', e.message); return null }
    }
    return glRef.current
  }

  useEffect(() => () => {
    if (glRef.current) { glRef.current.dispose(); glRef.current = null }
  }, [])

  const scenario = useMemo(() => {
    if (!enabled) return null
    if (!floor?.scale) return null
    // With cross-floor in play, the heatmap still has content when the
    // active floor has no APs as long as other floors do.
    const anyAp = Object.values(apsByFloor).some((arr) => arr && arr.length > 0)
    if (!anyAp) return null

    // Apply live drag overrides so the heatmap tracks the object being dragged
    // without waiting for the commit-on-dragend write into the main stores.
    const apsLive = dragAP
      ? aps.map((a) => (a.id === dragAP.id ? { ...a, x: dragAP.x, y: dragAP.y } : a))
      : aps

    const wallsLive = dragWall
      ? walls.map((w) => (w.id === dragWall.id
          ? { ...w, startX: w.startX + dragWall.dx, startY: w.startY + dragWall.dy,
                    endX:   w.endX   + dragWall.dx, endY:   w.endY   + dragWall.dy }
          : w))
      : walls

    const scopesLive = dragScope
      ? scopes.map((s) => {
          if (s.id !== dragScope.id) return s
          const pts = s.points.slice()
          for (let i = 0; i < pts.length; i += 2) {
            pts[i]     += dragScope.dx
            pts[i + 1] += dragScope.dy
          }
          return { ...s, points: pts }
        })
      : scopes

    // Cross-floor context. Every other floor's APs are projected into the
    // active floor's coordinate system so they contribute to this floor's
    // heatmap (with per-floor slab attenuation on the AP→rx ray, and other
    // floors' walls attenuating the ray's 2D projection when it passes
    // through their Z band — HM-F2c).
    // XY alignment assumes each floor's canvas (0,0) refers to the same
    // world point. If the user has applied the 2D "align floor" transform
    // (alignOffset / scale / rotation), cross-floor APs and walls will
    // appear at the wrong XY. Fixing this needs a canonical world frame
    // (tracked as a future refinement).
    const elevations = computeFloorElevations(floors)
    const floorIndexById = new Map(floors.map((f, i) => [f.id, i]))
    const floorStack = floors.map((f) => ({
      id: f.id,
      elevationM: elevations[f.id] ?? 0,
      slabDb: f.floorSlabAttenuationDb ?? 0,
      // Canvas-px → m uses each floor's own scale; the hole polygon points
      // convert per-hole in buildScenario.
      scale: f.scale,
      // Raw holes as stored (canvas px + vertical range). Filtering /
      // conversion to meters happens in buildScenario.
      holes: (holesByFloor[f.id] ?? []).map((h) => ({
        points: h.points,
        // Resolve vertical range to array-index form. Missing →
        // treat the hole as "just this floor" (single slab bypass).
        fromIdx: floorIndexById.get(h.bottomFloorId ?? f.id) ?? floorIndexById.get(f.id),
        toIdx:   floorIndexById.get(h.topFloorId    ?? f.id) ?? floorIndexById.get(f.id),
      })),
    }))

    // Collect APs across every floor, each with the elevation of its own
    // floor. The active floor contributes its live-drag copy so the heatmap
    // updates immediately while dragging.
    const apsAcrossFloors = []
    for (const f of floors) {
      const floorAPs = f.id === floorId ? apsLive : (apsByFloor[f.id] ?? [])
      const floorElev = elevations[f.id] ?? 0
      for (const ap of floorAPs) {
        apsAcrossFloors.push({
          ...ap,
          posPx: { x: ap.x, y: ap.y },
          elevationM: floorElev,
          floorScale: f.scale,
        })
      }
    }

    // Other floors' walls. Active floor's walls stay in `wallsLive` and go
    // into scenario.walls (corners also come from them — diffraction is same-
    // floor only). Other-floor walls live in a separate bucket and only
    // participate in wall-penetration loss, each with its own elevation + scale.
    const otherFloorWalls = []
    for (const f of floors) {
      if (f.id === floorId) continue
      const fws = wallsByFloor[f.id] ?? []
      if (fws.length === 0) continue
      otherFloorWalls.push({
        elevationM: elevations[f.id] ?? 0,
        scale: f.scale,
        walls: fws,
      })
    }

    const crossFloor = {
      activeElevationM: elevations[floorId] ?? 0,
      rxHeightM: 1.0,
      floorStack,
      apsByFloor: apsAcrossFloors,
      otherFloorWalls,
    }

    return buildScenario(floor, wallsLive, apsLive, scopesLive, crossFloor)
  }, [enabled, floor, floorId, floors, walls, aps, scopes, apsByFloor, wallsByFloor, holesByFloor, dragAP, dragWall, dragScope])

  // Pad the sampled grid outward on edges that aren't already framed by a
  // wall. Without this, an AP near a wall-less plan edge produces iso-contours
  // that should bend into "outside" but instead get clamped at the grid edge
  // by heatmapGL's CLAMP_TO_EDGE bilinear, producing straight-edge artefacts.
  // The padded region is sampled but never displayed — KonvaImage crops back
  // to the original plan rect below.
  //
  // Edge "covered" heuristic: any same-floor wall whose segment lies along
  // that edge within a tolerance counts. Conservative — even partial coverage
  // suppresses padding, which matches the user's observation that "edges
  // framed by walls render correctly" without wasting compute on framed plans.
  const PAD_M = 12 // generous enough for -75 dBm to settle in free space
  const EDGE_TOL_M = 0.5
  const padding = useMemo(() => {
    if (!scenario) return null
    const { w, h } = scenario.size
    let onLeft = false, onRight = false, onTop = false, onBottom = false
    for (const seg of scenario.walls) {
      // Active-floor walls only — other-floor walls (HM-F2c) sit at different
      // Z bands and don't visually frame this floor's heatmap edges. We
      // approximate "active floor" via the elevation Z band: scenario doesn't
      // tag origin per-segment, so use a simpler rule — segments must lie
      // entirely within the plan rect (other-floor walls usually do too, but
      // if they don't we'd over-pad which is harmless).
      const minX = Math.min(seg.a.x, seg.b.x)
      const maxX = Math.max(seg.a.x, seg.b.x)
      const minY = Math.min(seg.a.y, seg.b.y)
      const maxY = Math.max(seg.a.y, seg.b.y)
      if (maxX <= EDGE_TOL_M)        onLeft   = true
      if (minX >= w - EDGE_TOL_M)    onRight  = true
      if (maxY <= EDGE_TOL_M)        onTop    = true
      if (minY >= h - EDGE_TOL_M)    onBottom = true
    }
    return {
      left:   onLeft   ? 0 : PAD_M,
      right:  onRight  ? 0 : PAD_M,
      top:    onTop    ? 0 : PAD_M,
      bottom: onBottom ? 0 : PAD_M,
    }
  }, [scenario])

  // Drag state. Two modes (HeatmapStore.dragMode):
  //   live — recompute every frame with HM-drag-lod compromises (refl/diff off,
  //          blur off, RSSI-only when applicable). Position-accurate; full
  //          N_AP aggregation; cost dominated by the per-fragment AP loop.
  //   solo — HM-drag-solo / Hamina style. Snapshot the heatmap on dragstart;
  //          while dragging an AP render only THAT AP into gl.canvas (full
  //          resolution — single AP is already 1/N_AP work, no need to LOD);
  //          while dragging walls/scopes, freeze the heatmap (no recompute).
  //          On dragend the next effect run does a full-quality recompute and
  //          atomically swaps back.
  const isDragging = !!(dragAP || dragWall || dragScope)
  const isSolo     = dragMode === 'solo' && isDragging
  const isSoloAP   = isSolo && !!dragAP && !dragWall && !dragScope
  const isSoloFreeze = isSolo && (dragWall || dragScope) && !dragAP

  // Live-mode drag compromises (HM-drag-lod). Only apply when actively dragging
  // in live mode — solo mode bypasses these by taking the dedicated solo path.
  const lodActive = dragMode === 'live' && isDragging
  const liveGridStepM     = lodActive ? gridStepM * 1 : gridStepM
  const liveFreqOverrideN = undefined
  // Cull threshold: -120 (default) is exact for full quality. -95 dBm matches
  // the noise floor so any AP whose free-space-only RSSI sits below it cannot
  // change SINR / CCI / SNR meaningfully — still lossless within colormap
  // resolution but lets faraway APs get culled per-fragment.
  const liveCullFloorDbm = lodActive ? -95 : undefined
  const liveBlur         = lodActive ? 0     : blur
  const liveShowContours = lodActive ? false : showContours
  // Drop reflections / diffraction during live drag — both are O(N_walls) per
  // AP. p50 RSSI delta < 1 dB in typical coverage range.
  const liveMaxReflOrder      = lodActive ? 0     : (reflections ? 1 : 0)
  const liveEnableDiffraction = lodActive ? false : diffraction
  // RSSI / SNR mode never reads cci/sinr fields, so skip the per-fragment
  // co-channel AP loop during live drag.
  const liveRssiOnly = lodActive && (mode === 'rssi' || mode === 'snr')


  // HM-drag-solo snapshot: when solo drag begins, copy the current gl.canvas
  // pixels into a separate offscreen canvas. The snapshot becomes the visible
  // base layer for the duration of the drag, freeing gl.canvas to be either
  // overwritten with the single-AP overlay (drag AP) or left alone (freeze).
  // The transition out (dragend → 'main') happens *after* the next full
  // recompute writes fresh pixels into gl.canvas, so there is no black-frame
  // gap.
  useEffect(() => {
    if (!enabled) return
    if (!isSolo) return
    const gl = glRef.current
    if (!gl || !gl.canvas) return
    const src = gl.canvas
    const w = src.width
    const h = src.height
    if (w <= 0 || h <= 0) return
    // Allocate / resize once. Reuse across drags as long as size matches.
    let snap = snapshotCanvasRef.current
    if (!snap || snap.width !== w || snap.height !== h) {
      snap = document.createElement('canvas')
      snap.width = w
      snap.height = h
      snapshotCanvasRef.current = snap
    }
    const ctx = snap.getContext('2d')
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(src, 0, 0)
    setDisplayMode(isSoloAP ? 'solo-ap' : 'solo-frozen')
    // Intentionally only run on transitions INTO the solo state; transitions
    // between solo-ap / solo-frozen during one drag are rare (would require
    // the user to release one object and grab another within the same
    // gesture, which the drag overlay store doesn't surface as a continuous
    // drag). The displayMode update above still tracks them if it happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isSolo])

  useEffect(() => {
    if (!enabled || !scenario || !floor?.scale || !padding) return
    let cancelled = false
    const run = () => {
      const gl = getGL()
      if (!gl) return
      const totalWm = scenario.size.w + padding.left + padding.right
      const totalHm = scenario.size.h + padding.top  + padding.bottom
      const outW = Math.max(1, Math.round(totalWm * floor.scale))
      const outH = Math.max(1, Math.round(totalHm * floor.scale))

      // ----- HM-drag-solo: freeze path -----
      // Drag wall / scope while dragMode === 'solo' → don't recompute at all.
      // The snapshot Konva Image is already showing the dragstart frame.
      if (isSoloFreeze) return

      // ----- HM-drag-solo: single-AP path -----
      // Drag AP while dragMode === 'solo' → render only the dragged AP into
      // gl.canvas. Full grid step / no LOD compromise (single AP is already
      // 1/N_AP work). Snapshot at 0.3 opacity provides context underneath.
      let field
      const isSoloAPRun = isSoloAP && dragAP
      if (isSoloAPRun) {
        const soloAP = scenario.aps.find((a) => a.id === dragAP.id)
        if (!soloAP) return
        const soloScenario = { ...scenario, aps: [soloAP] }
        // Reflections / diffraction stay ON in solo: 1 AP × refl/diff is cheap,
        // and these contribute most to the visual difference users care about
        // when positioning a single AP near walls.
        const soloOpts = {
          maxReflOrder: reflections ? 1 : 0,
          enableDiffraction: diffraction,
          padding,
        }
        if (engine === 'shader') {
          try {
            field = sampleFieldGL(soloScenario, gridStepM, soloOpts)
          } catch (e) {
            console.warn('[Heatmap] solo shader path failed, falling back to JS:', e.message)
            field = sampleField(soloScenario, gridStepM, soloOpts)
          }
        } else {
          field = sampleField(soloScenario, gridStepM, soloOpts)
        }
      } else {
        // ----- live mode + idle: full recompute (with optional LOD) -----
        if (engine === 'shader') {
          try {
            field = sampleFieldGL(scenario, liveGridStepM, {
              maxReflOrder: liveMaxReflOrder,
              enableDiffraction: liveEnableDiffraction,
              padding,
              freqOverrideN: liveFreqOverrideN,
              cullFloorDbm: liveCullFloorDbm,
              rssiOnly: liveRssiOnly,
            })
          } catch (e) {
            console.warn('[Heatmap] shader engine failed, falling back to JS:', e.message)
            field = sampleField(scenario, liveGridStepM, {
              maxReflOrder: liveMaxReflOrder,
              enableDiffraction: liveEnableDiffraction,
              padding,
              freqOverrideN: liveFreqOverrideN,
            })
          }
        } else {
          field = sampleField(scenario, liveGridStepM, {
            maxReflOrder: liveMaxReflOrder,
            enableDiffraction: liveEnableDiffraction,
            padding,
            freqOverrideN: liveFreqOverrideN,
          })
        }
      }
      if (cancelled) return

      // Mode selects which sampled field feeds the renderer. heatmapGL reads
      // `field.rssi` by convention, so we swap the active field into that slot.
      // Solo-AP runs always render in RSSI (single AP has no SINR / CCI).
      const modeCfg = isSoloAPRun ? getModeConfig('rssi') : getModeConfig(mode)
      const activeField = field[modeCfg.field] ?? field.rssi
      const renderField = { rssi: activeField, nx: field.nx, ny: field.ny }
      // Solo-AP keeps blur / contours at user settings; live LOD overrides them.
      const useBlur     = isSoloAPRun ? blur         : liveBlur
      const useContours = isSoloAPRun ? showContours : liveShowContours
      gl.render(renderField, outW, outH, 1 / floor.scale, useBlur, useContours, {
        anchors: modeCfg.anchors,
      })
      // After a fresh full render (i.e. not the single-AP solo overlay),
      // atomically reveal the main canvas. We delay this state update until
      // *after* gl.render() returns so the browser cannot paint a frame
      // where the snapshot has been hidden but the main canvas still holds
      // stale or in-progress pixels.
      if (!isSoloAPRun && displayMode !== 'main') {
        setDisplayMode('main')
      }
      const node = imageNodeRef.current
      const layer = node?.getLayer?.()
      if (layer) layer.batchDraw()
    }
    const id = setTimeout(run, 0)
    return () => { cancelled = true; clearTimeout(id) }
    // displayMode intentionally NOT a dep — it's only set inside this effect,
    // and re-running when it changes would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode, engine, scenario, reflections, diffraction,
      liveGridStepM, liveFreqOverrideN, liveCullFloorDbm, liveRssiOnly,
      liveBlur, liveShowContours, floor?.scale, padding,
      isSoloAP, isSoloFreeze, isDragging, dragAP, gridStepM, blur, showContours])

  if (!enabled || !scenario || !floor?.scale || !padding) return null
  // Initialise GL eagerly during render so the KonvaImage mounts on the same
  // commit that first satisfies enabled+scenario+padding. Previously this was
  // gated on glRef.current, which is only populated inside the effect — and
  // because refs don't trigger re-render, the KonvaImage stayed unmounted
  // until some unrelated state change happened to re-run render. That's why
  // the heatmap only appeared after the first hover post-Demo-load.
  const gl = getGL()
  if (!gl) return null

  const canvas = gl.canvas
  const rotation = floor.rotation || 0
  const hasCrop = floor.cropX != null && floor.cropWidth != null
  const cx = floor.imageWidth / 2
  const cy = floor.imageHeight / 2

  // Padded canvas geometry, in canvas pixels (px = m × floor.scale). The
  // canvas is bigger than the plan; we shift it so the plan-rect sub-region
  // lines up with (0, 0)..(imageWidth, imageHeight), then clip everything
  // outside the plan rect (or the user's crop window if set).
  const padLpx = padding.left   * floor.scale
  const padTpx = padding.top    * floor.scale
  const padRpx = padding.right  * floor.scale
  const padBpx = padding.bottom * floor.scale
  const fullW = floor.imageWidth  + padLpx + padRpx
  const fullH = floor.imageHeight + padTpx + padBpx

  // Match FloorImageLayer's crop-under-rotation so the heatmap respects the
  // same visible window as the underlying plan. When no user crop is set we
  // still need to clip the padded margin away.
  const clipFunc = hasCrop
    ? (ctx) => {
        ctx.translate(cx, cy)
        ctx.rotate((rotation * Math.PI) / 180)
        ctx.translate(-cx, -cy)
        ctx.rect(floor.cropX, floor.cropY, floor.cropWidth, floor.cropHeight)
      }
    : (ctx) => {
        ctx.rect(0, 0, floor.imageWidth, floor.imageHeight)
      }

  // HM-drag-solo: visibility plan
  //   displayMode === 'main'        — main canvas only
  //   displayMode === 'solo-ap'     — snapshot at 0.3 (under) + main (single-AP, on top)
  //   displayMode === 'solo-frozen' — snapshot at 1.0 (only); main hidden
  const showSnapshot = displayMode !== 'main' && !!snapshotCanvasRef.current
  const showMain     = displayMode !== 'solo-frozen'
  const snapshotOpacity = displayMode === 'solo-ap' ? 0.3 : 1.0

  return (
    <Layer listening={false} clipFunc={clipFunc}>
      {showSnapshot && (
        <KonvaImage
          ref={snapshotImageNodeRef}
          image={snapshotCanvasRef.current}
          x={cx}
          y={cy}
          offsetX={cx + padLpx}
          offsetY={cy + padTpx}
          width={fullW}
          height={fullH}
          rotation={rotation}
          opacity={snapshotOpacity}
        />
      )}
      {showMain && (
        <KonvaImage
          ref={imageNodeRef}
          image={canvas}
          x={cx}
          y={cy}
          offsetX={cx + padLpx}
          offsetY={cy + padTpx}
          width={fullW}
          height={fullH}
          rotation={rotation}
        />
      )}
    </Layer>
  )
}
