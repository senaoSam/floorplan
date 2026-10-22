import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useClientViewStore } from '@/store/useClientViewStore'
import { flashGapMarker } from '@/features/cameras/gapMarkerBus'
import { greedyChannelAssign, radiosWithoutChannels } from '@/utils/autoChannelPlan'
import { expandRadios, applyRadioResults, enabledRadios, radioAllowed } from '@/utils/apRadios'
import { computePlanQualityStats, LOW_SINR_DB } from '@/features/heatmap/planQuality'
import { storeChannelNeighbors } from '@/features/heatmap/channelNeighbors'
import { NumberInput } from '@/components/PanelRight/_shared/PanelControls'
import Icon from '@/components/Icon/Icon'
import { usePlanningDialogStore } from '@/store/usePlanningDialogStore'
import { useRadioPreviewStore, withRadioPreview } from '@/store/useRadioPreviewStore'
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
  const [toast, setToast] = useState(null) // { kind: 'channel', count, skipped? }

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

  // A planning dialog's preview (useRadioPreviewStore): the quality stats
  // follow the previewed plan, like the heatmap -- read only for the stats
  // (auto channel and the rest write the real APs).
  const previewFloorId   = useRadioPreviewStore((s) => s.floorId)
  const previewPlan      = useRadioPreviewStore((s) => s.plan)
  const previewShowBefore = useRadioPreviewStore((s) => s.showBefore)
  const qualityApsByFloor = useMemo(
    () => withRadioPreview(apsByFloor, { floorId: previewFloorId, plan: previewPlan, showBefore: previewShowBefore }),
    [apsByFloor, previewFloorId, previewPlan, previewShowBefore],
  )
  const qualityAps = qualityApsByFloor[activeFloorId] ?? []
  const qualityPreviewed = qualityApsByFloor !== apsByFloor && previewFloorId === activeFloorId

  const walls  = useWallStore((s) => s.wallsByFloor[activeFloorId])
  const scopes = useScopeStore((s) => s.scopesByFloor[activeFloorId])
  // 57-17: quality samples the cross-floor scenario, so other floors' walls /
  // holes must retrigger it too.
  const wallsByAll   = useWallStore((s) => s.wallsByFloor)
  const holesByFloor = useFloorHoleStore((s) => s.floorHolesByFloor)
  // 57-33: stats follow the heatmap's band; conflicts use Client View's min
  // interfering RSSI (read via the scenario), so both retrigger the sweep.
  const bandFilter   = useHeatmapStore((s) => s.bandFilter) || 'all'
  const minInterf    = useClientViewStore((s) => s.minInterferingRssiDbm)

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
      // 57-17: building maps → same cross-floor scenario as the heatmap.
      setQuality(computePlanQualityStats({
        floor, walls: walls ?? [], aps: qualityAps, scopes: scopes ?? [], thresholdDbm,
        floors,
        apsByFloor: qualityApsByFloor,
        wallsByFloor: useWallStore.getState().wallsByFloor,
        holesByFloor: useFloorHoleStore.getState().floorHolesByFloor,
        bandFilter,
      }))
    }, QUALITY_DEBOUNCE_MS)
    return () => { if (qualityTimerRef.current) clearTimeout(qualityTimerRef.current) }
  }, [collapsed, floor, hasScale, walls, qualityAps, scopes, thresholdDbm, floors, qualityApsByFloor, wallsByAll, holesByFloor, bandFilter, minInterf, regulatoryDomain])

  // 52-D2: this was the button that froze the UI with zero feedback — the
  // tester hit it, saw nothing move for seconds, and assumed a crash.
  //
  // The obvious reading ("put the planner in a worker, like AutoPlaceModal")
  // is wrong: measured at 300 APs, greedyChannelAssign is only ~15 ms. The
  // stall is the SYNCHRONOUS re-render cascade that setAPs triggers (~161 ms
  // in the store commit, ~274 ms of blocked frames after it, and more on a
  // slow machine — the tester reported ~5.8 s). A worker would move the 15 ms
  // and leave the freeze exactly as it is.
  // 58-15: those 15 ms predate the signal-based neighbours and the pair-move /
  // multi-start search. Re-measured in node: 300 APs ~80 ms for the search,
  // ~340 ms with the AP-to-AP signal computation; 1000 APs ~1 s / ~3.8 s.
  //
  // So the fix is honest feedback rather than parallelism: flip a busy flag,
  // yield twice so the browser actually paints it, then do the heavy commit.
  // Without the double rAF the paint and the commit land in the same frame and
  // the user still sees nothing.
  const [channelBusy, setChannelBusy] = useState(false)
  const openDialog = usePlanningDialogStore((s) => s.openDialog)

  const runAutoChannel = async () => {
    // No scale → no AP-to-AP distances to plan with (the button is disabled).
    if (aps.length === 0 || channelBusy || !hasScale) return
    setChannelBusy(true)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    try {
      // 57-34: neighbours = radios that hear each other (not a canvas-px
      // radius). 58: planned per radio; the toast counts radios.
      const radios = expandRadios(aps)
      // 58-15 (C5): every radio here is being planned -- one on a channel the
      // domain does not allow is moved to an allowed one.
      const assignments = greedyChannelAssign(radios, regulatoryDomain, storeChannelNeighbors(activeFloorId, aps, new Set(radios.map((r) => r.id))))
      const updated = applyRadioResults(aps, assignments, (a) => ({ channel: a.channel }))
      setAPs(activeFloorId, updated)
      // 58-16 (C5): enabled radios on a band the domain has no channel for
      // (e.g. 6 GHz after switching to CN) are not planned -- say so.
      const skipped = {}
      for (const r of radiosWithoutChannels(radios, regulatoryDomain)) skipped[r.frequency] = (skipped[r.frequency] ?? 0) + 1
      setToast({ kind: 'channel', count: assignments.size, skipped })
    } finally {
      setChannelBusy(false)
    }
  }

  // Same cue as the camera CoveragePanel: a pulsing amber ring AT the gap
  // plus a brief shade over every blind cell, leaving the view where the user
  // put it (an edge arrow points the way when the gap is off-screen).
  const locateBiggestGap = () => {
    if (!quality?.biggestGap) return
    flashGapMarker(quality.biggestGap.x, quality.biggestGap.y, performance.now(), activeFloorId, 'heatmap', quality.blindMask)
  }

  const meetsTarget = quality ? quality.coveragePct >= targetPct : false
  const conflictCount = quality?.channelConflicts?.length ?? 0
  // 58-15: conflicts come sorted strongest first; the pair count alone hides
  // that auto-channel trades a few loud pairs for more faint ones.
  const strongestConflictDbm = quality?.channelConflicts?.[0]?.rssiDbm
  // Cross-floor pairs are listed on their own row (not added to the per-floor
  // count), shown once the building has another calibrated floor.
  const crossFloorCount = quality?.crossFloorConflicts?.length ?? 0
  const strongestCrossDbm = quality?.crossFloorConflicts?.[0]?.rssiDbm
  const hasOtherFloors = floors.some((f) => f.id !== activeFloorId && f.scale)
  // 58-15 (C5): this floor's enabled radios the domain does not allow -- left
  // out of every number above.
  let notAllowedCount = 0
  for (const a of aps) {
    for (const r of enabledRadios(a)) if (!radioAllowed(regulatoryDomain, r.band, r.channel, r.channelWidth)) notAllowedCount++
  }

  return (
    <div className="device-planning">
      <div className="device-planning__header" onClick={() => setCollapsed((v) => !v)}>
        <span className="device-planning__icon"><Icon name="radioTower" size={12} inline /></span>
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
                disabled={apsOnFloor === 0 || channelBusy || !hasScale}
                title={channelBusy
                  ? `正在為 ${apsOnFloor} 顆 AP 指派頻道…`
                  : !hasScale
                    ? '尚未設定比例尺，無法判斷 AP 之間的距離'
                    : '自動為本樓層所有 AP 指派互不干擾的頻道'}
              >
                <Icon name={channelBusy ? 'hourglass' : 'radio'} size={14} />
                {channelBusy ? `指派頻道中（${apsOnFloor} 顆）…` : '自動頻道'}
              </button>
              {/* 58-13 */}
              <button
                className="device-planning__btn"
                onClick={() => openDialog('redundant24')}
                disabled={apsOnFloor === 0 || !hasScale}
                title={!hasScale ? '尚未設定比例尺' : '找出覆蓋已被其他 AP 蓋到的 2.4 GHz 射頻，預覽後關閉'}
              >
                <Icon name="powerOff" size={14} />
                關閉多餘 2.4 GHz
              </button>
            </div>
          </section>

          {/* 規劃品質報表：涵蓋率 / 盲區 / 頻道衝突。以本樓層 scope 內
              （無 scope 則整張圖）為分母，RSSI ≥ 門檻算已涵蓋。 */}
          <section className="device-planning__section device-planning__quality">
            <p className="device-planning__section-title">規劃品質{qualityPreviewed ? '（預覽：套用後）' : ''}</p>

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
                  {/* 57-33: stats follow the heatmap's band filter. */}
                  <span className="device-planning__hero-label">已涵蓋（≥ {thresholdDbm} dBm，{bandFilter !== 'all' ? `${bandFilter} GHz` : '最強頻段，含 2.4 GHz'}）</span>
                </div>

                <div className="device-planning__bar" title={`已涵蓋 ${fmtPct(quality.coveragePct)}、盲區 ${fmtPct(quality.blindPct)}`}>
                  <div
                    className={`device-planning__bar-fill${meetsTarget ? '' : ' device-planning__bar-fill--fail'}`}
                    style={{ width: `${quality.coveragePct}%` }}
                  />
                  <div className="device-planning__bar-target" style={{ left: `${targetPct}%` }} />
                </div>

                <div className={`device-planning__verdict${meetsTarget ? ' device-planning__verdict--pass' : ' device-planning__verdict--fail'}`}>
                  <span>{meetsTarget ? '✓ 已達標' : <><Icon name="warning" size={12} inline style={{ marginRight: 4 }} />未達標</>}</span>
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
                  <div className="device-planning__row" title={`有訊號（≥ ${thresholdDbm} dBm）但 SINR 低於 ${LOW_SINR_DB} dB 的面積比例——多半是同頻干擾吃掉了訊號餘裕。自動頻道就是在壓低這個數字（與 SINR 熱圖同一套模型，只算直射）`}>
                    <span>低 SINR（&lt;{LOW_SINR_DB} dB）</span>
                    <b>{fmtPct(quality.lowSinrPct ?? 0)}</b>
                  </div>
                  <div className="device-planning__row" title={`本樓層內同頻段、頻譜重疊、且彼此聽得到（AP 間訊號 ≥ ${minInterf} dBm，即 Client View 的最小干擾 RSSI）的射頻對數——這些 AP 得輪流使用通話時間（同一對 AP 在兩個頻段衝突算 2 對）；括號內為訊號最強那一對的 AP 間訊號`}>
                    <span>頻道衝突</span>
                    <b className={conflictCount > 0 ? 'device-planning__val--warn' : ''}>{conflictCount} 對{conflictCount > 0 && strongestConflictDbm != null ? `（最強 ${strongestConflictDbm.toFixed(1)} dBm）` : ''}</b>
                  </div>
                  {hasOtherFloors && (
                    <div className="device-planning__row" title={`本樓層射頻與其他樓層射頻之間的同頻衝突（判斷規則同上），不計入上方本樓層的對數。自動頻道會一併避開其他樓層，所以有時會用一對較弱的本樓層衝突，換掉一對更強的跨樓層衝突`}>
                      <span>跨樓層衝突</span>
                      <b className={crossFloorCount > 0 ? 'device-planning__val--warn' : ''}>{crossFloorCount} 對{crossFloorCount > 0 && strongestCrossDbm != null ? `（最強 ${strongestCrossDbm.toFixed(1)} dBm）` : ''}</b>
                    </div>
                  )}
                  {notAllowedCount > 0 && (
                    <div className="device-planning__row" title="已啟用、但頻段或頻道在目前國家不允許的射頻：不發射，不計入熱圖與上方各項數字。頻道不合法者可按「自動頻道」改到合法頻道；換回原國家即恢復">
                      <span>此國家不可用</span>
                      <b className="device-planning__val--warn">{notAllowedCount} 個射頻</b>
                    </div>
                  )}
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
                    title="在訊號盲區最集中的位置閃示標記（不移動畫面），方便補一台 AP"
                  >
                    <Icon name="locate" size={12} inline style={{ marginRight: 4 }} />定位最大盲區
                  </button>
                )}
              </>
            )}
          </section>

          {/* 未來：Switch / IPCam / Gateway 規劃 section 追加在這裡 */}

          {toast && (
            <div className="device-planning__toast" key={`${toast.kind}-${toast.count}-${Date.now()}`}>
              <span className="device-planning__toast-check">✓</span>
              已為 {toast.count} {toast.kind === 'channel' ? '個射頻指派頻道' : '個 AP 指派功率'}
              {Object.entries(toast.skipped ?? {}).map(([band, n]) => `；${n} 個 ${band} GHz 射頻在目前國家頻段不可用，未排頻`).join('')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default DevicePlanningPanel
