import React, { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useAutoPlaceStore } from '@/store/useAutoPlaceStore'
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss'
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
//   fresh / fixed — 移除現有「同頻段」AP（其他頻段不動）再新增
//   fill          — 全保留，只新增

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const MODE_OPTIONS = [
  { value: 'fresh', label: '重新規劃', hint: '算出達標所需的最少 AP 數（套用時移除現有同頻段 AP）' },
  { value: 'fixed', label: '固定數量', hint: '用指定顆數把覆蓋做到最好（套用時移除現有同頻段 AP）' },
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

  const sameBandCount = aps.filter((a) => (a.frequency ?? 5) === band).length

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

  // 每次開啟從乾淨設定頁開始（同 AutoPowerModal——關閉不 unmount）。
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
          setResult({ proposedAps: named, removeApIds: removeIds, stats: r.stats })
          setPreview(activeFloorId, named, removeIds)
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
      },
    })
  }, [floor, walls, aps, scopes, mode, band, targetRssi, targetCoverage, apCount,
      regulatoryDomain, indoorOnly, activeFloorId, clearPreview, setPreview])

  const handleApply = useCallback(() => {
    if (!result) return
    const store = useAPStore.getState()
    if (result.removeApIds.length > 0) {
      store.removeAPs(activeFloorId, result.removeApIds)
    }
    // 以 apNameBase 連號命名（避開 setAPs 載入不推進 counter 的撞名）；
    // addAP 逐顆進，counter 照常推進。
    const base = apNameBase()
    result.proposedAps.forEach((ap, i) => {
      const name = `AP-${String(base + i + 1).padStart(2, '0')}`
      useAPStore.getState().addAP(activeFloorId, { ...ap, name })
    })
    clearPreview()
    onClose()
  }, [result, activeFloorId, clearPreview, onClose])

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
  const dismiss = useOverlayDismiss(running || previewing ? null : onClose)

  if (!open) return null

  const stats = result?.stats

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
                  {BAND_OPTIONS.map((b) => (
                    <option key={b.value} value={b.value}>{b.label}</option>
                  ))}
                </select>
                <span className="auto-place-modal__unit">
                  本層現有 {sameBandCount} 顆此頻段 AP
                </span>
              </div>
              <p className="auto-place-modal__hint">
                業界慣例以 5 GHz 做覆蓋設計（5 GHz 達標則 2.4 GHz 必達標）。設計功率採該頻段預設值。
              </p>
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
              <div className="auto-place-modal__progress-row">
                <span>預估覆蓋率（≥ {targetRssi} dBm）</span>
                <span>
                  {result.removeApIds.length === 0 && stats.coverageBefore > 0
                    ? `${fmtPct(stats.coverageBefore)} → ${fmtPct(stats.coverageAfter)}`
                    : fmtPct(stats.coverageAfter)}
                </span>
              </div>
              {result.removeApIds.length > 0 && (
                <div className="auto-place-modal__progress-row auto-place-modal__progress-row--warn">
                  <span>套用將移除現有同頻段 AP</span>
                  <span>{result.removeApIds.length} 顆</span>
                </div>
              )}
              {stats.indoorFallback && (
                <div className="auto-place-modal__progress-row auto-place-modal__progress-row--warn">
                  <span>無法辨識室內範圍，已改用全範圍規劃</span>
                  <span>檢查牆是否封閉</span>
                </div>
              )}
              {stats.targetMet === false && (
                <div className="auto-place-modal__progress-row auto-place-modal__progress-row--warn">
                  <span>未達目標覆蓋率 {targetCoverage}%</span>
                  <span>
                    {stats.stopReason === 'exhausted' ? '已無可改善位置'
                      : stats.stopReason === 'max-aps' ? `已達上限 ${stats.placedCount} 顆`
                      : '—'}
                  </span>
                </div>
              )}
            </div>
            {stats.placedCount === 0 && result.removeApIds.length === 0 ? (
              <p className="auto-place-modal__hint">
                現有配置已是本次規劃的最佳解，沒有需要調整的地方 —— 套用不會有任何變更。
                {stats.indoorApplied && ' 覆蓋率僅計算牆圍出的室內區域。'}
              </p>
            ) : (
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
                disabled={stats.placedCount === 0 && result.removeApIds.length === 0}
                title={stats.placedCount === 0 && result.removeApIds.length === 0
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
