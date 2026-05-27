import { create } from 'zustand'

// Ephemeral drag-in-progress positions, used by downstream consumers (e.g. the
// heatmap layer) that need to react to live positions without waiting for the
// commit-on-dragend write into the main stores.
//
// Nothing in here is persisted or undoable — it's cleared on dragend.
//
// Shape:
//   ap:         { id, x, y } | null                            (canvas-pixel coords)
//   sw:         { id, x, y } | null                            (canvas-pixel coords)
//   wall:       { id, dx, dy } | null                          (offset from committed endpoints)
//   scope:      { id, dx, dy } | null
//   hole:       { id, dx, dy } | null
//   tray:       { id, dx, dy } | null                          (Phase 24-30-2: body drag offset)
//   trayVertex: { trayId, vertexIdx, x, y } | null             (Phase 24-30-2: single-vertex drag pos)
//   riser:      { id, x, y } | null                            (Phase 25 Bundle 21: riser drag pos)
export const useDragOverlayStore = create((set) => ({
  ap: null,
  sw: null,
  wall: null,
  scope: null,
  hole: null,
  tray: null,
  trayVertex: null,
  riser: null,

  setAP:         (v) => set({ ap: v }),
  setSwitch:     (v) => set({ sw: v }),
  setWall:       (v) => set({ wall: v }),
  setScope:      (v) => set({ scope: v }),
  setHole:       (v) => set({ hole: v }),
  setTray:       (v) => set({ tray: v }),
  setTrayVertex: (v) => set({ trayVertex: v }),
  setRiser:      (v) => set({ riser: v }),
  clear:         () => set({ ap: null, sw: null, wall: null, scope: null, hole: null, tray: null, trayVertex: null, riser: null }),
}))
