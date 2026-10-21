import React, { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useAutoPlaceStore } from '@/store/useAutoPlaceStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { currentScenarioEnv } from '@/features/heatmap/buildScenario'
import { computePlanQualityStats } from '@/features/heatmap/planQuality'
import { COVERAGE_THRESHOLD_DBM } from '@/constants/coverage'
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss'
import { hasEnabledBand, apRadio, patchRadio, radioAllowed } from '@/utils/apRadios'
import { allowedChannels } from '@/constants/regulatoryDomains'
import './AutoPlaceModal.sass'

import AutoPlaceWorker from '@/workers/autoPlacePlan.worker.js?worker'

// 53-G9: one frozen empty array for the `?? EMPTY` selectors below. A bare
// `?? []` returns a new reference whenever the floor's key is absent, so
// zustand saw a changed slice on EVERY store write and re-rendered.
const EMPTY = Object.freeze([])

// Phase 49 — 自動規劃 AP 放置 modal。
// 三態：設定（模式/頻段/目標）→ 執行中（determinate 進度）→ 預覽。
// 預覽態 modal 退成右下角 docked 小卡、背板不擋畫布 —— ghost marker
// （ghostAPsLayer）與 what-if 熱圖（heatmapAdapter 併入 previewAps）
// 直接在畫布上看，確認才「套用」真正建立 AP。
//
// 套用語意：
//   fresh / fixed — 移除有「同頻段」射頻的現有 AP（58: 整台，含其他頻段）再新增
//   fill          — 全保留，只新增

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const MODE_OPTIONS = [
  { value: 'fresh', label: '重新規劃', hint: '算出達標所需的最少 AP 數（套用時移除現有同頻段 AP，整台含其他頻段）' },
  { value: 'fixed', label: '固定數量', hint: '用指定顆數把覆蓋做到最好（套用時移除現有同頻段 AP，整台含其他頻段）' },
  { value: 'fill',  label: '補洞',     hint: '現有 AP 全保留，只加新 AP 補覆蓋缺口' },
]

const BAND_OPTIONS = [
  { value: 2.4, label: '2.4 GHz' },
  { value: 5,   label: '5 GHz' },
  { value: 6,   label: '6 GHz' },
]

const fmtPct = (x) => x == null || !isFinite(x) ? '—' : `${(x * 100).toFixed(1)}%`

// 連號命名基數。52-A4 後 setAPs 會推進 globalAPCounter，故 counter 已涵蓋
// demo / 壓測載入；仍掃一次現有名稱作為保險（手動改名可能高於 counter）。
function apNameBase() {
  const st = useAPStore.getState()
  let maxNum = st.globalAPCounter
  for (const list of Object.values(st.apsByFloor)) {
    for (const a of list ?? []) {
      const m = /^AP-(\d+)$/.exec(a.name ?? '')
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10))
    }
  }
  return maxNum
}

