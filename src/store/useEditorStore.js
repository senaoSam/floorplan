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
  ALIGN_FLOOR: 'align_floor',
}

// 視角模式
export const VIEW_MODE = {
  TWO_D: '2d',
  THREE_D: '3d',
}

// ⚠️ 新增可選取物件類型時的聯動點（grep 'SELECTABLE-TYPE' 可找到所有需要一起改的地方）：
//   [SELECTABLE-TYPE] 此處 `selectedType` 的 JSDoc 列舉
//   [SELECTABLE-TYPE] PanelRight.jsx 的 selectedType 分派
//   [SELECTABLE-TYPE] Editor2D.jsx 的 clearSelectedIfMissing / 刪除快捷鍵 / Layer onClick Ctrl+Click
//   [SELECTABLE-TYPE] BatchPanel.jsx 的 typesPresent / 同類型欄位 (showXxxFields)
//   [SELECTABLE-TYPE] useHistoryStore.js 的 takeSnapshot / restoreSnapshot / 監聽擴充點
export const useEditorStore = create((set, get) => ({
  editorMode: EDITOR_MODE.SELECT,
  viewMode: VIEW_MODE.TWO_D,
  selectedId: null,
  // [SELECTABLE-TYPE] 新增物件類型時在此 JSDoc 加字串
  selectedType: null, // 'wall' | 'ap' | 'scope' | 'floor_hole' | 'floor_image' | 'floor_align' | null
  // 批次選取 — [{ id, type }]
  selectedItems: [],
  regulatoryDomain: 'TW',
  autoChannelOnPlace: true,
  panelCollapsed: false,
  showFloorImage: true,
  showScopes: true,
  showFloorHoles: true,
  showWalls: true,
  showAPs: true,
  showAPInfo: true,

  // Align-mode reference overlay. `alignRefFloors` is a Set of floor IDs that
  // should render as semi-transparent reference layers while in ALIGN_FLOOR
  // mode. null = "not yet initialized for this session"; the AlignFloorPanel
  // seeds it to all other floors on first entry.
  alignRefFloors: null,
  alignRefOpacity: 0.3,

  // 3D view: when true, Viewer3D renders every floor stacked; when false,
  // only the active floor is shown (useful when stacked walls / APs clutter
  // the view). Non-active floors in "all" mode render dimmed.
  show3DAllFloors: true,

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
    // Seed from existing single selection so Ctrl+Click accumulates from it,
    // rather than dropping the original pick (matches common editor UX).
    const base = s.selectedItems.length > 0
      ? s.selectedItems
      : (s.selectedId && s.selectedType ? [{ id: s.selectedId, type: s.selectedType }] : [])
    const exists = base.find((it) => it.id === id && it.type === type)
    const next = exists
      ? base.filter((it) => !(it.id === id && it.type === type))
      : [...base, { id, type }]
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

  setRegulatoryDomain: (id) => set({ regulatoryDomain: id }),
  toggleAutoChannelOnPlace: () => set((s) => ({ autoChannelOnPlace: !s.autoChannelOnPlace })),
  togglePanelCollapsed: () => set((s) => ({ panelCollapsed: !s.panelCollapsed })),
  toggleLayer: (key) => set((s) => ({ [key]: !s[key] })),

  setAlignRefFloors: (ids) => set({ alignRefFloors: ids }),
  toggleAlignRefFloor: (id) => set((s) => {
    const current = s.alignRefFloors ?? []
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    return { alignRefFloors: next }
  }),
  setAlignRefOpacity: (v) => set({ alignRefOpacity: v }),
}))
