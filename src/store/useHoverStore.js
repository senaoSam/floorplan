import { create } from 'zustand'

// Ephemeral hover state — which object the pointer is currently over.
// hoverOverlayLayer reads this to draw a faint outline; layers write to
// it from their PIXI pointerover / pointerout handlers.
//
// shape:
//   id: string | null
//   type: 'ap' | 'switch' | 'cable_tray' | 'wall' | null
export const useHoverStore = create((set, get) => ({
  id: null,
  type: null,

  setHover: (id, type) => {
    const cur = get()
    if (cur.id === id && cur.type === type) return
    set({ id, type })
  },
  clearHoverIf: (id) => {
    const cur = get()
    if (cur.id === id) set({ id: null, type: null })
  },
}))
