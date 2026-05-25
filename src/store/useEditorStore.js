import { create } from 'zustand'

export const EDITOR_MODE = {
  SELECT: 'select',
  PAN: 'pan',
  DRAW_SCALE: 'draw_scale',
  DRAW_WALL: 'draw_wall',
  PLACE_AP: 'place_ap',
  DRAW_SCOPE: 'draw_scope',
  DRAW_FLOOR_HOLE: 'draw_floor_hole',
  CROP_IMAGE: 'crop_image',
  MARQUEE_SELECT: 'marquee_select',
  DOOR_WINDOW: 'door_window',
  ALIGN_FLOOR: 'align_floor',
  PLACE_SWITCH: 'place_switch',
  DRAW_CABLE_TRAY: 'draw_cable_tray',
  PLACE_RISER: 'place_riser',
}

export const VIEW_MODE = {
  TWO_D: '2d',
  THREE_D: '3d',
}

export const useEditorStore = create((set, get) => ({
  editorMode: EDITOR_MODE.SELECT,
  viewMode: VIEW_MODE.TWO_D,
  selectedId: null,
  selectedType: null,
  selectedItems: [],

  setEditorMode: (mode) => set({
    editorMode: mode,
    selectedId: null,
    selectedType: null,
    selectedItems: [],
  }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSelected: (id, type) => set({ selectedId: id, selectedType: type, selectedItems: [] }),
  clearSelected: () => set({ selectedId: null, selectedType: null, selectedItems: [] }),

  setSelectedItems: (items) => set({
    selectedItems: items,
    selectedId: items.length === 1 ? items[0].id : null,
    selectedType: items.length === 1 ? items[0].type : null,
  }),
  isItemSelected: (id) => {
    const s = get()
    if (s.selectedId === id) return true
    return s.selectedItems.some((it) => it.id === id)
  },

  // ── 23-2c Right-click object context menu ───────────────────────
  // Centralised state so any Layer can request a menu and the same overlay
  // component renders it. shape:
  //   { targetType, targetId, screenX, screenY } | null
  contextMenu: null,
  openContextMenu: (payload) => set({ contextMenu: payload }),
  closeContextMenu: () => set((s) => (s.contextMenu ? { contextMenu: null } : {})),
}))
