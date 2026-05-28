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
//   doorWindowDraft: null | { wallId, startFrac, cursorFrac, kind }
//   — set by wallsLayer after the first click in DRAW_DOOR / DRAW_WINDOW
//     mode. cursorFrac updates on pointermove over the SAME wall so
//     draftOverlayLayer can paint a coloured preview band between
//     startFrac and cursorFrac (matches the door / window OPENING_TYPES
//     colour). Cleared on commit / Esc / mode exit.
//   scalePreview: null | { p0, p1 }
//   — set by draftModeController on the 2nd DRAW_SCALE click. Keeps the
//     measured line visible while ScaleDialog is open so the user can see
//     pt1 + pt2 + the px label behind the modal (matches oldSrc Editor2D
//     where scalePt1 / scalePt2 React state persists across the dialog
//     lifetime). Cleared explicitly by FloorplanSystem on dialog confirm /
//     cancel.
export const useDraftStore = create((set) => ({
  mode: null,
  points: [],
  cursor: null,
  snapHint: null,
  doorWindowDraft: null,
  scalePreview: null,
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
  setDoorWindowDraft: (d) => set({ doorWindowDraft: d }),
  setScalePreview: (p) => set({ scalePreview: p }),
  clearScalePreview: () => set({ scalePreview: null }),
  setShiftHeld: (held) => set({ _shiftHeld: !!held }),
  clearDraft: () => set({ mode: null, points: [], cursor: null, snapHint: null }),
}))
