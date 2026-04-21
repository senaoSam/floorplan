import { create } from 'zustand'

// Ephemeral drag-in-progress positions, used by downstream consumers (e.g. the
// heatmap layer) that need to react to live positions without waiting for the
// commit-on-dragend write into the main stores.
//
// Nothing in here is persisted or undoable — it's cleared on dragend.
//
// Shape:
//   ap:    { id, x, y } | null        (canvas-pixel coords)
//   wall:  { id, dx, dy } | null      (offset from committed endpoints)
//   scope: { id, dx, dy } | null
//   hole:  { id, dx, dy } | null
export const useDragOverlayStore = create((set) => ({
  ap: null,
  wall: null,
  scope: null,
  hole: null,

  setAP:    (v) => set({ ap: v }),
  setWall:  (v) => set({ wall: v }),
  setScope: (v) => set({ scope: v }),
  setHole:  (v) => set({ hole: v }),
  clear:    () => set({ ap: null, wall: null, scope: null, hole: null }),
}))
