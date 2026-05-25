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

  // Toolbar place-mode sub-types — Editor2D / placeModeBinder reads these to
  // know which AP band / switch kind to drop on the next click.
  placeApBand: 5,
  placeSwitchKind: 'switch',

  // Toolbar dropdown open — surfaced so the mode hint banner can hide
  // itself while a dropdown is expanded.
  toolbarMenuOpen: false,

  // Panel collapse states (visual chrome).
  panelCollapsed: false,
  sidebarCollapsed: false,

  // Per-layer visibility (LayerToggle).
  showFloorImage: true,
  showScopes: true,
  showFloorHoles: true,
  showWalls: true,
  showAPs: true,
  showAPInfo: true,
  showSwitches: true,
  showCables: true,
  showCableTrays: true,
  showRisers: true,
  // Per-band AP visibility (gated by showAPs master toggle).
  showAPBand: { 2.4: true, 5: true, 6: true },
  // Per-kind Switch visibility (gated by showSwitches master toggle).
  showSwitchKind: { switch: true, idf: true, mdf: true, router: true },

  // Regulatory domain — drives channel plan auto-assignment.
  regulatoryDomain: 'TW',
  autoChannelOnPlace: true,

  setEditorMode: (mode) => set({
    editorMode: mode,
    selectedId: null,
    selectedType: null,
    selectedItems: [],
  }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSelected: (id, type) => set({ selectedId: id, selectedType: type, selectedItems: [], panelCollapsed: false }),
  clearSelected: () => set({ selectedId: null, selectedType: null, selectedItems: [] }),

  setSelectedItems: (items) => set({
    selectedItems: items,
    selectedId: items.length === 1 ? items[0].id : null,
    selectedType: items.length === 1 ? items[0].type : null,
    panelCollapsed: false,
  }),
  isItemSelected: (id) => {
    const s = get()
    if (s.selectedId === id) return true
    return s.selectedItems.some((it) => it.id === id)
  },

  setPlaceApBand: (band) => set({ placeApBand: band }),
  setPlaceSwitchKind: (kind) => set({ placeSwitchKind: kind }),
  setToolbarMenuOpen: (open) => set({ toolbarMenuOpen: open }),
  togglePanelCollapsed: () => set((s) => ({ panelCollapsed: !s.panelCollapsed })),
  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  toggleLayer: (key) => set((s) => ({ [key]: !s[key] })),
  toggleAPBand: (band) => set((s) => ({
    showAPBand: { ...s.showAPBand, [band]: !s.showAPBand[band] },
  })),
  toggleSwitchKind: (kind) => set((s) => ({
    showSwitchKind: { ...s.showSwitchKind, [kind]: !s.showSwitchKind[kind] },
  })),

  setRegulatoryDomain: (id) => set({ regulatoryDomain: id }),
  toggleAutoChannelOnPlace: () => set((s) => ({ autoChannelOnPlace: !s.autoChannelOnPlace })),

  contextMenu: null,
  openContextMenu: (payload) => set({ contextMenu: payload }),
  closeContextMenu: () => set((s) => (s.contextMenu ? { contextMenu: null } : {})),
}))
