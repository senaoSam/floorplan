import { create } from 'zustand'

// 58-12: band map legend data, published by heatmapAdapter after each band map
// paint -- { 2.4, 5, 6, none } shares of the plan (scope) cells, or null.
// Kept out of useHeatmapStore on purpose: that store drives the heatmap
// compute, and a write from inside a running compute would restart it.
export const useBandMapStore = create((set) => ({
  shares: null,
  setShares: (v) => set({ shares: v }),
}))
