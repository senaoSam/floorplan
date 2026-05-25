import { create } from 'zustand'

// Per-mousemove RSSI/SINR readout. Lives in its own store so the high-frequency
// `set` doesn't churn subscribers of useHeatmapStore (engine / mode / reflections
// / etc.). HeatmapLayer reads none of this; only HeatmapControl's readout panel
// subscribes here.
export const useHoverReadoutStore = create((set) => ({
  reading: null,
  setReading: (v) => set({ reading: v }),
}))
