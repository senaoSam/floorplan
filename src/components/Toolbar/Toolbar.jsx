import React, { useState } from 'react'
import { useEditorStore, EDITOR_MODE, VIEW_MODE } from '@/store/useEditorStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
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
  const [pendingMode, setPendingMode] = useState(null)

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

      <a
        className="toolbar__sample-link"
        href="#/heatmap-sample"
        title="切到 heatmap_sample 獨立頁面對照"
      >
        → Heatmap Sample
      </a>

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
          className="toolbar__view-btn toolbar__view-btn--disabled"
          disabled
          title="3D 檢視功能開發中，敬請期待"
        >
          3D
        </button>
      </div>

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
