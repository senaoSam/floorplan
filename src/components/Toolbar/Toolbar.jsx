import React, { useState, useRef, useEffect } from 'react'
import { useEditorStore, EDITOR_MODE, PRIMARY_MODE, VIEW_MODE, getPrimaryMode } from '@/store/useEditorStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useFloorStore } from '@/store/useFloorStore'
import { showUiToast } from '@/store/useUiToastStore'
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

// Top row: the persistent primary-mode switcher. AP planning / Camera / Stats
// are three mutually-exclusive "worlds"; clicking one switches into it (Stats
// and Camera are single canonical modes, AP restores the last AP-family tool).
// Stats sits after a divider — it's an entry usable from either working world.
const PRIMARY_BUTTONS = [
  { primary: PRIMARY_MODE.AP,     icon: 'ap',     label: 'AP 規劃（無線 / 布線 / 結構）' },
  { primary: PRIMARY_MODE.CAMERA, icon: 'camera', label: 'Camera 模式（監視器規劃）' },
  { primary: PRIMARY_MODE.STATS,  icon: 'stats',  label: '統計（即時網路儀表板）', dividerBefore: true },
]

// Bottom row: per-primary tool groups. Only the groups whose `primary` matches
// the active primary mode are rendered — so entering Camera / Stats hides the
// entire AP-planning tool family (walls / AP / cabling / measure), which is
// exactly the point: those tools do nothing in those read-only worlds.
// 52-D5: tools that act ON a floor. Pointer tools (select / marquee / pan)
// are harmless with an empty canvas and stay available.
const MODES_NEEDING_FLOOR = new Set([
  EDITOR_MODE.DRAW_WALL, EDITOR_MODE.DRAW_DOOR, EDITOR_MODE.DRAW_WINDOW,
  EDITOR_MODE.DRAW_FLOOR_HOLE, EDITOR_MODE.PLACE_AP, EDITOR_MODE.DRAW_SCOPE,
  EDITOR_MODE.CLIENT_VIEW, EDITOR_MODE.PLACE_SWITCH, EDITOR_MODE.DRAW_CABLE_TRAY,
  EDITOR_MODE.PLACE_RISER, EDITOR_MODE.DRAW_SCALE,
])

