import { create } from 'zustand'
import { detectSoftwareRender } from '@/utils/detectSoftwareRender'

// Supported heatmap visualisation modes.
// - rssi: strongest AP power in dBm (default)
// - sinr: signal-to-interference-plus-noise in dB
// - snr:  signal-to-noise only (ignores co-channel interferers) in dB
// - cci:  co-channel interference power in dBm, higher = worse
// 58-12: band -- band map (which band a phone joins per cell; every band).
export const HEATMAP_MODES = ['rssi', 'sinr', 'snr', 'cci', 'band']

// Sampling engine. 'js' is the canonical CPU implementation; 'shader' uses
// the WebGL2 fragment-shader path being ported in HM-F5a~f. Until full
// parity (F5d), the shader engine intentionally lacks reflections /
// diffraction / multi-frequency coherence — it remains opt-in, with a
// HeatmapControl toggle (HM-T3) so users can flip engines side-by-side.
export const HEATMAP_ENGINES = ['js', 'shader']

// Drag-time recompute strategy.
// - live: recompute every frame with the drag-lod compromises (HM-drag-lod —
//   refl/diff off, RSSI-only when applicable, etc). Position-accurate, full
//   N_AP aggregation, slight numeric drift on dragend.
// - solo: HM-drag-solo, Hamina-style. Snapshot the heatmap on dragstart;
//   while dragging an AP, overlay only that AP's single-AP RSSI grid (full
//   resolution, no LOD compromise — single AP is already 1/N_AP work). While
//   dragging walls/scopes, freeze (no recompute). Optimised for 1000+ AP
//   scenes where live mode still can't hit 60 FPS.
export const HEATMAP_DRAG_MODES = ['live', 'solo']

// Band the heatmap renders. 'all' aggregates every AP (current behaviour);
// '2.4'/'5'/'6' filter to a single band's APs *before* the field is built, so
// e.g. a far 2.4 GHz AP can't mask a 6 GHz coverage hole. Purely a display
// filter — AP data and shader physics are untouched.
// 58-7: 'all' is labelled 最強 in the UI and is RSSI-only — SINR/SNR/CCI
// across bands mix one band's signal with another band's interference.
export const HEATMAP_BANDS = ['all', '2.4', '5', '6']
export const DEFAULT_BAND_FILTER = '5'
// 58-12: the band map always computes every band ('all').
export const bandFilterAllowed = (mode, band) => (mode === 'band' ? band === 'all' : band !== 'all' || mode === 'rssi')

