import { create } from 'zustand'

// Floor-import progress, shared by every useFloorImport() caller (DropZone,
// SidebarLeft's "+") and the canvas loading overlay. It lived in each hook's
// own useState, so an import started from the sidebar only showed up as the
// sidebar's small badge — the canvas had no way to know one was running.
export const useFloorImportStore = create((set) => ({
  loadingMsg: null,   // string while an import runs, else null
  setLoadingMsg: (loadingMsg) => set({ loadingMsg }),
}))
