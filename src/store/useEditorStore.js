import { create } from 'zustand'

// 編輯器模式
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
}

// 視角模式
export const VIEW_MODE = {
  TWO_D: '2d',
  THREE_D: '3d',
}

// 熱力圖模式
export const HEATMAP_MODE = {
  RSSI: 'rssi',
  SINR: 'sinr',
  SNR: 'snr',
  CHANNEL_OVERLAP: 'channel_overlap',
  DATA_RATE: 'data_rate',
  AP_COUNT: 'ap_count',
}

// 環境路徑損耗預設
export const ENVIRONMENT_PRESETS = {
  FREE_SPACE:  { label: '開放空間',   n: 2.0 },
  OFFICE:      { label: '辦公室',     n: 3.0 },
  DENSE:       { label: '密集隔間',   n: 3.5 },
  CORRIDOR:    { label: '走廊',       n: 1.8 },
}

export const useEditorStore = create((set, get) => ({
  editorMode: EDITOR_MODE.SELECT,
  viewMode: VIEW_MODE.TWO_D,
  selectedId: null,
  selectedType: null, // 'wall' | 'ap' | 'scope' | 'floor_hole' | 'floor_image' | null
  // 批次選取 — [{ id, type }]
  selectedItems: [],
  showHeatmap: false,
  heatmapMode: HEATMAP_MODE.RSSI,
  pathLossExponent: 3.0, // 預設辦公室環境
  panelCollapsed: false,
  showFloorImage: true,
  showScopes: true,
  showFloorHoles: true,
  showWalls: true,
  showAPs: true,
  showAPInfo: true,

  setEditorMode: (mode) => set({ editorMode: mode, selectedId: null, selectedType: null, selectedItems: [] }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSelected: (id, type) => set({ selectedId: id, selectedType: type, selectedItems: [], panelCollapsed: false }),
  clearSelected: () => set({ selectedId: null, selectedType: null, selectedItems: [] }),

  // 批次選取 actions
  setSelectedItems: (items) => set({
    selectedItems: items,
    selectedId: items.length === 1 ? items[0].id : null,
    selectedType: items.length === 1 ? items[0].type : null,
    panelCollapsed: false,
  }),
  toggleSelectedItem: (id, type) => set((s) => {
    const exists = s.selectedItems.find((it) => it.id === id && it.type === type)
    let next
    if (exists) {
      next = s.selectedItems.filter((it) => !(it.id === id && it.type === type))
    } else {
      next = [...s.selectedItems, { id, type }]
    }
    return {
      selectedItems: next,
      selectedId: next.length === 1 ? next[0].id : null,
      selectedType: next.length === 1 ? next[0].type : null,
      panelCollapsed: false,
    }
  }),
  isItemSelected: (id) => {
    const s = get()
    if (s.selectedId === id) return true
    return s.selectedItems.some((it) => it.id === id)
  },

  toggleHeatmap: () => set((s) => ({ showHeatmap: !s.showHeatmap })),
  setHeatmapMode: (mode) => set({ heatmapMode: mode }),
  setPathLossExponent: (n) => set({ pathLossExponent: n }),
  togglePanelCollapsed: () => set((s) => ({ panelCollapsed: !s.panelCollapsed })),
  toggleLayer: (key) => set((s) => ({ [key]: !s[key] })),
}))
