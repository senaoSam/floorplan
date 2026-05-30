import { Sprite, Texture, Graphics } from 'pixi.js'
import { createHeatmapGL } from '@/features/heatmap/heatmapGL'
import { buildScenario } from '@/features/heatmap/buildScenario'
import { sampleFieldGL } from '@/features/heatmap/sampleFieldGL'
import { sampleField } from '@/features/heatmap/sampleField'
import { getModeConfig } from '@/features/heatmap/modes'
import { computeFloorElevations } from '@/utils/floorStacking'

// Heatmap adapter — keeps the existing raw WebGL2 heatmap engine intact and
// wraps its offscreen canvas as a PIXI.Sprite mounted in scene.layers.heatmap.
//
// Functional parity with oldSrc HeatmapLayer:
//   ✓ scope mask (in-/out-scope sample exclusion via buildScenario)
//   ✓ cross-floor propagation (other floors' APs + slab attenuation +
//     floor-hole bypass via floorStack)
//   ✓ padding margin (PAD_M / EDGE_TOL_M heuristic, ported below)
//   ✓ hover readout (driven by heatmapHoverBinder + useHoverReadoutStore)
//
// Drag-aware render (HeatmapStore.dragMode, oldSrc HeatmapLayer 307-516):
//   live — recompute every frame with LOD compromises (reflections/diffraction
//          off, blur/contours off, cull faraway APs at -95 dBm). Position-
//          accurate; cheaper per frame than full quality.
//   solo — Hamina style. On drag start, snapshot the current heatmap canvas
//          into a frozen sprite shown underneath. While dragging an AP, render
//          ONLY that AP into the live sprite over the dimmed snapshot (single
//          AP is already 1/N work, no LOD needed). While dragging a wall/scope
//          (no AP), FREEZE — skip recompute entirely and just show the
//          snapshot. On drag end the normal store-driven recompute restores
//          full quality.
//
// (Fingerprint-skip from oldSrc is NOT ported — render-on-demand already
// coalesces redundant repaints, so re-running compute() on an unchanged scene
// is the cost of one field sample, not a wasted GPU frame loop.)
//
// The shader → JS fallback mirrors oldSrc HeatmapLayer.

// Padding (metres) added to each side of the sampling grid when that
// side ISN'T already framed by a wall. Without padding, APs sitting
// close to the floor plan edge behave as if a wall ran along the edge
// (because the sampler stops there) — RSSI bleeds into a sharp drop.
// EDGE_TOL_M: any wall segment whose extent lies within this tolerance
// of an edge counts as "framing" that edge, in which case no padding is
// added there.
const PAD_M = 12
const EDGE_TOL_M = 0.5

