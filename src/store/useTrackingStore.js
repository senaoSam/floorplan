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
}))
