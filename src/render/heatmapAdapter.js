import { Sprite, Texture, Graphics } from 'pixi.js'
import { createHeatmapGL } from '@/features/heatmap/heatmapGL'
import { buildScenario } from '@/features/heatmap/buildScenario'
import { sampleFieldGL, sampleFieldGLAsync } from '@/features/heatmap/sampleFieldGL'
import { sampleField } from '@/features/heatmap/sampleField'
import { getModeConfig } from '@/features/heatmap/modes'
import { computeFloorElevations } from '@/utils/floorStacking'
import { EDITOR_MODE } from '@/store/useEditorStore'

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
// Phase 41 (無感重算):
//   41-1 idle recomputes run in TWO async stages — a coarse pass (≥1.0 m,
//        refl/diff off) paints within a frame or two, then the fine
//        user-quality pass retargets the transition when it lands.
//   41-2 landed fields paint IMMEDIATELY at full size; a decaying noise
//        ripple perturbs the contours while the fine stage computes (each
//        frame costs one perturbation pass + the heatmapGL colormap passes).
//        NOT an old→new dBm lerp — that read as coverage blobs
//        growing/shrinking when an AP moved (user-rejected 2026-07-03).
//   41-5 all idle GPU readbacks are PBO + fence (no main-thread stall);
//   41-6 per-AP CPU folds are sliced ~5 ms with macrotask yields.
//   Drag (solo/live) paths stay fully synchronous — they are the realtime
//   path and already run at degraded LOD.
//
// (Fingerprint-skip from oldSrc IS ported for idle computes — with the
// transition animation, a redundant recompute would show a visible morph
// pulse, not just waste a field sample. See lastIdleInputs.)
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

// ---- Phase 41-1/41-2 constants + pure helpers ----
// Coarse first-stage grid step: max(user step, 1.0 m). Same visual sweet spot
// as the drag-LOD step — near-indistinguishable once blur/bicubic upsample
// runs, ~3.9× fewer grid points than 0.5 m.
const COARSE_STEP_M = 1.0

// 41-2 wobble parameters. The transition is NOT an old→new dBm lerp — that
// reads as coverage blobs growing/shrinking (a moved AP's old blob collapses
// inward while the new one inflates from its centre), which the user
// rejected as physically wrong. Instead the new field paints IMMEDIATELY at
// full size and a drifting value-noise perturbation (±WOBBLE_AMP_DB) makes
// every contour line ripple while the fine result is still computing; when
// it lands the base swaps underneath (masked by the ripple) and the
// amplitude decays to zero.
const WOBBLE_AMP_DB = 1.6      // peak contour perturbation
const WOBBLE_LAMBDA_M = 2      // ripple wavelength (metres, world space)
const WOBBLE_DECAY_MS = 900    // amplitude ramp-down once the final field is in
const WOBBLE_HOLD_MAX_MS = 4000 // safety cap if the fine stage never lands

// Wrapped-bilinear sample of a latN×latN random lattice, output ≈ [-1, 1].
function latticeSample(lat, latN, u, v) {
  let x = u % latN; if (x < 0) x += latN
  let y = v % latN; if (y < 0) y += latN
  const x0 = x | 0, y0 = y | 0
  const x1 = (x0 + 1) % latN, y1 = (y0 + 1) % latN
  const fx = x - x0, fy = y - y0
  const a = lat[y0 * latN + x0], b = lat[y0 * latN + x1]
  const c = lat[y1 * latN + x0], d = lat[y1 * latN + x1]
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy
}

// out = base + amp × noise(worldXY drifting over time). Two counter-drifting
// samples interfere into a watery shimmer instead of one sliding pattern.
// NaN (scope-mask holes) stays NaN.
function wobbleInto(out, base, ampDb, tSec, lat, latN, nx, ny, stepM, originX, originY) {
  const inv = 1 / WOBBLE_LAMBDA_M
  const du1 = tSec * 0.55, dv1 = tSec * 0.40
  const du2 = -tSec * 0.37, dv2 = tSec * 0.29
  for (let j = 0; j < ny; j++) {
    const wy = (originY + j * stepM) * inv
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i
      const b = base[idx]
      if (Number.isNaN(b)) { out[idx] = NaN; continue }
      const wx = (originX + i * stepM) * inv
      const n = 0.6 * latticeSample(lat, latN, wx + du1, wy + dv1)
              + 0.4 * latticeSample(lat, latN, wx + du2 + 7.3, wy + dv2 + 3.1)
      out[idx] = b + ampDb * n
    }
  }
}

