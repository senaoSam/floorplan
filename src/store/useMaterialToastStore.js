import { create } from 'zustand'

// Transient "you just changed X" overlay near the canvas — oldSrc Editor2D
// 1643-1648 (`materialToast`). Driven by the Tab / Shift+Tab cycle in
// FloorplanSystem keydown (wall material in DRAW_WALL, AP band in PLACE_AP,
// switch kind in PLACE_SWITCH).
//
// Auto-dismisses 1500 ms after the last showToast call (oldSrc 384). A new
// showToast cancels the prior timer so back-to-back presses don't blink.

let timerId = null

export const useMaterialToastStore = create((set) => ({
  toast: null,   // { label, color, key } | null

  showToast: (t) => {
    if (timerId) clearTimeout(timerId)
    set({ toast: { ...t, _ts: Date.now() } })
    timerId = setTimeout(() => set({ toast: null }), 1500)
  },
  clearToast: () => {
    if (timerId) { clearTimeout(timerId); timerId = null }
    set({ toast: null })
  },
}))
