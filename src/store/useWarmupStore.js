import { create } from 'zustand'

// Tracks whether the heatmap GL shader warmup is still running. Editor2D
// flips this on at mount and off when warmupGL() resolves. DropZone /
// DemoLoader subscribe to show a spinner — we don't want users dropping a
// floor plan or hitting "Load Demo" mid-warmup, since the first heatmap
// render would then re-pay the GLSL compile cost the warmup is meant to
// hide.
export const useWarmupStore = create((set) => ({
  warmingUp: false,
  setWarmingUp: (v) => set({ warmingUp: v }),
}))
