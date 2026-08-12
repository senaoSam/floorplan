import React, { useState } from 'react'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useHoverReadoutStore } from '@/store/useHoverReadoutStore'
import { HEATMAP_MODE_LIST, getModeConfig } from '@/features/heatmap/modes'
import FormulaNote from '@/components/FormulaNote/FormulaNote'
import Icon from '@/components/Icon/Icon'
import HeatmapLegend from './HeatmapLegend'
import './HeatmapControl.sass'

// Pick the hover value that corresponds to the active visualisation mode.
function hoverValueForMode(hover, mode) {
  if (!hover) return undefined
  switch (mode) {
    case 'sinr': return hover.sinrDb
    case 'snr':  return hover.snrDb
    case 'cci':  return hover.cciDbm
    case 'rssi':
    default:     return hover.rssiDbm
  }
}

function HeatmapControl() {
  const enabled      = useHeatmapStore((s) => s.enabled)
  const setEnabled   = useHeatmapStore((s) => s.setEnabled)
  const mode         = useHeatmapStore((s) => s.mode)
  const setMode      = useHeatmapStore((s) => s.setMode)
  const bandFilter   = useHeatmapStore((s) => s.bandFilter)
  const setBandFilter = useHeatmapStore((s) => s.setBandFilter)
  const reflections  = useHeatmapStore((s) => s.reflections)
  const setReflections = useHeatmapStore((s) => s.setReflections)
  const diffraction  = useHeatmapStore((s) => s.diffraction)
  const setDiffraction = useHeatmapStore((s) => s.setDiffraction)
  const gridStepM    = useHeatmapStore((s) => s.gridStepM)
  const setGridStepM = useHeatmapStore((s) => s.setGridStepM)
  const blur         = useHeatmapStore((s) => s.blur)
  const setBlur      = useHeatmapStore((s) => s.setBlur)
  const showContours = useHeatmapStore((s) => s.showContours)
  const setShowContours = useHeatmapStore((s) => s.setShowContours)
  const engine       = useHeatmapStore((s) => s.engine)
  const setEngine    = useHeatmapStore((s) => s.setEngine)
  const dragMode     = useHeatmapStore((s) => s.dragMode)
  const setDragMode  = useHeatmapStore((s) => s.setDragMode)
  // 任務 4: when the active scene's wall×AP exceeds the downgrade threshold,
  // heatmapAdapter forces reflections/diffraction off for the whole compute.
  const simplifiedLargeScene = useHeatmapStore((s) => s.simplifiedLargeScene)
  // Frozen while drawing walls — the field shown is from before the draw.
  const drawWallFrozen = useHeatmapStore((s) => s.drawWallFrozen)
  // Frozen while aligning floors — drag-align writes the floor store every
  // pointermove, which would otherwise recompute + ripple continuously.
  const alignFrozen = useHeatmapStore((s) => s.alignFrozen)
  // 47-22: enabled but the active floor has no scale → nothing can render.
  const scaleMissing = useHeatmapStore((s) => s.scaleMissing)
  const glUnavailable = useHeatmapStore((s) => s.glUnavailable)
  // Phase 48: other floors excluded from cross-floor computation (no scale).
  const crossFloorExcluded = useHeatmapStore((s) => s.crossFloorExcluded)
  const setEditorMode = useEditorStore((s) => s.setEditorMode)
  const hover        = useHoverReadoutStore((s) => s.reading)

  const [panelOpen, setPanelOpen] = useState(false)
  const [formulaOpen, setFormulaOpen] = useState(false)

  const hoverValue = hoverValueForMode(hover, mode)
  const activeCfg  = getModeConfig(mode)

  const formatReading = (v, unit) => isFinite(v) ? `${v.toFixed(1)} ${unit}` : '—'

  return (
    <div className="heatmap-control">
      {/* Drawing walls freezes the heatmap (each segment commits immediately,
          so recomputing per segment would stutter). Tell the user the field is
          a snapshot from before drawing and will refresh on exit. Top-level so
          it's visible even with the settings panel collapsed. */}
      {enabled && drawWallFrozen && (
        <div className="heatmap-control__notice">
          ❄️ 畫牆中：熱圖已暫停更新（畫完離開畫牆模式後自動重新計算）
        </div>
      )}
      {enabled && alignFrozen && (
        <div className="heatmap-control__notice">
          ❄️ 對齊樓層中：熱圖已暫停更新（完成對齊後自動重新計算）
        </div>
      )}
      {/* Phase 48: floors whose scale is uncalibrated can't be positioned in
          meters — they're excluded from the cross-floor field, not silently
          mis-placed. */}
      {enabled && crossFloorExcluded.length > 0 && (
        <div className="heatmap-control__notice">
          ⚠️ {crossFloorExcluded.join('、')} 尚未校正比例尺，未納入跨樓層計算
        </div>
      )}
      {/* 47-22: heatmap is on but there's no scale — it can't render. Tell the
          user why and offer a one-click jump into the scale-drawing mode, so
          the enabled toggle isn't paired with a mysteriously blank canvas. */}
      {enabled && scaleMissing && (
        <div className="heatmap-control__notice heatmap-control__notice--action">
          <span>⚠️ 尚未設定比例尺，熱圖無法計算</span>
          <button
            type="button"
            className="heatmap-control__notice-btn"
            onClick={() => setEditorMode(EDITOR_MODE.DRAW_SCALE)}
          >
            設定比例尺
          </button>
        </div>
      )}
      {/* 52-C3: WebGL2 unavailable — same reasoning as the scale notice above.
          Without this the toggle reads "on" while nothing ever draws. */}
      {enabled && glUnavailable && (
        <div className="heatmap-control__notice">
          ⚠️ 這個瀏覽器／裝置無法使用 WebGL2，熱圖無法繪製
        </div>
      )}
      {/* Readout — stacked above the button. Shows all four metrics so the
          user can compare without flipping modes. */}
      {enabled && hover && (
        <div className="heatmap-control__readout">
          <div className="heatmap-control__readout-row">
            <b>RSSI</b> <span>{formatReading(hover.rssiDbm, 'dBm')}</span>
          </div>
          <div className="heatmap-control__readout-row">
            <b>SINR</b> <span>{formatReading(hover.sinrDb, 'dB')}</span>
          </div>
          <div className="heatmap-control__readout-row">
            <b>SNR</b> <span>{formatReading(hover.snrDb, 'dB')}</span>
          </div>
          <div className="heatmap-control__readout-row">
            <b>CCI</b> <span>{formatReading(hover.cciDbm, 'dBm')}</span>
          </div>
          <div className="heatmap-control__readout-row heatmap-control__readout-pos">
            ({hover.at.x.toFixed(2)}, {hover.at.y.toFixed(2)}) m
          </div>
          {(() => {
            let best = -1
            let bestVal = -Infinity
            for (let i = 0; i < hover.perAp.length; i++) {
              const v = hover.perAp[i]
              if (isFinite(v) && v > bestVal) { bestVal = v; best = i }
            }
            if (best < 0) return null
            const ap = hover.apList[best]
            return (
              <div className="heatmap-control__readout-row">
                <b>{ap?.name ?? `AP-${best + 1}`}</b>
                <span>
                  {bestVal.toFixed(1)} dBm · ch {ap?.channel ?? '—'} · {ap?.channelWidth ? `${ap.channelWidth} MHz` : '—'}
                </span>
              </div>
            )
          })()}
        </div>
      )}

      {/* Color legend — only while heatmap is enabled; pointer follows hover
          value for the active mode. */}
      {enabled && (
        <HeatmapLegend mode={mode} hoverValue={hoverValue} />
      )}

      <div className="heatmap-control__row">
        {/* Toggle idiom (ui-spec §2.3-3): fixed label, state shown by the
            filled --active style — same pattern as the timeline chips. */}
        <button
          type="button"
          className={`heatmap-control__btn${enabled ? ' heatmap-control__btn--active' : ''}`}
          onClick={() => setEnabled(!enabled)}
          title={enabled ? '關閉熱圖' : '開啟熱圖'}
        >
          <span className="heatmap-control__dot" />
          <span>熱圖</span>
        </button>
        {enabled && (
          <>
            <select
              className="heatmap-control__mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              title={activeCfg.description}
            >
              {HEATMAP_MODE_LIST.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <select
              className="heatmap-control__mode"
              value={bandFilter}
              onChange={(e) => setBandFilter(e.target.value)}
              title="只顯示所選頻段的 AP 訊號場（避免遠處他頻段 AP 蓋掉覆蓋洞）"
            >
              <option value="all">全部頻段</option>
              <option value="2.4">2.4 GHz</option>
              <option value="5">5 GHz</option>
              <option value="6">6 GHz</option>
            </select>
            <button
              type="button"
              className="heatmap-control__more"
              onClick={() => setPanelOpen((v) => !v)}
              title="熱圖設定"
            >
              <Icon name={panelOpen ? 'chevronDown' : 'chevronRight'} size={11} /> 設定
            </button>
          </>
        )}
      </div>

      {enabled && panelOpen && (
        <div className="heatmap-control__panel">
          <label className="heatmap-control__line">
            <span>引擎</span>
            <select
              className="heatmap-control__select"
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
              title="精確：完整物理（含反射／繞射，較慢）。快速：GPU 加速，適合大場景即時預覽。"
            >
              <option value="js">精確（完整物理）</option>
              <option value="shader">快速（GPU 加速）</option>
            </select>
          </label>
          <label className="heatmap-control__line">
            <span>拖曳模式</span>
            <select
              className="heatmap-control__select"
              value={dragMode}
              onChange={(e) => setDragMode(e.target.value)}
              title="Live = 拖曳即時重算（降畫質）；Solo = 拖 AP 只重算被拖那一顆，拖牆/Scope 凍結（Hamina 風格）"
            >
              <option value="live">Live (即時重算)</option>
              <option value="solo">Solo (單 AP / 凍結)</option>
            </select>
          </label>
          <label className="heatmap-control__line">
            <input type="checkbox" checked={reflections} onChange={(e) => setReflections(e.target.checked)} />
            <span>反射 (1st-order, image source)</span>
          </label>
          <label className="heatmap-control__line">
            <input type="checkbox" checked={diffraction} onChange={(e) => setDiffraction(e.target.checked)} />
            <span>繞射 (UTD / knife edge)</span>
          </label>
          {/* 任務 4: large scenes auto-disable refl/diff for performance. The
              checkboxes above still reflect the user's preference, but the
              actual compute ignores them until the scene shrinks below the
              threshold — tell the user so the simplified field isn't a
              surprise. */}
          {simplifiedLargeScene && (
            <div className="heatmap-control__notice">
              ⚡ 大場景已簡化：暫時關閉反射 / 繞射以維持效能（縮小場景後自動恢復）
            </div>
          )}
          <label className="heatmap-control__line">
            <span>網格精度: {gridStepM.toFixed(2)} m</span>
            <input
              type="range" min="0.2" max="0.8" step="0.05"
              value={gridStepM}
              onChange={(e) => setGridStepM(parseFloat(e.target.value))}
            />
          </label>
          <label className="heatmap-control__line">
            <span>平滑 (blur): {blur} px</span>
            <input
              type="range" min="0" max="24" step="1"
              value={blur}
              onChange={(e) => setBlur(parseInt(e.target.value, 10))}
            />
          </label>
          <label className="heatmap-control__line">
            <input type="checkbox" checked={showContours} onChange={(e) => setShowContours(e.target.checked)} />
            <span>訊號等高線</span>
          </label>
          <button
            type="button"
            className="heatmap-control__formula-btn"
            onClick={() => setFormulaOpen((v) => !v)}
          >
            <Icon name={formulaOpen ? 'chevronDown' : 'chevronRight'} size={11} /> 公式說明
          </button>
          {formulaOpen && <FormulaNote />}
        </div>
      )}
    </div>
  )
}

export default HeatmapControl
