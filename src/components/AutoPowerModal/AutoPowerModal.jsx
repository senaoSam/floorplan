import React, { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useEditorStore } from '@/store/useEditorStore'
import { getDefaultTxPower } from '@/constants/apModels'
import { apRadios, enabledRadios, radioKey, applyRadioResults, deviceIdOf, radioAllowed } from '@/utils/apRadios'
import { currentScenarioEnv } from '@/features/heatmap/buildScenario'
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss'
import './AutoPowerModal.sass'

// HM-F9: run the greedy plan in a Web Worker so the main thread stays
// responsive (modal progress / cancel / overall UI) while the search churns.
// Vite resolves `?worker` imports to a Worker constructor.
import AutoPowerWorker from '@/workers/autoPowerPlan.worker.js?worker'

// 53-G9: one frozen empty array for the `?? EMPTY` selectors below. A bare
// `?? []` returns a new reference whenever the floor's key is absent, so
// zustand saw a changed slice on EVERY store write and re-rendered.
const EMPTY = Object.freeze([])

// HM-F4 — Auto power plan modal.
// Lets the user pick a target RSSI / scope, runs greedy multi-start search,
// previews resulting txPower per AP radio, then commits via one setAPs.
//
// Props:
//   open         - boolean
//   apIds        - AP id 子集；空陣列代表「整層」
//   onClose      - 取消或完成關閉

