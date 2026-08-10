import { create } from 'zustand'
import { createHeatmapGL } from '@/features/heatmap/heatmapGL'
import { buildScenario } from '@/features/heatmap/buildScenario'
import { buildCrossFloorData } from '@/features/heatmap/buildCrossFloor'
import { sampleFieldGLAsync } from '@/features/heatmap/sampleFieldGL'
import { sampleField } from '@/features/heatmap/sampleField'
import { getModeConfig } from '@/features/heatmap/modes'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'

// 3D all-floors heatmap stack (Phase 48+, strategy A: compute ON DEMAND).
//
// The 2D adapter maintains exactly ONE field — the active floor's — and 3D's
// active plane consumes its canvas via heatmapFrameBus. This module computes
// the OTHER floors' fields (each at its own rx height, with the full
// cross-floor model relative to THAT floor) only while the user is in 3D
// with the「全樓層熱圖」toggle on. Results are painted to per-floor 2D
// canvases consumed by HeatmapStackPlane3D.
//
// Cache: a fingerprint of every input that feeds the fields (store object
// refs + heatmap settings). Toggling the view or the switch off/on without
// any data change re-uses the cached canvases — zero recompute (user
// requirement). Any change → all floors stale (cross-floor coupling: one
// floor's AP/wall/slab edit affects every floor's field), recompute
// sequentially with a yield between floors so planes pop in one by one.
//
// Not here on purpose: ripple transitions, drag paths, coarse-first stages —
// 3D is a read-only view; a single idle-quality stage per floor is enough.

export const useHeatmapStackStore = create((set) => ({
  // floorId → { canvas, imgW, imgH, floorId, rev }
  frames: {},
  setFrame: (floorId, frame) =>
    set((s) => ({ frames: { ...s.frames, [floorId]: frame } })),
  setFrames: (frames) => set({ frames }),
}))

let fingerprint = null
let generation = 0
let paintGL = null      // lazy colormap-render GL (separate from the adapter's)
let ensureTimer = 0

const FP_KEYS = [
  'activeFloorId', 'floors', 'wallsAll', 'apsAll', 'holes',
  'mode', 'engine', 'gridStepM', 'blur', 'contours',
  'reflections', 'diffraction', 'bandFilter',
]
const fpEqual = (a, b) => FP_KEYS.every((k) => a[k] === b[k])

const buildFingerprint = () => {
  const hm = useHeatmapStore.getState()
  const { floors, activeFloorId } = useFloorStore.getState()
  return {
    activeFloorId,
    floors,
    wallsAll: useWallStore.getState().wallsByFloor,
    apsAll: useAPStore.getState().apsByFloor,
    holes: useFloorHoleStore.getState().floorHolesByFloor,
    mode: hm.mode, engine: hm.engine, gridStepM: hm.gridStepM,
    blur: hm.blur, contours: hm.showContours,
    reflections: hm.reflections, diffraction: hm.diffraction,
    bandFilter: hm.bandFilter,
  }
}

