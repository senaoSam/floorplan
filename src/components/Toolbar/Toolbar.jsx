import React from 'react'
import { useEditorStore, EDITOR_MODE, VIEW_MODE, HEATMAP_MODE, ENVIRONMENT_PRESETS } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import './Toolbar.sass'

const TOOLS = [
  { mode: EDITOR_MODE.SELECT,         label: '選取',     icon: '\u2196' },
  { mode: EDITOR_MODE.MARQUEE_SELECT, label: '框選',     icon: '\u25A2' },
  { mode: EDITOR_MODE.PAN,            label: '平移',     icon: '\u270B' },
  { mode: EDITOR_MODE.DRAW_SCALE,     label: '比例尺',   icon: '\uD83D\uDCCF' },
  { mode: EDITOR_MODE.DRAW_WALL,      label: '畫牆',     icon: '\u25AC' },
  { mode: EDITOR_MODE.DOOR_WINDOW,    label: '門窗',     icon: '\uD83D\uDEAA' },
  { mode: EDITOR_MODE.PLACE_AP,       label: '放置 AP',  icon: '\uD83D\uDCE1' },
  { mode: EDITOR_MODE.DRAW_SCOPE,     label: '熱圖範圍', icon: '\u2B21' },
  { mode: EDITOR_MODE.DRAW_FLOOR_HOLE,label: '中庭',     icon: '\u2B1B' },
  { mode: EDITOR_MODE.CROP_IMAGE,     label: '裁切',     icon: '\u2702' },
]

const HEATMAP_OPTIONS = [
  { mode: HEATMAP_MODE.RSSI,            label: 'RSSI 訊號強度' },
  { mode: HEATMAP_MODE.SINR,            label: 'SINR 訊號干擾比' },
  { mode: HEATMAP_MODE.SNR,             label: 'SNR 訊號噪聲比' },
  { mode: HEATMAP_MODE.CHANNEL_OVERLAP, label: '頻道重疊' },
  { mode: HEATMAP_MODE.DATA_RATE,       label: '預估速率' },
  { mode: HEATMAP_MODE.AP_COUNT,        label: '可用 AP 數' },
]

const ENV_OPTIONS = Object.entries(ENVIRONMENT_PRESETS).map(([key, val]) => ({
  key,
  label: val.label,
  n: val.n,
}))

function Toolbar() {
  const { editorMode, viewMode, showHeatmap, heatmapMode, pathLossExponent,
          setEditorMode, setViewMode, toggleHeatmap, setHeatmapMode, setPathLossExponent } = useEditorStore()
  const floorScale = useFloorStore((s) => s.scale)
  const hasScale = !!floorScale
  const undoLen = useHistoryStore((s) => s.undoStack.length)
  const redoLen = useHistoryStore((s) => s.redoStack.length)
  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)

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

      <div className="toolbar__history">
        <button
          className="toolbar__btn"
          onClick={undo}
          disabled={undoLen === 0}
          title="復原 (Ctrl+Z)"
        >
          <span className="toolbar__btn-icon">↩</span>
          <span className="toolbar__btn-label">復原</span>
        </button>
        <button
          className="toolbar__btn"
          onClick={redo}
          disabled={redoLen === 0}
          title="重做 (Ctrl+Shift+Z)"
        >
          <span className="toolbar__btn-icon">↪</span>
          <span className="toolbar__btn-label">重做</span>
        </button>
      </div>

      <div className="toolbar__actions">
        {/* 熱圖開關 */}
        <button
          className={`toolbar__heatmap-btn${showHeatmap ? ' toolbar__heatmap-btn--active' : ''}`}
          onClick={toggleHeatmap}
          title={hasScale ? '熱圖' : '請先設定比例尺才能顯示熱圖'}
          disabled={!hasScale}
        >
          {hasScale ? '熱圖' : '🔒 熱圖'}
        </button>

        {/* 熱圖模式 + 環境（開啟時才顯示，用下拉收納） */}
        {showHeatmap && (
          <>
            <select
              className="toolbar__select"
              value={heatmapMode}
              onChange={(e) => setHeatmapMode(e.target.value)}
              title="熱圖模式"
            >
              {HEATMAP_OPTIONS.map((opt) => (
                <option key={opt.mode} value={opt.mode}>{opt.label}</option>
              ))}
            </select>

            <select
              className="toolbar__select"
              value={ENV_OPTIONS.find((e) => Math.abs(e.n - pathLossExponent) < 0.05)?.key || 'OFFICE'}
              onChange={(e) => {
                const preset = ENVIRONMENT_PRESETS[e.target.value]
                if (preset) setPathLossExponent(preset.n)
              }}
              title="環境類型（路徑損耗指數）"
            >
              {ENV_OPTIONS.map((e) => (
                <option key={e.key} value={e.key}>{e.label} (n={e.n})</option>
              ))}
            </select>
          </>
        )}

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
