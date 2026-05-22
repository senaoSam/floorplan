import React, { useState } from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useFloorStore } from '@/store/useFloorStore'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
import AIWallsModal from '@/components/AIWallsModal/AIWallsModal'
import Icon from '@/components/Icon/Icon'
import Tooltip from '@/components/Tooltip/Tooltip'
import './Toolbar.sass'

// Phase 18 / Task 24-2: floating, icon-only toolbar pinned to the top-center
// of the canvas. Groups follow the .claude/task.md "24-1 Group 對照表"
// (操作 / 結構 / 無線 / 網路布線 / 標註 / 編輯 / 輔助). No emoji icons — every
// glyph is an SVG path component for crisp rendering and consistent stroke.
//
// Layout in the parent canvas area:
//   [設備規劃] ←left              [Toolbar (this)]           [圖層] [國家頻段]
//                                  ↑ float top, x-centered

// Each entry: { mode | action, icon, label }. Action buttons (undo/redo/ai)
// don't have a mode and use `action` instead.
const GROUPS = [
  {
    id: 'pointer',
    items: [
      { mode: EDITOR_MODE.SELECT,          icon: 'select',     label: '選取' },
      { mode: EDITOR_MODE.MARQUEE_SELECT,  icon: 'marquee',    label: '框選' },
      { mode: EDITOR_MODE.PAN,             icon: 'pan',        label: '平移' },
    ],
  },
  {
    id: 'structure',
    items: [
      { mode: EDITOR_MODE.DRAW_WALL,       icon: 'wall',       label: '畫牆' },
      { mode: EDITOR_MODE.DOOR_WINDOW,     icon: 'doorWindow', label: '門窗' },
      { mode: EDITOR_MODE.DRAW_FLOOR_HOLE, icon: 'floorHole',  label: '中庭' },
    ],
  },
  {
    id: 'wireless',
    items: [
      { mode: EDITOR_MODE.PLACE_AP,        icon: 'ap',         label: '放置 AP' },
      { mode: EDITOR_MODE.DRAW_SCOPE,      icon: 'scope',      label: '範圍' },
    ],
  },
  {
    id: 'cable',
    items: [
      { mode: EDITOR_MODE.PLACE_SWITCH,    icon: 'switch',     label: '放置 Switch' },
      { mode: EDITOR_MODE.DRAW_CABLE_TRAY, icon: 'cableTray',  label: '繪製線槽' },
      { mode: EDITOR_MODE.PLACE_RISER,     icon: 'riser',      label: '放置 Riser' },
    ],
  },
  {
    id: 'measure',
    items: [
      { mode: EDITOR_MODE.DRAW_SCALE,      icon: 'scale',      label: '比例尺' },
    ],
  },
  // Edit + Aux are action buttons; rendered through the same render path
  // so groups stay visually uniform. `action` field distinguishes them.
  {
    id: 'edit',
    items: [
      { action: 'undo',   icon: 'undo',     label: '復原（Ctrl+Z）' },
      { action: 'redo',   icon: 'redo',     label: '重做（Ctrl+Shift+Z）' },
    ],
  },
  {
    id: 'aux',
    items: [
      { action: 'aiWalls', icon: 'aiWalls', label: 'AI 牆（從底圖辨識）' },
    ],
  },
]

function Toolbar() {
  const editorMode = useEditorStore((s) => s.editorMode)
  const setEditorMode = useEditorStore((s) => s.setEditorMode)
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

  const isAlignMode = editorMode === EDITOR_MODE.ALIGN_FLOOR

  const handleModeClick = (mode) => {
    if (isAlignMode && mode !== EDITOR_MODE.ALIGN_FLOOR) {
      setPendingMode(mode)
      return
    }
    setEditorMode(mode)
  }

  // Resolve action button state (enabled, onClick) from its action id.
  const resolveAction = (action) => {
    switch (action) {
      case 'undo':    return { enabled: undoLen > 0, onClick: undo }
      case 'redo':    return { enabled: redoLen > 0, onClick: redo }
      case 'aiWalls': return { enabled: aiEnabled,   onClick: () => setAiOpen(true) }
      default:        return { enabled: false, onClick: () => {} }
    }
  }

  return (
    <div className="toolbar-floating" role="toolbar" aria-label="編輯工具">
      {GROUPS.map((group, gi) => (
        <React.Fragment key={group.id}>
          {gi > 0 && <span className="toolbar-floating__separator" aria-hidden="true" />}
          <div className="toolbar-floating__group">
            {group.items.map((it) => {
              const isMode = !!it.mode
              const active = isMode && editorMode === it.mode
              const { enabled, onClick } = isMode
                ? { enabled: true, onClick: () => handleModeClick(it.mode) }
                : resolveAction(it.action)
              return (
                <Tooltip key={it.mode ?? it.action} label={it.label}>
                  <button
                    type="button"
                    className={
                      'toolbar-floating__btn' +
                      (active ? ' toolbar-floating__btn--active' : '')
                    }
                    onClick={onClick}
                    disabled={!enabled}
                    aria-label={it.label}
                    aria-pressed={active || undefined}
                  >
                    <Icon name={it.icon} size={18} />
                  </button>
                </Tooltip>
              )
            })}
          </div>
        </React.Fragment>
      ))}

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