const ensureStack = async () => {
  const fp = buildFingerprint()
  if (fingerprint && fpEqual(fp, fingerprint)) return   // cache hit — no work
  const gen = ++generation
  const isStale = () => gen !== generation

  const { floors, activeFloorId } = fp
  const hm = useHeatmapStore.getState()
  const bandFilter = hm.bandFilter || 'all'
  const mapAps = (list) =>
    bandFilter === 'all' ? (list ?? []) : (list ?? []).filter((a) => String(a.frequency) === bandFilter)
  const modeCfg = getModeConfig(hm.mode)

  // Every calibrated non-active floor gets a plane; the active floor keeps
  // the adapter-shared canvas (HeatmapPlane3D).
  const targets = floors.filter(
    (f) => f.id !== activeFloorId && f.scale && f.imageWidth && f.imageHeight,
  )

  const nextFrames = {}
  for (const f of targets) {
    if (isStale()) return
    const walls = fp.wallsAll[f.id] ?? []
    const aps = mapAps(fp.apsAll[f.id])
    const { crossFloor } = buildCrossFloorData({
      floors,
      activeFloorId: f.id,          // field computed FOR this floor
      apsByFloor: fp.apsAll,
      wallsByFloor: fp.wallsAll,
      holesByFloor: fp.holes,
      mapAps,
    })
    if (!crossFloor || crossFloor.apsByFloor.length === 0) continue
    const scenario = buildScenario(f, walls, aps, [], crossFloor)
    if (!scenario) continue

    // Mirror the adapter's large-scene downgrade (same PLACEHOLDER
    // thresholds — see heatmapAdapter 任務 4).
    const threshold = hm.isSoftwareRender ? 1500 : 20000
    const forceAggregated = walls.length * scenario.aps.length > threshold
    const opts = {
      maxReflOrder: forceAggregated ? 0 : (hm.reflections ? 1 : 0),
      enableDiffraction: forceAggregated ? false : hm.diffraction,
      isStale,
    }

    let field
    try {
      field = hm.engine === 'shader'
        ? await sampleFieldGLAsync(scenario, hm.gridStepM, opts)
        : sampleField(scenario, hm.gridStepM, opts)
    } catch (e) {
      console.warn('[heatmapStack] shader engine failed, falling back to JS:', e.message)
      field = sampleField(scenario, hm.gridStepM, opts)
    }
    if (!field || isStale()) return

    const grid = field[modeCfg.field] ?? field.rssi
    if (!paintGL) paintGL = createHeatmapGL()
    const outW = f.imageWidth
    const outH = f.imageHeight
    // No `edgeFeather` here, deliberately (51-11): unlike the active floor, the
    // stack samples the plan rect EXACTLY — no PAD_M margin — so its boundary
    // has no data beyond it to fade into, and a ramp would just dim real
    // readings at the edge. Stacked floors are background context anyway; the
    // feather is for the floor being read.
    paintGL.render(
      { rssi: grid, nx: field.nx, ny: field.ny },
      outW, outH, 1 / f.scale, hm.blur, hm.showContours,
      { anchors: modeCfg.anchors },
    )
    // Copy out — paintGL.canvas is reused for the next floor.
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    canvas.getContext('2d').drawImage(paintGL.canvas, 0, 0)
    if (isStale()) return

    const frame = { canvas, imgW: outW, imgH: outH, floorId: f.id, rev: gen }
    nextFrames[f.id] = frame
    useHeatmapStackStore.getState().setFrame(f.id, frame)   // progressive pop-in
    // Yield between floors so a long stack never owns the thread.
    await new Promise((r) => setTimeout(r, 0))
  }
  if (isStale()) return
  useHeatmapStackStore.getState().setFrames(nextFrames)      // prune stale floors
  fingerprint = fp
}

// Driver — attach while (3D visible && 全樓層 && 全樓層熱圖 && heatmap on).
// Subscribes the data stores so edits made FROM 3D (right-panel parameter
// changes) refresh the stack; detach keeps the cache (fingerprint decides
// whether the next attach recomputes).
export function attachHeatmapStackDriver() {
  const schedule = () => {
    if (ensureTimer) clearTimeout(ensureTimer)
    ensureTimer = setTimeout(() => { ensureTimer = 0; ensureStack() }, 250)
  }
  ensureStack()
  const unsubs = [
    useFloorStore.subscribe(schedule),
    useWallStore.subscribe(schedule),
    useAPStore.subscribe(schedule),
    useFloorHoleStore.subscribe(schedule),
    useHeatmapStore.subscribe(schedule),
  ]
  return () => {
    if (ensureTimer) { clearTimeout(ensureTimer); ensureTimer = 0 }
    // Abandon any in-flight run's staleness only on the NEXT ensure — an
    // almost-finished run may as well land in the cache for the next open.
    for (const u of unsubs) u()
  }
}
