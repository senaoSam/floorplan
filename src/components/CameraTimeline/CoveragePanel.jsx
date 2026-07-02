import React, { useState, useEffect, useRef } from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useCameraStore } from '@/store/useCameraStore'
import { useWallStore } from '@/store/useWallStore'
import { computeCoverageStats } from '@/features/cameras/coverageStats'
import { flashGapMarker } from '@/features/cameras/gapMarkerBus'
import { useViewportStore } from '@/store/useViewportStore'
import { getSceneRefs } from '@/render/sceneRegistry'
import { NumberInput } from '@/components/PanelRight/_shared/PanelControls'
import '@/components/PanelRight/_shared/shared.sass'
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
  const targetPct = useCameraStore((s) => s.coverageTargetPct)
  const setTargetPct = useCameraStore((s) => s.setCoverageTargetPct)
  const showBlindSpots = useCameraStore((s) => s.showBlindSpots)
  const toggleShowBlindSpots = useCameraStore((s) => s.toggleShowBlindSpots)
  const selectedId = useEditorStore((s) => s.selectedId)
  const selectedType = useEditorStore((s) => s.selectedType)

  const [stats, setStats] = useState(null)
  const [soloStats, setSoloStats] = useState(null)   // selected camera alone
  const timerRef = useRef(null)
  const soloTimerRef = useRef(null)
  const blindRevertRef = useRef(null)

  useEffect(() => {
    if (!inCameraMode || !activeFloorId) { setStats(null); return }
    const floor = floors.find((f) => f.id === activeFloorId)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setStats(computeCoverageStats({ cameras: cameras ?? [], walls: walls ?? [], floor }))
    }, DEBOUNCE_MS)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [inCameraMode, activeFloorId, floors, cameras, walls])

  // Contribution of the SELECTED camera alone — what it covers on its own
  // (rasterise just that one). Only when a camera is selected.
  const selCam = selectedType === 'camera'
    ? (cameras ?? []).find((c) => c.id === selectedId)
    : null
  useEffect(() => {
    if (!inCameraMode || !activeFloorId || !selCam) { setSoloStats(null); return }
    const floor = floors.find((f) => f.id === activeFloorId)
    if (soloTimerRef.current) clearTimeout(soloTimerRef.current)
    soloTimerRef.current = setTimeout(() => {
      setSoloStats(computeCoverageStats({ cameras: [selCam], walls: walls ?? [], floor }))
    }, DEBOUNCE_MS)
    return () => { if (soloTimerRef.current) clearTimeout(soloTimerRef.current) }
  }, [inCameraMode, activeFloorId, floors, walls, selCam])

  if (!inCameraMode || !activeFloorId || !stats) return null

  const offline = stats.cameraCount - stats.onlineCount
  const meetsTarget = stats.coveredPct >= targetPct

  return (
    <div className="coverage-panel">
      <div className="coverage-panel__title">覆蓋率報表</div>

      <div className="coverage-panel__hero">
        <span className={`coverage-panel__hero-num${meetsTarget ? '' : ' coverage-panel__hero-num--fail'}`}>
          {fmtPct(stats.coveredPct)}
        </span>
        <span className="coverage-panel__hero-label">地板已涵蓋</span>
      </div>

      <div className="coverage-panel__bar" title={`已涵蓋 ${fmtPct(stats.coveredPct)}、盲區 ${fmtPct(stats.blindPct)}`}>
        <div
          className={`coverage-panel__bar-fill${meetsTarget ? '' : ' coverage-panel__bar-fill--fail'}`}
          style={{ width: `${stats.coveredPct}%` }}
        />
        {/* target threshold marker */}
        <div className="coverage-panel__bar-target" style={{ left: `${targetPct}%` }} />
      </div>

      <div className={`coverage-panel__verdict${meetsTarget ? ' coverage-panel__verdict--pass' : ' coverage-panel__verdict--fail'}`}>
        <span>{meetsTarget ? '✓ 已達標' : '⚠ 未達標'}</span>
        <span className="coverage-panel__target" title="覆蓋率目標門檻">
          目標
          <NumberInput
            value={targetPct}
            min={0}
            max={100}
            step={5}
            unit="%"
            width={44}
            onChange={(v) => { if (!isNaN(v)) setTargetPct(v) }}
          />
        </span>
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

      {selCam && soloStats && (
        <div className="coverage-panel__solo" title="這台相機單獨能看到的範圍（不計其他相機）">
          <span>📷 {selCam.name} 單獨涵蓋</span>
          <b>{fmtPct(soloStats.coveredPct)} · {fmtArea(soloStats.coveredAreaM2)}</b>
        </div>
      )}

      {stats.biggestGap && stats.blindPct > 0.5 && (
        <button
          type="button"
          className="coverage-panel__gap"
          onClick={() => {
            const vp = useViewportStore.getState()
            const canvas = getSceneRefs()?.app?.canvas
            if (canvas && vp.setViewport) {
              const rect = canvas.getBoundingClientRect()
              const scale = vp.scale || 1
              vp.setViewport({
                x: rect.width / 2 - stats.biggestGap.x * scale,
                y: rect.height / 2 - stats.biggestGap.y * scale,
                scale,
              })
            }
            // Flash a pulsing ring AT the gap so it's clear where to look.
            flashGapMarker(stats.biggestGap.x, stats.biggestGap.y, performance.now())
            // Briefly shade the blind area too, then revert to the user's
            // prior setting so the locate action doesn't leave the overlay
            // stuck on. (If it was already on, leave it on.)
            if (!showBlindSpots) {
              toggleShowBlindSpots()
              if (blindRevertRef.current) clearTimeout(blindRevertRef.current)
              blindRevertRef.current = setTimeout(() => {
                if (useCameraStore.getState().showBlindSpots) {
                  useCameraStore.getState().toggleShowBlindSpots()
                }
              }, 4500)
            }
          }}
          title="把畫面移到盲區最集中的位置並閃示標記，方便補一台相機"
        >
          ◎ 定位最大盲區
        </button>
      )}

      <div className="coverage-panel__note">以整張平面圖範圍為分母</div>
    </div>
  )
}

export default CoveragePanel
