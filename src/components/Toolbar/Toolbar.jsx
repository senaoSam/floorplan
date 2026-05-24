import React, { useState, useRef, useEffect } from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useFloorStore } from '@/store/useFloorStore'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
import AIWallsModal from '@/components/AIWallsModal/AIWallsModal'
import Icon from '@/components/Icon/Icon'
import Tooltip from '@/components/Tooltip/Tooltip'
import './Toolbar.sass'

// Two-tier floating toolbar (Phase 24 redesign).
//   Tier 1: one button per group (representative icon). Hover to open.
//   Tier 2: vertical dropdown listing each item with icon + label text.
//   - Hover open / mouseleave with 200ms delay to avoid losing the menu
//     when the cursor crosses the gap between trigger and dropdown.
//   - If a group has an active mode, the trigger shows that item's icon
//     and the active accent; otherwise it shows the group's default icon.
//   - Some items carry a sub-type (e.g. AP band, switch kind) that is
//     stored in useEditorStore (placeApBand / placeSwitchKind) so Editor2D
//     can apply it when the click commits the placement.
//
// Undo/Redo stay as two flat icon buttons pinned to the toolbar's right
// edge — no dropdown, no merging.

// Group definition. `items` are the list-menu entries. Each item is either
// a mode trigger (`mode` + optional sub-type `band` / `switchKind`) or an
// action (`action`). `representativeIcon` is the trigger glyph shown when no
// item in the group is currently active.
const GROUPS = [
  {
    id: 'pointer',
    label: '指標',
    representativeIcon: 'select',
    items: [
      { mode: EDITOR_MODE.SELECT,          icon: 'select',     label: '選取' },
      { mode: EDITOR_MODE.MARQUEE_SELECT,  icon: 'marquee',    label: '框選' },
      { mode: EDITOR_MODE.PAN,             icon: 'pan',        label: '平移' },
    ],
  },
  {
    id: 'structure',
    label: '牆 / 結構',
    representativeIcon: 'wall',
    items: [
      { mode: EDITOR_MODE.DRAW_WALL,       icon: 'wall',       label: '畫牆' },
      { mode: EDITOR_MODE.DOOR_WINDOW,     icon: 'doorWindow', label: '門窗' },
      { mode: EDITOR_MODE.DRAW_FLOOR_HOLE, icon: 'floorHole',  label: '中庭' },
      { action: 'aiWalls',                 icon: 'aiWalls',    label: 'AI 牆（從底圖辨識）' },
    ],
  },
  {
    id: 'wireless',
    label: '無線 AP',
    representativeIcon: 'ap',
    items: [
      { mode: EDITOR_MODE.PLACE_AP,        icon: 'ap', label: '放置 AP — 2.4 GHz', band: 2.4 },
      { mode: EDITOR_MODE.PLACE_AP,        icon: 'ap', label: '放置 AP — 5 GHz',   band: 5   },
      { mode: EDITOR_MODE.PLACE_AP,        icon: 'ap', label: '放置 AP — 6 GHz',   band: 6   },
      { mode: EDITOR_MODE.DRAW_SCOPE,      icon: 'scope', label: '範圍' },
    ],
  },
  {
    id: 'cable',
    label: '網路布線',
    representativeIcon: 'switch',
    items: [
      { mode: EDITOR_MODE.PLACE_SWITCH,    icon: 'switch', label: '放置 Switch', switchKind: 'switch' },
      { mode: EDITOR_MODE.PLACE_SWITCH,    icon: 'switch', label: '放置 IDF',    switchKind: 'idf'    },
      { mode: EDITOR_MODE.PLACE_SWITCH,    icon: 'switch', label: '放置 MDF',    switchKind: 'mdf'    },
      { mode: EDITOR_MODE.PLACE_SWITCH,    icon: 'switch', label: '放置 Router', switchKind: 'router' },
      { mode: EDITOR_MODE.DRAW_CABLE_TRAY, icon: 'cableTray', label: '繪製線槽' },
      { mode: EDITOR_MODE.PLACE_RISER,     icon: 'riser',     label: '放置 Riser' },
    ],
  },
  {
    id: 'measure',
    label: '量測',
    representativeIcon: 'scale',
    items: [
      { mode: EDITOR_MODE.DRAW_SCALE,      icon: 'scale',  label: '比例尺' },
    ],
  },
]

// Undo / Redo render as two flat icon buttons at the far right.
const EDIT_ACTIONS = [
  { action: 'undo', icon: 'undo', label: '復原（Ctrl+Z）' },
  { action: 'redo', icon: 'redo', label: '重做（Ctrl+Shift+Z）' },
]

const CLOSE_DELAY_MS = 200

// Is this item the currently-active selection? Sub-type aware so the
// active highlight only lights up when both mode AND sub-type match.
function isItemActive(item, editorMode, placeApBand, placeSwitchKind) {
  if (item.action) return false
  if (item.mode !== editorMode) return false
  if (item.band != null && item.band !== placeApBand) return false
  if (item.switchKind != null && item.switchKind !== placeSwitchKind) return false
  return true
}

