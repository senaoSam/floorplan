import React, { useState, useEffect, useRef } from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useViewportStore } from '@/store/useViewportStore'
import { getSceneRefs } from '@/render/sceneRegistry'
import { greedyChannelAssign } from '@/utils/autoChannelPlan'
import { computePlanQualityStats } from '@/features/heatmap/planQuality'
import { NumberInput } from '@/components/PanelRight/_shared/PanelControls'
import Icon from '@/components/Icon/Icon'
import { COVERAGE_THRESHOLD_DBM, COVERAGE_TARGET_PCT } from '@/constants/coverage'
import './DevicePlanningPanel.sass'

// Recomputing the full-floor RF field is too heavy to run every drag frame, so
// the quality stats are debounced like CoveragePanel's camera stats.
const QUALITY_DEBOUNCE_MS = 200
const DEFAULT_TARGET_PCT = COVERAGE_TARGET_PCT

function fmtPct(v) { return `${v.toFixed(1)}%` }
function fmtArea(m2) { return m2 >= 100 ? `${Math.round(m2)} m²` : `${m2.toFixed(1)} m²` }

function DevicePlanningPanel() {
  const [collapsed, setCollapsed] = useState(true)
  const [toast, setToast] = useState(null) // { kind: 'channel', count }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])

  const regulatoryDomain      = useEditorStore((s) => s.regulatoryDomain)
  const autoChannelOnPlace    = useEditorStore((s) => s.autoChannelOnPlace)
  const toggleAutoChannelOnPlace = useEditorStore((s) => s.toggleAutoChannelOnPlace)

  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floors        = useFloorStore((s) => s.floors)

  const apsByFloor = useAPStore((s) => s.apsByFloor)
  const setAPs     = useAPStore((s) => s.setAPs)
  const aps        = apsByFloor[activeFloorId] ?? []
  const apsOnFloor = aps.length

  const walls  = useWallStore((s) => s.wallsByFloor[activeFloorId])
  const scopes = useScopeStore((s) => s.scopesByFloor[activeFloorId])

  // Coverage design target + threshold live on the panel (planning aid, not the
  // Client-View coverage semantics), defaulting to the -67 dBm industry target.
  const [targetPct, setTargetPct] = useState(DEFAULT_TARGET_PCT)
  const [thresholdDbm, setThresholdDbm] = useState(COVERAGE_THRESHOLD_DBM)
  const [quality, setQuality] = useState(null)
  const qualityTimerRef = useRef(null)

  const floor = floors.find((f) => f.id === activeFloorId)
  const hasScale = !!(floor && floor.scale)

  // Recompute quality stats (debounced) whenever the plan changes. Only while
  // the panel is expanded — the full-floor sweep is wasted work when hidden.
  useEffect(() => {
    if (collapsed || !floor || !hasScale) { setQuality(null); return }
    if (qualityTimerRef.current) clearTimeout(qualityTimerRef.current)
    qualityTimerRef.current = setTimeout(() => {
      setQuality(computePlanQualityStats({ floor, walls: walls ?? [], aps, scopes: scopes ?? [], thresholdDbm }))
    }, QUALITY_DEBOUNCE_MS)
    return () => { if (qualityTimerRef.current) clearTimeout(qualityTimerRef.current) }
  }, [collapsed, floor, hasScale, walls, aps, scopes, thresholdDbm])

  // 52-D2: this was the button that froze the UI with zero feedback — the
  // tester hit it, saw nothing move for seconds, and assumed a crash.
  //
  // The obvious reading ("put the planner in a worker, like AutoPlaceModal")
  // is wrong: measured at 300 APs, greedyChannelAssign is only ~15 ms. The
  // stall is the SYNCHRONOUS re-render cascade that setAPs triggers (~161 ms
  // in the store commit, ~274 ms of blocked frames after it, and more on a
  // slow machine — the tester reported ~5.8 s). A worker would move the 15 ms
  // and leave the freeze exactly as it is.
  //
  // So the fix is honest feedback rather than parallelism: flip a busy flag,
  // yield twice so the browser actually paints it, then do the heavy commit.
  // Without the double rAF the paint and the commit land in the same frame and
  // the user still sees nothing.
  const [channelBusy, setChannelBusy] = useState(false)

  const runAutoChannel = async () => {
    if (aps.length === 0 || channelBusy) return
    setChannelBusy(true)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    try {
      const assignments = greedyChannelAssign(aps, regulatoryDomain)
      const updated = aps.map((ap) => {
        const a = assignments.get(ap.id)
        return a ? { ...ap, channel: a.channel } : ap
      })
      setAPs(activeFloorId, updated)
      setToast({ kind: 'channel', count: assignments.size })
    } finally {
      setChannelBusy(false)
    }
  }

  const locateBiggestGap = () => {
    if (!quality?.biggestGap) return
    const vp = useViewportStore.getState()
    const canvas = getSceneRefs()?.app?.canvas
    if (canvas && vp.setViewport) {
      const rect = canvas.getBoundingClientRect()
      const scale = vp.scale || 1
      vp.setViewport({
        x: rect.width / 2 - quality.biggestGap.x * scale,
        y: rect.height / 2 - quality.biggestGap.y * scale,
        scale,
      })
    }
  }

  const meetsTarget = quality ? quality.coveragePct >= targetPct : false
  const conflictCount = quality?.channelConflicts?.length ?? 0

  return (
    <div className="device-planning">
      <div className="device-planning__header" onClick={() => setCollapsed((v) => !v)}>
        <span className="device-planning__icon">📡</span>
        <span className="device-planning__title">設備規劃</span>
        <span className={`device-planning__arrow${collapsed ? ' device-planning__arrow--collapsed' : ''}`}><Icon name="chevronDown" size={11} /></span>
      </div>

      {!collapsed && (
        <div className="device-planning__body">
          <section className="device-planning__section">
            <div className="device-planning__section-head">
              <p className="device-planning__section-title">AP</p>
              <label
                className="device-planning__check"
                title="放置新 AP 時自動指派頻道"
              >
                <input
                  type="checkbox"
                  checked={autoChannelOnPlace}
                  onChange={toggleAutoChannelOnPlace}
                />
                <span>新AP自動選頻</span>
              </label>
            </div>

            <div className="device-planning__actions">
              <button
                className="device-planning__btn"
                onClick={runAutoChannel}
                disabled={apsOnFloor === 0 || channelBusy}
                title={channelBusy
                  ? `正在為 ${apsOnFloor} 顆 AP 指派頻道…`
                  : '自動為本樓層所有 AP 指派互不干擾的頻道'}
              >
                {channelBusy ? `⏳ 指派頻道中（${apsOnFloor} 顆）…` : '📻 自動頻道'}
              </button>
            </div>
          </section>

          {/* 規劃品質報表：涵蓋率 / 盲區 / 頻道衝突。以本樓層 scope 內
              （無 scope 則整張圖）為分母，RSSI ≥ 門檻算已涵蓋。 */}
          <section className="device-planning__section device-planning__quality">
            <p className="device-planning__section-title">規劃品質</p>

            {!hasScale && (
              <p className="device-planning__empty">尚未設定比例尺，無法計算涵蓋率</p>
            )}

            {hasScale && apsOnFloor === 0 && (
              <p className="device-planning__empty">本樓層還沒有 AP</p>
            )}

            {hasScale && apsOnFloor > 0 && !quality && (
              <p className="device-planning__empty">計算中…</p>
            )}

            {hasScale && apsOnFloor > 0 && quality && (
              <>
                <div className="device-planning__hero">
                  <span className={`device-planning__hero-num${meetsTarget ? '' : ' device-planning__hero-num--fail'}`}>
                    {fmtPct(quality.coveragePct)}
                  </span>
                  <span className="device-planning__hero-label">已涵蓋（≥ {thresholdDbm} dBm）</span>
                </div>

                <div className="device-planning__bar" title={`已涵蓋 ${fmtPct(quality.coveragePct)}、盲區 ${fmtPct(quality.blindPct)}`}>
                  <div
                    className={`device-planning__bar-fill${meetsTarget ? '' : ' device-planning__bar-fill--fail'}`}
                    style={{ width: `${quality.coveragePct}%` }}
                  />
                  <div className="device-planning__bar-target" style={{ left: `${targetPct}%` }} />
                </div>

                <div className={`device-planning__verdict${meetsTarget ? ' device-planning__verdict--pass' : ' device-planning__verdict--fail'}`}>
                  <span>{meetsTarget ? '✓ 已達標' : '⚠ 未達標'}</span>
                  <span className="device-planning__target" title="涵蓋率目標門檻">
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

                <div className="device-planning__rows">
                  <div className="device-planning__row">
                    <span>盲區</span>
                    <b>{fmtPct(quality.blindPct)} · {fmtArea(quality.blindAreaM2)}</b>
                  </div>
                  <div className="device-planning__row" title="有兩台以上 AP 同時高於門檻的區域比例——語音通話與漫遊需要這種重疊備援，避免換手時斷訊">
                    <span>雙重涵蓋（≥2 台）</span>
                    <b>{fmtPct(quality.secondaryCoveragePct ?? 0)}</b>
                  </div>
                  <div className="device-planning__row" title="同頻段、頻譜重疊、且距離過近的 AP 對數">
                    <span>頻道衝突</span>
                    <b className={conflictCount > 0 ? 'device-planning__val--warn' : ''}>{conflictCount} 對</b>
                  </div>
                  <div className="device-planning__row" title="訊號門檻——RSSI 高於此值才算已涵蓋">
                    <span>訊號門檻</span>
                    <NumberInput
                      value={thresholdDbm}
                      min={-85}
                      max={-55}
                      step={1}
                      unit="dBm"
                      width={56}
                      onChange={(v) => { if (!isNaN(v)) setThresholdDbm(v) }}
                    />
                  </div>
                </div>

                {quality.biggestGap && quality.blindPct > 0.5 && (
                  <button
                    type="button"
                    className="device-planning__gap"
                    onClick={locateBiggestGap}
                    title="把畫面移到訊號盲區最集中的位置，方便補一台 AP"
                  >
                    ◎ 定位最大盲區
                  </button>
                )}
              </>
            )}
          </section>

          {/* 未來：Switch / IPCam / Gateway 規劃 section 追加在這裡 */}

          {toast && (
            <div className="device-planning__toast" key={`${toast.kind}-${toast.count}-${Date.now()}`}>
              <span className="device-planning__toast-check">✓</span>
              已為 {toast.count} 個 AP 指派{toast.kind === 'channel' ? '頻道' : '功率'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default DevicePlanningPanel