// mm:ss formatter for elapsed / ETA display.
function formatMs(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return '--:--'
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Convert a [0, 1] cost to a 0–100 quality score for human display.
const qualityScore = (cost) =>
  cost == null || !isFinite(cost) ? null : Math.max(0, Math.min(100, Math.round(100 * (1 - cost))))

// Format a [0, 1] loss term as a percentage string.
const fmtPct = (x) => x == null || !isFinite(x) ? '—' : `${(x * 100).toFixed(1)}%`

// 起點顯示名稱（演算法內部 key 是英文）。
const START_KIND_LABELS = { max: '高功率', mid: '中功率', min: '低功率' }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// 58-15 (D1): the TX at or below which a radio's planned value means "off" --
// per radio (a radio whose legal max is <= the TX floor stays on at it).
const offTxOf = (opts, key) => opts?.offTxByRadio?.get(key) ?? opts?.txMinDbm ?? 0

// 58-15 (decision 6): whether radio `r` of `ap` is on once the plan is
// applied -- a planned radio above its off level is on (a disabled one is
// switched back on), at or below it off; an unplanned radio keeps its state
// (58-15 C5: one the domain does not allow does not transmit).
function onAfterPlan(result, ap, r, domainId) {
  const key = radioKey(ap.id, r.band)
  const next = result.txMap.get(key)
  return next == null ? r.enabled && radioAllowed(domainId, r.band, r.channel, r.channelWidth) : next > offTxOf(result.opts, key)
}

function AutoPowerModal({ open, apIds, onClose }) {
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const regulatoryDomain = useEditorStore((s) => s.regulatoryDomain)
  const floors = useFloorStore((s) => s.floors)
  const floor = floors.find((f) => f.id === activeFloorId)
  const walls = useWallStore((s) => s.wallsByFloor[activeFloorId] ?? EMPTY)
  const aps = useAPStore((s) => s.apsByFloor[activeFloorId] ?? EMPTY)
  const scopes = useScopeStore((s) => s.scopesByFloor[activeFloorId] ?? EMPTY)
  const setAPs = useAPStore((s) => s.setAPs)

  const [targetRssi, setTargetRssi] = useState(-65)
  const [targetSinr, setTargetSinr] = useState(20)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null)
  // 58-14: shown fill of the overall bar -- null until the first finite
  // estimate (indeterminate until then), then only ever grows within a run.
  const [fillPct, setFillPct] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  // Active worker instance — null when idle. Held in a ref so cancel/cleanup
  // can terminate it without bouncing through state.
  const workerRef = useRef(null)

  const targetIds = apIds && apIds.length > 0 ? apIds : aps.map((a) => a.id)
  const targetAPs = aps.filter((a) => targetIds.includes(a.id))

  // Tear the worker down if the modal unmounts mid-run, otherwise the search
  // would silently keep churning + post messages to a dead component.
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [])

  // 每次開啟都從乾淨的設定頁開始。元件關閉時不 unmount（open=false 只是
  // return null），舊 result 會殘留 — 換樓層/換選取後重開，舊 txMap 對不上
  // 新 AP id，結果列會渲染出 undefined/NaN。
  useEffect(() => {
    if (open) {
      setResult(null)
      setProgress(null)
      setError(null)
    }
  }, [open])

  const handleRun = useCallback(() => {
    if (!floor || !floor.scale) {
      setError('當前樓層未設定比例尺，無法執行自動規劃')
      return
    }
    if (targetIds.length === 0) {
      setError('沒有可規劃的 AP')
      return
    }
    // 輸入驗證：欄位清空時 parseFloat('') = NaN，帶著 NaN 目標跑出來的分數
    // 全是垃圾。開跑前 parse + clamp 回合法區間，並把正規化後的值寫回 state
    // （進度/結果標籤讀 state 顯示）。
    const rssiVal = parseFloat(targetRssi)
    const sinrVal = parseFloat(targetSinr)
    if (!isFinite(rssiVal) || !isFinite(sinrVal)) {
      setError('請輸入有效的目標 RSSI / SINR 數值')
      return
    }
    const rssiClamped = Math.round(clamp(rssiVal, -90, -30))
    const sinrClamped = Math.round(clamp(sinrVal, 0, 40))
    setTargetRssi(rssiClamped)
    setTargetSinr(sinrClamped)
    setRunning(true)
    setError(null)
    setResult(null)
    setProgress(null)
    setFillPct(null)

    // Spin up a fresh worker per run so a previously-terminated worker can't
    // leak state into this one.
    const worker = new AutoPowerWorker()
    workerRef.current = worker

    worker.onmessage = (e) => {
      const msg = e.data
      if (!msg || !msg.type) return
      if (msg.type === 'progress') {
        setProgress(msg.state)
        const elapsed = msg.state?.elapsedMs
        const eta = msg.state?.etaMs
        if (eta != null) {
          const pct = (elapsed / (elapsed + eta)) * 100
          if (isFinite(pct)) {
            const p = Math.max(0, Math.min(100, pct))
            setFillPct((prev) => (prev == null ? p : Math.max(prev, p)))
          }
        }
      } else if (msg.type === 'done') {
        const r = msg.result
        if (r.aborted) {
          setError('已取消')
        } else if (r.error === 'not-allowed') {
          // 58-15 (C5): every radio to plan is one the domain does not allow.
          const names = (r.opts?.notAllowedRadios ?? []).map((x) => `${x.name} · ${x.band} GHz`)
          setError(`選取的 AP 射頻在此國家皆不可用，未規劃：${names.slice(0, 5).join('、')}${names.length > 5 ? `…等 ${names.length} 個` : ''}`)
        } else if (r.error) {
          setError(`錯誤：${r.error}`)
        } else {
          // Rehydrate Map from entries; keep the rest of the result as-is.
          setResult({
            aborted: r.aborted,
            txMap: r.txMapEntries ? new Map(r.txMapEntries) : null,
            scoresByBand: r.scoresByBand,   // 58: per band
            opts: r.opts,
          })
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
        apIdsToPlan: targetIds,
        userOpts: { targetRssiDbm: rssiClamped, targetSinrDb: sinrClamped },
        // 57-34: the worker's stores only hold defaults.
        env: currentScenarioEnv(),
        // 58-15: same cross-floor scenario as the heatmap (image data
        // stripped -- the engine needs geometry only).
        floors: useFloorStore.getState().floors.map(({ imageUrl, ...f }) => f),
        apsByFloor: useAPStore.getState().apsByFloor,
        wallsByFloor: useWallStore.getState().wallsByFloor,
        holesByFloor: useFloorHoleStore.getState().floorHolesByFloor,
      },
    })
  }, [floor, walls, aps, scopes, targetIds, targetRssi, targetSinr])

  const handleApply = useCallback(() => {
    if (!result || !result.txMap) return
    // 58: txMap is keyed per radio -- write the devices' radios back in one
    // store write (only target devices are in txMap's planned keys).
    const targetIds = new Set(targetAPs.map((a) => a.id))
    const floorAps = useAPStore.getState().apsByFloor[activeFloorId] ?? []
    // 58: a radio the search drove to the TX floor is switched off rather than
    // left radiating at it (planning tools disable surplus radios the same way).
    // 58-15 (D1): the floor is per radio -- resolved here (null = off).
    // 58-15 (decision 6): a disabled radio planned on is switched back on; one
    // that stays off is left untouched (keeps its stored TX).
    const wasOff = new Set(floorAps.flatMap((ap) => apRadios(ap)
      .filter((r) => !r.enabled).map((r) => radioKey(ap.id, r.band))))
    const planned = new Map([...result.txMap].filter(([k]) => targetIds.has(deviceIdOf(k)))
      .map(([k, tx]) => [k, tx <= offTxOf(result.opts, k) ? null : tx])
      .filter(([k, tx]) => !(tx == null && wasOff.has(k))))
    setAPs(activeFloorId, applyRadioResults(floorAps, planned,
      (tx) => (tx == null ? { enabled: false } : { enabled: true, txPower: tx })))
    onClose()
  }, [result, targetAPs, setAPs, activeFloorId, onClose])

  const handleCancel = useCallback(() => {
    if (running) {
      // Hard cancel: terminate the worker outright. In-band 'cancel' messages
      // don't work — the greedy loop is one synchronous microtask chain, so
      // the worker's event loop can't deliver any message until the run ends.
      // Terminate is instant and the worker is per-run disposable anyway.
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
      setRunning(false)
      setProgress(null)
      setError('已取消')
    } else {
      onClose()
    }
  }, [running, onClose])

  // 回設定頁：清掉 result / progress / error，露出 targetRssi 輸入。
  const handleReset = useCallback(() => {
    setResult(null)
    setProgress(null)
    setError(null)
  }, [])

  const dismiss = useOverlayDismiss(running ? null : onClose)

  if (!open) return null

  // Render to body：避開 PanelRight 祖先 transform 對 position:fixed 的影響。
  return createPortal((
    <div className="auto-power-modal-overlay" {...dismiss}>
      <div className="auto-power-modal">
        <div className="auto-power-modal__header">
          <span className="auto-power-modal__title">自動功率規劃</span>
          <span className="auto-power-modal__sub">
            {targetIds.length} 顆 AP{apIds && apIds.length > 0 ? '（已選取）' : '（整層）'}
          </span>
        </div>

        {/* 整體進度條：執行中才顯示。
            起點 1 期間 etaMs=null → indeterminate（左右掃）動畫；
            起點 2 起 etaMs 有值 → 變成依時間百分比的填充。
            58-14: elapsedMs / etaMs 是整次規劃（所有頻段）的值，換頻段不重來；
            填充只增不減（fillPct 取最大值），算不出有限值前維持 indeterminate。 */}
        {running && (() => {
          const isCalibrating = fillPct == null
          const pct = fillPct
          return (
            <div className={`auto-power-modal__progressbar${isCalibrating ? ' auto-power-modal__progressbar--indeterminate' : ''}`}>
              <div
                className="auto-power-modal__progressbar-fill"
                style={isCalibrating ? undefined : { width: `${pct}%` }}
              />
            </div>
          )
        })()}

        {/* 設定區 */}
        {!running && !result && (
          <>
            <section className="auto-power-modal__section">
              <p className="auto-power-modal__label">目標 RSSI</p>
              <div className="auto-power-modal__row">
                <input
                  type="number"
                  className="auto-power-modal__input"
                  step="1"
                  min="-90"
                  max="-30"
                  value={targetRssi}
                  onChange={(e) => setTargetRssi(e.target.value)}
                />
                <span className="auto-power-modal__unit">dBm</span>
              </div>
              <p className="auto-power-modal__hint">
                覆蓋強度門檻：cell RSSI ≥ 此值算「已覆蓋」。-65 dBm 一般辦公、-70 dBm 大空間、-60 dBm VoIP/視訊。
              </p>
            </section>

            <section className="auto-power-modal__section">
              <p className="auto-power-modal__label">目標 SINR</p>
              <div className="auto-power-modal__row">
                <input
                  type="number"
                  className="auto-power-modal__input"
                  step="1"
                  min="0"
                  max="40"
                  value={targetSinr}
                  onChange={(e) => setTargetSinr(e.target.value)}
                />
                <span className="auto-power-modal__unit">dB</span>
              </div>
              <p className="auto-power-modal__hint">
                訊號品質門檻：已覆蓋 cell 中 SINR &lt; 此值算「能收到但會卡」。20 dB 對應 5G 80MHz MCS-7；25 dB 為高速 MCS-9。
              </p>
            </section>

            <section className="auto-power-modal__section">
              <p className="auto-power-modal__hint">
                系統會反覆微調每台 AP 的功率，在「涵蓋足夠」與「不過度重疊」之間取得平衡。<br/>
                規劃品質分數綜合評估涵蓋率、死角、訊號品質與功率過量。<br/>
                一般樓層數秒內完成；樓層大、AP 數量多時可能需要數分鐘。
              </p>
            </section>
          </>
        )}

        {/* 執行中 */}
        {running && (
          <section className="auto-power-modal__section">
            <p className="auto-power-modal__label">規劃中…</p>
            {progress && (
              <div className="auto-power-modal__progress">
                {/* 58: bands are planned one after another. */}
                {progress.band != null && (
                  <div className="auto-power-modal__progress-row">
                    <span>頻段</span>
                    <span>{progress.band} GHz（{(progress.bandIdx ?? 0) + 1} / {progress.totalBands ?? 1}）</span>
                  </div>
                )}
                <div className="auto-power-modal__progress-row">
                  <span>起點</span>
                  <span>{(progress.startIdx ?? 0) + 1} / {progress.totalStarts ?? 3}（{START_KIND_LABELS[progress.startKind] ?? progress.startKind}）</span>
                </div>
                <div className="auto-power-modal__progress-row">
                  <span>迭代</span>
                  <span>{progress.iter}</span>
                </div>
                <div className="auto-power-modal__progress-row">
                  <span>已用 / 預計剩餘</span>
                  <span>
                    {formatMs(progress.elapsedMs)} / {progress.etaMs == null ? '校準中…' : `~${formatMs(progress.etaMs)}`}
                  </span>
                </div>
                <div className="auto-power-modal__progress-row">
                  <span>規劃品質</span>
                  <span>{qualityScore(progress.cost) ?? '—'} / 100</span>
                </div>
                <div className="auto-power-modal__progress-row">
                  <span>覆蓋率（≥ {targetRssi} dBm）</span>
                  <span>{fmtPct(progress.coverage)}</span>
                </div>
                {progress.terms && (
                  <>
                    <div className="auto-power-modal__progress-row">
                      <span>死角嚴重度（P95 RSSI 缺）</span>
                      <span>{fmtPct(progress.terms.L_outlier)}</span>
                    </div>
                    <div className="auto-power-modal__progress-row">
                      <span>已覆蓋區品質缺口</span>
                      <span>{fmtPct(progress.terms.L_quality)}</span>
                    </div>
                    <div className="auto-power-modal__progress-row">
                      <span>過量發射</span>
                      <span>{fmtPct(progress.terms.L_excess)}</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {/* 結果預覽 */}
        {result && result.txMap && (
          <section className="auto-power-modal__section">
            <p className="auto-power-modal__label">規劃結果（目標 RSSI {targetRssi} dBm / SINR {targetSinr} dB）</p>
            {/* 58: one block per band -- each band is planned on its own. */}
            {Object.entries(result.scoresByBand ?? {}).sort(([a], [b]) => Number(a) - Number(b)).map(([band, score]) => (
              <div key={band} className="auto-power-modal__progress" style={{ marginTop: 8 }}>
                <div className="auto-power-modal__progress-row auto-power-modal__progress-row--score">
                  <span>{band} GHz 規劃品質</span>
                  <span>
                    <strong>{qualityScore(score.cost) ?? '—'}</strong> / 100
                  </span>
                </div>
                <div className="auto-power-modal__progress-row">
                  <span>覆蓋率（≥ {targetRssi} dBm）</span>
                  <span>{fmtPct(score.coverage)}</span>
                </div>
                {score.terms && (
                  <>
                    <div className="auto-power-modal__progress-row">
                      <span>死角嚴重度（P95 RSSI 缺）</span>
                      <span>{fmtPct(score.terms.L_outlier)}</span>
                    </div>
                    <div className="auto-power-modal__progress-row">
                      <span>已覆蓋區品質缺口</span>
                      <span>{fmtPct(score.terms.L_quality)}</span>
                    </div>
                    <div className="auto-power-modal__progress-row">
                      <span>過量發射</span>
                      <span>{fmtPct(score.terms.L_excess)}</span>
                    </div>
                  </>
                )}
              </div>
            ))}
            <p className="auto-power-modal__label" style={{ marginTop: 12 }}>各 AP 功率變更</p>
            <div className="auto-power-modal__changes">
              {targetAPs.flatMap((ap) => apRadios(ap).map((r) => ({ ap, r, key: radioKey(ap.id, r.band) }))).map(({ ap: a, r, key }) => {
                const next = result.txMap.get(key)
                // 開啟後第一幀可能還帶著上一輪的 result（reset effect 在
                // render 後才跑）— txMap 對不上當前 AP 就跳過該列，避免
                // 渲染出 NaN。
                if (next == null) return null
                // 58-15 (decision 6): a disabled radio -- listed only when the
                // plan switches it back on; one that stays off is unchanged.
                if (!r.enabled) {
                  if (next <= offTxOf(result.opts, key)) return null
                  return (
                    <div key={key} className="auto-power-modal__change-row">
                      <span className="auto-power-modal__ap-name">{a.name ?? a.id} · {r.band} GHz</span>
                      <span className="auto-power-modal__tx-next" style={{ gridColumn: '2 / -1' }}>建議開啟（原本關閉）· {next} dBm</span>
                    </div>
                  )
                }
                // txPower 未設時退回 per-band 預設 — 跟引擎建模值同源，
                // 也避免顯示「undefined dBm」/ delta NaN。
                const cur = r.txPower ?? getDefaultTxPower(r.band)
                const delta = next - cur
                // 58: driven to the TX floor → applied as "radio off".
                const off = next <= offTxOf(result.opts, key)
                return (
                  <div key={key} className="auto-power-modal__change-row">
                    <span className="auto-power-modal__ap-name">{a.name ?? a.id} · {r.band} GHz</span>
                    <span className="auto-power-modal__tx-cur">{cur} dBm</span>
                    <span className="auto-power-modal__tx-arrow">→</span>
                    <span className="auto-power-modal__tx-next">{off ? '建議關閉' : `${next} dBm`}</span>
                    <span className={`auto-power-modal__tx-delta auto-power-modal__tx-delta--${off || delta < 0 ? 'down' : delta > 0 ? 'up' : 'zero'}`}>
                      {off ? '關' : delta > 0 ? `+${delta}` : delta}
                    </span>
                  </div>
                )
              })}
            </div>
            {/* 58-9: devices every radio of which would be switched off --
                one line for all of them, names cut after 10.
                58-15 (decision 6): off after apply counts every radio (a
                disabled one switched back on keeps the device on); a device
                already all off is not listed. */}
            {(() => {
              const names = targetAPs.filter((ap) => enabledRadios(ap).length > 0
                && apRadios(ap).every((r) => !onAfterPlan(result, ap, r, regulatoryDomain))).map((ap) => ap.name ?? ap.id)
              if (names.length === 0) return null
              return (
                <p className="auto-power-modal__hint">
                  {names.length === 1
                    ? `${names[0]} 所有射頻都將關閉，可考慮移除此 AP`
                    : `共 ${names.length} 台所有射頻都將關閉，可考慮移除：${names.slice(0, 10).join('、')}${names.length > 10 ? `…等 ${names.length} 台` : ''}`}
                </p>
              )
            })()}
            {/* Left out of the plan: a band off on every radio of this floor
                stays off; a disabled radio whose channel the regulatory
                domain does not allow cannot come back on. */}
            {(result.opts?.skippedBands ?? []).map((band) => (
              <p key={band} className="auto-power-modal__hint">{band} GHz：整層皆關閉，未規劃</p>
            ))}
            {(() => {
              const list = result.opts?.skippedRadios ?? []
              if (list.length === 0) return null
              const names = list.map((x) => `${x.name} · ${x.band} GHz`)
              return (
                <p className="auto-power-modal__hint">
                  {`${list.length} 個已關閉的射頻頻道不符目前國家頻段，未納入規劃：${names.slice(0, 5).join('、')}${names.length > 5 ? `…等 ${names.length} 個` : ''}`}
                </p>
              )
            })()}
            {/* 58-15 (C5): enabled radios the domain does not allow. */}
            {(() => {
              const list = result.opts?.notAllowedRadios ?? []
              if (list.length === 0) return null
              const names = list.map((x) => `${x.name} · ${x.band} GHz`)
              return (
                <p className="auto-power-modal__hint">
                  {`${list.length} 個射頻此國家不可用，未納入規劃：${names.slice(0, 5).join('、')}${names.length > 5 ? `…等 ${names.length} 個` : ''}`}
                </p>
              )
            })()}
          </section>
        )}

        {error && (
          <section className="auto-power-modal__section">
            <p className="auto-power-modal__error">{error}</p>
          </section>
        )}

        {/* 按鈕 */}
        <div className="auto-power-modal__actions">
          <button
            className="auto-power-modal__btn auto-power-modal__btn--cancel"
            onClick={handleCancel}
          >
            {running ? '中止' : '關閉'}
          </button>
          {!running && !result && (
            <button
              className="auto-power-modal__btn auto-power-modal__btn--primary"
              onClick={handleRun}
            >
              開始規劃
            </button>
          )}
          {!running && result && (
            <>
              <button
                className="auto-power-modal__btn auto-power-modal__btn--cancel"
                onClick={handleReset}
                title="改設定後重新規劃"
              >
                ← 重新設定
              </button>
              <button
                className="auto-power-modal__btn auto-power-modal__btn--primary"
                onClick={handleApply}
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

export default AutoPowerModal
