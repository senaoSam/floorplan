import React from 'react'
import { useHeatmapStore, HEATMAP_MODES } from '@/store/useHeatmapStore'
import { HEATMAP_MODE_CONFIG } from '@/features/heatmap/modes'
import './HeatmapControl.sass'

// MVP control surface: enabled toggle + mode dropdown. engine / gridStepM /
// blur / reflections / diffraction sliders will come back when the layer
// stress-tests warrant exposing them.
function HeatmapControl() {
  const enabled = useHeatmapStore((s) => s.enabled)
  const mode = useHeatmapStore((s) => s.mode)
  const setEnabled = useHeatmapStore((s) => s.setEnabled)
  const setMode = useHeatmapStore((s) => s.setMode)

  return (
    <div className="heatmap-control">
      <div className="heatmap-control__row">
        <label className="heatmap-control__check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>熱力圖</span>
        </label>
      </div>
      <div className="heatmap-control__row">
        <span className="heatmap-control__label">模式</span>
        <select
          className="heatmap-control__select"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          disabled={!enabled}
        >
          {HEATMAP_MODES.map((m) => (
            <option key={m} value={m}>
              {HEATMAP_MODE_CONFIG[m]?.label ?? m}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export default HeatmapControl
