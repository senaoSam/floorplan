import React from 'react'
import { getModeConfig, BAND_MAP_ALPHA, BAND_MAP_NONE_HATCH } from '@/features/heatmap/modes'
import { useBandMapStore } from '@/store/useBandMapStore'
import { useFloorStore } from '@/store/useFloorStore'
import Icon from '@/components/Icon/Icon'
import { BAND_MAP_RULE } from '@/features/heatmap/bandMap'
import { ROAM_HYSTERESIS_DB } from '@/store/useClientViewStore'

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

// 58-7: the band the field is drawn from (apsLayer FREQ_COLOR).
const BAND_COLOR = { 2.4: '#f39c12', 5: '#4fc3f7', 6: '#a855f7' }

// No-service swatch: the plan's grey diagonal hatch (BAND_MAP_NONE_HATCH).
const NONE_HATCH_BG = (() => {
  const { rgb, alpha } = BAND_MAP_NONE_HATCH
  const c = `rgba(${rgb.join(', ')}, ${alpha})`
  return `repeating-linear-gradient(135deg, ${c} 0 1.5px, transparent 1.5px 4px)`
})()

// 58-12: band map key -- one swatch per band (the paint's colour, faded shade
// alongside) with its share of the plan, and no service. `hoverBand` is the
// band under the pointer (null = no service, undefined = no hover).
const fmtShare = (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`)

// `bandCounts` (HeatmapControl): building-wide devices per band, allowed
// (`building`) and enabled at all (`enabled`) -- a band with none says why
// instead of a 0% that reads like a coverage result.
function BandMapLegend({ cfg, hoverBand, bandCounts, multipath }) {
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const raw = useBandMapStore((s) => s.shares)
  const shares = raw && raw.floorId === activeFloorId ? raw : null
  const absent = (b) => {
    if (!bandCounts || bandCounts.building[b] > 0) return null
    return bandCounts.enabled[b] > 0 ? '此國家不可用' : '無射頻'
  }
  const rows = [
    ...[2.4, 5, 6].map((b) => ({ key: String(b), label: `${b} GHz`, color: BAND_COLOR[b], share: shares?.[b], absent: absent(b) })),
    { key: 'none', label: '無服務', color: null, share: shares?.none, absent: null },
  ]
  const hoverKey = hoverBand === undefined ? undefined : (hoverBand == null ? 'none' : String(hoverBand))
  // The notes live in the info icon's tooltip: as text lines they made the
  // legend ~180 px tall, which pushed the hover readout above it over the plan
  // (it covered and blocked AP-01 on the demo).
  const notes = [
    `左深右淡：深色訊號 ≥ ${BAND_MAP_RULE.goodDbm} dBm，淡色連得上但未達。灰色斜線：無服務（各頻段都低於 ${BAND_MAP_RULE.usableDbm} dBm）。百分比為平面圖（範圍內）面積。`,
    `新連線手機的選頻，規則同 Client View；已連在 5 / 6 GHz 的手機會撐到 ${BAND_MAP_RULE.availableDbm - ROAM_HYSTERESIS_DB} dBm 才改連 2.4 GHz。`,
    ...(multipath ? ['訊號含反射 / 繞射；Client View 只算直射，頻段交界可能差幾 dB。'] : []),
  ]
  return (
    <div className="heatmap-legend">
      <div className="heatmap-legend__title">
        {cfg.label} {cfg.plain} · 所有頻段
        <span className="heatmap-legend__info" title={notes.join(' ')}>
          <Icon name="info" size={11} inline style={{ marginLeft: 4 }} />
        </span>
      </div>
      <div className="heatmap-legend__bandmap">
        {rows.map((r) => (
          <div key={r.key} className={`heatmap-legend__bandmap-row${hoverKey === r.key ? ' heatmap-legend__bandmap-row--on' : ''}${r.absent ? ' heatmap-legend__bandmap-row--wide' : ''}`}>
            <span className="heatmap-legend__bandmap-swatch">
              {r.color ? (
                <>
                  <span style={{ background: r.color, opacity: BAND_MAP_ALPHA[0] }} />
                  <span style={{ background: r.color, opacity: BAND_MAP_ALPHA[1] }} />
                </>
              ) : <span className="heatmap-legend__bandmap-none" style={{ background: NONE_HATCH_BG }} />}
            </span>
            <span className="heatmap-legend__bandmap-label">{r.label}</span>
            <span className="heatmap-legend__bandmap-share">{r.absent ?? fmtShare(r.share)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HeatmapLegend({ mode, hoverValue, bandFilter, hoverBand, bandCounts, multipath }) {
  const cfg = getModeConfig(mode)
  if (cfg.bandMap) return <BandMapLegend cfg={cfg} hoverBand={hoverBand} bandCounts={bandCounts} multipath={multipath} />
  const { stops, minVal, maxVal, leftToRightAsc } = buildLegendData(cfg)
  const pct = valueToPercent(hoverValue, minVal, maxVal, leftToRightAsc)
  const hasPointer = pct !== null
  const gradient = `linear-gradient(to right, ${stops.map((s) => `${s.color} ${s.pct.toFixed(1)}%`).join(', ')})`

  // End-stop tick labels get ≤ / ≥ prefixes to signal clamping.
  const n = stops.length

  return (
    <div className="heatmap-legend">
      <div className="heatmap-legend__title">
        {cfg.label} {cfg.plain}<span className="heatmap-legend__unit">（{cfg.unit}）</span>
        {' · '}
        {bandFilter === 'all' ? '最強頻段' : (
          <>
            <span className="heatmap-legend__band-dot" style={{ background: BAND_COLOR[bandFilter] }} />
            {bandFilter} GHz
          </>
        )}
      </div>
      {bandFilter === 'all' && (
        <div className="heatmap-legend__note">每點取最強射頻（多為 2.4 GHz），手機實際多連 5/6 GHz</div>
      )}

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
