import React from 'react'
import { useEditorStore, EDITOR_MODE, VIEW_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { greedyChannelAssign } from '@/utils/autoChannelPlan'
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
    { mode: EDITOR_MODE.DRAW_SCOPE,     label: '熱圖範圍', icon: '\u2B21' },
  ],
]

function Toolbar() {
  const { editorMode, viewMode, regulatoryDomain, setEditorMode, setViewMode } = useEditorStore()
  const undoLen = useHistoryStore((s) => s.undoStack.length)
  const redoLen = useHistoryStore((s) => s.redoStack.length)
  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const apsByFloor = useAPStore((s) => s.apsByFloor)
  const setAPs = useAPStore((s) => s.setAPs)

  function handleAutoChannel() {
    const aps = apsByFloor[activeFloorId] ?? []
    if (aps.length === 0) return
    const assignments = greedyChannelAssign(aps, regulatoryDomain)
    const updated = aps.map((ap) => {
      const a = assignments.get(ap.id)
      return a ? { ...ap, channel: a.channel } : ap
    })
    setAPs(activeFloorId, updated)
  }

  const apsOnFloor = (apsByFloor[activeFloorId] ?? []).length

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
                onClick={() => setEditorMode(t.mode)}
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
          className="toolbar__auto-ch-btn"
          onClick={handleAutoChannel}
          disabled={apsOnFloor === 0}
          title="自動頻道規劃：對本樓層所有 AP 執行 greedy 最小干擾頻道指派"
        >
          ⚡ 自動頻道
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
          className="toolbar__view-btn toolbar__view-btn--disabled"
          disabled
          title="3D 檢視功能開發中，敬請期待"
        >
          3D
        </button>
      </div>
    </header>
  )
}

export default Toolbar
