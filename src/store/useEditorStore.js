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

export const useEditorStore = create((set) => ({
  editorMode: EDITOR_MODE.SELECT,
  viewMode: VIEW_MODE.TWO_D,
  selectedId: null,
  selectedType: null, // 'wall' | 'ap' | 'scope' | 'floor_hole' | null
  showHeatmap: false,
  heatmapMode: HEATMAP_MODE.SINR,
  pathLossExponent: 3.0, // 預設辦公室環境
  panelCollapsed: false,

  setEditorMode: (mode) => set({ editorMode: mode, selectedId: null, selectedType: null }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSelected: (id, type) => set({ selectedId: id, selectedType: type, panelCollapsed: false }),
  clearSelected: () => set({ selectedId: null, selectedType: null }),
  toggleHeatmap: () => set((s) => ({ showHeatmap: !s.showHeatmap })),
  setHeatmapMode: (mode) => set({ heatmapMode: mode }),
  setPathLossExponent: (n) => set({ pathLossExponent: n }),
  togglePanelCollapsed: () => set((s) => ({ panelCollapsed: !s.panelCollapsed })),
}))
