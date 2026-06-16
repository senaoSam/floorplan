import React, { useState, useEffect, useRef } from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useCameraStore } from '@/store/useCameraStore'
import { useWallStore } from '@/store/useWallStore'
import { computeCoverageStats } from '@/features/cameras/coverageStats'
import './CoveragePanel.sass'

// Coverage report for Camera mode (planning aid). Always-on card top-left:
// what fraction of the floor the placed cameras actually see, how much is
// blind, and how much is redundantly covered (≥2 cameras). Recomputes
// (debounced) whenever cameras / walls / floor change — rasterising the FOV
// polygons is too heavy to run every drag frame.

const DEBOUNCE_MS = 160

function fmtPct(v) { return `${v.toFixed(1)}%` }
function fmtArea(m2) { return m2 >= 100 ? `${Math.round(m2)} m²` : `${m2.toFixed(1)} m²` }

function CoveragePanel() {
  const inCameraMode = useEditorStore((s) => s.editorMode === EDITOR_MODE.CAMERA)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floors = useFloorStore((s) => s.floors)
  const cameras = useCameraStore((s) => s.camerasByFloor[activeFloorId])
  const walls = useWallStore((s) => s.wallsByFloor[activeFloorId])

  const [stats, setStats] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!inCameraMode || !activeFloorId) { setStats(null); return }
    const floor = floors.find((f) => f.id === activeFloorId)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setStats(computeCoverageStats({ cameras: cameras ?? [], walls: walls ?? [], floor }))
    }, DEBOUNCE_MS)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [inCameraMode, activeFloorId, floors, cameras, walls])

  if (!inCameraMode || !activeFloorId || !stats) return null

  const offline = stats.cameraCount - stats.onlineCount

  return (
    <div className="coverage-panel">
      <div className="coverage-panel__title">覆蓋率報表</div>

      <div className="coverage-panel__hero">
        <span className="coverage-panel__hero-num">{fmtPct(stats.coveredPct)}</span>
        <span className="coverage-panel__hero-label">地板已涵蓋</span>
      </div>

      <div className="coverage-panel__bar" title={`已涵蓋 ${fmtPct(stats.coveredPct)}、盲區 ${fmtPct(stats.blindPct)}`}>
        <div className="coverage-panel__bar-fill" style={{ width: `${stats.coveredPct}%` }} />
      </div>

      <div className="coverage-panel__rows">
        <div className="coverage-panel__row">
          <span>相機</span>
          <b>{stats.onlineCount} 台{offline > 0 ? ` (+${offline} 離線)` : ''}</b>
        </div>
        <div className="coverage-panel__row">
          <span>盲區</span>
          <b>{fmtPct(stats.blindPct)} · {fmtArea(stats.blindAreaM2)}</b>
        </div>
        <div className="coverage-panel__row" title="被 2 台以上相機同時看到的面積——其中一台故障也不會變盲區">
          <span>重疊備援</span>
          <b>{fmtPct(stats.redundantPct)}</b>
        </div>
        <div className="coverage-panel__row" title="已涵蓋區域平均被幾台相機看到">
          <span>平均重疊</span>
          <b>{stats.avgOverlap.toFixed(2)}×</b>
        </div>
      </div>
    </div>
  )
}

export default CoveragePanel
