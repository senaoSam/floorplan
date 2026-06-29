import { EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useTrackingStore } from '@/store/useTrackingStore'
import { useCameraStore } from '@/store/useCameraStore'
import { generateDayTracks, DAY_START_SEC, DAY_END_SEC } from './mockTracks'
import { bindTracksToCameras } from './projectTracks'

// Drives the Camera-mode playback clock + lazily generates the mock crowd.
//
// One rAF loop advances useTrackingStore.clockSec while (a) the editor is in
// CAMERA mode and (b) playing is on. Each tick writes the store, which both
// redraws tracksLayer and (via FloorplanSystem's render-on-demand wiring)
// schedules a PIXI render — leaving the mode or pausing stops the loop, so
// the render-on-demand idle guarantee is preserved outside playback.
//
// Mock data: the first time CAMERA mode opens on a floor (with an image),
// a full day of tracks is generated for it. The seed is stored per floor so
// regeneration is explicit (TimelineBar's 重新產生 button).

const DEFAULT_SEED = 20260611
const ENTRY_CLOCK_SEC = 12 * 3600   // drop into the lunch rush so motion is instant

// Generate (or re-roll) the active floor's mock day. `seedOverride` forces a
// regeneration with that seed; otherwise only fills floors with no tracks yet.
// Module-level (not binder-scoped) so the React TimelineBar can call it too.
export function ensureTracksForActiveFloor(seedOverride) {
  const { floors, activeFloorId } = useFloorStore.getState()
  const floor = floors.find((f) => f.id === activeFloorId)
  if (!floor || !floor.imageWidth) return
  const tr = useTrackingStore.getState()
  if (seedOverride == null && (tr.tracksByFloor[activeFloorId]?.length ?? 0) > 0) return
  const seed = seedOverride ?? DEFAULT_SEED
  const walls = useWallStore.getState().wallsByFloor[activeFloorId] ?? []
  const tracks = generateDayTracks(floor, walls, { seed })
  // Stage-2: bind each track to the camera that sees it (FOV containment) so a
  // manual calibration can later re-project it. samples stay in floor px —
  // uncalibrated cameras display tracks as generated.
  const cameras = useCameraStore.getState().camerasByFloor[activeFloorId] ?? []
  const scale = floor.scale ?? 40
  const bound = bindTracksToCameras(tracks, cameras, walls, scale)
  tr.setTracks(activeFloorId, bound, seed)
  // Re-project any cameras already manually calibrated (e.g. returning to a
  // floor whose cameras were calibrated before this regeneration).
  for (const cam of cameras) {
    if (cam.calibration?.H) tr.reprojectCameraTracks(activeFloorId, cam.id, cam.calibration.H)
  }
  if (seedOverride == null) {
    tr.setClockSec(ENTRY_CLOCK_SEC)
    tr.setPlaying(true)
  }
}

export function regenerateActiveFloorTracks() {
  const tr = useTrackingStore.getState()
  const fid = useFloorStore.getState().activeFloorId
  const prevSeed = tr.seedByFloor[fid] ?? DEFAULT_SEED
  ensureTracksForActiveFloor(prevSeed + 1)
}