function computePadding(scenario) {
  const { w, h } = scenario.size
  let onLeft = false, onRight = false, onTop = false, onBottom = false
  for (const seg of scenario.walls ?? []) {
    const minX = Math.min(seg.a.x, seg.b.x)
    const maxX = Math.max(seg.a.x, seg.b.x)
    const minY = Math.min(seg.a.y, seg.b.y)
    const maxY = Math.max(seg.a.y, seg.b.y)
    if (maxX <= EDGE_TOL_M)      onLeft   = true
    if (minX >= w - EDGE_TOL_M)  onRight  = true
    if (maxY <= EDGE_TOL_M)      onTop    = true
    if (minY >= h - EDGE_TOL_M)  onBottom = true
  }
  return {
    left:   onLeft   ? 0 : PAD_M,
    right:  onRight  ? 0 : PAD_M,
    top:    onTop    ? 0 : PAD_M,
    bottom: onBottom ? 0 : PAD_M,
  }
}
export function attachHeatmapLayer({
  scene,
  useFloorStore,
  useWallStore,
  useAPStore,
  useScopeStore,
  useFloorHoleStore,
  useHeatmapStore,
  useDragOverlayStore,
}) {
  const layer = scene.layers.heatmap
  let gl = null
  let sprite = null
  let texture = null
  // Solo-drag snapshot: a 2nd sprite holding a frozen copy of the heatmap as
  // it looked when the drag began. Shown dimmed under the single-AP overlay
  // (solo-ap) or at full alpha alone (solo-frozen). Its canvas is a plain 2D
  // copy of gl.canvas taken on drag start.
  let snapSprite = null
  let snapTexture = null
  let snapCanvas = null
  // Tracks whether we are mid-solo-drag so we snapshot exactly once per drag
  // (on the transition idle→solo) and restore on the transition back.
  let soloActive = false
  // The padded sample grid extends past the floor image extent. Without
  // a clip the padded region bleeds into the canvas background outside
  // the floor plan, which looked wrong to the user. mask is a Graphics
  // rect anchored at (0,0)→(imgW,imgH) world coords; sprite.mask =
  // maskG clips the sprite to that rect (oldSrc HeatmapLayer used a
  // Konva clipFunc for the same effect).
  let maskG = null

  const ensureSprite = () => {
    if (sprite) return sprite
    if (!gl) {
      try {
        gl = createHeatmapGL()
      } catch (e) {
        console.warn('[heatmap] WebGL2 init failed:', e.message)
        return null
      }
    }
    texture = Texture.from(gl.canvas)
    sprite = new Sprite(texture)
    sprite.eventMode = 'none' // heatmap is pure visual overlay; never intercept clicks
    sprite.x = 0
    sprite.y = 0
    sprite.visible = false
    maskG = new Graphics()
    maskG.eventMode = 'none'
    layer.addChild(maskG)
    layer.addChild(sprite)
    sprite.mask = maskG
    return sprite
  }

  const hide = () => {
    if (sprite) sprite.visible = false
    if (snapSprite) snapSprite.visible = false
  }

  // Copy the current heatmap pixels into the snapshot sprite and show it. Used
  // on the idle→solo transition so the pre-drag field stays visible (frozen)
  // while the live sprite is repurposed for the single-AP overlay / left alone.
  const takeSnapshot = () => {
    if (!gl || !gl.canvas || !sprite) return
    const w = gl.canvas.width, h = gl.canvas.height
    if (w <= 0 || h <= 0) return
    if (!snapCanvas || snapCanvas.width !== w || snapCanvas.height !== h) {
      snapCanvas = document.createElement('canvas')
      snapCanvas.width = w
      snapCanvas.height = h
      if (snapTexture) { snapTexture.destroy(); snapTexture = null }
    }
    const ctx = snapCanvas.getContext('2d')
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(gl.canvas, 0, 0)
    if (!snapSprite) {
      snapTexture = Texture.from(snapCanvas)
      snapSprite = new Sprite(snapTexture)
      snapSprite.eventMode = 'none'
      // Insert directly under the live sprite, sharing the same mask.
      layer.addChildAt(snapSprite, layer.getChildIndex(sprite))
      snapSprite.mask = maskG
    } else if (!snapTexture) {
      snapTexture = Texture.from(snapCanvas)
      snapSprite.texture = snapTexture
    }
    // Match the live sprite's placement/scale so the frozen copy registers
    // exactly over the floor.
    snapSprite.x = sprite.x
    snapSprite.y = sprite.y
    snapSprite.scale.set(sprite.scale.x, sprite.scale.y)
    snapTexture.source.update()
  }

  const compute = () => {
    const hm = useHeatmapStore.getState()
    if (!hm.enabled) {
      hide()
      soloActive = false
      return
    }

    const { floors, activeFloorId } = useFloorStore.getState()
    const floor = floors.find((f) => f.id === activeFloorId)
    if (!floor || !floor.scale) {
      hide()
      return
    }

    // Drag state (heatmap reacts to ap / wall / scope drags only — oldSrc
    // HeatmapLayer 317-320). The canonical AP store doesn't update until
    // dragend, so apply the live overlay onto the dragged AP so the field
    // follows it during the drag.
    const drag = useDragOverlayStore ? useDragOverlayStore.getState() : {}
    const dragAP = drag.ap || null
    const dragWall = drag.wall || null
    const dragScope = drag.scope || null
    const isDragging = !!(dragAP || dragWall || dragScope)
    const dragMode = hm.dragMode || 'solo'
    const isSolo = dragMode === 'solo' && isDragging
    const isSoloAP = isSolo && !!dragAP && !dragWall && !dragScope
    const isSoloFreeze = isSolo && (!!dragWall || !!dragScope) && !dragAP
    const lodActive = dragMode === 'live' && isDragging

    const applyApOverlay = (list) =>
      dragAP ? list.map((a) => (a.id === dragAP.id ? { ...a, x: dragAP.x, y: dragAP.y } : a)) : list

    const walls = useWallStore.getState().wallsByFloor[activeFloorId] ?? []
    const aps = applyApOverlay(useAPStore.getState().apsByFloor[activeFloorId] ?? [])
    // Cross-floor: even when the ACTIVE floor has no APs, other floors'
    // APs can still cast attenuated signal through the slab. Check the
    // building-wide AP count, not just the active floor's.
    const apsByFloorAll = useAPStore.getState().apsByFloor ?? {}
    const totalApCount = Object.values(apsByFloorAll).reduce((n, list) => n + (list?.length ?? 0), 0)
    if (totalApCount === 0) {
      hide()
      return
    }
    // Scope mask: scopes on the active floor are passed through to
    // buildScenario which assembles a scopeMaskFn that sampleField /
    // sampleFieldGL apply per-sample. in-scopes restrict the visible
    // heatmap to their interior; out-scopes always exclude theirs.
    const scopes = useScopeStore
      ? (useScopeStore.getState().scopesByFloor?.[activeFloorId] ?? [])
      : []

    // Cross-floor propagation (oldSrc HeatmapLayer.jsx 200-263 1:1):
    //   * APs from every floor land in apsByFloor[] with their floor's
    //     elevation, so heatmapGL can compute the vertical leg via
    //     elevation delta + slab attenuation + floor-hole bypass.
    //   * Other floors' walls go into otherFloorWalls (wall-penetration
    //     loss only; no diffraction across floors).
    //   * floorStack carries slab attenuation per floor + the hole list
    //     (vertical range) that lets samples skip slabs at hole columns.
    // Build crossFloor UNCONDITIONALLY — even for a single floor — to match
    // oldSrc HeatmapLayer.jsx (200-263), which never guarded on floor count.
    // This matters for visual parity: buildScenario takes a different path when
    // crossFloor is an object vs null. With crossFloor present it resolves the
    // AP→rx geometry in 3D (rxHeightM 1.0 + per-AP elevation), so even a lone
    // floor's RSSI field — hence its iso-contour positions — differs subtly
    // from the null/2D path. A `length > 1` guard here made the single-floor
    // demo's contours drift relative to Konva (MCP-confirmed: null crossFloor
    // field checksum 461800843 vs object 914922232, the latter matching oldSrc).
    let crossFloor = null
    const allFloors = floors
    if (allFloors.length > 0) {
      const elevations = computeFloorElevations(allFloors)
      const floorIndexById = new Map(allFloors.map((f, i) => [f.id, i]))
      const holesByFloor = useFloorHoleStore?.getState().floorHolesByFloor ?? {}
      const apsByFloor   = useAPStore.getState().apsByFloor ?? {}
      const wallsByFloor = useWallStore.getState().wallsByFloor ?? {}
      const floorStack = allFloors.map((f) => ({
        id: f.id,
        elevationM: elevations[f.id] ?? 0,
        slabDb: f.floorSlabAttenuationDb ?? 0,
        scale: f.scale,
        holes: (holesByFloor[f.id] ?? []).map((h) => ({
          points: h.points,
          fromIdx: floorIndexById.get(h.bottomFloorId ?? f.id) ?? floorIndexById.get(f.id),
          toIdx:   floorIndexById.get(h.topFloorId    ?? f.id) ?? floorIndexById.get(f.id),
        })),
      }))
      const apsAcrossFloors = []
      for (const f of allFloors) {
        const floorAPs = applyApOverlay(apsByFloor[f.id] ?? [])
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
      const otherFloorWalls = []
      for (const f of allFloors) {
        if (f.id === activeFloorId) continue
        const fws = wallsByFloor[f.id] ?? []
        if (fws.length === 0) continue
        otherFloorWalls.push({
          elevationM: elevations[f.id] ?? 0,
          scale: f.scale,
          walls: fws,
        })
      }
      crossFloor = {
        activeElevationM: elevations[activeFloorId] ?? 0,
        rxHeightM: 1.0,
        floorStack,
        apsByFloor: apsAcrossFloors,
        otherFloorWalls,
      }
    }

    const scenario = buildScenario(floor, walls, aps, scopes, crossFloor)
    if (!scenario) {
      hide()
      return
    }

    const s = ensureSprite()
    if (!s) return

    // Solo-drag snapshot transitions. Snapshot once on idle→solo so the frozen
    // pre-drag field is available; restore on solo→idle.
    if (isSolo && !soloActive) {
      takeSnapshot()
      soloActive = true
    } else if (!isSolo && soloActive) {
      soloActive = false
      if (snapSprite) snapSprite.visible = false
    }

    // ----- Solo freeze (dragging wall / scope, no AP) -----
    // Don't recompute — show the frozen snapshot, hide the live sprite. The
    // next non-freeze compute() (drag end, store change) restores full quality.
    if (isSoloFreeze && snapSprite && snapCanvas) {
      snapSprite.visible = true
      snapSprite.alpha = 1
      s.visible = false
      return
    }

    const padding = computePadding(scenario)

    // Solo-AP: render ONLY the dragged AP at full quality over a dimmed
    // snapshot. Live-drag (lodActive): full recompute with LOD compromises
    // (reflections/diffraction/blur/contours off, faraway APs culled at
    // -95 dBm). Idle: full quality. (oldSrc HeatmapLayer 322-495.)
    const soloScenario = isSoloAP
      ? { ...scenario, aps: scenario.aps.filter((a) => a.id === dragAP.id) }
      : scenario
    const renderScenario = isSoloAP ? soloScenario : scenario

    const opts = isSoloAP
      ? {
          // Single AP — keep refl/diff at user settings (cheap for 1 AP and
          // most visible when positioning near walls).
          maxReflOrder: hm.reflections ? 1 : 0,
          enableDiffraction: hm.diffraction,
          padding,
        }
      : {
          maxReflOrder: lodActive ? 0 : (hm.reflections ? 1 : 0),
          enableDiffraction: lodActive ? false : hm.diffraction,
          padding,
          // Cull faraway APs to the noise floor during a live drag — lossless
          // within colormap resolution, skips their per-fragment work.
          ...(lodActive ? { cullFloorDbm: -95 } : {}),
        }

    let field
    if (hm.engine === 'shader') {
      try {
        field = sampleFieldGL(renderScenario, hm.gridStepM, opts)
      } catch (e) {
        console.warn('[heatmap] shader engine failed, falling back to JS:', e.message)
        field = sampleField(renderScenario, hm.gridStepM, opts)
      }
    } else {
      field = sampleField(renderScenario, hm.gridStepM, opts)
    }

    // Solo-AP always renders in RSSI (a single AP has no SINR / CCI). Live LOD
    // drops blur + contours; idle and solo-AP keep the user settings.
    const modeCfg = isSoloAP ? getModeConfig('rssi') : getModeConfig(hm.mode)
    const activeField = field[modeCfg.field] ?? field.rssi
    const renderField = { rssi: activeField, nx: field.nx, ny: field.ny }
    const useBlur     = isSoloAP ? hm.blur         : (lodActive ? 0     : hm.blur)
    const useContours = isSoloAP ? hm.showContours : (lodActive ? false : hm.showContours)

    // The padded region IS sampled (so the kernel resolves correctly at
    // the floor-plan edge) but spills past the image extent — sprite
    // position + size compensate so the floor-rect-aligned portion lines
    // up perfectly with the floor image, and the padding bleeds into the
    // dark canvas background outside it.
    const totalWm = scenario.size.w + padding.left + padding.right
    const totalHm = scenario.size.h + padding.top  + padding.bottom
    const outW = Math.max(1, Math.round(totalWm * floor.scale))
    const outH = Math.max(1, Math.round(totalHm * floor.scale))

    gl.render(renderField, outW, outH, 1 / floor.scale, useBlur, useContours, {
      anchors: modeCfg.anchors,
    })

    // PIXI v8 CanvasSource caches its dimensions at create-time; resize so
    // the GPU texture upload reuploads at the new resolution after heatmapGL
    // mutates canvas.width/height in-place.
    if (texture.source.width !== gl.canvas.width || texture.source.height !== gl.canvas.height) {
      texture.source.resize(gl.canvas.width, gl.canvas.height)
    }
    texture.source.update()

    // Anchor sprite top-left at (-padLpx, -padTpx) so the unpadded
    // floor-plan rect (scenario.size.w × h) aligns with (0,0)→(imgW,imgH)
    // in world space. Mirrors oldSrc KonvaImage offsetX/offsetY trick.
    const padLpx = padding.left * floor.scale
    const padTpx = padding.top  * floor.scale
    const fullW  = totalWm * floor.scale
    const fullH  = totalHm * floor.scale
    s.x = -padLpx
    s.y = -padTpx
    s.scale.set(fullW / gl.canvas.width, fullH / gl.canvas.height)
    s.visible = true
    // Solo-AP: dim the frozen snapshot underneath to 0.3 so the single moving
    // AP reads clearly on top (oldSrc displayMode 'solo-ap'). Otherwise the
    // snapshot is hidden (idle / live both show only the live sprite).
    if (snapSprite) {
      if (isSoloAP && snapCanvas) {
        snapSprite.visible = true
        snapSprite.alpha = 0.3
      } else {
        snapSprite.visible = false
      }
    }
    // Clip the padded sprite to the floor image rect so the padding
    // sample region — which we WANT for kernel correctness near edges
    // — never bleeds visually past the floor extent.
    if (maskG) {
      maskG.clear()
      maskG.rect(0, 0, floor.imageWidth, floor.imageHeight)
        .fill({ color: 0xffffff, alpha: 1 })
    }
  }

  // Defer + coalesce compute (oldSrc HeatmapLayer.jsx 508: `setTimeout(run, 0)`).
  // Two reasons, both observed against oldSrc:
  //   1. Coalescing — a single user action often mutates several stores in the
  //      same synchronous task (e.g. drag-end fires setAP(null) on the overlay
  //      store AND updateAP() on the AP store back-to-back). With direct
  //      subscribers that's TWO full recomputes in one task; the macrotask
  //      hop collapses them into one.
  //   2. Task separation — running the recompute synchronously inside the
  //      pointerup handler bills its whole cost (sampleFieldGL + gl.render +
  //      the AP-marker redraw + the full-scene PIXI render that follows) to
  //      one [pointerup] long-task, blocking the release. oldSrc's setTimeout
  //      lets pointerup return and the browser paint the marker move first,
  //      then the heavy recompute runs in its own task — so the same work is
  //      split across tasks instead of stacked, which is why oldSrc's drag-end
  //      stall reads markedly lower than the synchronous path did.
  let pendingComputeId = 0
  const scheduleCompute = () => {
    if (pendingComputeId !== 0) return // already queued; coalesce
    pendingComputeId = setTimeout(() => {
      pendingComputeId = 0
      compute()
    }, 0)
  }
  const unsubHM = useHeatmapStore.subscribe(scheduleCompute)
  const unsubFloor = useFloorStore.subscribe(scheduleCompute)
  const unsubWall = useWallStore.subscribe(scheduleCompute)
  const unsubAP = useAPStore.subscribe(scheduleCompute)
  const unsubScope = useScopeStore ? useScopeStore.subscribe(scheduleCompute) : () => {}
  const unsubHole  = useFloorHoleStore ? useFloorHoleStore.subscribe(scheduleCompute) : () => {}
  // Drag overlay drives the live / solo drag render (AP follow, freeze,
  // single-AP overlay). Without this the dragMode control is inert.
  const unsubDrag = useDragOverlayStore ? useDragOverlayStore.subscribe(scheduleCompute) : () => {}
  compute()

  return () => {
    unsubHM()
    unsubFloor()
    unsubWall()
    unsubAP()
    unsubScope()
    unsubHole()
    unsubDrag()
    if (pendingComputeId !== 0) { clearTimeout(pendingComputeId); pendingComputeId = 0 }
    if (snapSprite) {
      snapSprite.mask = null
      layer.removeChild(snapSprite)
      snapSprite.destroy()
      snapSprite = null
    }
    if (snapTexture) { snapTexture.destroy(); snapTexture = null }
    snapCanvas = null
    if (maskG) {
      if (sprite) sprite.mask = null
      layer.removeChild(maskG)
      maskG.destroy()
      maskG = null
    }
    if (sprite) {
      layer.removeChild(sprite)
      sprite.destroy()
      sprite = null
    }
    if (texture) {
      texture.destroy()
      texture = null
    }
    if (gl) {
      gl.dispose()
      gl = null
    }
  }
}
