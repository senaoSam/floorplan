import React, { useMemo, useRef, useState, useCallback } from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useTrackingStore } from '@/store/useTrackingStore'
import { useCameraStore } from '@/store/useCameraStore'
import { computeFloorTrend, computeDayRollup } from '@/features/cameras/analyticsStats'
import {
  DAY_START_SEC, DAY_END_SEC, generateWeekTracks, formatClock,
} from '@/features/cameras/mockTracks'
import { showUiToast } from '@/store/useUiToastStore'
import './TrendPanel.sass'

// Floor-wide occupancy trend panel (Verkada "Occupancy Trends" parity).
// Two views, switchable:
//   • hourly (default) — distinct presence per hour across day 0, with the
//     busiest-hour callout, day totals, and the live clock's current hour
//     highlighted; click a bar to seek the playback clock to that hour.
//   • daily  — distinct presence per day across a simulated WEEK
//     (generateWeekTracks). Real per-day aggregation via computeDayRollup
//     (day-level Sets, never summed hourly counts).
// A metric toggle re-keys both views to head-count / person-seconds / cars.
// Counts are RAW (the mock keeps a baseline crowd present, so quiet hours are
// never zero) — this is a head-count trend, not an occupancy percentage.
//
// The panel is a DRAGGABLE floating window — it first appears at the
// bottom-left of the canvas (out of the way of the cameras) and can be moved
// anywhere by its title bar.

const WEEKDAY_LABELS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日']

// 53-G9: stable placeholders for the gated memos below. EMPTY_TREND is derived
// by running the real function over zero tracks rather than hand-written, so it
// can't drift from computeFloorTrend's shape. Both are frozen module constants
// — a fresh literal each render would defeat the memo it's standing in for.
const EMPTY_ARRAY = Object.freeze([])
const EMPTY_TREND = Object.freeze(computeFloorTrend([], DAY_START_SEC, DAY_END_SEC))

const METRICS = [
  { value: 'people',     label: '人數',   field: 'people' },
  { value: 'presentSec', label: '人·秒',  field: 'presentSec' },
  { value: 'cars',       label: '車數',   field: 'cars' },
]

// person-seconds → compact "1.2 萬秒" feel; keep raw seconds in the title.
function formatPersonSec(sec) {
  if (sec >= 3600) return `${(sec / 3600).toFixed(1)} 人時`
  if (sec >= 60) return `${Math.round(sec / 60)} 人分`
  return `${Math.round(sec)} 人秒`
}

function metricValueLabel(metric, v) {
  return metric === 'presentSec' ? formatPersonSec(v) : String(v)
}

function dayLabel(day) {
  return WEEKDAY_LABELS[day % 7] ?? `第 ${day + 1} 天`
}

