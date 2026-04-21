import React, { useState } from 'react'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import FormulaNote from '@/components/FormulaNote/FormulaNote'
import './HeatmapControl.sass'

function HeatmapControl() {
  const enabled      = useHeatmapStore((s) => s.enabled)
  const setEnabled   = useHeatmapStore((s) => s.setEnabled)
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
  const hover        = useHeatmapStore((s) => s.hoverReading)

  const [panelOpen, setPanelOpen] = useState(false)
  const [formulaOpen, setFormulaOpen] = useState(false)

  return (
    <div className="heatmap-control">
      {/* RSSI readout — stacked above the button */}
      {enabled && hover && (
        <div className="heatmap-control__readout">
          <div className="heatmap-control__readout-row">
            <b>RSSI</b> <span>{hover.rssiDbm.toFixed(1)} dBm</span>
          </div>
          <div className="heatmap-control__readout-row">
            <b>SINR</b> <span>{hover.sinrDb.toFixed(1)} dB</span>
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
          <button
            type="button"
            className="heatmap-control__more"
            onClick={() => setPanelOpen((v) => !v)}
            title="熱圖設定"
          >
            {panelOpen ? '▾' : '▸'} 設定
          </button>
        )}
      </div>

      {enabled && panelOpen && (
        <div className="heatmap-control__panel">
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
