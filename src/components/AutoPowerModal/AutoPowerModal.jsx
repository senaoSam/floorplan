import React, { useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { runAutoPowerPlan } from '@/utils/autoPowerPlan'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import './AutoPowerModal.sass'

// HM-F4 — Auto power plan modal.
// Lets the user pick a target RSSI / scope, runs greedy multi-start search,
// previews resulting txPower per AP, then commits via updateAPs.
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
function AutoPowerModal({ open, apIds, onClose }) {
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floors = useFloorStore((s) => s.floors)
  const floor = floors.find((f) => f.id === activeFloorId)
  const walls = useWallStore((s) => s.wallsByFloor[activeFloorId] ?? [])
  const aps = useAPStore((s) => s.apsByFloor[activeFloorId] ?? [])
  const scopes = useScopeStore((s) => s.scopesByFloor[activeFloorId] ?? [])
  const updateAPs = useAPStore((s) => s.updateAPs)

  const [targetRssi, setTargetRssi] = useState(-65)
  const [targetSinr, setTargetSinr] = useState(20)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const abortRef = useRef(false)

  const targetIds = apIds && apIds.length > 0 ? apIds : aps.map((a) => a.id)
  const targetAPs = aps.filter((a) => targetIds.includes(a.id))

  const handleRun = useCallback(async () => {
    if (!floor || !floor.scale) {
      setError('當前樓層未設定比例尺，無法執行自動規劃')
      return
    }
    if (targetIds.length === 0) {
      setError('沒有可規劃的 AP')
      return
    }
    setRunning(true)
    setError(null)
    setResult(null)
    setProgress(null)
    abortRef.current = false

    try {
      const r = await runAutoPowerPlan({
        floor,
        walls,
        aps,
        scopes,
        apIdsToPlan: targetIds,
        userOpts: { targetRssiDbm: targetRssi, targetSinrDb: targetSinr },
        onProgress: async (st) => {
          setProgress(st)
          // 讓出 main thread 給 React 重繪 + 響應 cancel。
          await new Promise((res) => setTimeout(res, 0))
          return !abortRef.current
        },
      })
      if (r.aborted) {
        setError('已取消')
      } else if (r.error) {
        setError(`錯誤：${r.error}`)
      } else {
        setResult(r)
      }
    } catch (e) {
      setError(`執行失敗：${e.message}`)
    } finally {
      setRunning(false)
    }
  }, [floor, walls, aps, scopes, targetIds, targetRssi, targetSinr])

  const handleApply = useCallback(() => {
    if (!result || !result.txMap) return
    // 依新 tx 值分桶，逐桶 batch update（updateAPs 一次只能套同一 patch）。
    const buckets = new Map()  // tx → ids[]
    targetAPs.forEach((a) => {
      const tx = result.txMap.get(a.id)
      if (tx == null) return
      if (!buckets.has(tx)) buckets.set(tx, [])
      buckets.get(tx).push(a.id)
    })
    buckets.forEach((ids, tx) => {
      updateAPs(activeFloorId, ids, { txPower: tx })
    })
    onClose()
  }, [result, targetAPs, updateAPs, activeFloorId, onClose])

  const handleCancel = useCallback(() => {
    if (running) {
      abortRef.current = true
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

  if (!open) return null

  // Render to body：避開 PanelRight 祖先 transform 對 position:fixed 的影響。
  return createPortal((
    <div className="auto-power-modal-overlay" onClick={running ? undefined : onClose}>
      <div className="auto-power-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auto-power-modal__header">
          <span className="auto-power-modal__title">自動功率規劃</span>
          <span className="auto-power-modal__sub">
            {targetIds.length} 顆 AP{apIds && apIds.length > 0 ? '（已選取）' : '（整層）'}
          </span>
        </div>

        {/* 整體進度條：執行中才顯示。
            起點 1 期間 etaMs=null → indeterminate（左右掃）動畫；
            起點 2 起 etaMs 有值 → 變成依時間百分比的填充。 */}
        {running && (() => {
          const elapsed = progress?.elapsedMs ?? 0
          const eta = progress?.etaMs
          const isCalibrating = eta == null
          const pct = isCalibrating
            ? 0
            : Math.max(0, Math.min(100, (elapsed / (elapsed + eta)) * 100))
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
                  onChange={(e) => setTargetRssi(parseFloat(e.target.value))}
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
                  onChange={(e) => setTargetSinr(parseFloat(e.target.value))}
                />
                <span className="auto-power-modal__unit">dB</span>
              </div>
              <p className="auto-power-modal__hint">
                訊號品質門檻：已覆蓋 cell 中 SINR &lt; 此值算「能收到但會卡」。20 dB 對應 5G 80MHz MCS-7；25 dB 為高速 MCS-9。
              </p>
            </section>

            <section className="auto-power-modal__section">
              <p className="auto-power-modal__hint">
                演算法：3 起點（max / mid / min txPower）greedy ±1 dB 局部搜尋。
                cost = (1 − coverage) + 0.2 × sinrShortfall（粗 grid 2 m）。預估 30 秒~2 分鐘。
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
                <div className="auto-power-modal__progress-row">
                  <span>起點</span>
                  <span>{(progress.startIdx ?? 0) + 1} / {progress.totalStarts ?? 3}（{progress.startKind}）</span>
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
                  <span>覆蓋率（≥ {targetRssi} dBm）</span>
                  <span>{(progress.coverage * 100).toFixed(1)}%</span>
                </div>
                <div className="auto-power-modal__progress-row">
                  <span>SINR 不足比例（&lt; {targetSinr} dB）</span>
                  <span>{(progress.sinrShortfall * 100).toFixed(1)}%</span>
                </div>
                <div className="auto-power-modal__progress-row">
                  <span>cost</span>
                  <span>{progress.cost.toFixed(4)}</span>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 結果預覽 */}
        {result && result.txMap && (
          <section className="auto-power-modal__section">
            <p className="auto-power-modal__label">規劃結果（目標 RSSI {targetRssi} dBm / SINR {targetSinr} dB）</p>
            <div className="auto-power-modal__progress">
              <div className="auto-power-modal__progress-row">
                <span>覆蓋率（≥ {targetRssi} dBm）</span>
                <span>{(result.score.coverage * 100).toFixed(1)}%</span>
              </div>
              <div className="auto-power-modal__progress-row">
                <span>SINR 不足比例（&lt; {targetSinr} dB）</span>
                <span>{(result.score.sinrShortfall * 100).toFixed(1)}%</span>
              </div>
              <div className="auto-power-modal__progress-row">
                <span>cost</span>
                <span>{result.score.cost.toFixed(4)}</span>
              </div>
            </div>
            <p className="auto-power-modal__label" style={{ marginTop: 12 }}>各 AP 功率變更</p>
            <div className="auto-power-modal__changes">
              {targetAPs.map((a) => {
                const next = result.txMap.get(a.id)
                const cur = a.txPower
                const delta = next - cur
                return (
                  <div key={a.id} className="auto-power-modal__change-row">
                    <span className="auto-power-modal__ap-name">{a.name ?? a.id}</span>
                    <span className="auto-power-modal__tx-cur">{cur} dBm</span>
                    <span className="auto-power-modal__tx-arrow">→</span>
                    <span className="auto-power-modal__tx-next">{next} dBm</span>
                    <span className={`auto-power-modal__tx-delta auto-power-modal__tx-delta--${delta > 0 ? 'up' : delta < 0 ? 'down' : 'zero'}`}>
                      {delta > 0 ? `+${delta}` : delta}
                    </span>
                  </div>
                )
              })}
            </div>
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
