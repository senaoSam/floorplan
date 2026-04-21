import { create } from 'zustand'

// Heatmap UI / compute options.
// Defaults mirror heatmap_sample's App.jsx initial state.
export const useHeatmapStore = create((set) => ({
  enabled: false,
  reflections: true,
  diffraction: true,
  gridStepM: 0.5,
  blur: 8,
  showContours: true,

  // Hover readout driven by Editor2D's mousemove when enabled. Shape:
  //   { at:{x,y}, rssiDbm, sinrDb, perAp:number[], apList:AP[] }  or null
  hoverReading: null,

  setEnabled:     (v) => set({ enabled: v }),
  setReflections: (v) => set({ reflections: v }),
  setDiffraction: (v) => set({ diffraction: v }),
  setGridStepM:   (v) => set({ gridStepM: v }),
  setBlur:        (v) => set({ blur: v }),
  setShowContours:(v) => set({ showContours: v }),
  setHoverReading:(v) => set({ hoverReading: v }),
}))