function TrendPanel() {
  const inCameraMode = useEditorStore((s) => s.editorMode === EDITOR_MODE.CAMERA)
  const show = useCameraStore((s) => s.showTrendPanel)
  const toggle = useCameraStore((s) => s.toggleShowTrendPanel)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const tracks = useTrackingStore((s) => s.tracksByFloor[activeFloorId] ?? EMPTY_ARRAY)
  const seed = useTrackingStore((s) => s.seedByFloor[activeFloorId])
  const clockSec = useTrackingStore((s) => s.clockSec)
  const setClockSec = useTrackingStore((s) => s.setClockSec)

  const [view, setView] = useState('hourly')     // 'hourly' | 'daily'
  const [metric, setMetric] = useState('people')  // 'people' | 'presentSec' | 'cars'

  // null pos → not yet dragged, use the CSS default (bottom-left). After the
  // first drag we switch to explicit top/left coordinates.
  const [pos, setPos] = useState(null)
  const dragRef = useRef(null)

  const onDragStart = useCallback((e) => {
    e.preventDefault()
    const panel = e.currentTarget.closest('.trend-panel')
    const rect = panel.getBoundingClientRect()
    const parent = panel.parentElement.getBoundingClientRect()
    const offX = e.clientX - rect.left
    const offY = e.clientY - rect.top
    // Clamp inside the overlay container so the panel can't be dragged off
    // the canvas (ui-spec §2.1-4).
    const maxLeft = Math.max(0, parent.width - rect.width)
    const maxTop = Math.max(0, parent.height - rect.height)
    const onMove = (ev) => {
      setPos({
        left: Math.min(maxLeft, Math.max(0, ev.clientX - parent.left - offX)),
        top: Math.min(maxTop, Math.max(0, ev.clientY - parent.top - offY)),
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  // 53-G9: `visible` gates BOTH memos below. Hooks can't move after the early
  // return (that would change hook order), so the guard has to live in the
  // deps + body instead — same reason WallLayer3D uses a `degenerate` flag.
  const visible = inCameraMode && !!activeFloorId && show

  const trend = useMemo(
    () => (visible ? computeFloorTrend(tracks, DAY_START_SEC, DAY_END_SEC) : EMPTY_TREND),
    [visible, tracks],
  )

  // §K: the daily rollup needs a full simulated week, which is expensive to
  // generate — memoize on [activeFloorId, tracks, seed] so it rebuilds only
  // when the crowd is regenerated / the floor switches, NEVER on a clockSec
  // tick. (tracks is day 0; it shares its seed with day 0 of the week, so the
  // two stay consistent.)
  //
  // 53-G9: this used to run above the `!show` early return with `show`/`view`
  // missing from deps, so a full week of crowd simulation was generated even
  // with the panel CLOSED — measured as a single 1121 ms main-thread freeze on
  // every crowd regeneration (45 walls). It's only ever read by the 'daily'
  // view, so gate on that too: opening the panel on 'hourly' costs nothing.
  const daily = useMemo(() => {
    if (!visible || view !== 'daily') return EMPTY_ARRAY
    const floor = useFloorStore.getState().floors.find((f) => f.id === activeFloorId)
    if (!floor || !floor.imageWidth) return EMPTY_ARRAY
    const walls = useWallStore.getState().wallsByFloor[activeFloorId] ?? []
    const week = generateWeekTracks(floor, walls, { seed: seed ?? undefined })
    return computeDayRollup(week)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, view, activeFloorId, tracks, seed])

  if (!inCameraMode || !activeFloorId || !show) return null

  const field = METRICS.find((m) => m.value === metric)?.field ?? 'people'
  const curHour = Math.floor(clockSec / 3600)

  // Bars for the active view, normalised so the tallest fills the chart.
  const bars = view === 'hourly'
    ? trend.hourly.map((h) => ({
        key: h.hour,
        value: h[field],
        label: String(h.hour).padStart(2, '0'),
        isPeak: h.hour === trend.peakHour,
        isNow: h.hour === curHour,
        title: `${formatClock(h.hour * 3600)}：${metricValueLabel(metric, h[field])}（點擊跳到此時段）`,
        onClick: () => setClockSec(Math.max(DAY_START_SEC, h.hour * 3600)),
      }))
    : daily.map((d) => ({
        key: d.day,
        value: d[field],
        label: dayLabel(d.day),
        isPeak: false,
        isNow: false,
        title: `${dayLabel(d.day)}：${metricValueLabel(metric, d[field])}`,
        onClick: null,
      }))
  const maxVal = Math.max(1, ...bars.map((b) => b.value))

  return (
    <div
      className={`trend-panel${pos ? ' trend-panel--floating' : ''}`}
      style={pos ? { left: pos.left, top: pos.top } : undefined}
      ref={dragRef}
    >
      <div className="trend-panel__head trend-panel__head--drag" onPointerDown={onDragStart}>
        <span className="trend-panel__title">占用趨勢</span>
        <button
          type="button"
          className="trend-panel__close"
          onClick={() => {
            toggle()
            showUiToast('占用趨勢已關閉，可從下方時間軸的「📊 趨勢」重新開啟')
          }}
          title="關閉（可從時間軸「📊 趨勢」重新開啟）"
        >
          ✕
        </button>
      </div>

      <div className="trend-panel__toggles">
        <div className="trend-panel__seg">
          <button
            type="button"
            className={`trend-panel__seg-btn${view === 'hourly' ? ' trend-panel__seg-btn--active' : ''}`}
            onClick={() => setView('hourly')}
          >逐時</button>
          <button
            type="button"
            className={`trend-panel__seg-btn${view === 'daily' ? ' trend-panel__seg-btn--active' : ''}`}
            onClick={() => setView('daily')}
          >逐日</button>
        </div>
        <div className="trend-panel__seg">
          {METRICS.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`trend-panel__seg-btn${metric === m.value ? ' trend-panel__seg-btn--active' : ''}`}
              onClick={() => setMetric(m.value)}
            >{m.label}</button>
          ))}
        </div>
      </div>

      <div className="trend-panel__summary">
        <span>全日 <b>{trend.totalPeople}</b> 人 · <b>{trend.totalCars}</b> 車</span>
        {trend.peakHour != null && (
          <span>尖峰 <b>{formatClock(trend.peakHour * 3600)}</b>（{trend.peakPresent} 人）</span>
        )}
      </div>

      <div className="trend-panel__chart">
        {bars.map((b) => {
          const pct = Math.round((b.value / maxVal) * 100)
          const colCls = `trend-panel__bar-col${b.onClick ? ' trend-panel__bar-col--clickable' : ''}${b.isNow ? ' trend-panel__bar-col--now' : ''}`
          return (
            <div
              key={b.key}
              role={b.onClick ? 'button' : undefined}
              className={colCls}
              title={b.title}
              onClick={b.onClick ?? undefined}
            >
              <div className="trend-panel__bar-track">
                <div
                  className={`trend-panel__bar${b.isPeak ? ' trend-panel__bar--peak' : ''}`}
                  style={{ height: `${pct}%` }}
                />
              </div>
              <span className="trend-panel__bar-label">{b.label}</span>
            </div>
          )
        })}
      </div>
      <div className="trend-panel__axis">
        {view === 'hourly'
          ? '每小時在場原始計數（綠柱＝尖峰，亮欄＝目前時刻；非占用率）'
          : '每日在場原始計數（模擬一週，逐日去重統計；非占用率）'}
      </div>
    </div>
  )
}

export default TrendPanel
