import React, { useState } from 'react'
import { useEditorStore, EDITOR_MODE, VIEW_MODE } from '@/store/useEditorStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useFloorStore } from '@/store/useFloorStore'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
import AIWallsModal from '@/components/AIWallsModal/AIWallsModal'
import './Toolbar.sass'

const TOOL_GROUPS = [
  [
    { mode: EDITOR_MODE.SELECT,         label: '選取',     icon: '\u2196' },
    { mode: EDITOR_MODE.MARQUEE_SELECT, label: '框選',     icon: '\u25A2' },
    { mode: EDITOR_MODE.PAN,            label: '平移',     icon: '\u270B' },
  ],
  [
    { mode: EDITOR_MODE.CROP_IMAGE,     label: '裁切',     icon: '\u2702' },
    { mode: EDITOR_MODE.DRAW_SCALE,     label: '比例尺',   icon: '\uD83D\uDCCF' },
  ],
  [
    { mode: EDITOR_MODE.DRAW_WALL,      label: '畫牆',     icon: '\u25AC' },
    { mode: EDITOR_MODE.DOOR_WINDOW,    label: '門窗',     icon: '\uD83D\uDEAA' },
    { mode: EDITOR_MODE.DRAW_FLOOR_HOLE,label: '中庭',     icon: '\u2B1B' },
  ],
  [
    { mode: EDITOR_MODE.PLACE_AP,       label: 'AP',       icon: '\uD83D\uDCE1' },
    { mode: EDITOR_MODE.DRAW_SCOPE,     label: '範圍',     icon: '\u2B21' },
  ],
]

function Toolbar() {
  const { editorMode, viewMode, setEditorMode, setViewMode } = useEditorStore()
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

  const handleToolClick = (mode) => {
    if (isAlignMode && mode !== EDITOR_MODE.ALIGN_FLOOR) {
      setPendingMode(mode)
      return
    }
    setEditorMode(mode)
  }

  return (
    <header className="toolbar">
      <div className="toolbar__brand">Floorplan</div>

      <div className="toolbar__tools">
        {TOOL_GROUPS.map((group, gi) => (
          <div key={gi} className="toolbar__group">
            {group.map((t) => (
              <button
                key={t.mode}
                className={`toolbar__btn${editorMode === t.mode ? ' toolbar__btn--active' : ''}`}
                onClick={() => handleToolClick(t.mode)}
                title={t.label}
              >
                <span className="toolbar__btn-icon">{t.icon}</span>
                <span className="toolbar__btn-label">{t.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="toolbar__actions">
        <button
          className="toolbar__btn"
          onClick={() => setAiOpen(true)}
          disabled={!aiEnabled}
          title={aiEnabled ? 'AI 偵測牆壁（從底圖自動辨識）' : '此樓層需先匯入底圖'}
        >
          <span className="toolbar__btn-icon">🤖</span>
          <span className="toolbar__btn-label">AI 牆</span>
        </button>
        <div className="toolbar__history">
          <button
            className="toolbar__btn toolbar__btn--history"
            onClick={undo}
            disabled={undoLen === 0}
            title="復原 (Ctrl+Z)"
          >
            <span className="toolbar__btn-icon">↩</span>
            <span className="toolbar__btn-label">復原</span>
          </button>
          <button
            className="toolbar__btn toolbar__btn--history"
            onClick={redo}
            disabled={redoLen === 0}
            title="重做 (Ctrl+Shift+Z)"
          >
            <span className="toolbar__btn-icon">↪</span>
            <span className="toolbar__btn-label">重做</span>
          </button>
        </div>

        <button
          className={`toolbar__view-btn${viewMode === VIEW_MODE.TWO_D ? ' toolbar__view-btn--active' : ''}`}
          onClick={() => setViewMode(VIEW_MODE.TWO_D)}
        >
          2D
        </button>
        <button
          className={`toolbar__view-btn${viewMode === VIEW_MODE.THREE_D ? ' toolbar__view-btn--active' : ''}`}
          onClick={() => setViewMode(VIEW_MODE.THREE_D)}
        >
          3D
        </button>
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
    </header>
  )
}

export default Toolbar
