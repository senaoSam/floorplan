import { create } from 'zustand'

// Phase 25 stub — preserves the API the Toolbar reads (undoStack /
// redoStack / undo / redo) but is intentionally inert. Real undo/redo
// returns when the snapshot-based history infrastructure (oldSrc
// useHistoryStore + per-store takeSnapshot / restoreSnapshot wiring) is
// ported in a later bundle. Toolbar's undo / redo buttons stay disabled
// (lengths === 0) so the user knows nothing's recording yet.
export const useHistoryStore = create(() => ({
  undoStack: [],
  redoStack: [],
  undo: () => {},
  redo: () => {},
}))
