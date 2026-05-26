import { create } from 'zustand'

// In-progress draft state shared between viewport (which captures clicks)
// and draftOverlayLayer (which renders the ghost). Cleared on Esc, mode
// switch, or successful commit.
//
// shape:
//   mode:  EDITOR_MODE.* | null
//   points: [{ x, y }] in world coords
//   cursor: { x, y } | null — last pointermove world coord for the ghost
//                              segment to the cursor
export const useDraftStore = create((set) => ({
  mode: null,
  points: [],
  cursor: null,

  beginDraft: (mode, firstPoint) => set({
    mode,
    points: firstPoint ? [firstPoint] : [],
    cursor: firstPoint ?? null,
  }),
  addPoint: (p) => set((s) => ({ points: [...s.points, p] })),
  setCursor: (p) => set({ cursor: p }),
  clearDraft: () => set({ mode: null, points: [], cursor: null }),
}))
