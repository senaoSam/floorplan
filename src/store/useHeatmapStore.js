import { create } from 'zustand'

// Supported heatmap visualisation modes.
// - rssi: strongest AP power in dBm (default)
// - sinr: signal-to-interference-plus-noise in dB
// - snr:  signal-to-noise only (ignores co-channel interferers) in dB
// - cci:  co-channel interference power in dBm, higher = worse
export const HEATMAP_MODES = ['rssi', 'sinr', 'snr', 'cci']

// Sampling engine. 'js' is the canonical CPU implementation; 'shader' uses
// the WebGL2 fragment-shader path being ported in HM-F5a~f. Until full
// parity (F5d), the shader engine intentionally lacks reflections /
// diffraction / multi-frequency coherence — it remains opt-in, with a
// HeatmapControl toggle (HM-T3) so users can flip engines side-by-side.
export const HEATMAP_ENGINES = ['js', 'shader']

// Heatmap UI / compute options.
export const useHeatmapStore = create((set) => ({
  enabled: false,
  mode: 'rssi',
  engine: 'js',
  reflections: true,
  diffraction: true,
  gridStepM: 0.5,
  blur: 8,
  showContours: true,

  // Hover readout driven by Editor2D's mousemove when enabled. Shape:
  //   { at:{x,y}, rssiDbm, sinrDb, snrDb, cciDbm, perAp:number[], apList:AP[] }
  hoverReading: null,

  setEnabled:     (v) => set({ enabled: v }),
  setMode:        (v) => set({ mode: v }),
  setEngine:      (v) => set({ engine: v }),
  setReflections: (v) => set({ reflections: v }),
  setDiffraction: (v) => set({ diffraction: v }),
  setGridStepM:   (v) => set({ gridStepM: v }),
  setBlur:        (v) => set({ blur: v }),
  setShowContours:(v) => set({ showContours: v }),
  setHoverReading:(v) => set({ hoverReading: v }),
}))
