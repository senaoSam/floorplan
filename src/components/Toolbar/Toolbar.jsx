import React from 'react'
import { useEditorStore, EDITOR_MODE, VIEW_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import './Toolbar.sass'

const TOOLS = [
  { mode: EDITOR_MODE.SELECT,     label: '選取',   icon: '↖' },
  { mode: EDITOR_MODE.PAN,        label: '平移',   icon: '✋' },
  { mode: EDITOR_MODE.DRAW_SCALE, label: '比例尺', icon: '📏' },
  { mode: EDITOR_MODE.DRAW_WALL,  label: '畫牆',   icon: '▬' },
  { mode: EDITOR_MODE.PLACE_AP,   label: '放置 AP',icon: '📡' },
  { mode: EDITOR_MODE.DRAW_SCOPE,      label: '範圍',      icon: '⬡' },
  { mode: EDITOR_MODE.DRAW_FLOOR_HOLE, label: 'Floor Hole', icon: '⬛' },
]

function Toolbar() {
  const { editorMode, viewMode, showHeatmap, setEditorMode, setViewMode, toggleHeatmap } = useEditorStore()
  const floorScale = useFloorStore((s) => s.scale)
  const hasScale = !!floorScale

  return (
    <header className="toolbar">
      <div className="toolbar__brand">Floorplan</div>

      <div className="toolbar__tools">
        {TOOLS.map((t) => (
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

      <div className="toolbar__actions">
        <button
          className={`toolbar__heatmap-btn${showHeatmap ? ' toolbar__heatmap-btn--active' : ''}`}
          onClick={toggleHeatmap}
          title={hasScale ? '熱圖' : '請先設定比例尺才能顯示熱圖'}
          disabled={!hasScale}
        >
          熱圖
        </button>

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
    </header>
  )
}

export default Toolbar
