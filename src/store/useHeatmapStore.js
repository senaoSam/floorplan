import { create } from 'zustand'
import { detectSoftwareRender } from '@/utils/detectSoftwareRender'

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

// Heatmap UI / compute options.
export const useHeatmapStore = create((set) => ({
  enabled: false,
  mode: 'rssi',
  engine: 'shader',
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

  setEnabled:     (v) => set({ enabled: v }),
  setMode:        (v) => set({ mode: v }),
  setEngine:      (v) => set({ engine: v }),
  setDragMode:    (v) => set({ dragMode: v }),
  setReflections: (v) => set({ reflections: v }),
  setDiffraction: (v) => set({ diffraction: v }),
  setGridStepM:   (v) => set({ gridStepM: v }),
  setBlur:        (v) => set({ blur: v }),
  setShowContours:(v) => set({ showContours: v }),
  setHoverReading:(v) => set({ hoverReading: v }),
  // 任務 4 (b): adapter calls this each compute; guarded to a no-op when the
  // value is unchanged so it never triggers an extra subscriber recompute loop.
  setSimplifiedLargeScene: (v) => set((s) => (s.simplifiedLargeScene === v ? s : { simplifiedLargeScene: v })),
}))
