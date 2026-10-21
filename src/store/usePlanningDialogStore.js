import { create } from 'zustand'

// Which planning dialog is open: 'autoPlace' | 'autoPower' | 'redundant24'
// (null = none). One at a time -- their previews share the heatmap (band /
// mode override, what-if APs or radios), so opening one closes the other.
// They are mounted once (PlanningDialogs) rather than inside the panel that
// opens them: a docked preview leaves the canvas usable, and collapsing the
// sidebar or changing the selection must not unmount the dialog and drop
// the plan. `apIds`: the auto power subset (empty = whole floor).
export const usePlanningDialogStore = create((set) => ({
  dialog: null,
  apIds: [],

  openDialog: (dialog, apIds = []) => set({ dialog, apIds }),
  closeDialog: () => set({ dialog: null, apIds: [] }),
}))
