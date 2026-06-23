import { Sprite, Texture, Graphics } from 'pixi.js'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { computeOccupancyGrid, renderOccupancyCanvas } from './occupancyGrid'
import { computeFlowGrid } from './analyticsStats'
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

// Flow-map arrows (occupancyMode 'flow').
const FLOW_COLOR = '#06b6d4'
const FLOW_MIN_COUNT_FRAC = 0.04   // hide cells with too few movement samples

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

  // Flow arrows: one per cell with a clear net direction; length follows the
  // cell pitch, opacity follows how much traffic the cell saw.
  const drawFlow = (flow) => {
    for (const cell of flow.cells) {
      const frac = cell.count / (flow.maxCount || 1)
      if (frac < FLOW_MIN_COUNT_FRAC) continue
      const cx = (cell.cx + 0.5) * flow.cellPx
      const cy = (cell.cy + 0.5) * flow.cellPx
      const mag = Math.hypot(cell.vx, cell.vy)
      const ux = cell.vx / mag
      const uy = cell.vy / mag
      const len = flow.cellPx * 0.42
      const alpha = 0.35 + 0.65 * Math.min(1, frac * 3)
      const w = 1.5 + 1.5 * Math.min(1, frac * 3)
      const x0 = cx - ux * len, y0 = cy - uy * len
      const x1 = cx + ux * len, y1 = cy + uy * len
      flowG.moveTo(x0, y0).lineTo(x1, y1)
        .stroke({ width: w, color: FLOW_COLOR, alpha, cap: 'round' })
      // arrowhead
      const hw = len * 0.45
      flowG.poly([
        x1, y1,
        x1 - ux * hw - uy * hw * 0.6, y1 - uy * hw + ux * hw * 0.6,
        x1 - ux * hw + uy * hw * 0.6, y1 - uy * hw - ux * hw * 0.6,
      ]).fill({ color: FLOW_COLOR, alpha })
    }
  }

  const rebuild = () => {
    const tr = useTrackingStore.getState()
    const { floors, activeFloorId } = useFloorStore.getState()
    const floor = floors.find((f) => f.id === activeFloorId)
    flowG.clear()
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
      const flow = computeFlowGrid(common)
      if (flow) drawFlow(flow)
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
    unsubTracking()
    unsubFloor()
    unsubEditor()
    clearSprite()
    layer.removeChild(flowG)
    flowG.destroy()
  }
}
