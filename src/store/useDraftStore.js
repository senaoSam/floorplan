import { create } from 'zustand'

// In-progress draft state shared between viewport (which captures clicks)
// and draftOverlayLayer (which renders the ghost). Cleared on Esc, mode
// switch, or successful commit.
//
// shape:
//   mode:    EDITOR_MODE.* | null
//   points:  [{ x, y }] in world coords
//   cursor:  { x, y } | null — last pointermove world coord (already
//                              snapped if in DRAW_CABLE_TRAY mode)
//   snapHint: null | {
//     kind: 'wallEndpoint' | 'wallSegment' | 'parallelWall' | 'trayVertex',
//     pos:  { x, y },
//     ref?: wall | tray | { startX, startY, endX, endY } — depends on kind
//     lockedAngle?: radians (parallelWall only)
//   }
//   — used by draftOverlayLayer to render the matching halo (orange ring /
//     square / purple guide).
export const useDraftStore = create((set) => ({
  mode: null,
  points: [],
  cursor: null,
  snapHint: null,
  // Shift-held tracker — driven by global keydown / keyup in
  // FloorplanSystem. Tray + wall draft snap pipelines read this to
  // decide whether to angle-lock the cursor to 45° from the anchor.
  _shiftHeld: false,

  beginDraft: (mode, firstPoint) => set({
    mode,
    points: firstPoint ? [firstPoint] : [],
    cursor: firstPoint ?? null,
    snapHint: null,
  }),
  addPoint: (p) => set((s) => ({ points: [...s.points, p] })),
  setCursor: (p) => set({ cursor: p }),
  setSnapHint: (h) => set({ snapHint: h }),
  setShiftHeld: (held) => set({ _shiftHeld: !!held }),
  clearDraft: () => set({ mode: null, points: [], cursor: null, snapHint: null }),
}))
