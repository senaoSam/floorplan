import { create } from 'zustand'

// Screen-space viewport transform applied to the world Container.
// world.position = (x, y) ; world.scale = (scale, scale)
// canvasPos = (screenPos - viewport.{x,y}) / viewport.scale
export const useViewportStore = create((set, get) => ({
  x: 0,
  y: 0,
  scale: 1,
  minScale: 0.05,
  maxScale: 40,

  setViewport: (next) => set((s) => ({
    x: next.x ?? s.x,
    y: next.y ?? s.y,
    scale: next.scale ?? s.scale,
  })),

  panBy: (dx, dy) => set((s) => ({ x: s.x + dx, y: s.y + dy })),

  zoomAt: (screenX, screenY, factor) => {
    const s = get()
    const nextScale = Math.max(s.minScale, Math.min(s.maxScale, s.scale * factor))
    if (nextScale === s.scale) return
    const k = nextScale / s.scale
    set({
      scale: nextScale,
      x: screenX - (screenX - s.x) * k,
      y: screenY - (screenY - s.y) * k,
    })
  },

  reset: () => set({ x: 0, y: 0, scale: 1 }),
}))
