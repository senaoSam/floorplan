import React from 'react'
import { getModeConfig } from '@/features/heatmap/modes'

// Build a CSS linear-gradient from a mode's anchors. Anchors are stored
// high-value-first (same order WebGL consumes); for the legend we reverse to
// left-to-right = low-to-high when signBetter === 'high', or flip for 'low'
// modes (CCI) so the "good" side stays on the left.
function buildLegendData(cfg) {
  // Sort ascending by value for consistent placement math.
  const ascending = [...cfg.anchors].sort((a, b) => a[0] - b[0])
  const minVal = ascending[0][0]
  const maxVal = ascending[ascending.length - 1][0]

  // CCI: lower is better — reverse so the left end is "good" (quiet) like the
  // other modes. We do this by mapping highest value to the left.
  const leftToRightAsc = cfg.signBetter === 'low' ? false : true
  const ordered = leftToRightAsc ? ascending : [...ascending].reverse()

  const stops = ordered.map((a, i) => {
    const pct = (i / (ordered.length - 1)) * 100
    return {
      pct,
      value: a[0],
      color: `rgb(${a[1]}, ${a[2]}, ${a[3]})`,
    }
  })

  return { stops, minVal, maxVal, leftToRightAsc }
}

// Map hover value to [0, 100] along the legend. Clamped to the anchor range.
function valueToPercent(value, minVal, maxVal, leftToRightAsc) {
  if (!isFinite(value)) return null
  const clamped = Math.max(minVal, Math.min(maxVal, value))
  const ratio = (clamped - minVal) / (maxVal - minVal || 1)
  return (leftToRightAsc ? ratio : 1 - ratio) * 100
}

// 52-D3: the scale showed only "≤-75 … ≥-35", leaving the reader to guess
// whether -73 dBm is usable. These are the conventional Wi-Fi planning bands
// (-67 dBm is the industry coverage target this app already uses as its
// default threshold, see constants/coverage). Only RSSI gets this: SINR/SNR/
// CCI have no comparably settled plain-language mapping, and inventing one
// would be worse than saying nothing.
const RSSI_BANDS = [
  { max: -75, label: '幾乎沒訊號' },
  { max: -67, label: '訊號差' },
  { max: -55, label: '堪用（收信 / 網頁）' },
  { max: Infinity, label: '很好（可視訊）' },
]

function rssiQualityLabel(v) {
  if (!isFinite(v)) return null
  return RSSI_BANDS.find((b) => v <= b.max)?.label ?? null
}

function HeatmapLegend({ mode, hoverValue }) {
  const cfg = getModeConfig(mode)
  const { stops, minVal, maxVal, leftToRightAsc } = buildLegendData(cfg)
  const pct = valueToPercent(hoverValue, minVal, maxVal, leftToRightAsc)
  const hasPointer = pct !== null
  const gradient = `linear-gradient(to right, ${stops.map((s) => `${s.color} ${s.pct.toFixed(1)}%`).join(', ')})`

  // End-stop tick labels get ≤ / ≥ prefixes to signal clamping.
  const n = stops.length

  return (
    <div className="heatmap-legend">
      <div className="heatmap-legend__title">
        {cfg.label} <span className="heatmap-legend__unit">({cfg.unit})</span>
      </div>

      <div className="heatmap-legend__bar" style={{ background: gradient }}>
        {hasPointer && (
          <div
            className="heatmap-legend__pointer"
            style={{ left: `${pct}%` }}
          >
            <span className="heatmap-legend__pointer-value">
              {hoverValue.toFixed(0)}
            </span>
            <span className="heatmap-legend__pointer-arrow" />
          </div>
        )}
      </div>

      <div className="heatmap-legend__ticks">
        {stops.map((s, i) => {
          // Leftmost / rightmost tick: mark clamping direction. For signBetter
          // 'low' the ordering is reversed so we need to flip the prefix too.
          const isFirst = i === 0
          const isLast  = i === n - 1
          let prefix = ''
          if (leftToRightAsc) {
            if (isFirst) prefix = '≤'
            if (isLast)  prefix = '≥'
          } else {
            if (isFirst) prefix = '≥'
            if (isLast)  prefix = '≤'
          }
          return (
            <span key={s.value} className="heatmap-legend__tick">{prefix}{s.value}</span>
          )
        })}
      </div>

      {/* 52-D3: plain-language bands so the numbers mean something without
          RF background. Shows the hovered reading's verdict when there is one,
          otherwise the scale's own key. */}
      {cfg.id === 'rssi' && (
        <div className="heatmap-legend__quality">
          {isFinite(hoverValue) ? (
            <span className="heatmap-legend__quality-now">
              {hoverValue.toFixed(0)} dBm — {rssiQualityLabel(hoverValue)}
            </span>
          ) : (
            <>
              <span>差</span>
              <span className="heatmap-legend__quality-mid">-67 起堪用</span>
              <span>可視訊</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default HeatmapLegend