export function bindTracking({ useEditorStore }) {
  let rafId = 0
  let lastTs = 0

  const isActive = () => useEditorStore.getState().editorMode === EDITOR_MODE.CAMERA

  const tick = (ts) => {
    const tr = useTrackingStore.getState()
    if (!isActive() || !tr.playing) { rafId = 0; lastTs = 0; return }
    // Schedule the next frame BEFORE the store write: setClockSec fires the
    // store subscribers synchronously, and syncLoop (one of them) would see
    // rafId === 0 and schedule a second callback — every frame would then
    // double the queued callbacks (2^n freeze). Keeping rafId non-zero across
    // the write makes syncLoop a no-op here.
    rafId = requestAnimationFrame(tick)
    if (lastTs !== 0) {
      const dt = Math.min(0.5, (ts - lastTs) / 1000)   // clamp tab-switch jumps
      let next = tr.clockSec + dt * tr.speedX
      if (next >= DAY_END_SEC) next = DAY_START_SEC + (next - DAY_END_SEC)  // loop the day
      tr.setClockSec(next)
    }
    lastTs = ts
  }

  const syncLoop = () => {
    const shouldRun = isActive() && useTrackingStore.getState().playing
    if (shouldRun && rafId === 0) {
      lastTs = 0
      rafId = requestAnimationFrame(tick)
    } else if (!shouldRun && rafId !== 0) {
      cancelAnimationFrame(rafId)
      rafId = 0
      lastTs = 0
    }
  }

  // ── Occupancy timelapse loop ──────────────────────────────────────────────
  // Independent rAF loop that slides the heatmap analysis window forward, so
  // the occupancy heatmap animates the day's activity rolling through. Runs
  // only in CAMERA mode while the lapse is playing and a heatmap mode is on.
  let lapseRaf = 0
  let lapseLastTs = 0
  const lapseShouldRun = () => {
    const tr = useTrackingStore.getState()
    return isActive() && tr.occupancyLapsePlaying && tr.occupancyMode !== 'off'
  }
  const lapseTick = (ts) => {
    if (!lapseShouldRun()) { lapseRaf = 0; lapseLastTs = 0; return }
    lapseRaf = requestAnimationFrame(lapseTick)
    const tr = useTrackingStore.getState()
    if (lapseLastTs !== 0) {
      const dt = Math.min(0.5, (ts - lapseLastTs) / 1000)
      tr.advanceOccupancyLapse(dt * tr.occupancyLapseSpeed)
    }
    lapseLastTs = ts
  }
  const syncLapse = () => {
    if (lapseShouldRun() && lapseRaf === 0) {
      lapseLastTs = 0
      lapseRaf = requestAnimationFrame(lapseTick)
    } else if (!lapseShouldRun() && lapseRaf !== 0) {
      cancelAnimationFrame(lapseRaf)
      lapseRaf = 0
      lapseLastTs = 0
    }
  }

  let prevMode = useEditorStore.getState().editorMode
  const unsubEditor = useEditorStore.subscribe(() => {
    const mode = useEditorStore.getState().editorMode
    if (mode === prevMode) return
    const left = prevMode === EDITOR_MODE.CAMERA && mode !== EDITOR_MODE.CAMERA
    prevMode = mode
    if (mode === EDITOR_MODE.CAMERA) ensureTracksForActiveFloor()
    // Leaving the mode disarms any in-flight tripwire/zone draw so it can't
    // fire on the first click after re-entry.
    if (left && useCameraStore.getState().drawTool) useCameraStore.getState().setDrawTool(null)
    syncLoop()
    syncLapse()
  })
  // Floor switch while in CAMERA mode → make sure the new floor has a crowd.
  let prevFid = useFloorStore.getState().activeFloorId
  const unsubFloor = useFloorStore.subscribe(() => {
    const fid = useFloorStore.getState().activeFloorId
    if (fid === prevFid) return
    prevFid = fid
    if (isActive()) ensureTracksForActiveFloor()
  })
  const unsubTracking = useTrackingStore.subscribe(() => { syncLoop(); syncLapse() })

  // Re-project a camera's tracks when its calibration homography changes
  // (manual recalibrate). We snapshot each camera's H reference; on change we
  // ask the tracking store to recompute that camera's samples from its frame
  // source. Writes only to the tracking store → no feedback loop with cameras.
  let prevHById = new Map()
  const snapshotH = () => {
    const fid = useFloorStore.getState().activeFloorId
    const cams = useCameraStore.getState().camerasByFloor[fid] ?? []
    const m = new Map()
    for (const c of cams) m.set(c.id, c.calibration?.H ?? null)
    return m
  }
  prevHById = snapshotH()
  const unsubCalib = useCameraStore.subscribe(() => {
    const fid = useFloorStore.getState().activeFloorId
    const cams = useCameraStore.getState().camerasByFloor[fid] ?? []
    const tr = useTrackingStore.getState()
    for (const c of cams) {
      const H = c.calibration?.H ?? null
      if (prevHById.get(c.id) !== H && H) tr.reprojectCameraTracks(fid, c.id, H)
    }
    // refresh snapshot (covers H changes handled above + camera add/remove)
    prevHById = snapshotH()
  })

  if (isActive()) ensureTracksForActiveFloor()
  syncLoop()
  syncLapse()

  return () => {
    unsubEditor()
    unsubFloor()
    unsubTracking()
    unsubCalib()
    if (rafId !== 0) cancelAnimationFrame(rafId)
    if (lapseRaf !== 0) cancelAnimationFrame(lapseRaf)
  }
}