// Heatmap UI / compute options.
export const useHeatmapStore = create((set) => ({
  enabled: false,
  mode: 'rssi',
  // 26-2 P3c — 'solo' (HM-drag-solo, Hamina style): wall/scope freeze the
  // heatmap during drag; AP renders only the dragged AP as overlay on a
  // snapshot. At 150+ AP this is the difference between 1 FPS and 30+ FPS
  // because sampleFieldGL during drag is ~700ms/frame. Users can flip back
  // to 'live' in HeatmapControl.
  dragMode: 'solo',
  reflections: true,
  diffraction: true,
  gridStepM: 0.5,
  blur: 8,
  showContours: true,
  // 47-8a: which band's APs feed the field. 'all' = every AP (最強).
  // 58-7: defaults to 5 GHz.
  bandFilter: DEFAULT_BAND_FILTER,
  // 58-7: last single band picked, restored when a non-RSSI mode rules out
  // 'all'.
  lastSingleBand: DEFAULT_BAND_FILTER,

  // Hover readout driven by Editor2D's mousemove when enabled. Shape:
  //   { at:{x,y}, rssiDbm, sinrDb, snrDb, cciDbm, perAp:number[], apList:AP[] }
  hoverReading: null,

  // 任務 4 (a): true when WebGL2 is backed by a software rasteriser (SwiftShader
  // etc). Probed once at store-creation; drives the lower large-scene downgrade
  // threshold in heatmapAdapter. Read-only after init.
  isSoftwareRender: detectSoftwareRender(),

  // 任務 4 (b): set by heatmapAdapter when the active scene's wall×AP product
  // exceeds the downgrade threshold, so reflections/diffraction are forced off
  // for the WHOLE compute (idle + drag). HeatmapControl surfaces this as a
  // "large scene simplified" notice so the user knows the field is approximate.
  simplifiedLargeScene: false,

  // 57-39: set by heatmapAdapter when the fine render ran over its time
  // budget and stepped down: null (full quality) | 'noDiffraction' | 'direct'.
  // HeatmapControl surfaces it next to the large-scene notice.
  budgetQuality: null,

  // 52-C3: WebGL2 could not be initialised at all (no support, or context
  // creation refused). Previously there was no channel for this: the toggle
  // stayed on, nothing drew, and the user had no idea why. Sibling notices
  // (scaleMissing / simplifiedLargeScene) already had one; this completes the
  // set. Note this is the permanent case — a merely LOST context is recovered
  // silently by the adapter and never reaches here.
  glUnavailable: false,

  // Set by heatmapAdapter while editorMode === DRAW_WALL: the heatmap is frozen
  // (showing the pre-draw field) and not recomputing, because each drawn wall
  // segment commits immediately and would otherwise fire a full recompute per
  // segment. HeatmapControl surfaces this as a notice so the stale field isn't
  // mistaken for live. Cleared when the user leaves DRAW_WALL.
  drawWallFrozen: false,

  // Same freeze idea for ALIGN_FLOOR: align fields live on the floor record,
  // so drag-aligning fires a floor-store change per pointermove — each would
  // trigger a full recompute + a visible ripple transition. Frozen while in
  // align mode; leaving the mode triggers the restoring recompute.
  alignFrozen: false,

  // 47-22: set by heatmapAdapter when the heatmap is enabled but the active
  // floor has no scale — the field can't be computed (no px→m), so instead of
  // silently hiding while the toggle still reads "on", HeatmapControl surfaces
  // a notice + a one-click "set the scale" action (enters DRAW_SCALE).
  scaleMissing: false,

  // Phase 48 Bundle 2 (決策②): names of OTHER floors excluded from the
  // cross-floor computation because their scale is uncalibrated (their
  // AP/wall/hole positions can't be converted to meters). Drives a
  // HeatmapControl notice so the exclusion isn't silent.
  crossFloorExcluded: [],

  setEnabled:     (v) => set({ enabled: v }),
  // 58-7: leaving RSSI while on 'all' falls back to the last single band.
  // 58-12: entering the band map switches to 'all'; leaving it restores the
  // last single band.
  setMode:        (v) => set((s) => {
    if (v === 'band') return { mode: v, bandFilter: 'all' }
    if (s.mode === 'band') return { mode: v, bandFilter: s.lastSingleBand }
    return bandFilterAllowed(v, s.bandFilter) ? { mode: v } : { mode: v, bandFilter: s.lastSingleBand }
  }),
  setDragMode:    (v) => set({ dragMode: v }),
  setReflections: (v) => set({ reflections: v }),
  setDiffraction: (v) => set({ diffraction: v }),
  setGridStepM:   (v) => set({ gridStepM: v }),
  setBlur:        (v) => set({ blur: v }),
  setShowContours:(v) => set({ showContours: v }),
  setBandFilter:  (v) => set((s) => {
    if (!bandFilterAllowed(s.mode, v)) return s
    return v === 'all' ? { bandFilter: v } : { bandFilter: v, lastSingleBand: v }
  }),
  setHoverReading:(v) => set({ hoverReading: v }),
  // 任務 4 (b): adapter calls this each compute; guarded to a no-op when the
  // value is unchanged so it never triggers an extra subscriber recompute loop.
  setSimplifiedLargeScene: (v) => set((s) => (s.simplifiedLargeScene === v ? s : { simplifiedLargeScene: v })),
  setBudgetQuality: (v) => set((s) => (s.budgetQuality === v ? s : { budgetQuality: v })),
  setGlUnavailable: (v) => set((s) => (s.glUnavailable === v ? s : { glUnavailable: v })),
  // Same no-op-when-unchanged guard: adapter calls it every compute, but the
  // heatmap store is one of its own compute triggers, so an unconditional set
  // would loop.
  setDrawWallFrozen: (v) => set((s) => (s.drawWallFrozen === v ? s : { drawWallFrozen: v })),
  setAlignFrozen: (v) => set((s) => (s.alignFrozen === v ? s : { alignFrozen: v })),
  // 47-22: same no-op-when-unchanged guard (adapter calls it every compute).
  setScaleMissing: (v) => set((s) => (s.scaleMissing === v ? s : { scaleMissing: v })),
  // Same guard, array-valued (adapter calls it every compute).
  setCrossFloorExcluded: (names) => set((s) => (
    s.crossFloorExcluded.length === names.length &&
    s.crossFloorExcluded.every((n, i) => n === names[i])
      ? s
      : { crossFloorExcluded: names }
  )),
}))
