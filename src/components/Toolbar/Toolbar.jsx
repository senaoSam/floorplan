import React, { useState, useRef, useEffect } from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useFloorStore } from '@/store/useFloorStore'
import Icon from '@/components/Icon/Icon'
import Tooltip from '@/components/Tooltip/Tooltip'
import AIWallsModal from '@/components/AIWallsModal/AIWallsModal'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
import './Toolbar.sass'

// Phase 18 + 24-2 floating toolbar — top-center icon strip with hover-
// expand group dropdowns. Phase 25 port:
//   - Undo / Redo wired up to the real useHistoryStore as of Bundle 18.
//   - AI walls action wired Bundle 24.
//   - Align-mode "are you sure" confirm dialog restored (oldSrc Toolbar
//     155-161 + 284-293): clicking a tool while in ALIGN_FLOOR stashes the
//     pending mode and prompts before leaving align mode, so alignment work
//     isn't dropped by a stray tool click. (The floor-switch path has its own
//     guard in SidebarLeft; this covers the toolbar tool-switch path.)

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
      { mode: EDITOR_MODE.DRAW_WALL,       icon: 'wall',       label: '畫牆（Tab 切換材質）' },
      { mode: EDITOR_MODE.DRAW_DOOR,       icon: 'door',       label: '門' },
      { mode: EDITOR_MODE.DRAW_WINDOW,     icon: 'window',     label: '窗' },
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

const EDIT_ACTIONS = [
  { action: 'undo', icon: 'undo', label: '復原（Ctrl+Z）' },
  { action: 'redo', icon: 'redo', label: '重做（Ctrl+Shift+Z）' },
]

const CLOSE_DELAY_MS = 200

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

  const [openGroupId, setOpenGroupId] = useState(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [pendingMode, setPendingMode] = useState(null)
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

  useEffect(() => () => setToolbarMenuOpen(false), [setToolbarMenuOpen])

  const resolveAction = (action) => {
    switch (action) {
      case 'undo':    return { enabled: undoLen > 0, onClick: undo }
      case 'redo':    return { enabled: redoLen > 0, onClick: redo }
      case 'aiWalls': return { enabled: aiEnabled,   onClick: () => setAiOpen(true) }
      default:     return { enabled: false, onClick: () => {} }
    }
  }

  const handleItemClick = (item) => {
    if (item.action) {
      const { enabled, onClick } = resolveAction(item.action)
      if (enabled) onClick()
      closeImmediate()
      return
    }
    if (item.band != null) setPlaceApBand(item.band)
    if (item.switchKind != null) setPlaceSwitchKind(item.switchKind)
    // In ALIGN_FLOOR, switching to any other tool would silently end align
    // mode — stash it and prompt instead (oldSrc handleModeClick 155-161).
    if (isAlignMode && item.mode !== EDITOR_MODE.ALIGN_FLOOR) {
      setPendingMode(item.mode)
      closeImmediate()
      return
    }
    setEditorMode(item.mode)
    closeImmediate()
  }

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
