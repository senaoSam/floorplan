// Single source of truth for "what can each Layer do in mode X?".
// Derived from .claude/mode-matrix.md §3.
//
// Layers must consult getModeCapability(mode) instead of writing ad-hoc
// `if (isXMode)` checks. The 9 flags below cover hover / drag / handle /
// magnet / cursor / select / context-menu / dim behaviour.
//
// Object categories (matches mode-matrix.md):
//   - 'struct'   : Wall, Scope, FloorHole
//   - 'wireless' : AP
//   - 'cable'    : Switch, Cable Tray, Riser
//   - 'meta'     : FloorImage
//
// Type → category mapping (single place to update when adding object types):
//   wall, scope, floor_hole       → struct
//   ap                            → wireless
//   switch, cable_tray, cable_riser → cable
//   floor_image                   → meta

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

// Default cap: everything off. Specific modes opt-in to specific capabilities.
function emptyCap() {
  return {
    // Click on existing object selects it (and opens panel).
    allowSelectClick: { struct: false, wireless: false, cable: false, meta: false },
    // STRONG hover highlight (stroke thicken / glow, move-cursor). Implies
    // "left-click will select / drag". Use only when allowSelectClick or
    // allowDragExisting is true for the category.
    allowSelectHover: { struct: false, wireless: false, cable: false, meta: false },
    // WEAK hover highlight (faint outline only — no move cursor, no handles).
    // 23-3f: signals "right-click here will open a context menu" without
    // promising selectability. Modes that allow context menu but not drag/
    // click should set this so users know what they're aiming at when they
    // right-click in a draw / place mode.
    allowCommandHover: { struct: false, wireless: false, cable: false, meta: false },
    // Object can be dragged to a new position.
    allowDragExisting: { struct: false, wireless: false, cable: false, meta: false },
    // Endpoint / vertex handles when the object is selected.
    showHandles: { struct: false, cable: false },
    // Tray / riser magnet halo policy:
    //   'never'     — hide
    //   'selectedOnly' — only on selected / hovered
    //   'all'       — show on every tray / riser (snap candidate visibility)
    showMagnet: { tray: 'never', riser: 'never' },
    // Stage cursor default. Per-object `setHoverCursor` only overrides when
    // allowDragExisting or allowSelectClick is true for that object.
    cursor: 'default',
    // Right-click opens object context menu (rename / delete / ...).
    // 23-3f: Editor2D dynamically forces this OFF whenever a draft is in
    // progress (wall draft / scope polygon / tray polyline / scale points /
    // crop box / door-window first click), because right-click is already
    // bound to "cancel draft" in that state.
    allowContextMenu: false,
    // Fade out objects of non-target categories to opacity ~0.4 so the canvas
    // visually reads as "you're in X mode". Empty array = nothing dimmed.
    dimOthers: [],
  }
}

// 23-3f baseline for "non-SELECT mode without a draft in progress" — right-
// click can target any object and weak hover signals which one. Editor2D
// strips both flags off when a draft becomes active (see Step 2).
const COMMAND_OVERLAY = {
  allowCommandHover: { struct: true, wireless: true, cable: true, meta: true },
  allowContextMenu: true,
}

const SELECT_CAP = {
  allowSelectClick:   { struct: true,  wireless: true,  cable: true,  meta: true  },
  allowSelectHover:   { struct: true,  wireless: true,  cable: true,  meta: true  },
  // SELECT doesn't need allowCommandHover — strong hover already covers it.
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
  // Only wall hover/click is allowed — it picks the host wall for the opening.
  // Wall sub-category is 'struct' but DOOR_WINDOW only wants wall, not Scope /
  // FloorHole. The Layer-level `WallLayer` will handle this distinction; from
  // the matrix, struct=true is the closest fit so we light it up here. Scope /
  // FloorHole layers must still suppress hover X / drag because we set the
  // other capability flags to false.
  c.allowSelectClick.struct = true
  c.allowSelectHover.struct = true
  // 23-3f: right-click on AP/switch/tray etc. should still open command menu.
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
  // Switch hub snap to magnets: show all tray magnet halos so the user knows
  // which trays will auto-snap (17-3 spec §4).
  showMagnet: { tray: 'all', riser: 'never' },
  dimOthers: ['wireless', 'meta'],
}

const DRAW_CABLE_TRAY_CAP = {
  ...emptyCap(),
  ...COMMAND_OVERLAY,
  cursor: 'crosshair',
  // Drawing visibility: show every tray + riser magnet so user can plan snaps.
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

// Convenience: ask whether a specific object type (e.g. 'wall', 'ap') is
// dimmed under the given mode.
export function isCategoryDimmed(mode, type) {
  const cap = getModeCapability(mode)
  const cat = getObjectCategory(type)
  if (!cat) return false
  return cap.dimOthers.includes(cat)
}
