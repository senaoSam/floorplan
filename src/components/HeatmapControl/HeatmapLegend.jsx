import React from 'react'

// 5 dBm anchors that match heatmap_sample/render/colormap.js ANCHORS.
// Ordered left (weakest) → right (strongest) for the legend bar.
const ANCHORS = [
  { dbm: -75, rgb: [ 26, 191, 204], label: 'Edge' },
  { dbm: -65, rgb: [102, 217,  64], label: 'Low' },
  { dbm: -55, rgb: [255, 217,  26], label: 'Decent' },
  { dbm: -45, rgb: [255, 128,  13], label: 'High' },
  { dbm: -35, rgb: [235,  26,  26], label: 'Max' },
]

const LEGEND_MIN = ANCHORS[0].dbm     // -75
const LEGEND_MAX = ANCHORS[ANCHORS.length - 1].dbm   // -35

// Continuous gradient between anchors. Each anchor sits at its own percentage
// along the bar, calculated from its dBm on the [LEGEND_MIN, LEGEND_MAX] axis.
function buildGradient() {
  const stops = ANCHORS.map((a) => {
    const pct = ((a.dbm - LEGEND_MIN) / (LEGEND_MAX - LEGEND_MIN)) * 100
    return `rgb(${a.rgb[0]}, ${a.rgb[1]}, ${a.rgb[2]}) ${pct.toFixed(1)}%`
  })
  return `linear-gradient(to right, ${stops.join(', ')})`
}

const GRADIENT = buildGradient()

// Map an arbitrary dBm to [0, 100] along the legend. Values outside the anchor
// range are clamped so the pointer stays on the bar.
function dbmToPercent(dbm) {
  if (!isFinite(dbm)) return null
  const clamped = Math.max(LEGEND_MIN, Math.min(LEGEND_MAX, dbm))
  return ((clamped - LEGEND_MIN) / (LEGEND_MAX - LEGEND_MIN)) * 100
}

function HeatmapLegend({ hoverDbm }) {
  const pct = dbmToPercent(hoverDbm)
  const hasPointer = pct !== null

  return (
    <div className="heatmap-legend">
      <div className="heatmap-legend__labels">
        {ANCHORS.map((a) => (
          <span key={a.dbm} className="heatmap-legend__label">{a.label}</span>
        ))}
      </div>

      <div className="heatmap-legend__bar" style={{ background: GRADIENT }}>
        {hasPointer && (
          <div
            className="heatmap-legend__pointer"
            style={{ left: `${pct}%` }}
          >
            <span className="heatmap-legend__pointer-value">
              {hoverDbm.toFixed(0)}
            </span>
            <span className="heatmap-legend__pointer-arrow" />
          </div>
        )}
      </div>

      <div className="heatmap-legend__ticks">
        {ANCHORS.map((a, i) => {
          const prefix = i === 0 ? '≤' : i === ANCHORS.length - 1 ? '≥' : ''
          return (
            <span key={a.dbm} className="heatmap-legend__tick">{prefix}{a.dbm}</span>
          )
        })}
      </div>
    </div>
  )
}

export default HeatmapLegend