function AutoPlaceModal({ open, onClose }) {
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floors = useFloorStore((s) => s.floors)
  const floor = floors.find((f) => f.id === activeFloorId)
  const walls = useWallStore((s) => s.wallsByFloor[activeFloorId] ?? EMPTY)
  const aps = useAPStore((s) => s.apsByFloor[activeFloorId] ?? EMPTY)
  const scopes = useScopeStore((s) => s.scopesByFloor[activeFloorId] ?? EMPTY)
  const regulatoryDomain = useEditorStore((s) => s.regulatoryDomain)
  const setPreview = useAutoPlaceStore((s) => s.setPreview)
  const clearPreview = useAutoPlaceStore((s) => s.clearPreview)

  const [mode, setMode] = useState('fresh')
  const [band, setBand] = useState(5)
  const [targetRssi, setTargetRssi] = useState(-65)
  const [targetCoverage, setTargetCoverage] = useState(95)
  const [apCount, setApCount] = useState(4)
  const [indoorOnly, setIndoorOnly] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)   // { proposedAps, removeApIds, stats }
  const [error, setError] = useState(null)
  const workerRef = useRef(null)

  // 58: devices with an enabled radio on the band.
  const sameBandCount = aps.filter((a) => hasEnabledBand(a, band)).length
  // 58-9: devices that have the band but switched it off.
  const offBandCount = aps.filter((a) => apRadio(a, band) && !hasEnabledBand(a, band)).length
  // 58-15 (C5): of those enabled, the ones the domain does not allow -- they
  // keep their channel here (auto channel retunes them) and add no coverage.
  const notAllowedCount = aps.filter((a) => {
    const r = apRadio(a, band)
    return r?.enabled && !radioAllowed(regulatoryDomain, band, r.channel, r.channelWidth)
  }).length
  // 58-9: only bands the regulatory domain has channels on (no 6 GHz in CN).
  const bandOptions = BAND_OPTIONS.filter((b) => allowedChannels(regulatoryDomain, b.value).length > 0)

  // 國家頻段換成沒有目前頻段頻道的國家 → 退回 5 GHz。
  useEffect(() => {
    if (allowedChannels(regulatoryDomain, band).length === 0) setBand(5)
  }, [regulatoryDomain, band])

  // Unmount 清理：worker + ghost 預覽都不能留。
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
      useAutoPlaceStore.getState().clearPreview()
    }
  }, [])

  // 每次開啟從乾淨設定頁開始（同 AutoPowerModal——關閉不 unmount）。關閉時
  // （含開了別的規劃視窗，usePlanningDialogStore）停掉 worker、收掉 ghost 預覽。
  useEffect(() => {
    if (!open) {
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
      useAutoPlaceStore.getState().clearPreview()
      setRunning(false)
    }
    setResult(null)
    setProgress(null)
    setError(null)
  }, [open])

  const handleRun = useCallback(() => {
    if (!floor || !floor.scale) {
      setError('當前樓層未設定比例尺，無法執行自動規劃')
      return
    }
    const rssiVal = parseFloat(targetRssi)
    const covVal = parseFloat(targetCoverage)
    const nVal = parseInt(apCount, 10)
    if (!isFinite(rssiVal) || !isFinite(covVal) || (mode === 'fixed' && !isFinite(nVal))) {
      setError('請輸入有效的目標數值')
      return
    }
    const rssiClamped = Math.round(clamp(rssiVal, -90, -30))
    const covClamped = Math.round(clamp(covVal, 50, 100))
    const nClamped = clamp(nVal || 1, 1, 200)
    setTargetRssi(rssiClamped)
    setTargetCoverage(covClamped)
    setApCount(nClamped)
    setRunning(true)
    setError(null)
    setResult(null)
    setProgress(null)
    clearPreview()

    const worker = new AutoPlaceWorker()
    workerRef.current = worker

    worker.onmessage = (e) => {
      const msg = e.data
      if (!msg || !msg.type) return
      if (msg.type === 'progress') {
        setProgress(msg.state)
      } else if (msg.type === 'done') {
        const r = msg.result
        if (r.error) {
          const text = r.error === 'no-scope-cells' ? '評分範圍為空（scope 是否把整層排除了？）'
            : r.error === 'no-indoor-cells' ? '規劃範圍與辨識出的室內區域沒有交集（可取消「僅室內放置」）'
            : r.error === 'no-candidates' ? '找不到可放置的候選點（scope 是否過小？）'
            : r.error === 'invalid-floor' ? '樓層資料不完整'
            : r.error === 'band-not-allowed' ? '目前國家頻段沒有此頻段的頻道'
            : r.error
          setError(`錯誤：${text}`)
        } else {
          // Ghost 顯示名稱：連號預估（套用時以同一基數定名）。
          const base = apNameBase()
          const named = r.proposedAps.map((ap, i) => ({
            ...ap,
            name: `AP-${String(base + i + 1).padStart(2, '0')}`,
          }))
          const removeIds = r.removeApIds ?? []
          const enableIds = r.enableApIds ?? []
          const enableChannels = r.enableChannels ?? {}
          // 58-15 (B4): the same plan on the planning panel's basis (every
          // in-scope cell incl. outdoor margins, its default threshold, this
          // band) -- computed here: the worker's stores hold default RF /
          // regulatory settings, computePlanQualityStats reads the live ones.
          let panelCoveragePct = null
          if (r.stats?.indoorApplied) {
            const st = useAPStore.getState()
            const on = new Set(enableIds)
            const drop = new Set(removeIds)
            const finalAps = [
              ...(st.apsByFloor[activeFloorId] ?? []).filter((a) => !drop.has(a.id)).map((a) => (on.has(a.id)
                ? { ...a, radios: patchRadio(a, band, { enabled: true, ...(enableChannels[a.id] != null ? { channel: enableChannels[a.id] } : {}) }) }
                : a)),
              ...r.proposedAps.map(({ planBand, ...ap }) => ap),
            ]
            const q = computePlanQualityStats({
              floor, walls, aps: finalAps, scopes, thresholdDbm: COVERAGE_THRESHOLD_DBM,
              floors: useFloorStore.getState().floors,
              apsByFloor: { ...st.apsByFloor, [activeFloorId]: finalAps },
              wallsByFloor: useWallStore.getState().wallsByFloor,
              holesByFloor: useFloorHoleStore.getState().floorHolesByFloor,
              bandFilter: String(band),
            })
            panelCoveragePct = q ? q.coveragePct : null
          }
          // 53-G10 (P0-3): stamp the floor this plan was computed FOR. The
          // preview overlay is deliberately click-through so the sidebar stays
          // usable, which means the user can switch floors between planning and
          // applying. Same self-describing-payload rule the preview store
          // already follows on the next line.
          setResult({ floorId: activeFloorId, band, proposedAps: named, removeApIds: removeIds, enableApIds: enableIds, enableChannels, panelCoveragePct, stats: r.stats })
          setPreview(activeFloorId, named, removeIds, enableIds, band, enableChannels)
        }
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
        setRunning(false)
      } else if (msg.type === 'error') {
        setError(`執行失敗：${msg.message}`)
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
        setRunning(false)
      }
    }

    worker.onerror = (e) => {
      setError(`Worker 錯誤：${e.message ?? 'unknown'}`)
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
      setRunning(false)
    }

    worker.postMessage({
      type: 'run',
      payload: {
        floor,
        walls,
        aps,
        scopes,
        userOpts: {
          mode,
          band,
          apCount: nClamped,
          targetRssiDbm: rssiClamped,
          targetCoverage: covClamped / 100,
          domainId: regulatoryDomain,
          indoorOnly,
        },
        // 57-34: same cross-floor scenario as the heatmap (image data stripped
        // -- the engine needs geometry only), plus the main thread's
        // regulatory / RF settings (the worker's stores hold defaults).
        floors: useFloorStore.getState().floors.map(({ imageUrl, ...f }) => f),
        apsByFloor: useAPStore.getState().apsByFloor,
        wallsByFloor: useWallStore.getState().wallsByFloor,
        holesByFloor: useFloorHoleStore.getState().floorHolesByFloor,
        env: currentScenarioEnv(),
      },
    })
  }, [floor, walls, aps, scopes, mode, band, targetRssi, targetCoverage, apCount,
      regulatoryDomain, indoorOnly, activeFloorId, clearPreview, setPreview])

  const handleApply = useCallback(() => {
    if (!result) return
    // 53-G10 (P0-3): apply to the floor the plan was COMPUTED for, never to
    // whatever happens to be active now. This used to read activeFloorId, so
    // switching floors with the preview open wrote the whole plan to the wrong
    // floor — verified: a 7-AP plan for floor B landed on floor A (5 -> 12)
    // while B stayed at 5, with coordinates from B's layout and the APs that
    // should have been replaced left in place.
    const targetFloorId = result.floorId
    const floorStillExists = useFloorStore.getState().floors.some((f) => f.id === targetFloorId)
    if (!targetFloorId || !floorStillExists) {
      setError('規劃所屬的樓層已不存在，請重新規劃')
      clearPreview()
      setResult(null)
      return
    }
    const store = useAPStore.getState()
    if (result.removeApIds.length > 0) {
      store.removeAPs(targetFloorId, result.removeApIds)
    }
    // 58-9: kept devices whose planned-band radio was off -- switch it on,
    // 58-15: on the channel the plan assigned it.
    if (result.enableApIds.length > 0) {
      const on = new Set(result.enableApIds)
      const chs = result.enableChannels ?? {}
      const floorAps = useAPStore.getState().apsByFloor[targetFloorId] ?? []
      store.setAPs(targetFloorId, floorAps.map((a) => (on.has(a.id)
        ? { ...a, radios: patchRadio(a, result.band, { enabled: true, ...(chs[a.id] != null ? { channel: chs[a.id] } : {}) }) }
        : a)))
    }
    // 以 apNameBase 連號命名（避開 setAPs 載入不推進 counter 的撞名）；
    // addAP 逐顆進，counter 照常推進。
    const base = apNameBase()
    result.proposedAps.forEach(({ planBand, ...ap }, i) => {
      const name = `AP-${String(base + i + 1).padStart(2, '0')}`
      useAPStore.getState().addAP(targetFloorId, { ...ap, name })
    })
    clearPreview()
    onClose()
  }, [result, clearPreview, onClose])

  const handleCancel = useCallback(() => {
    if (running) {
      // Hard cancel（同 AutoPowerModal）：搜尋是 worker 內同步 microtask 鏈，
      // in-band cancel 送不進去 — 直接 terminate。
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
      setRunning(false)
      setProgress(null)
      setError('已取消')
    } else {
      clearPreview()
      onClose()
    }
  }, [running, clearPreview, onClose])

  const handleReset = useCallback(() => {
    clearPreview()
    setResult(null)
    setProgress(null)
    setError(null)
  }, [clearPreview])

  // 執行中與預覽態不可點背景關閉（預覽態的背板本來就不擋畫布）。
  // hook 必須在 early return 之前呼叫。
  const previewing = !running && !!result

  // 58-7: 預覽期間熱圖暫切到規劃頻段（其他頻段的射頻會蓋掉要補的洞），
  // 套用 / 取消 / 重新設定 / 關閉時還原。
  const previewBand = open && previewing ? result.band : null
  useEffect(() => {
    if (previewBand == null) return undefined
    const { bandFilter: prevBand, lastSingleBand: prevLast, mode: prevMode } = useHeatmapStore.getState()
    // 58-12: the band map takes no single band -- the preview shows RSSI on
    // the plan band, and the band map comes back after.
    if (prevMode === 'band') {
      useHeatmapStore.setState({ mode: 'rssi', bandFilter: String(previewBand) })
      return () => useHeatmapStore.setState({ mode: prevMode, bandFilter: prevBand, lastSingleBand: prevLast })
    }
    useHeatmapStore.getState().setBandFilter(String(previewBand))
    return () => {
      useHeatmapStore.getState().setBandFilter(prevBand)
      useHeatmapStore.setState({ lastSingleBand: prevLast })
    }
  }, [previewBand])
  const dismiss = useOverlayDismiss(running || previewing ? null : onClose)
  // 58-15 (E4): the plan's coverage is direct path only; the heatmap may add
  // reflected / diffracted power.
  const heatmapMultipath = useHeatmapStore((s) => s.reflections || s.diffraction)

  if (!open) return null

  const stats = result?.stats
  // Applying would change nothing.
  const noChange = !!result && stats.placedCount === 0 && result.removeApIds.length === 0 && result.enableApIds.length === 0

  return createPortal((
    <div
      className={`auto-place-modal-overlay${previewing ? ' auto-place-modal-overlay--preview' : ''}`}
      {...dismiss}
    >
      <div className="auto-place-modal">
        <div className="auto-place-modal__header">
          <span className="auto-place-modal__title">自動規劃 AP 放置</span>
          <span className="auto-place-modal__sub">
            {BAND_OPTIONS.find((b) => b.value === band)?.label}
          </span>
        </div>

        {/* 進度條：fields 階段 determinate（候選場計算佔絕大多數時間） */}
        {running && (
          <div className="auto-place-modal__progressbar">
            <div
              className="auto-place-modal__progressbar-fill"
              style={{ width: `${Math.round((progress?.phase === 'fields' ? (progress?.pct ?? 0) : 1) * 100)}%` }}
            />
          </div>
        )}

        {/* 設定 */}
        {!running && !result && (
          <>
            <section className="auto-place-modal__section">
              <p className="auto-place-modal__label">模式</p>
              <div className="auto-place-modal__mode-group">
                {MODE_OPTIONS.map((m) => (
                  <label key={m.value} className={`auto-place-modal__mode${mode === m.value ? ' auto-place-modal__mode--active' : ''}`}>
                    <input
                      type="radio"
                      name="auto-place-mode"
                      checked={mode === m.value}
                      onChange={() => setMode(m.value)}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
              <p className="auto-place-modal__hint">
                {MODE_OPTIONS.find((m) => m.value === mode)?.hint}
              </p>
            </section>

            <section className="auto-place-modal__section">
              <p className="auto-place-modal__label">頻段</p>
              <div className="auto-place-modal__row">
                <select
                  className="auto-place-modal__input auto-place-modal__input--select"
                  value={band}
                  onChange={(e) => setBand(parseFloat(e.target.value))}
                >
                  {bandOptions.map((b) => (
                    <option key={b.value} value={b.value}>{b.label}</option>
                  ))}
                </select>
                <span className="auto-place-modal__unit">
                  本層現有 {sameBandCount} 顆此頻段 AP
                  {offBandCount > 0 && `（另 ${offBandCount} 顆此頻段已關閉）`}
                </span>
              </div>
              <p className="auto-place-modal__hint">
                業界慣例以 5 GHz 做覆蓋設計（5 GHz 達標則 2.4 GHz 必達標）。設計功率採該頻段預設值。
              </p>
              {band === 2.4 && (
                <p className="auto-place-modal__hint auto-place-modal__hint--warn">
                  以 2.4 GHz 規劃會放得較稀，5 GHz 覆蓋可能不足
                </p>
              )}
              {notAllowedCount > 0 && (
                <p className="auto-place-modal__hint auto-place-modal__hint--warn">
                  其中 {notAllowedCount} 顆的此頻段頻道在此國家不可用，不計入覆蓋。建議先在設備規劃按「自動頻道」改到合法頻道，再執行規劃
                </p>
              )}
            </section>

            <section className="auto-place-modal__section">
              <p className="auto-place-modal__label">目標 RSSI</p>
              <div className="auto-place-modal__row">
                <input
                  type="number"
                  className="auto-place-modal__input"
                  step="1"
                  min="-90"
                  max="-30"
                  value={targetRssi}
                  onChange={(e) => setTargetRssi(e.target.value)}
                />
                <span className="auto-place-modal__unit">dBm</span>
              </div>
            </section>

            {mode !== 'fixed' && (
              <section className="auto-place-modal__section">
                <p className="auto-place-modal__label">目標覆蓋率</p>
                <div className="auto-place-modal__row">
                  <input
                    type="number"
                    className="auto-place-modal__input"
                    step="1"
                    min="50"
                    max="100"
                    value={targetCoverage}
                    onChange={(e) => setTargetCoverage(e.target.value)}
                  />
                  <span className="auto-place-modal__unit">% 的規劃範圍</span>
                </div>
              </section>
            )}

            {mode === 'fixed' && (
              <section className="auto-place-modal__section">
                <p className="auto-place-modal__label">AP 數量</p>
                <div className="auto-place-modal__row">
                  <input
                    type="number"
                    className="auto-place-modal__input"
                    step="1"
                    min="1"
                    max="200"
                    value={apCount}
                    onChange={(e) => setApCount(e.target.value)}
                  />
                  <span className="auto-place-modal__unit">顆</span>
                </div>
              </section>
            )}

            <section className="auto-place-modal__section">
              <label className="auto-place-modal__check">
                <input
                  type="checkbox"
                  checked={indoorOnly}
                  onChange={(e) => setIndoorOnly(e.target.checked)}
                />
                僅室內放置
              </label>
              <p className="auto-place-modal__hint">
                自動辨識牆圍出的建築範圍，AP 只放室內，覆蓋率也只計算室內區域。
                開放式廠房或牆面不完整的圖面若辨識失敗，會自動退回全範圍規劃並提示。
              </p>
            </section>

            <section className="auto-place-modal__section">
              <p className="auto-place-modal__hint">
                完成後先以半透明 ghost 顯示建議位置、熱圖同步預覽效果，確認「套用」才會真正建立 AP。<br/>
                頻道會依國家頻段自動指派；建議套用後再跑「自動功率規劃」微調功率。
              </p>
            </section>
          </>
        )}

        {/* 執行中 */}
        {running && (
          <section className="auto-place-modal__section">
            <p className="auto-place-modal__label">
              {progress?.phase === 'fields' && `計算候選點覆蓋場… ${Math.round((progress?.pct ?? 0) * 100)}%`}
              {progress?.phase === 'greedy' && `放置中… 已放 ${progress?.placed ?? 0} 顆`}
              {progress?.phase === 'refine' && '微調位置…'}
              {!progress && '準備中…'}
            </p>
            {progress?.coverage != null && (
              <div className="auto-place-modal__progress">
                <div className="auto-place-modal__progress-row">
                  <span>目前覆蓋率（≥ {targetRssi} dBm）</span>
                  <span>{fmtPct(progress.coverage)}</span>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 預覽（docked 小卡） */}
        {previewing && (
          <section className="auto-place-modal__section">
            <p className="auto-place-modal__hint">預覽熱圖：{result.band} GHz</p>
            <div className="auto-place-modal__progress">
              <div className="auto-place-modal__progress-row auto-place-modal__progress-row--score">
                <span>建議新增</span>
                <span><strong>{stats.placedCount}</strong> 顆 AP</span>
              </div>
              {stats.keptCount > 0 && (
                <div className="auto-place-modal__progress-row">
                  <span>位置不變、原地保留</span>
                  <span>{stats.keptCount} 顆</span>
                </div>
              )}
              {stats.enabledCount > 0 && (
                <div className="auto-place-modal__progress-row">
                  <span>其中重新開啟此頻段射頻</span>
                  <span>{stats.enabledCount} 顆</span>
                </div>
              )}
              <div className="auto-place-modal__progress-row">
                <span>預估{stats.indoorApplied ? '室內' : ''}覆蓋率（≥ {targetRssi} dBm）</span>
                <span>
                  {stats.coverageBefore > 0
                    ? `${fmtPct(stats.coverageBefore)} → ${fmtPct(stats.coverageAfter)}`
                    : fmtPct(stats.coverageAfter)}
                </span>
              </div>
              {result.panelCoveragePct != null && (
                <div className="auto-place-modal__progress-row">
                  <span>規劃面板口徑（≥ {COVERAGE_THRESHOLD_DBM} dBm，含室外邊緣）</span>
                  <span>{`${result.panelCoveragePct.toFixed(1)}%`}</span>
                </div>
              )}
              {/* 58-15 (decision 5): the re-plan's effect on the other bands
                  (whole devices removed / added), on the headline's basis. */}
              {stats.otherBands?.map((ob) => {
                // Warn on a drop of the displayed (rounded) value only.
                const before = fmtPct(ob.coverageBefore)
                const after = fmtPct(ob.coverageAfter)
                const dropped = before !== '—' && after !== '—' && parseFloat(after) < parseFloat(before)
                return (
                  <div key={ob.band} className={`auto-place-modal__progress-row${dropped ? ' auto-place-modal__progress-row--warn' : ''}`}>
                    <span>{ob.band} GHz 預估{stats.indoorApplied ? '室內' : ''}覆蓋率（≥ {targetRssi} dBm）</span>
                    <span>{`${before} → ${after}`}</span>
                  </div>
                )
              })}
              {result.removeApIds.length > 0 && (
                <div className="auto-place-modal__progress-row auto-place-modal__progress-row--warn">
                  <span>
                    {stats.removedOffCount > 0
                      ? `套用將移除現有同頻段 AP（整台，含其他頻段；其中 ${stats.removedOffCount} 顆此頻段已關閉）`
                      : '套用將移除現有同頻段 AP（整台，含其他頻段）'}
                  </span>
                  <span>{result.removeApIds.length} 顆</span>
                </div>
              )}
              {/* 58-15 (D3): the walls are blamed only when they leak. */}
              {stats.indoorFallback && (
                <div className="auto-place-modal__progress-row auto-place-modal__progress-row--warn">
                  <span>無法辨識室內範圍，已改用全範圍規劃</span>
                  <span>
                    {stats.indoorFallbackReason === 'leaky' ? '檢查牆是否封閉'
                      : stats.indoorFallbackReason === 'no-walls' ? '圖面沒有牆'
                      : '覆蓋率含室外區域'}
                  </span>
                </div>
              )}
              {/* 58-15 (D2): fixed mode stopped before the requested count. */}
              {stats.targetMet === null && stats.stopReason === 'exhausted' && (
                <div className="auto-place-modal__progress-row auto-place-modal__progress-row--warn">
                  <span>只放 {stats.placedCount + stats.keptCount} 顆：已無位置能再提升覆蓋</span>
                  <span>目標 {apCount} 顆</span>
                </div>
              )}
              {stats.targetMet === false && (
                <div className="auto-place-modal__progress-row auto-place-modal__progress-row--warn">
                  <span>未達目標覆蓋率 {targetCoverage}%</span>
                  <span>
                    {stats.stopReason === 'exhausted' ? '已無可改善位置'
                      : stats.stopReason === 'max-aps' ? `已達上限 ${stats.placedCount} 顆`
                      : stats.stopReason === 'channel' ? '實際頻道下覆蓋略降'
                      : '—'}
                  </span>
                </div>
              )}
            </div>
            {/* 58-15 (decision 4): nothing to add, but weak devices -- the
                "already optimal" sentence would contradict the list below. */}
            {noChange && stats.weakAps?.length > 0 && (
              <p className="auto-place-modal__hint">
                不新增 AP；可考慮調高下列 AP 的功率
                {stats.indoorApplied && '。覆蓋率僅計算牆圍出的室內區域。'}
              </p>
            )}
            {/* 58-15 (F): fill -- existing devices whose low TX left the hole. */}
            {stats.weakAps?.length > 0 && (
              <p className="auto-place-modal__hint auto-place-modal__hint--warn">
                {stats.weakAps.slice(0, 3).map((a) => `${a.name}${stats.weakAps.length === 1 ? ' 功率偏低' : ''}（${a.txDbm} dBm）`).join('、')}
                {stats.weakAps.length > 3 && `…等 ${stats.weakAps.length} 台`}
                {stats.weakAps.length > 1 && '功率偏低'}
                ，調高可能比新增更好
              </p>
            )}
            {heatmapMultipath && (
              <p className="auto-place-modal__hint">
                預估覆蓋率只計算直射路徑；熱圖開啟反射 / 繞射，覆蓋看起來可能略好。
              </p>
            )}
            {/* 58-15 (D4): a large floor's sampling steps were widened. */}
            {stats.gridCoarsened && (
              <p className="auto-place-modal__hint">
                場地較大，已放寬取樣間距至 {stats.gridStepM} m
              </p>
            )}
            {/* Short of the target with nothing to change: no "optimal" claim
                next to the warning above. */}
            {noChange ? (stats.weakAps?.length > 0 ? null : (
              <p className="auto-place-modal__hint">
                {stats.targetMet === false
                  ? '沒有可再提升覆蓋的位置 —— 套用不會有任何變更。'
                  : '現有配置已是本次規劃的最佳解，沒有需要調整的地方 —— 套用不會有任何變更。'}
                {stats.indoorApplied && ' 覆蓋率僅計算牆圍出的室內區域。'}
              </p>
            )) : (
              <p className="auto-place-modal__hint">
                畫布上的半透明「+」標記為建議位置
                {result.removeApIds.length > 0 && '、紅色「✕」為套用時將移除的 AP'}
                ，熱圖已顯示套用後的預估效果。可拖曳畫布檢視。
                {stats.indoorApplied && ' 覆蓋率僅計算牆圍出的室內區域。'}
              </p>
            )}
          </section>
        )}

        {error && (
          <section className="auto-place-modal__section">
            <p className="auto-place-modal__error">{error}</p>
          </section>
        )}

        {/* 按鈕 */}
        <div className="auto-place-modal__actions">
          <button
            className="auto-place-modal__btn auto-place-modal__btn--cancel"
            onClick={handleCancel}
          >
            {running ? '中止' : previewing ? '取消' : '關閉'}
          </button>
          {!running && !result && (
            <button
              className="auto-place-modal__btn auto-place-modal__btn--primary"
              onClick={handleRun}
            >
              開始規劃
            </button>
          )}
          {previewing && (
            <>
              <button
                className="auto-place-modal__btn auto-place-modal__btn--cancel"
                onClick={handleReset}
                title="改設定後重新規劃"
              >
                ← 重新設定
              </button>
              <button
                className="auto-place-modal__btn auto-place-modal__btn--primary"
                onClick={handleApply}
                disabled={stats.placedCount === 0 && result.removeApIds.length === 0 && result.enableApIds.length === 0}
                title={stats.placedCount === 0 && result.removeApIds.length === 0 && result.enableApIds.length === 0
                  ? '沒有需要變更的項目' : undefined}
              >
                套用
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  ), document.body)
}

export default AutoPlaceModal
