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
  const walls        = useWallStore((s) => s.wallsByFloor[floorId] ?? [])
  const aps          = useAPStore((s) => s.apsByFloor[floorId] ?? [])
  const scopes       = useScopeStore((s) => s.scopesByFloor[floorId] ?? [])
  // Subscribe to the full apsByFloor map so cross-floor APs drive recompute.
  const apsByFloor   = useAPStore((s) => s.apsByFloor)
  // Same for walls — other floors' walls attenuate cross-floor rays (HM-F2c).
  const wallsByFloor = useWallStore((s) => s.wallsByFloor)
  // Same for floor holes — any floor's hole can bypass a slab boundary.
  const holesByFloor = useFloorHoleStore((s) => s.floorHolesByFloor)

  const enabled     = useHeatmapStore((s) => s.enabled)
  const mode        = useHeatmapStore((s) => s.mode)
  const engine      = useHeatmapStore((s) => s.engine)
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
  const [version, setVersion] = useState(0)

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

  useEffect(() => {
    if (!enabled || !scenario || !floor?.scale || !padding) return
    let cancelled = false
    const run = () => {
      // Engine choice: shader is HM-F5a (Friis + walls + slab + openings only;
      // reflections / diffraction silently ignored at this stage). Falls back
      // to JS if the GL context can't be created (no WebGL2, lost context).
      let field
      if (engine === 'shader') {
        try {
          field = sampleFieldGL(scenario, gridStepM, {
            maxReflOrder: reflections ? 1 : 0,
            enableDiffraction: diffraction,
            padding,
          })
        } catch (e) {
          console.warn('[Heatmap] shader engine failed, falling back to JS:', e.message)
          field = sampleField(scenario, gridStepM, {
            maxReflOrder: reflections ? 1 : 0,
            enableDiffraction: diffraction,
            padding,
          })
        }
      } else {
        field = sampleField(scenario, gridStepM, {
          maxReflOrder: reflections ? 1 : 0,
          enableDiffraction: diffraction,
          padding,
        })
      }
      if (cancelled) return
      // outW/outH cover the *padded* meter range so the heatmap canvas pixel
      // mapping (1 m → floor.scale px) stays consistent. KonvaImage below
      // shifts and sizes the canvas so only the plan-rect pixels are visible.
      const totalWm = scenario.size.w + padding.left + padding.right
      const totalHm = scenario.size.h + padding.top  + padding.bottom
      const outW = Math.max(1, Math.round(totalWm * floor.scale))
      const outH = Math.max(1, Math.round(totalHm * floor.scale))
      const gl = getGL()
      if (!gl) return
      // Mode selects which sampled field feeds the renderer. heatmapGL reads
      // `field.rssi` by convention, so we swap the active field into that slot.
      const modeCfg = getModeConfig(mode)
      const activeField = field[modeCfg.field] ?? field.rssi
      const renderField = { rssi: activeField, nx: field.nx, ny: field.ny }
      gl.render(renderField, outW, outH, 1 / floor.scale, blur, showContours, {
        anchors: modeCfg.anchors,
      })
      setVersion((n) => n + 1)
    }
    const id = setTimeout(run, 0)
    return () => { cancelled = true; clearTimeout(id) }
  }, [enabled, mode, engine, scenario, reflections, diffraction, gridStepM, blur, showContours, floor?.scale, padding])

  if (!enabled || !scenario || !floor?.scale || !glRef.current || !padding) return null

  const canvas = glRef.current.canvas
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

  return (
    <Layer listening={false} clipFunc={clipFunc}>
      <KonvaImage
        image={canvas}
        x={cx}
        y={cy}
        offsetX={cx + padLpx}
        offsetY={cy + padTpx}
        width={fullW}
        height={fullH}
        rotation={rotation}
        key={version}
      />
    </Layer>
  )
}
