import { EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useTrackingStore } from '@/store/useTrackingStore'
import { useCameraStore } from '@/store/useCameraStore'
import { generateDayTracks, DAY_START_SEC, DAY_END_SEC } from './mockTracks'

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
  tr.setTracks(activeFloorId, tracks, seed)
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
  })
  // Floor switch while in CAMERA mode → make sure the new floor has a crowd.
  let prevFid = useFloorStore.getState().activeFloorId
  const unsubFloor = useFloorStore.subscribe(() => {
    const fid = useFloorStore.getState().activeFloorId
    if (fid === prevFid) return
    prevFid = fid
    if (isActive()) ensureTracksForActiveFloor()
  })
  const unsubTracking = useTrackingStore.subscribe(syncLoop)

  if (isActive()) ensureTracksForActiveFloor()
  syncLoop()

  return () => {
    unsubEditor()
    unsubFloor()
    unsubTracking()
    if (rafId !== 0) cancelAnimationFrame(rafId)
  }
}
