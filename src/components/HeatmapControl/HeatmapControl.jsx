import React, { useState } from 'react'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useHoverReadoutStore } from '@/store/useHoverReadoutStore'
import { HEATMAP_MODE_LIST, getModeConfig } from '@/features/heatmap/modes'
import FormulaNote from '@/components/FormulaNote/FormulaNote'
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
  const hover        = useHoverReadoutStore((s) => s.reading)

  const [panelOpen, setPanelOpen] = useState(false)
  const [formulaOpen, setFormulaOpen] = useState(false)

  const hoverValue = hoverValueForMode(hover, mode)
  const activeCfg  = getModeConfig(mode)

  const formatReading = (v, unit) => isFinite(v) ? `${v.toFixed(1)} ${unit}` : '—'

  return (
    <div className="heatmap-control">
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
          {hover.perAp.map((v, i) => (
            <div key={i} className="heatmap-control__readout-row">
              <b>{hover.apList[i]?.name ?? `AP-${i + 1}`}</b> <span>{v.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Color legend — only while heatmap is enabled; pointer follows hover
          value for the active mode. */}
      {enabled && (
        <HeatmapLegend mode={mode} hoverValue={hoverValue} />
      )}

      <div className="heatmap-control__row">
        <button
          type="button"
          className={`heatmap-control__btn${enabled ? ' heatmap-control__btn--active' : ''}`}
          onClick={() => setEnabled(!enabled)}
          title="開啟/關閉熱圖"
        >
          <span className="heatmap-control__dot" />
          <span>熱圖 {enabled ? '已開啟' : '已關閉'}</span>
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
            <button
              type="button"
              className="heatmap-control__more"
              onClick={() => setPanelOpen((v) => !v)}
              title="熱圖設定"
            >
              {panelOpen ? '▾' : '▸'} 設定
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
              title="JS = 完整物理 (full parity); Shader = WebGL2 加速 (HM-F5a, 暫無反射/繞射/多頻點)"
            >
              <option value="js">JS (full parity)</option>
              <option value="shader">Shader (F5a, fast)</option>
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
            {formulaOpen ? '▾' : '▸'} 公式說明
          </button>
          {formulaOpen && <FormulaNote />}
        </div>
      )}
    </div>
  )
}

export default HeatmapControl
