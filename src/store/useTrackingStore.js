import { create } from 'zustand'
import { DAY_START_SEC, DAY_END_SEC } from '@/features/cameras/mockTracks'

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

  setClockSec: (clockSec) => set({
    clockSec: Math.min(DAY_END_SEC, Math.max(DAY_START_SEC, clockSec)),
  }),
  setPlaying: (playing) => set({ playing }),
  setSpeedX: (speedX) => set({ speedX }),
  toggleShowUndetected: () => set((s) => ({ showUndetected: !s.showUndetected })),

  setOccupancyMode: (occupancyMode) => set({ occupancyMode }),
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
}))
