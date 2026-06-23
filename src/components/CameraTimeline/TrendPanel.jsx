import React, { useMemo, useRef, useState, useCallback } from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useTrackingStore } from '@/store/useTrackingStore'
import { useCameraStore } from '@/store/useCameraStore'
import { computeFloorTrend } from '@/features/cameras/analyticsStats'
import { DAY_START_SEC, DAY_END_SEC, formatClock } from '@/features/cameras/mockTracks'
import './TrendPanel.sass'

// Floor-wide occupancy trend panel (Verkada "Occupancy Trends" parity).
// A bar chart of distinct people present per hour across the whole day, with
// the busiest-hour callout and day totals. The clock's current hour column is
// highlighted so the chart and the live canvas read together.
//
// The panel is a DRAGGABLE floating window — it first appears at the
// bottom-left of the canvas (out of the way of the cameras) and can be moved
// anywhere by its title bar.

// First spawn position: bottom-left corner of the canvas area.
const INITIAL_POS = { x: 18, y: null }   // y:null → resolved to "near bottom" via CSS bottom

function TrendPanel() {
  const inCameraMode = useEditorStore((s) => s.editorMode === EDITOR_MODE.CAMERA)
  const show = useCameraStore((s) => s.showTrendPanel)
  const toggle = useCameraStore((s) => s.toggleShowTrendPanel)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const tracks = useTrackingStore((s) => s.tracksByFloor[activeFloorId] ?? [])
  const clockSec = useTrackingStore((s) => s.clockSec)

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
    const onMove = (ev) => {
      setPos({
        left: Math.max(0, ev.clientX - parent.left - offX),
        top: Math.max(0, ev.clientY - parent.top - offY),
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const trend = useMemo(
    () => computeFloorTrend(tracks, DAY_START_SEC, DAY_END_SEC),
    [tracks],
  )

  if (!inCameraMode || !activeFloorId || !show) return null

  const maxPeople = Math.max(1, ...trend.hourly.map((h) => h.people))
  const curHour = Math.floor(clockSec / 3600)
  const style = pos ? { left: pos.left, top: pos.top, bottom: 'auto' } : undefined

  return (
    <div className="trend-panel" style={style} ref={dragRef}>
      <div className="trend-panel__head trend-panel__head--drag" onPointerDown={onDragStart}>
        <span className="trend-panel__title">占用趨勢</span>
        <button type="button" className="trend-panel__close" onClick={toggle} title="關閉">✕</button>
      </div>

      <div className="trend-panel__summary">
        <span>全日 <b>{trend.totalPeople}</b> 人 · <b>{trend.totalCars}</b> 車</span>
        {trend.peakHour != null && (
          <span>尖峰 <b>{formatClock(trend.peakHour * 3600)}</b>（{trend.peakPresent} 人）</span>
        )}
      </div>

      <div className="trend-panel__chart">
        {trend.hourly.map((h) => {
          const pct = Math.round((h.people / maxPeople) * 100)
          const isPeak = h.hour === trend.peakHour
          const isNow = h.hour === curHour
          return (
            <div
              key={h.hour}
              className={`trend-panel__bar-col${isNow ? ' trend-panel__bar-col--now' : ''}`}
              title={`${formatClock(h.hour * 3600)}：${h.people} 人、${h.cars} 車`}
            >
              <div className="trend-panel__bar-track">
                <div
                  className={`trend-panel__bar${isPeak ? ' trend-panel__bar--peak' : ''}`}
                  style={{ height: `${pct}%` }}
                />
              </div>
              <span className="trend-panel__bar-label">{String(h.hour).padStart(2, '0')}</span>
            </div>
          )
        })}
      </div>
      <div className="trend-panel__axis">每小時在場不同人數（綠柱＝尖峰，亮欄＝目前時刻）</div>
    </div>
  )
}

export default TrendPanel
