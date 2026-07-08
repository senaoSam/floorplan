import { create } from 'zustand'

// Shared time source for STATS mode (Phase 43 / stage 3, timelapse). Both the
// React dashboard and the imperative PIXI overlay layer subscribe to this one
// store — same pattern as camera's useTrackingStore, but in epoch-ms (stats
// spans real timestamps / diurnal curve) rather than day-seconds.
//
// `anchorTs` = "now" captured once on entering STATS (the right edge of the
// trend window). `playheadTs` = the moment the dashboard + overlay currently
// display; the scrubber writes it, playback advances it. The trend window is
// [anchorTs - rangeHours*h, anchorTs]. anchorTs stays null until the dashboard
// seeds it on mount, so the store has no Date.now() side-effect at import time.

const HOUR_MS = 3600 * 1000

export const STATS_SPEEDS = [1, 60, 300]   // ×1 real, ×60 (1min/s), ×300 (5min/s)

export const useStatsTimeStore = create((set, get) => ({
  anchorTs: null,       // epoch ms, right edge of the window (== "live now")
  playheadTs: null,     // epoch ms currently displayed
  rangeHours: 24,
  playing: false,
  speed: 60,

  // Seed the window once (dashboard mount). Only sets when unseeded so
  // re-mounts / HMR don't jump the playhead.
  initAnchor: (nowTs) => set((s) => (
    s.anchorTs == null ? { anchorTs: nowTs, playheadTs: nowTs } : {}
  )),

  windowStart: () => {
    const s = get()
    return s.anchorTs == null ? null : s.anchorTs - s.rangeHours * HOUR_MS
  },

  setPlayhead: (ts) => set((s) => {
    if (s.anchorTs == null) return {}
    const lo = s.anchorTs - s.rangeHours * HOUR_MS
    const clamped = Math.max(lo, Math.min(s.anchorTs, ts))
    return { playheadTs: clamped }
  }),

  setPlaying: (v) => set({ playing: v }),
  togglePlaying: () => set((s) => {
    if (s.playing) return { playing: false }
    // Starting playback: if the playhead is at (or past) the live edge, rewind
    // to the window start so ▶ replays the past window instead of instantly
    // hitting the end and stopping.
    const lo = s.anchorTs == null ? null : s.anchorTs - s.rangeHours * HOUR_MS
    const atLive = s.playheadTs == null || s.anchorTs == null || s.playheadTs >= s.anchorTs
    return atLive && lo != null
      ? { playing: true, playheadTs: lo }
      : { playing: true }
  }),
  setSpeed: (v) => set({ speed: v }),

  // Jump the playhead back to the live edge and stop.
  goLive: () => set((s) => ({ playheadTs: s.anchorTs, playing: false })),

  // Reset on leaving STATS so a fresh entry re-anchors to a new "now".
  reset: () => set({ anchorTs: null, playheadTs: null, playing: false }),
}))
