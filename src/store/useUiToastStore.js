import { create } from 'zustand'

// Global transient toast (ui-spec §2.4 / §2.6). One message at a time,
// bottom-center, auto-dismisses. Replaces raw alert() and carries the
// "deleted — Ctrl+Z to undo" hints of the unified delete policy.
//
// MaterialToast (Tab-cycling readout) stays separate — it is a keyboard
// echo tied to place/draw modes, not a general notification.

const DEFAULT_DURATION_MS = 3000

let timerId = null

export const useUiToastStore = create((set) => ({
  toast: null,   // { text, _ts } | null

  show: (text, { duration = DEFAULT_DURATION_MS } = {}) => {
    if (timerId) clearTimeout(timerId)
    set({ toast: { text, _ts: Date.now() } })
    timerId = setTimeout(() => set({ toast: null }), duration)
  },
  clear: () => {
    if (timerId) { clearTimeout(timerId); timerId = null }
    set({ toast: null })
  },
}))

// Convenience for non-React call sites (keydown handlers, store actions).
export function showUiToast(text, opts) {
  useUiToastStore.getState().show(text, opts)
}
