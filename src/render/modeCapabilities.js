// Ported 1:1 from oldSrc/features/editor/modeCapabilities.js — Phase 25.
// Single source of truth for "what can each Layer do in mode X?".
//
// Layers must consult getModeCapability(mode) instead of writing ad-hoc
// `if (isXMode)` checks. The 9 flags below cover hover / drag / handle /
// magnet / cursor / select / context-menu / dim behaviour.
//
// Object categories:
//   - 'struct'   : Wall, Scope, FloorHole
//   - 'wireless' : AP
//   - 'cable'    : Switch, Cable Tray, Riser
//   - 'meta'     : FloorImage

import { EDITOR_MODE } from '@/store/useEditorStore'
import { CLIENT_CURSOR } from '@/features/clientView/clientCursor'

export const OBJ_CATEGORY = {
  wall:         'struct',
  scope:        'struct',
  floor_hole:   'struct',
  ap:           'wireless',
  switch:       'cable',
  cable_tray:   'cable',
  cable_riser:  'cable',
  floor_image:  'meta',
}

export function getObjectCategory(type) {
  return OBJ_CATEGORY[type] ?? null
}

function emptyCap() {
  return {
    allowSelectClick:   { struct: false, wireless: false, cable: false, meta: false },
    allowSelectHover:   { struct: false, wireless: false, cable: false, meta: false },
    allowCommandHover:  { struct: false, wireless: false, cable: false, meta: false },
    allowDragExisting:  { struct: false, wireless: false, cable: false, meta: false },
    showHandles:        { struct: false, cable: false },
    showMagnet:         { tray: 'never', riser: 'never' },
    cursor:             'default',
    allowContextMenu:   false,
    // dimOthers: legacy category-based dim list (kept for back-compat).
    // Layers are now actually dimmed/kept via `keepLayers` below — a more
    // precise per-layer keep-list so e.g. PLACE_AP doesn't accidentally
    // keep walls / scopes / floor-holes full just because they share the
    // 'struct' category with the active draw target. User explicit ask:
    // strict mode-relevant focus.
    dimOthers:          [],
    keepLayers:         'all',
  }
}

// 23-3f baseline for "non-SELECT mode without a draft in progress" —
// right-click can target any object and weak hover signals which one.
const COMMAND_OVERLAY = {
  allowCommandHover: { struct: true, wireless: true, cable: true, meta: true },
  allowContextMenu: true,
}

const SELECT_CAP = {
  allowSelectClick:   { struct: true,  wireless: true,  cable: true,  meta: true  },
  allowSelectHover:   { struct: true,  wireless: true,  cable: true,  meta: true  },
  allowCommandHover:  { struct: false, wireless: false, cable: false, meta: false },
  allowDragExisting:  { struct: true,  wireless: true,  cable: true,  meta: true  },
  showHandles:        { struct: true,  cable: true },
  showMagnet:         { tray: 'selectedOnly', riser: 'selectedOnly' },
  cursor:             'default',
  allowContextMenu:   true,
  dimOthers:          [],
  keepLayers:         'all',
}

const PAN_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'grab',
  keepLayers: 'all',
}

const MARQUEE_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  keepLayers: 'all',
}

// Strict per-mode keep-lists. floorImage always stays full (background
// reference) — other categories follow the rule "only my own type stays
// bright, everything else dims" so the user can focus on the active
// edit. heatmap only stays full in PLACE_AP since it's purely RF
// visualisation. scopes layer hosts BOTH scope and floor_hole objects
// in this codebase, so DRAW_SCOPE and DRAW_FLOOR_HOLE both keep it.
const DRAW_WALL_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  dimOthers: ['wireless', 'cable', 'meta'],
  keepLayers: ['floorImage', 'walls'],
}

const DOOR_WINDOW_CAP = (() => {
  const c = emptyCap()
  c.allowSelectClick.struct = true
  c.allowSelectHover.struct = true
  c.allowCommandHover = { struct: true, wireless: true, cable: true, meta: true }
  c.allowContextMenu = true
  c.cursor = 'crosshair'
  c.dimOthers = ['wireless', 'cable', 'meta']
  c.keepLayers = ['floorImage', 'walls']
  return c
})()

const DRAW_SCOPE_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  dimOthers: ['wireless', 'cable', 'meta'],
  keepLayers: ['floorImage', 'scopes'],
}

const DRAW_FLOOR_HOLE_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  dimOthers: ['wireless', 'cable', 'meta'],
  keepLayers: ['floorImage', 'scopes'],
}

const PLACE_AP_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  dimOthers: ['cable', 'meta'],
  keepLayers: ['floorImage', 'devicesAP', 'heatmap'],
}