// Stable ref for floors with no scopes. An inline `?? []` here minted a NEW
// array every compute, so the idleInputs fingerprint never matched — any
// unrelated store event (toolbar hover toggling toolbarMenuOpen on the editor
// store) fired a full two-stage recompute plus a visible ripple pulse.
const EMPTY_SCOPES = []

// Shallow ===-compare of the idle-input snapshot. Store slices are replaced
// on every mutation (zustand immutability), so reference equality is exact.
function idleInputsEqual(a, b) {
  for (const k in a) {
    if (a[k] !== b[k]) return false
  }
  return true
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
  useEditorStore,
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

  // ---- Phase 41 state ----
  // generation: bumped on EVERY compute() entry; in-flight async idle results
  // compare against it and drop themselves when stale.
  let generation = 0
  // anim: live wobble state or null.
  //   { base:{grid,nx,ny,stepM,originX,originY}, ctx, t0, decayAt, lattice,
  //     latN, scratch, raf }
  // base is always the LATEST landed field (painted at full size instantly);
  // the raf loop only perturbs it. decayAt === null while the fine stage is
  // still pending (ripple keeps running as the "computing" signal).
  let anim = null
  // Inputs of the last COMPLETED idle compute. When nothing that feeds the
  // field changed (store refs + heatmap settings), compute() skips entirely —
  // without this, unrelated store events (editor-mode churn etc.) would fire
  // a redundant two-stage recompute plus a visible ripple pulse.
  let lastIdleInputs = null

  const cancelAnim = (finishToTarget = false) => {
    if (!anim) return
    const a = anim
    if (a.raf) cancelAnimationFrame(a.raf)
    anim = null
    if (finishToTarget) paintCanvas(a.base.grid, a.base.nx, a.base.ny, a.ctx)
  }

  const hide = () => {
    cancelAnim(false)
    lastIdleInputs = null
    if (sprite) sprite.visible = false
    if (snapSprite) snapSprite.visible = false
  }

  // Render one scalar grid through heatmapGL and present it: PIXI texture
  // update, sprite placement, floor-rect mask, on-demand render. Every paint —
  // drag frames, idle stages, animation frames — funnels through here.
  const paintCanvas = (grid, nx, ny, ctx) => {
    gl.render({ rssi: grid, nx, ny }, ctx.outW, ctx.outH, 1 / ctx.scale, ctx.blur, ctx.contours, {
      anchors: ctx.anchors,
    })
    // PIXI v8 CanvasSource caches its dimensions at create-time; resize so
    // the GPU texture upload reuploads at the new resolution after heatmapGL
    // mutates canvas.width/height in-place.
    if (texture.source.width !== gl.canvas.width || texture.source.height !== gl.canvas.height) {
      texture.source.resize(gl.canvas.width, gl.canvas.height)
    }
    texture.source.update()
    // Anchor sprite top-left at (-padLpx, -padTpx) so the unpadded floor-plan
    // rect aligns with (0,0)→(imgW,imgH) in world space.
    sprite.x = -ctx.padLpx
    sprite.y = -ctx.padTpx
    sprite.scale.set(ctx.fullW / gl.canvas.width, ctx.fullH / gl.canvas.height)
    sprite.visible = true
    // Idle paints replace whatever the solo snapshot was covering; during an
    // active solo drag the caller re-dims it right after.
    if (snapSprite && !soloActive) snapSprite.visible = false
    if (maskG) {
      maskG.clear()
      maskG.rect(0, 0, ctx.imgW, ctx.imgH)
        .fill({ color: 0xffffff, alpha: 1 })
    }
    if (typeof scene.requestRender === 'function') scene.requestRender()
  }

  // Phase 41-2: Hamina-style ripple transition. The landed field paints
  // IMMEDIATELY at full size (a moved AP's old blob vanishes at once and the
  // new one appears at its final contour size — no grow/shrink morph), then
  // every contour ripples under a decaying noise perturbation:
  //   coarse lands → paint + ripple at full amplitude (signals "computing")
  //   fine lands   → base swaps underneath (masked by the ripple) → decay
  // Each frame costs one wobbleInto pass + the heatmapGL passes; no
  // propagation recompute.
  const presentField = (target, ctx, awaitingFine) => {
    // 41-4 software renderer: every ripple frame would re-run the colormap
    // passes on the CPU — paint directly instead.
    if (useHeatmapStore.getState().isSoftwareRender) {
      cancelAnim(false)
      paintCanvas(target.grid, target.nx, target.ny, ctx)
      return
    }
    const now = performance.now()
    if (anim) {
      // Retarget: swap the base under the running ripple. Fine arriving
      // (awaitingFine=false) arms the decay.
      anim.base = target
      anim.ctx = ctx
      if (!awaitingFine && anim.decayAt === null) anim.decayAt = now
      return
    }
    const latN = 32
    const lattice = new Float32Array(latN * latN)
    for (let i = 0; i < lattice.length; i++) lattice[i] = Math.random() * 2 - 1
    const state = {
      base: target, ctx, t0: now,
      decayAt: awaitingFine ? null : now,
      lattice, latN, scratch: null, raf: 0,
    }
    anim = state
    const tick = () => {
      if (anim !== state) return
      const t = performance.now()
      // Safety cap: never ripple forever if the fine stage errored/stalled.
      if (state.decayAt === null && t - state.t0 > WOBBLE_HOLD_MAX_MS) state.decayAt = t
      let amp = WOBBLE_AMP_DB
      if (state.decayAt !== null) {
        const d = (t - state.decayAt) / WOBBLE_DECAY_MS
        if (d >= 1) {
          anim = null
          paintCanvas(state.base.grid, state.base.nx, state.base.ny, state.ctx)
          return
        }
        amp *= (1 - d) * (1 - d)
      }
      const b = state.base
      if (!state.scratch || state.scratch.length !== b.grid.length) {
        state.scratch = new Float32Array(b.grid.length)
      }
      wobbleInto(state.scratch, b.grid, amp, (t - state.t0) / 1000, state.lattice, state.latN,
        b.nx, b.ny, b.stepM, b.originX, b.originY)
      paintCanvas(state.scratch, b.nx, b.ny, state.ctx)
      state.raf = requestAnimationFrame(tick)
    }
    tick()
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
    // Any newer compute invalidates in-flight async idle stages (they poll
    // this via isStale and drop their result instead of painting stale data).
    generation++
    const hm = useHeatmapStore.getState()
    if (!hm.enabled) {
      hide()
      soloActive = false
      // 任務 4: clear the large-scene notice when the heatmap is off so it
      // can't linger stale into the next enable.
      useHeatmapStore.getState().setSimplifiedLargeScene(false)
      // Also clear the draw-wall freeze notice — heatmap off, nothing frozen.
      useHeatmapStore.getState().setDrawWallFrozen(false)
      return
    }

    // Freeze during wall drawing. DRAW_WALL commits each segment to the wall
    // store immediately (draftModeController), so drawing a chain of N walls
    // would otherwise fire N full recomputes — each a per-AP refl/diff pass.
    // While in DRAW_WALL we leave the existing heatmap sprite untouched (shows
    // the pre-draw field as a reference) and skip recompute entirely; leaving
    // the mode triggers an editor-store change → a normal recompute restores
    // the live field. A store flag drives a HeatmapControl notice so the user
    // knows the field is stale. Exception: if the heatmap was never rendered
    // (no sprite yet) we don't freeze — compute once so there's a base image.
    const editorMode = useEditorStore ? useEditorStore.getState().editorMode : null
    if (editorMode === EDITOR_MODE.DRAW_WALL && sprite) {
      useHeatmapStore.getState().setDrawWallFrozen(true)
      return
    }
    useHeatmapStore.getState().setDrawWallFrozen(false)

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
      ? (useScopeStore.getState().scopesByFloor?.[activeFloorId] ?? EMPTY_SCOPES)
      : EMPTY_SCOPES

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
      // Finish a mid-flight transition first so the snapshot freezes the
      // settled field, not an interpolation frame.
      cancelAnim(true)
      takeSnapshot()
      soloActive = true
    } else if (!isSolo && soloActive) {
      soloActive = false
      // Release: change NOTHING visually — keep the exact drag-time composite
      // (dimmed pre-drag snapshot + bright single-AP overlay) until the first
      // idle paint swaps the new full field in. Restoring the snapshot to
      // full alpha here (an earlier attempt) flashed the moved AP's OLD blob
      // back and dropped its new contour for the whole coarse-compute window
      // — very visible on big scenes where that window is 1-2 s.
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

    // 任務 4 (b): large-scene downgrade. The per-AP path cost scales with
    // wall×AP (each AP's pass scans the walls for penetration + reflection +
    // diffraction), so once the product crosses a threshold we drop refl/diff
    // for the WHOLE compute — idle and drag alike — forcing the cheap
    // aggregated single-pass (canUseAggregated becomes true). The threshold is
    // far lower on a software renderer (single-core shader) than on a real GPU.
    // 任務 4 (a): isSoftwareRender (probed once at store init) picks which.
    //
    // NOTE: the two thresholds below are PLACEHOLDERS. They must be calibrated
    // on the user's software-render machine by measuring full-quality single
    // compute time across (wall, AP) combinations and finding the largest
    // product that still feels acceptable. HW GPU can tolerate a much higher
    // product. Until calibrated, these are conservative guesses.
    const SW_WALL_AP_THRESHOLD = 1500   // PLACEHOLDER — calibrate on SW machine
    const HW_WALL_AP_THRESHOLD = 20000  // PLACEHOLDER — calibrate on HW machine
    const wallApProduct = walls.length * scenario.aps.length
    const threshold = hm.isSoftwareRender ? SW_WALL_AP_THRESHOLD : HW_WALL_AP_THRESHOLD
    const forceAggregated = wallApProduct > threshold
    // Surface to the UI (no-op setter when unchanged, so it won't loop the
    // store subscription that drives compute).
    useHeatmapStore.getState().setSimplifiedLargeScene(forceAggregated)

    // The padded region IS sampled (so the kernel resolves correctly at
    // the floor-plan edge) but spills past the image extent — sprite
    // position + size compensate (in paintCanvas) so the floor-rect-aligned
    // portion lines up perfectly with the floor image, and the padding
    // bleeds into the dark canvas background outside it (clipped by maskG).
    const totalWm = scenario.size.w + padding.left + padding.right
    const totalHm = scenario.size.h + padding.top  + padding.bottom
    const ctxBase = {
      outW: Math.max(1, Math.round(totalWm * floor.scale)),
      outH: Math.max(1, Math.round(totalHm * floor.scale)),
      scale: floor.scale,
      padLpx: padding.left * floor.scale,
      padTpx: padding.top  * floor.scale,
      fullW: totalWm * floor.scale,
      fullH: totalHm * floor.scale,
      imgW: floor.imageWidth,
      imgH: floor.imageHeight,
      floorId: floor.id,
    }

    const isDragRender = isSoloAP || lodActive
    if (isDragRender) {
      // Drag frames stay fully synchronous — they ARE the realtime path.
      cancelAnim(false)
      lastIdleInputs = null

      // Solo-AP: render ONLY the dragged AP at full quality over a dimmed
      // snapshot. Live-drag (lodActive): full recompute with LOD compromises
      // (reflections/diffraction/blur/contours off, faraway APs culled at
      // -95 dBm). (oldSrc HeatmapLayer 322-495.)
      const renderScenario = isSoloAP
        ? { ...scenario, aps: scenario.aps.filter((a) => a.id === dragAP.id) }
        : scenario

      const opts = isSoloAP
        ? {
            // Single AP — keep refl/diff at user settings (cheap for 1 AP and
            // most visible when positioning near walls). Stays on the per-AP
            // path; the drag speedup for solo comes from the coarser grid below.
            // forceAggregated overrides even here: a huge scene's snapshot/
            // single-AP overlay should also skip the expensive refl/diff scan.
            maxReflOrder: forceAggregated ? 0 : (hm.reflections ? 1 : 0),
            enableDiffraction: forceAggregated ? false : hm.diffraction,
            padding,
          }
        : {
            maxReflOrder: 0,
            enableDiffraction: false,
            padding,
            // Cull faraway APs to the noise floor during a live drag — lossless
            // within colormap resolution, skips their per-fragment work.
            cullFloorDbm: -95,
          }

      // Coarsen the sample grid while dragging (任務 1). 0.5 m → 1.0 m drops the
      // grid point count ~3.9× (nx×ny), the dominant per-frame cost on a software
      // renderer (per-AP readback + the host aggregate loop both scale with
      // nx×ny). 1.0 m is the visual sweet spot — near-indistinguishable from
      // 0.5 m once the blur upsample runs, while 1.5/2.0 visibly coarsen contours;
      // coarser values trade clarity for diminishing SW speedups (verified the
      // point-count drop is the lever, exact ms is SW-machine-dependent). Drag end
      // recomputes at the user's full gridStepM. max() so a user who already chose
      // a coarser grid via the HeatmapControl slider is never refined.
      const DRAG_GRID_STEP_M = 1.0
      const stepM = Math.max(hm.gridStepM, DRAG_GRID_STEP_M)

      let field
      if (hm.engine === 'shader') {
        try {
          field = sampleFieldGL(renderScenario, stepM, opts)
        } catch (e) {
          console.warn('[heatmap] shader engine failed, falling back to JS:', e.message)
          field = sampleField(renderScenario, stepM, opts)
        }
      } else {
        field = sampleField(renderScenario, stepM, opts)
      }

      // Solo-AP always renders in RSSI (a single AP has no SINR / CCI). Live
      // LOD drops blur + contours; solo-AP keeps the user settings.
      const modeCfg = isSoloAP ? getModeConfig('rssi') : getModeConfig(hm.mode)
      const activeField = field[modeCfg.field] ?? field.rssi
      paintCanvas(activeField, field.nx, field.ny, {
        ...ctxBase,
        blur:     isSoloAP ? hm.blur         : 0,
        contours: isSoloAP ? hm.showContours : false,
        anchors:  modeCfg.anchors,
      })
      // Solo-AP: dim the frozen snapshot underneath to 0.3 so the single
      // moving AP reads clearly on top (oldSrc displayMode 'solo-ap').
      if (snapSprite) {
        if (isSoloAP && snapCanvas) {
          snapSprite.visible = true
          snapSprite.alpha = 0.3
        } else {
          snapSprite.visible = false
        }
      }
      return
    }

    // ---- idle: Phase 41-1 two-stage async compute ----
    // Skip entirely when nothing that feeds the field changed — unrelated
    // store events (editor-mode churn, selection) would otherwise fire a
    // redundant recompute plus a visible transition pulse.
    const idleInputs = {
      floorId: activeFloorId, scale: floor.scale,
      // wallsByFloor (not just the active floor's list): other floors' walls
      // feed the cross-floor penetration term, so their edits must recompute.
      wallsAll: useWallStore.getState().wallsByFloor,
      apsAll: apsByFloorAll, scopes,
      holes: useFloorHoleStore ? useFloorHoleStore.getState().floorHolesByFloor : null,
      floors,
      mode: hm.mode, engine: hm.engine, gridStepM: hm.gridStepM,
      blur: hm.blur, contours: hm.showContours,
      reflections: hm.reflections, diffraction: hm.diffraction,
      forceAggregated,
    }
    if (lastIdleInputs && idleInputsEqual(idleInputs, lastIdleInputs)) return
    runIdle(generation, scenario, hm, ctxBase, forceAggregated, padding, idleInputs)
  }

  // Phase 41-1: idle recompute in two stages. The coarse stage (≥1.0 m grid,
  // refl/diff off → aggregated single pass) lands within a frame or two and
  // starts the fluid transition; the fine stage (user-quality) computes in
  // the background — GPU work behind a fence, CPU folds sliced ~5 ms — and
  // retargets the transition when it arrives. Every await checks the
  // generation so a newer compute() drops this one wholesale.
  const runIdle = async (gen, scenario, hm, ctxBase, forceAggregated, padding, idleInputs) => {
    const isStale = () => gen !== generation
    const baseOpts = {
      maxReflOrder: forceAggregated ? 0 : (hm.reflections ? 1 : 0),
      enableDiffraction: forceAggregated ? false : hm.diffraction,
      padding,
    }
    const modeCfg = getModeConfig(hm.mode)
    const ctx = { ...ctxBase, blur: hm.blur, contours: hm.showContours, anchors: modeCfg.anchors }
    const present = (field, awaitingFine) => {
      const activeField = field[modeCfg.field] ?? field.rssi
      presentField({
        grid: activeField, nx: field.nx, ny: field.ny,
        stepM: field.gridStepM, originX: field.originX, originY: field.originY,
      }, ctx, awaitingFine)
    }
    const stage = async (stepM, opts) => {
      try {
        return await sampleFieldGLAsync(scenario, stepM, { ...opts, isStale })
      } catch (e) {
        console.warn('[heatmap] async shader engine failed, falling back to JS:', e.message)
        return sampleField(scenario, stepM, opts)
      }
    }
    try {
      // JS engine: single synchronous stage (pre-41 behaviour) + a short
      // settle ripple.
      if (hm.engine !== 'shader') {
        const field = sampleField(scenario, hm.gridStepM, baseOpts)
        if (isStale()) return
        present(field, false)
        lastIdleInputs = idleInputs
        return
      }
      const coarseStep = Math.max(hm.gridStepM, COARSE_STEP_M)
      const fineNeeded = hm.gridStepM < coarseStep || baseOpts.maxReflOrder > 0 || baseOpts.enableDiffraction
      // gridCacheEnabled:false on a non-final coarse stage — its per-AP grids
      // (custom-AP scenes) would evict the fine-quality cache entries that
      // make unchanged-AP recomputes cheap.
      const coarse = await stage(coarseStep, fineNeeded
        ? { ...baseOpts, maxReflOrder: 0, enableDiffraction: false, gridCacheEnabled: false }
        : baseOpts)
      if (coarse === null || isStale()) return
      present(coarse, fineNeeded)
      if (!fineNeeded) {
        lastIdleInputs = idleInputs
        return
      }
      // Task boundary so the first ripple frames paint before the fine
      // stage's (small) synchronous command encoding runs.
      await new Promise((r) => setTimeout(r, 0))
      if (isStale()) return
      const fine = await stage(hm.gridStepM, baseOpts)
      if (fine === null || isStale()) return
      present(fine, false)
      lastIdleInputs = idleInputs
    } catch (e) {
      console.warn('[heatmap] idle compute failed:', e.message)
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
  let debounceId = 0
  const runCompute = () => {
    // Whichever scheduler fires, the compute reads the LATEST store state, so
    // any other pending timer is redundant — cancel it instead of paying a
    // second full recompute right after this one.
    if (pendingComputeId !== 0) { clearTimeout(pendingComputeId); pendingComputeId = 0 }
    if (debounceId !== 0) { clearTimeout(debounceId); debounceId = 0 }
    compute()
    // PIXI renders on demand. Pre-debounce, the store change's own layer
    // redraw scheduled a rAF render that happened to paint AFTER the 0ms
    // compute; with the 250ms debounce that rAF is long gone by the time the
    // texture updates, so the fresh pixels would sit unpresented until the
    // NEXT interaction (heatmap looked one-change-behind). Present explicitly.
    if (typeof scene.requestRender === 'function') scene.requestRender()
  }
  const scheduleCompute = () => {
    if (pendingComputeId !== 0) return // already queued; coalesce
    pendingComputeId = setTimeout(runCompute, 0)
  }
  // Trailing debounce for DATA-store edits (AP / wall / scope / hole / floor).
  // Rapid parameter changes — holding ↑ on the azimuth input, dragging the
  // pattern-preview lobe — fire one store update per event, each previously a
  // full-quality recompute. 400 ms of quiet collapses the burst into ONE.
  // Drag-overlay / editor-mode / heatmap-toggle changes stay on the immediate
  // path: drags need the per-frame solo/live render, toggles are single events.
  const DEBOUNCE_MS = 400
  const scheduleComputeDebounced = () => {
    if (debounceId !== 0) clearTimeout(debounceId)
    debounceId = setTimeout(runCompute, DEBOUNCE_MS)
  }
  const unsubHM = useHeatmapStore.subscribe(scheduleCompute)
  const unsubFloor = useFloorStore.subscribe(scheduleComputeDebounced)
  const unsubWall = useWallStore.subscribe(scheduleComputeDebounced)
  const unsubAP = useAPStore.subscribe(scheduleComputeDebounced)
  const unsubScope = useScopeStore ? useScopeStore.subscribe(scheduleComputeDebounced) : () => {}
  const unsubHole  = useFloorHoleStore ? useFloorHoleStore.subscribe(scheduleComputeDebounced) : () => {}
  // Drag overlay drives the live / solo drag render (AP follow, freeze,
  // single-AP overlay). Without this the dragMode control is inert.
  const unsubDrag = useDragOverlayStore ? useDragOverlayStore.subscribe(scheduleCompute) : () => {}
  // Editor mode drives the DRAW_WALL freeze: entering it freezes (compute
  // early-returns), leaving it triggers a recompute that restores the live
  // field. Without this subscription the heatmap would stay frozen until some
  // other store changed.
  const unsubEditor = useEditorStore ? useEditorStore.subscribe(scheduleCompute) : () => {}
  runCompute()

  return () => {
    generation++ // orphan any in-flight idle stages
    cancelAnim(false)
    unsubHM()
    unsubFloor()
    unsubWall()
    unsubAP()
    unsubScope()
    unsubHole()
    unsubDrag()
    unsubEditor()
    if (pendingComputeId !== 0) { clearTimeout(pendingComputeId); pendingComputeId = 0 }
    if (debounceId !== 0) { clearTimeout(debounceId); debounceId = 0 }
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
