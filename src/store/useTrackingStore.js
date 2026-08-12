import { create } from 'zustand'
import { DAY_START_SEC, DAY_END_SEC } from '@/features/cameras/mockTracks'
import { applyHomography, invertHomography } from '@/utils/homography'

// Camera-mode tracking/playback state (Phase 34-2/34-4).
//
//   tracksByFloor — mock (later: live) tracks per floor, canvas px.
//   clockSec      — current wall-clock second of the simulated day. One clock
//                   drives BOTH live mode (1x) and replay (scrubber + speed);
//                   the icons layer just renders "the world at clockSec".
//   playing       — clock advancing (trackingBinder owns the rAF loop).
//   speedX        — playback speed multiplier (1 = live feel).
//   showUndetected— when true, targets outside every camera FOV still render
//                   as faint grey ghosts; when false they're hidden outright
//                   (only what the cameras actually see).
export const useTrackingStore = create((set) => ({
  tracksByFloor: {},
  seedByFloor: {},
  clockSec: DAY_START_SEC,
  playing: false,
  speedX: 1,
  showUndetected: true,
  // Occupancy heatmap (34-3): 'off' | 'traffic' (distinct visits) |
  // 'dwell' (accumulated seconds). The from/to window filters which part of
  // the day gets integrated — e.g. lunch rush only.
  occupancyMode: 'off',
  occupancyFromSec: DAY_START_SEC,
  occupancyToSec: DAY_END_SEC,
  // Timelapse (Verkada parity): when on, the [from,to] window keeps its WIDTH
  // and slides forward along the day on its own rAF loop (trackingBinder owns
  // it), so the heatmap animates the activity rolling through the day — the
  // Verkada "select interval, watch it evolve" experience. occupancyLapseSpeed
  // is simulated-seconds advanced per real second.
  occupancyLapsePlaying: false,
  occupancyLapseSpeed: 1800,   // 30 simulated min per real sec → a full day in ~28s

  setTracks: (floorId, tracks, seed) => set((s) => ({
    tracksByFloor: { ...s.tracksByFloor, [floorId]: tracks },
    seedByFloor: { ...s.seedByFloor, [floorId]: seed },
  })),
  clearFloor: (floorId) => set((s) => {
    const { [floorId]: _, ...rest } = s.tracksByFloor
    const { [floorId]: __, ...restSeed } = s.seedByFloor
    return { tracksByFloor: rest, seedByFloor: restSeed }
  }),

  // Stage-2 calibration: project a camera's tracks through its homography H.
  //
  //   • First time (track has no frameSamples): freeze frameSamples = H⁻¹·samples
  //     — the track captured in this camera's frame. Displayed samples = H·that
  //     = the original floor path, so a camera's FIRST calibration doesn't move
  //     its tracks (they were already where it sees them).
  //   • Later recalibration (frameSamples already frozen): samples = H·frameSamples,
  //     which differs from the original → the tracks visibly shift.
  //
  // `baseSamples` preserves the immutable generated floor path so we can always
  // recover frameSamples even after the displayed samples have been re-projected.
  reprojectCameraTracks: (floorId, cameraId, H) => set((s) => {
    const list = s.tracksByFloor[floorId]
    if (!list || !H) return {}
    const Hinv = invertHomography(H)
    if (!Hinv) return {}
    let changed = false
    let dropped = 0
    const next = list.map((trk) => {
      if (trk.cameraId !== cameraId) return trk
      const base = trk.baseSamples ?? trk.samples
      // 52-B2/B3: applyHomography returns null for samples that land on the
      // vanishing line. Drop those instead of writing Infinity/NaN into the
      // store — downstream grids index by coordinate, and a NaN index is
      // silently discarded while an Infinity one piles every track into the
      // last cell, producing a plausible-looking but wholly wrong heatmap.
      const project = (pts, M) => {
        const out = []
        for (const p of pts) {
          const q = applyHomography(M, p)
          if (q) out.push({ t: p.t, x: q.x, y: q.y })
          else dropped += 1
        }
        return out
      }
      const frameSamples = trk.frameSamples ?? project(base, Hinv)
      const samples = project(frameSamples, H)
      changed = true
      return { ...trk, baseSamples: base, frameSamples, samples }
    })
    if (dropped > 0) {
      console.warn(`[tracking] dropped ${dropped} sample(s) that projected to infinity — check the camera calibration`)
    }
    return changed ? { tracksByFloor: { ...s.tracksByFloor, [floorId]: next } } : {}
  }),

  setClockSec: (clockSec) => set({
    clockSec: Math.min(DAY_END_SEC, Math.max(DAY_START_SEC, clockSec)),
  }),
  setPlaying: (playing) => set({ playing }),
  setSpeedX: (speedX) => set({ speedX }),
  toggleShowUndetected: () => set((s) => ({ showUndetected: !s.showUndetected })),

  // Turning the heatmap on from 'off' while the window still spans the whole day
  // narrows it to the first 2h, so the scrubber/timelapse is immediately usable
  // (a full-day window leaves the scrubber with zero travel). Switching between
  // heatmap modes, or a window the user already narrowed, is left untouched.
  setOccupancyMode: (occupancyMode) => set((s) => {
    const turningOn = s.occupancyMode === 'off' && occupancyMode !== 'off'
    const fullDay = s.occupancyFromSec <= DAY_START_SEC && s.occupancyToSec >= DAY_END_SEC
    if (turningOn && fullDay) {
      return { occupancyMode, occupancyFromSec: DAY_START_SEC, occupancyToSec: DAY_START_SEC + 2 * 3600 }
    }
    return { occupancyMode }
  }),
  setOccupancyRange: (occupancyFromSec, occupancyToSec) => set((s) => {
    const from = Math.max(DAY_START_SEC, Math.min(DAY_END_SEC, occupancyFromSec ?? s.occupancyFromSec))
    const to = Math.max(DAY_START_SEC, Math.min(DAY_END_SEC, occupancyToSec ?? s.occupancyToSec))
    return from < to
      ? { occupancyFromSec: from, occupancyToSec: to }
      : {}   // ignore inverted ranges — the UI constrains the selects anyway
  }),

  // ── Timelapse ─────────────────────────────────────────────────────────────
  setOccupancyLapsePlaying: (occupancyLapsePlaying) => set({ occupancyLapsePlaying }),
  setOccupancyLapseSpeed: (occupancyLapseSpeed) => set({ occupancyLapseSpeed }),
  // Slide the window forward by `dtSec` keeping its width; wrap to the start of
  // the day once the trailing edge reaches DAY_END_SEC so the lapse loops.
  advanceOccupancyLapse: (dtSec) => set((s) => {
    const width = s.occupancyToSec - s.occupancyFromSec
    let from = s.occupancyFromSec + dtSec
    if (from + width >= DAY_END_SEC) from = DAY_START_SEC   // loop the day
    return { occupancyFromSec: from, occupancyToSec: from + width }
  }),
  // Jump the window back to the start of the day, keeping its width (⏮). Mirrors
  // the wrap in advanceOccupancyLapse but on demand; doesn't touch playing state.
  resetOccupancyLapse: () => set((s) => {
    const width = s.occupancyToSec - s.occupancyFromSec
    return { occupancyFromSec: DAY_START_SEC, occupancyToSec: DAY_START_SEC + width }
  }),
  // Scrubber: move the window's start to `fromSec`, keeping its width, clamped
  // so the trailing edge never passes DAY_END_SEC.
  setOccupancyWindowStart: (fromSec) => set((s) => {
    const width = s.occupancyToSec - s.occupancyFromSec
    const from = Math.max(DAY_START_SEC, Math.min(DAY_END_SEC - width, fromSec))
    return { occupancyFromSec: from, occupancyToSec: from + width }
  }),
}))
