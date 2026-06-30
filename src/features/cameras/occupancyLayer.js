import { Sprite, Texture, Graphics } from 'pixi.js'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { computeOccupancyGrid, renderOccupancyCanvas } from './occupancyGrid'
import { computeFlowGrid, computeStreamlines } from './analyticsStats'
import { FALLBACK_PX_PER_M } from './camerasLayer'

// Occupancy heatmap sprite for Camera mode (Phase 34-3). Sits at the BOTTOM
// of the cameraFov layer — above the floor image, below the FOV cones and
// the walls — so hot zones read as part of the floor.
//
// Recompute is debounced: integrating a full day (~250k samples) costs tens
// of ms, fine for a settings change but not per-frame. Inputs that trigger a
// rebuild: tracks / mode / time window / floor. Playback clock does NOT —
// the heatmap is an aggregate, deliberately independent of the scrubber.

const RECOMPUTE_DEBOUNCE_MS = 120
// Max time the debounce can be deferred before a forced rebuild — keeps the
// timelapse animating (its window changes every frame) instead of the debounce
// resetting forever and freezing the heatmap.
const RECOMPUTE_MAX_WAIT_MS = 200

// Flow map (occupancyMode 'flow') — rendered as streamlines: continuous
// glowing "movement corridors" traced through the velocity field, with a slow
// dash crawl so the direction of travel reads at a glance.
const FLOW_COLOR = 0x22d3ee          // cyan-400, matches the camera-mode palette
const FLOW_DASH_PX = 26              // spacing between flow chevrons (canvas px)
const FLOW_CRAWL_PX_PER_SEC = 34     // how fast the chevrons march along the line