function Toolbar() {
  const editorMode = useEditorStore((s) => s.editorMode)
  const setEditorMode = useEditorStore((s) => s.setEditorMode)
  const placeApBand = useEditorStore((s) => s.placeApBand)
  const placeSwitchKind = useEditorStore((s) => s.placeSwitchKind)
  const setPlaceApBand = useEditorStore((s) => s.setPlaceApBand)
  const setPlaceSwitchKind = useEditorStore((s) => s.setPlaceSwitchKind)
  const setToolbarMenuOpen = useEditorStore((s) => s.setToolbarMenuOpen)
  const undoLen = useHistoryStore((s) => s.undoStack.length)
  const redoLen = useHistoryStore((s) => s.redoStack.length)
  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floors = useFloorStore((s) => s.floors)
  const activeFloor = floors.find((f) => f.id === activeFloorId)
  const aiEnabled = !!(activeFloor && activeFloor.imageUrl)

  const [pendingMode, setPendingMode] = useState(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [openGroupId, setOpenGroupId] = useState(null)
  const closeTimerRef = useRef(null)

  const isAlignMode = editorMode === EDITOR_MODE.ALIGN_FLOOR

  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimerRef.current = setTimeout(() => {
      setOpenGroupId(null)
      setToolbarMenuOpen(false)
    }, CLOSE_DELAY_MS)
  }
  const openGroup = (gid) => {
    cancelClose()
    setOpenGroupId(gid)
    setToolbarMenuOpen(true)
  }
  const closeImmediate = () => {
    cancelClose()
    setOpenGroupId(null)
    setToolbarMenuOpen(false)
  }

  // Make sure a stale toolbarMenuOpen=true doesn't outlive this component
  // (e.g. if the toolbar unmounts while a menu is open).
  useEffect(() => () => setToolbarMenuOpen(false), [setToolbarMenuOpen])

  const handleModeClick = (mode) => {
    if (isAlignMode && mode !== EDITOR_MODE.ALIGN_FLOOR) {
      setPendingMode(mode)
      return
    }
    setEditorMode(mode)
  }

  // Resolve action button state from its action id.
  const resolveAction = (action) => {
    switch (action) {
      case 'undo':    return { enabled: undoLen > 0, onClick: undo }
      case 'redo':    return { enabled: redoLen > 0, onClick: redo }
      case 'aiWalls': return { enabled: aiEnabled,   onClick: () => setAiOpen(true) }
      default:        return { enabled: false, onClick: () => {} }
    }
  }

  // Commit a list-menu item click: set sub-type first (so Editor2D reads the
  // right value when the next placement fires), then switch mode, then close.
  const handleItemClick = (item) => {
    if (item.action) {
      const { enabled, onClick } = resolveAction(item.action)
      if (enabled) onClick()
      closeImmediate()
      return
    }
    if (item.band != null) setPlaceApBand(item.band)
    if (item.switchKind != null) setPlaceSwitchKind(item.switchKind)
    handleModeClick(item.mode)
    closeImmediate()
  }

  // Pick the icon shown on the group trigger. If something in this group is
  // active (mode + sub-type match), use that item's icon to give visual
  // continuity with the current placement; otherwise fall back to the
  // configured representative icon.
  const triggerIcon = (group) => {
    const active = group.items.find((it) =>
      isItemActive(it, editorMode, placeApBand, placeSwitchKind),
    )
    return active ? active.icon : group.representativeIcon
  }

  const groupHasActive = (group) =>
    group.items.some((it) => isItemActive(it, editorMode, placeApBand, placeSwitchKind))

  return (
    <div className="toolbar-floating" role="toolbar" aria-label="編輯工具">
      {GROUPS.map((group) => {
        const isOpen = openGroupId === group.id
        const active = groupHasActive(group)
        return (
          <div
            key={group.id}
            className="toolbar-floating__group"
            onMouseEnter={() => openGroup(group.id)}
            onMouseLeave={scheduleClose}
          >
            <Tooltip label={group.label}>
              <button
                type="button"
                className={
                  'toolbar-floating__btn' +
                  (active ? ' toolbar-floating__btn--active' : '')
                }
                aria-label={group.label}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                onClick={() => openGroup(group.id)}
              >
                <Icon name={triggerIcon(group)} size={18} />
              </button>
            </Tooltip>

            {isOpen && (
              <div className="toolbar-floating__menu" role="menu">
                {group.items.map((it, idx) => {
                  const key = `${it.mode ?? it.action}-${it.band ?? it.switchKind ?? idx}`
                  const itemActive = isItemActive(it, editorMode, placeApBand, placeSwitchKind)
                  const { enabled } = it.action
                    ? resolveAction(it.action)
                    : { enabled: true }
                  return (
                    <button
                      key={key}
                      type="button"
                      role="menuitem"
                      className={
                        'toolbar-floating__menu-item' +
                        (itemActive ? ' toolbar-floating__menu-item--active' : '')
                      }
                      disabled={!enabled}
                      onClick={() => handleItemClick(it)}
                    >
                      <Icon name={it.icon} size={16} />
                      <span className="toolbar-floating__menu-label">{it.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      <span className="toolbar-floating__spacer" aria-hidden="true" />

      <div className="toolbar-floating__group toolbar-floating__group--edit">
        {EDIT_ACTIONS.map((it) => {
          const { enabled, onClick } = resolveAction(it.action)
          return (
            <Tooltip key={it.action} label={it.label}>
              <button
                type="button"
                className="toolbar-floating__btn"
                onClick={onClick}
                disabled={!enabled}
                aria-label={it.label}
              >
                <Icon name={it.icon} size={18} />
              </button>
            </Tooltip>
          )
        })}
      </div>

      <AIWallsModal open={aiOpen} onClose={() => setAiOpen(false)} />

      {pendingMode && (
        <ConfirmDialog
          title="離開樓層對齊？"
          message="你正在對齊樓層，切換工具會結束對齊模式（已調整的偏移/縮放/旋轉會保留）。確定要離開嗎？"
          confirmLabel="離開對齊"
          cancelLabel="繼續對齊"
          onConfirm={() => { const m = pendingMode; setPendingMode(null); setEditorMode(m) }}
          onCancel={() => setPendingMode(null)}
        />
      )}
    </div>
  )
}

export default Toolbar