// Cable modes share a keep-list — switches / cable trays / risers are
// one integrated system and APs are the endpoints those cables land on,
// so all stay full while structural / scope / floor-hole layers dim.
const CABLE_KEEP = ['floorImage', 'devicesSW', 'devicesAP', 'cables', 'trays', 'devicesRiser']

const PLACE_SWITCH_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  showMagnet: { tray: 'all', riser: 'never' },
  dimOthers: ['wireless', 'meta'],
  keepLayers: CABLE_KEEP,
}

const DRAW_CABLE_TRAY_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  showMagnet: { tray: 'all', riser: 'all' },
  dimOthers: ['wireless', 'meta'],
  keepLayers: CABLE_KEEP,
}

const PLACE_RISER_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  showMagnet: { tray: 'never', riser: 'all' },
  dimOthers: ['wireless', 'meta'],
  keepLayers: CABLE_KEEP,
}

const DRAW_SCALE_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  dimOthers: ['struct', 'wireless', 'cable'],
  keepLayers: ['floorImage'],
}

// CLIENT_VIEW — "see the network from a client's perspective". A virtual
// client is placed / dragged on the canvas; the only RF context that matters
// is the floor image + the APs it might associate to (+ the heatmap when the
// user wants the coverage backdrop). All editing affordances are off: this is
// a read-only simulation mode (no select / drag / handles / context-menu).
// The client marker + association lines paint on the overlays layer, driven
// by clientViewBinder (not a hit-tested object), so no per-object capability
// is needed here.
const CLIENT_VIEW_CAP = {
  ...emptyCap(),
  cursor: CLIENT_CURSOR,
  dimOthers: ['struct', 'cable'],
  keepLayers: ['floorImage', 'devicesAP', 'heatmap'],
}

// CAMERA — surveillance planning (Phase 34). Per design consensus the mode is
// walls-only: every layer except floorImage + walls is HIDDEN (not dimmed —
// layerVisibilityBinder enforces the hiding; keepLayers here just keeps the
// two visible layers at full alpha). Cameras are mode-exclusive objects with
// their own interactions inside camerasLayer, so no per-category capability
// is granted — clicking empty canvas places a camera (viewport place-mode).
const CAMERA_CAP = {
  ...emptyCap(),
  cursor: 'crosshair',
  dimOthers: [],
  keepLayers: ['floorImage', 'walls'],
}

const CROP_IMAGE_CAP = {
  ...emptyCap(),
  cursor: 'crosshair',
  dimOthers: ['struct', 'wireless', 'cable'],
  keepLayers: ['floorImage'],
}

const ALIGN_FLOOR_CAP = {
  ...emptyCap(),
  cursor: 'default',
  dimOthers: [],
  keepLayers: 'all',
}

const CAP_BY_MODE = {
  [EDITOR_MODE.SELECT]:           SELECT_CAP,
  [EDITOR_MODE.MARQUEE_SELECT]:   MARQUEE_CAP,
  [EDITOR_MODE.PAN]:              PAN_CAP,
  [EDITOR_MODE.DRAW_WALL]:        DRAW_WALL_CAP,
  [EDITOR_MODE.DRAW_DOOR]:        DOOR_WINDOW_CAP,
  [EDITOR_MODE.DRAW_WINDOW]:      DOOR_WINDOW_CAP,
  [EDITOR_MODE.DRAW_SCOPE]:       DRAW_SCOPE_CAP,
  [EDITOR_MODE.DRAW_FLOOR_HOLE]:  DRAW_FLOOR_HOLE_CAP,
  [EDITOR_MODE.PLACE_AP]:         PLACE_AP_CAP,
  [EDITOR_MODE.PLACE_SWITCH]:     PLACE_SWITCH_CAP,
  [EDITOR_MODE.DRAW_CABLE_TRAY]:  DRAW_CABLE_TRAY_CAP,
  [EDITOR_MODE.PLACE_RISER]:      PLACE_RISER_CAP,
  [EDITOR_MODE.DRAW_SCALE]:       DRAW_SCALE_CAP,
  [EDITOR_MODE.CROP_IMAGE]:       CROP_IMAGE_CAP,
  [EDITOR_MODE.ALIGN_FLOOR]:      ALIGN_FLOOR_CAP,
  [EDITOR_MODE.CLIENT_VIEW]:      CLIENT_VIEW_CAP,
  [EDITOR_MODE.CAMERA]:           CAMERA_CAP,
}

export function getModeCapability(mode) {
  return CAP_BY_MODE[mode] ?? emptyCap()
}

export function isCategoryDimmed(mode, type) {
  const cap = getModeCapability(mode)
  const cat = getObjectCategory(type)
  if (!cat) return false
  return cap.dimOthers.includes(cat)
}