export function attachOccupancyLayer({
  scene,
  useFloorStore,
  useTrackingStore,
}) {
  const layer = scene.layers.cameraFov
  let sprite = null
  let timer = null
  const flowG = new Graphics()
  flowG.eventMode = 'none'
  layer.addChild(flowG)

  const isCameraMode = () => useEditorStore.getState().editorMode === EDITOR_MODE.CAMERA

  const clearSprite = () => {
    if (!sprite) return
    layer.removeChild(sprite)
    sprite.destroy({ texture: true })
    sprite = null
  }

  // Cached streamlines for the active window — each line carries its polyline
  // plus a precomputed cumulative arc-length table so the crawl animation can
  // place flow chevrons at exact distances without re-measuring every frame.
  let streamlines = null

  // Walk a streamline's cumulative-length table to the point at arc-length `d`,
  // returning { x, y, ux, uy } (position + unit tangent).
  const pointAtArc = (line, d) => {
    const { pts, cum } = line
    const total = cum[cum.length - 1]
    if (total <= 0) return null
    const dd = Math.min(Math.max(d, 0), total)
    let i = 1
    while (i < cum.length && cum[i] < dd) i++
    if (i >= cum.length) i = cum.length - 1
    const a = pts[i - 1], b = pts[i]
    const seg = cum[i] - cum[i - 1] || 1
    const f = (dd - cum[i - 1]) / seg
    const mag = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      ux: (b.x - a.x) / mag,
      uy: (b.y - a.y) / mag,
    }
  }

  // Draw the cached streamlines. Each line is exactly ONE polyline stroke plus
  // a handful of flow chevrons — never a per-segment stroke (that piles up
  // hundreds of separate geometries per line and overflows PIXI's batch vertex
  // buffer, blanking the whole canvas). `crawl` (px) slides the chevrons
  // downstream so the direction of travel reads at a glance.
  const drawStreamlines = (crawl) => {
    flowG.clear()
    if (!streamlines) return
    for (const line of streamlines.lines) {
      const pts = line.pts
      if (pts.length < 2) continue
      const total = line.cum[line.cum.length - 1]
      if (total <= 0) continue
      const alpha = 0.30 + 0.55 * Math.min(1, line.strength * 2.2)
      const w = 2 + 4 * Math.min(1, line.strength * 2.2)

      // core line — a single stroke for the whole polyline
      flowG.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) flowG.lineTo(pts[i].x, pts[i].y)
      flowG.stroke({ width: w, color: FLOW_COLOR, alpha: alpha * 0.55, cap: 'round', join: 'round' })

      // flow chevrons — one ">" every FLOW_DASH_PX, all shifted by `crawl` so
      // they march downstream. Count is bounded by length / pitch, so the layer
      // stays at a few hundred tiny polys total.
      const hw = 4 + 3 * Math.min(1, line.strength * 2.2)
      const start = ((crawl % FLOW_DASH_PX) + FLOW_DASH_PX) % FLOW_DASH_PX
      for (let d = start; d < total; d += FLOW_DASH_PX) {
        const p = pointAtArc(line, d)
        if (!p) continue
        const nx = -p.uy, ny = p.ux   // left normal
        flowG.poly([
          p.x, p.y,
          p.x - p.ux * hw + nx * hw * 0.8, p.y - p.uy * hw + ny * hw * 0.8,
          p.x - p.ux * hw * 0.4, p.y - p.uy * hw * 0.4,
          p.x - p.ux * hw - nx * hw * 0.8, p.y - p.uy * hw - ny * hw * 0.8,
        ]).fill({ color: FLOW_COLOR, alpha })
      }
    }
  }

  // ── Streamline crawl loop ───────────────────────────────────────────────
  // Self-contained rAF (same shape as camerasLayer's FOV pulse): runs only
  // while flow streamlines exist and we're in Camera mode, so render-on-demand
  // idle is preserved otherwise. Stops itself when streamlines clear.
  let flowRaf = 0
  const flowTick = (ts) => {
    if (!isCameraMode() || !streamlines) { flowRaf = 0; return }
    const crawl = (ts / 1000) * FLOW_CRAWL_PX_PER_SEC
    drawStreamlines(crawl)
    scene.requestRender()
    flowRaf = requestAnimationFrame(flowTick)
  }
  const syncFlow = () => {
    if (isCameraMode() && streamlines && flowRaf === 0) {
      flowRaf = requestAnimationFrame(flowTick)
    }
  }

  const rebuild = () => {
    const tr = useTrackingStore.getState()
    const { floors, activeFloorId } = useFloorStore.getState()
    const floor = floors.find((f) => f.id === activeFloorId)
    flowG.clear()
    streamlines = null
    if (!isCameraMode() || tr.occupancyMode === 'off' || !floor?.imageWidth) {
      clearSprite()
      scene.requestRender()
      return
    }
    const common = {
      tracks: tr.tracksByFloor[activeFloorId] ?? [],
      tFromSec: tr.occupancyFromSec,
      tToSec: tr.occupancyToSec,
      imageWidth: floor.imageWidth,
      imageHeight: floor.imageHeight,
      pxPerM: floor.scale ?? FALLBACK_PX_PER_M,
    }
    if (tr.occupancyMode === 'flow') {
      clearSprite()
      // Coarser cells than the heatmap (1.5 m vs 0.5 m): over a long window a
      // fine grid splinters into many short divergent bundles, so a slightly
      // bigger cell averages each octant bin over more samples → steadier
      // direction field and longer, cleaner streamlines.
      const flow = computeFlowGrid({ ...common, cellM: 1.5 })
      streamlines = flow ? computeStreamlines(flow) : null
      drawStreamlines(0)
      syncFlow()              // start the crawl loop if we have lines
      scene.requestRender()
      return
    }
    const result = computeOccupancyGrid({ ...common, mode: tr.occupancyMode })
    clearSprite()
    if (!result) { scene.requestRender(); return }
    const canvas = renderOccupancyCanvas(result)
    sprite = new Sprite(Texture.from(canvas))
    sprite.eventMode = 'none'
    // Stretch the per-cell canvas over the full floor — bilinear filtering
    // does the smoothing.
    sprite.width = result.cols * result.cellPx
    sprite.height = result.rows * result.cellPx
    layer.addChildAt(sprite, 0)
    scene.requestRender()
  }

  // Debounce, but with a MAX WAIT: while the timelapse is playing, the window
  // changes every frame, which would reset a plain debounce forever and freeze
  // the heatmap (it never gets to rebuild). The max-wait guarantees a refresh
  // at least every RECOMPUTE_MAX_WAIT_MS so the lapse animates and a mode
  // switch mid-lapse takes effect.
  let lastRunTs = 0
  const scheduleRebuild = () => {
    const now = performance.now()
    if (timer) clearTimeout(timer)
    if (lastRunTs && now - lastRunTs >= RECOMPUTE_MAX_WAIT_MS) {
      lastRunTs = now
      rebuild()
      return
    }
    timer = setTimeout(() => {
      timer = null
      lastRunTs = performance.now()
      rebuild()
    }, RECOMPUTE_DEBOUNCE_MS)
  }

  // Diff the inputs by hand — the tracking store changes every playback frame
  // (clockSec), and rebuilding then would melt the CPU.
  let prev = snapshot()
  function snapshot() {
    const tr = useTrackingStore.getState()
    const fid = useFloorStore.getState().activeFloorId
    return {
      mode: tr.occupancyMode,
      from: tr.occupancyFromSec,
      to: tr.occupancyToSec,
      tracks: tr.tracksByFloor[fid],
      fid,
      inCamera: isCameraMode(),
    }
  }
  const onChange = () => {
    const cur = snapshot()
    if (cur.mode === prev.mode && cur.from === prev.from && cur.to === prev.to
      && cur.tracks === prev.tracks && cur.fid === prev.fid && cur.inCamera === prev.inCamera) return
    prev = cur
    scheduleRebuild()
  }

  const unsubTracking = useTrackingStore.subscribe(onChange)
  const unsubFloor = useFloorStore.subscribe(onChange)
  const unsubEditor = useEditorStore.subscribe(onChange)
  rebuild()

  return () => {
    if (timer) clearTimeout(timer)
    if (flowRaf) cancelAnimationFrame(flowRaf)
    unsubTracking()
    unsubFloor()
    unsubEditor()
    clearSprite()
    layer.removeChild(flowG)
    flowG.destroy()
  }
}