const GROUPS = [
  {
    id: 'pointer',
    primary: PRIMARY_MODE.AP,
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
    primary: PRIMARY_MODE.AP,
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
    primary: PRIMARY_MODE.AP,
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
    id: 'experience',
    primary: PRIMARY_MODE.AP,
    label: '體驗',
    representativeIcon: 'client',
    items: [
      { mode: EDITOR_MODE.CLIENT_VIEW,     icon: 'client', label: 'Client 視角（從裝置看網路）' },
    ],
  },
  {
    id: 'cable',
    primary: PRIMARY_MODE.AP,
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
    primary: PRIMARY_MODE.AP,
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
  const setPrimaryMode = useEditorStore((s) => s.setPrimaryMode)
  const setToolbarMenuOpen = useEditorStore((s) => s.setToolbarMenuOpen)
  const undoLen = useHistoryStore((s) => s.undoStack.length)
  const redoLen = useHistoryStore((s) => s.redoStack.length)
  // 53-G5 (P3-17): the first edit lives only as a pending raw for the 300ms
  // debounce window. undo() flushes before checking, so it works during that
  // window — the button must not look disabled while it does.
  const hasPending = useHistoryStore((s) => s.hasPending)
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
  const activePrimary = getPrimaryMode(editorMode)
  // 47-26: 3D is a read-only view. Keep the primary world switcher (AP / Camera
  // / Stats — a navigation choice that still applies to what you're viewing in
  // 3D), but hide the editing tools row and Undo/Redo, which have nothing to
  // act on there.
  const is3D = useEditorStore((s) => s.viewMode === VIEW_MODE.THREE_D)
  const visibleGroups = is3D ? [] : GROUPS.filter((g) => g.primary === activePrimary)

  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  // 53-G10 (E8): clear the pending close on unmount. Switching to 3D unmounts
  // this toolbar; a timer already in flight then fired setOpenGroupId /
  // setToolbarMenuOpen on a gone component, and the menu-open flag it writes is
  // shared editor state — so the next 2D mount could come up with the menu
  // closing itself out from under the user.
  useEffect(() => cancelClose, [])
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
      case 'undo':    return { enabled: undoLen > 0 || hasPending, onClick: undo }
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
    // 52-D5: with no floor, entering a draw/place tool used to succeed
    // silently and then swallow every canvas click — the tester clicked
    // 無線 AP, clicked the canvas several times, got nothing, and assumed the
    // app had crashed. Meanwhile the 50/150/300 AP buttons right next to it
    // correctly grey out, so the toolbar was holding two different standards.
    // Say why instead of no-oping.
    if (!activeFloor && item.mode && MODES_NEEDING_FLOOR.has(item.mode)) {
      showUiToast('請先匯入平面圖，才能使用這項工具')
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

  // Primary-mode switch (top row). Reuses the ALIGN_FLOOR confirm guard: while
  // aligning a floor, jumping to another world would silently drop align mode,
  // so stash the intended editorMode and prompt first. We resolve the primary
  // to its landing editorMode here so the confirm's setEditorMode(m) lands the
  // user in the right world.
  const handlePrimaryClick = (primary) => {
    if (primary === activePrimary) return
    closeImmediate()
    if (isAlignMode) {
      const target = primary === PRIMARY_MODE.AP
        ? useEditorStore.getState().lastApMode
        : primary === PRIMARY_MODE.CAMERA ? EDITOR_MODE.CAMERA : EDITOR_MODE.STATS
      setPendingMode(target)
      return
    }
    setPrimaryMode(primary)
  }

  const triggerIcon = (group) => {
    const active = group.items.find((it) =>
      isItemActive(it, editorMode, placeApBand, placeSwitchKind),
    )
    return active ? active.icon : group.representativeIcon
  }

  const groupHasActive = (group) =>
    group.items.some((it) => isItemActive(it, editorMode, placeApBand, placeSwitchKind))

  // Camera / Stats are read-only worlds: their tools row has no RF-planning
  // groups (those are AP-only). We still surface the shared Undo/Redo keys in
  // every mode so the row isn't blank and history stays reachable.
  return (
    <div className="toolbar-floating" role="toolbar" aria-label="編輯工具">
      {/* Top row — persistent primary-mode switcher (AP / Camera / Stats) */}
      <div
        className={
          'toolbar-floating__row toolbar-floating__row--primary' +
          (visibleGroups.length === 0 ? ' toolbar-floating__row--no-tools' : '')
        }
        role="tablist"
        aria-label="模式"
      >
        {PRIMARY_BUTTONS.map((pb) => {
          const active = activePrimary === pb.primary
          return (
            <React.Fragment key={pb.primary}>
              {pb.dividerBefore && (
                <span className="toolbar-floating__divider" aria-hidden="true" />
              )}
              <Tooltip label={pb.label}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={
                    'toolbar-floating__primary-btn' +
                    (active ? ' toolbar-floating__primary-btn--active' : '')
                  }
                  aria-label={pb.label}
                  onClick={() => handlePrimaryClick(pb.primary)}
                >
                  <Icon name={pb.icon} size={18} />
                </button>
              </Tooltip>
            </React.Fragment>
          )
        })}

        {/* Undo / Redo — pinned to the far right of the primary row so they
            stay put in every mode instead of drifting with the tools below.
            47-26: hidden in 3D (read-only view, nothing to undo). */}
        {!is3D && (
          <>
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
          </>
        )}
      </div>

      {/* Bottom row — tools for the active primary mode only. Camera / Stats
          have no planning tools, so the row (and its separator) is omitted. */}
      {visibleGroups.length > 0 && (
      <div className="toolbar-floating__row toolbar-floating__row--tools">
        {visibleGroups.map((group) => {
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
                    // 52-D5: grey out floor-dependent tools when there is no
                    // floor, so the state is visible before the click — the
                    // toast in handleItemClick is the fallback for anyone who
                    // clicks anyway (a disabled button fires no onClick).
                    const needsFloor = !activeFloor && it.mode && MODES_NEEDING_FLOOR.has(it.mode)
                    const { enabled } = it.action
                      ? resolveAction(it.action)
                      : { enabled: !needsFloor }
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
                        title={needsFloor ? '需先匯入平面圖' : undefined}
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
      </div>
      )}

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
