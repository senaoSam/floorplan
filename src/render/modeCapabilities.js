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
    dimOthers:          [],
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
}

const PAN_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'grab',
}

const MARQUEE_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
}

const DRAW_WALL_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  dimOthers: ['wireless', 'cable', 'meta'],
}

const DOOR_WINDOW_CAP = (() => {
  const c = emptyCap()
  c.allowSelectClick.struct = true
  c.allowSelectHover.struct = true
  c.allowCommandHover = { struct: true, wireless: true, cable: true, meta: true }
  c.allowContextMenu = true
  c.cursor = 'crosshair'
  c.dimOthers = ['wireless', 'cable', 'meta']
  return c
})()

const DRAW_SCOPE_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  dimOthers: ['wireless', 'cable', 'meta'],
}

const DRAW_FLOOR_HOLE_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  dimOthers: ['wireless', 'cable', 'meta'],
}

const PLACE_AP_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  dimOthers: ['cable', 'meta'],
}

const PLACE_SWITCH_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  showMagnet: { tray: 'all', riser: 'never' },
  dimOthers: ['wireless', 'meta'],
}

const DRAW_CABLE_TRAY_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  showMagnet: { tray: 'all', riser: 'all' },
  dimOthers: ['wireless', 'meta'],
}

const PLACE_RISER_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  showMagnet: { tray: 'never', riser: 'all' },
  dimOthers: ['wireless', 'meta'],
}

const DRAW_SCALE_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  dimOthers: ['struct', 'wireless', 'cable'],
}

const CROP_IMAGE_CAP = {
  ...emptyCap(),
  cursor: 'crosshair',
  dimOthers: ['struct', 'wireless', 'cable'],
}

const ALIGN_FLOOR_CAP = {
  ...emptyCap(),
  cursor: 'default',
  dimOthers: [],
}

const CAP_BY_MODE = {
  [EDITOR_MODE.SELECT]:           SELECT_CAP,
  [EDITOR_MODE.MARQUEE_SELECT]:   MARQUEE_CAP,
  [EDITOR_MODE.PAN]:              PAN_CAP,
  [EDITOR_MODE.DRAW_WALL]:        DRAW_WALL_CAP,
  [EDITOR_MODE.DOOR_WINDOW]:      DOOR_WINDOW_CAP,
  [EDITOR_MODE.DRAW_SCOPE]:       DRAW_SCOPE_CAP,
  [EDITOR_MODE.DRAW_FLOOR_HOLE]:  DRAW_FLOOR_HOLE_CAP,
  [EDITOR_MODE.PLACE_AP]:         PLACE_AP_CAP,
  [EDITOR_MODE.PLACE_SWITCH]:     PLACE_SWITCH_CAP,
  [EDITOR_MODE.DRAW_CABLE_TRAY]:  DRAW_CABLE_TRAY_CAP,
  [EDITOR_MODE.PLACE_RISER]:      PLACE_RISER_CAP,
  [EDITOR_MODE.DRAW_SCALE]:       DRAW_SCALE_CAP,
  [EDITOR_MODE.CROP_IMAGE]:       CROP_IMAGE_CAP,
  [EDITOR_MODE.ALIGN_FLOOR]:      ALIGN_FLOOR_CAP,
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
