import { create } from 'zustand'
import { MATERIALS } from '@/constants/materials'

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
  DRAW_DOOR: 'draw_door',
  DRAW_WINDOW: 'draw_window',
  ALIGN_FLOOR: 'align_floor',
  PLACE_SWITCH: 'place_switch',
  DRAW_CABLE_TRAY: 'draw_cable_tray',
  PLACE_RISER: 'place_riser',
  CLIENT_VIEW: 'client_view',
  CAMERA: 'camera',
  STATS: 'stats',
}

export const VIEW_MODE = {
  TWO_D: '2d',
  THREE_D: '3d',
}

// Top-level "worlds" the toolbar switches between. Every editorMode belongs to
// exactly one PRIMARY_MODE. AP planning owns the full RF-planning tool family
// (plus the hidden-entry modes CROP_IMAGE / ALIGN_FLOOR reached from panels);
// CAMERA and STATS are read-only worlds of their own. The toolbar renders a
// persistent primary-mode switcher (AP / Camera / Stats) and, below it, only
// the tools that belong to the active primary mode.
export const PRIMARY_MODE = {
  AP: 'ap',
  CAMERA: 'camera',
  STATS: 'stats',
}

// The editorMode each primary mode lands on when you switch INTO it. AP falls
// back to SELECT unless a remembered AP-family mode is restored (see
// setPrimaryMode). Camera / Stats are single-mode worlds.
const PRIMARY_DEFAULT_MODE = {
  [PRIMARY_MODE.AP]: EDITOR_MODE.SELECT,
  [PRIMARY_MODE.CAMERA]: EDITOR_MODE.CAMERA,
  [PRIMARY_MODE.STATS]: EDITOR_MODE.STATS,
}

// editorMode → owning primary mode. Anything not listed (SELECT, PAN, all the
// draw / place modes, plus CROP_IMAGE / ALIGN_FLOOR / CLIENT_VIEW) belongs to
// AP planning by default via getPrimaryMode's fallback.
const PRIMARY_BY_MODE = {
  [EDITOR_MODE.CAMERA]: PRIMARY_MODE.CAMERA,
  [EDITOR_MODE.STATS]: PRIMARY_MODE.STATS,
}

export function getPrimaryMode(editorMode) {
  return PRIMARY_BY_MODE[editorMode] ?? PRIMARY_MODE.AP
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
  // Active wall material for DRAW_WALL — Tab / Shift+Tab in DRAW_WALL mode
  // cycles MATERIAL_LIST and pops a toast (FloorplanSystem keydown).
  wallMaterial: MATERIALS.CONCRETE,

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
  // 3D viewer — render all floors stacked (true) vs. only the active
  // floor (false). Toggled from the Viewer3D overlay.
  show3DAllFloors: true,
  // Per-kind Switch visibility (gated by showSwitches master toggle).
  showSwitchKind: { switch: true, idf: true, mdf: true, router: true },

  // Regulatory domain — drives channel plan auto-assignment.
  regulatoryDomain: 'TW',
  autoChannelOnPlace: true,

  // ALIGN_FLOOR mode reference overlays.
  // `alignRefFloors` is a list of floor IDs displayed as translucent
  // tinted overlays while the active floor is being aligned. `null` is
  // the "uninitialised" sentinel — AlignFloorPanel seeds it on first
  // mount to "all other floors visible".
  alignRefFloors: null,
  alignRefOpacity: 0.3,

  // Remembers the last AP-planning editorMode so switching Camera/Stats → AP
  // restores the tool the user was on, rather than always snapping to SELECT.
  lastApMode: EDITOR_MODE.SELECT,

  setEditorMode: (mode) => set({
    editorMode: mode,
    // Stash AP-family modes so we can return to them from Camera/Stats.
    lastApMode: getPrimaryMode(mode) === PRIMARY_MODE.AP ? mode : get().lastApMode,
    // Leaving ALIGN_FLOOR resets the ref-overlay list to the uninitialised
    // sentinel so the next align session re-seeds to "all other floors" —
    // otherwise floors added after the first session stay unchecked and
    // their overlays silently never show.
    alignRefFloors: mode === EDITOR_MODE.ALIGN_FLOOR ? get().alignRefFloors : null,
    selectedId: null,
    selectedType: null,
    selectedItems: [],
  }),

  // Toolbar primary-mode switcher. Switching to AP restores the remembered
  // AP-family mode; Camera / Stats land on their single canonical mode.
  setPrimaryMode: (primary) => {
    const target = primary === PRIMARY_MODE.AP
      ? get().lastApMode
      : PRIMARY_DEFAULT_MODE[primary]
    get().setEditorMode(target)
  },
  setViewMode: (mode) => set({ viewMode: mode }),
  setSelected: (id, type) => {
    if (typeof window !== 'undefined' && window.__debugWallSelect) {
      console.log('[editor]', 'setSelected(', id, type, ')  trace:')
      console.trace()
    }
    set({ selectedId: id, selectedType: type, selectedItems: [], panelCollapsed: false })
  },
  clearSelected: () => {
    if (typeof window !== 'undefined' && window.__debugWallSelect) {
      console.log('[editor]', 'clearSelected()  trace:')
      console.trace()
    }
    set({ selectedId: null, selectedType: null, selectedItems: [] })
  },

  setSelectedItems: (items) => set({
    selectedItems: items,
    selectedId: items.length === 1 ? items[0].id : null,
    selectedType: items.length === 1 ? items[0].type : null,
    panelCollapsed: false,
  }),
  // Ctrl/Cmd+click additive selection (oldSrc useEditorStore 97-113). Adds or
  // removes one object from the multi-selection, seeding from the current
  // single selection so the first Ctrl+click accumulates onto it rather than
  // dropping it. Keeps selectedId/selectedType in sync when the set collapses
  // back to one item (so single-object panels still render).
  toggleSelectedItem: (id, type) => set((s) => {
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

  setPlaceApBand: (band) => set({ placeApBand: band }),
  setPlaceSwitchKind: (kind) => set({ placeSwitchKind: kind }),
  setWallMaterial: (mat) => set({ wallMaterial: mat }),
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

  setAlignRefFloors: (ids) => set({ alignRefFloors: ids }),
  toggleAlignRefFloor: (id) => set((s) => {
    const current = s.alignRefFloors ?? []
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    return { alignRefFloors: next }
  }),
  setAlignRefOpacity: (v) => set({ alignRefOpacity: v }),

  contextMenu: null,
  openContextMenu: (payload) => {
    if (typeof window !== 'undefined' && window.__debugRMB === true) {
      console.log('[RMB openContextMenu]', payload)
      console.trace()
    }
    set({ contextMenu: payload })
  },
  closeContextMenu: () => set((s) => {
    if (typeof window !== 'undefined' && window.__debugRMB === true && s.contextMenu) {
      console.log('[RMB closeContextMenu] CALLED, current ctx =', s.contextMenu)
      console.trace()
    }
    return s.contextMenu ? { contextMenu: null } : {}
  }),
}))
