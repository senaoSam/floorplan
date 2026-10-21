import React, { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { currentScenarioEnv } from '@/features/heatmap/buildScenario'
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss'
import { patchRadio } from '@/utils/apRadios'
import { runRedundant24Plan, COF_MIN, MAX_DROP_PCT } from '@/utils/redundant24Plan'
import { BAND_AVAILABLE_RSSI_DBM } from '@/features/clientView/simulate'
import { COVERAGE_THRESHOLD_DBM } from '@/constants/coverage'
// Same look as the other planning dialogs.
import '@/components/AutoPowerModal/AutoPowerModal.sass'
import '@/components/AutoPlaceModal/AutoPlaceModal.sass'

const EMPTY = []
const fmtPct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)

// 58-13: preview-then-apply for redundantly placed 2.4 GHz radios on the
// active floor (rule: utils/redundant24Plan). Applying switches those radios
// off (settings kept) in one store write.
function Redundant24Modal({ open, onClose }) {
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floors = useFloorStore((s) => s.floors)
  const floor = floors.find((f) => f.id === activeFloorId)
  const aps = useAPStore((s) => s.apsByFloor[activeFloorId] ?? EMPTY)
  const setAPs = useAPStore((s) => s.setAPs)

  const [legacy, setLegacy] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const runId = useRef(0)

  useEffect(() => {
    if (!open) return
    runId.current++
    setRunning(false)
    setResult(null)
    setError(null)
    setProgress(0)
  }, [open])

  const handleRun = useCallback(async () => {
    if (!floor?.scale) { setError('尚未設定比例尺'); return }
    const id = ++runId.current
    setRunning(true)
    setError(null)
    setProgress(0)
    const r = await runRedundant24Plan({
      floor, aps, floors,
      apsByFloor: useAPStore.getState().apsByFloor,
      wallsByFloor: useWallStore.getState().wallsByFloor,
      holesByFloor: useFloorHoleStore.getState().floorHolesByFloor,
      scopes: useScopeStore.getState().scopesByFloor?.[activeFloorId] ?? [],
      env: currentScenarioEnv(),
      legacy,
      onProgress: (p) => { if (runId.current === id) setProgress(p) },
      isCancelled: () => runId.current !== id,
    })
    if (runId.current !== id) return
    setRunning(false)
    if (!r) return
    if (r.error) {
      setError(r.error === 'no-candidates'
        ? '本層沒有可判斷的 2.4 GHz 射頻（同一台需還有其他頻段開著）'
        : '無法計算（樓層資料不完整）')
      return
    }
    setResult(r)
  }, [floor, aps, floors, activeFloorId, legacy])

  const handleApply = useCallback(() => {
    if (!result) return
    const ids = new Set(result.disable.map((d) => d.apId))
    const floorAps = useAPStore.getState().apsByFloor[activeFloorId] ?? []
    setAPs(activeFloorId, floorAps.map((a) => (ids.has(a.id) ? { ...a, radios: patchRadio(a, 2.4, { enabled: false }) } : a)))
    onClose()
  }, [result, activeFloorId, setAPs, onClose])

  const handleCancel = useCallback(() => {
    if (running) {
      runId.current++
      setRunning(false)
      setError('已取消')
    } else {
      onClose()
    }
  }, [running, onClose])

  const dismiss = useOverlayDismiss(running ? null : onClose)
  if (!open) return null

  const stats = result?.stats
  const names = result?.disable.map((d) => d.name) ?? []

  return createPortal((
    <div className="auto-power-modal-overlay" {...dismiss}>
      <div className="auto-power-modal">
        <div className="auto-power-modal__header">
          <span className="auto-power-modal__title">關閉多餘 2.4 GHz 射頻</span>
          <span className="auto-power-modal__sub">本層</span>
        </div>

        {running && (
          <div className="auto-power-modal__progressbar">
            <div className="auto-power-modal__progressbar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}

        {!result && (
          <section className="auto-power-modal__section">
            <p className="auto-power-modal__hint">
              只看手機真的會連 2.4 GHz 的地方（5 / 6 GHz 都低於 {BAND_AVAILABLE_RSSI_DBM} dBm）。
              一個 2.4 GHz 射頻在這些地方負責的範圍，有 {Math.round(COF_MIN * 100)}% 以上已被其他 2.4 GHz 射頻以
              {' '}{COVERAGE_THRESHOLD_DBM} dBm 蓋到，就建議關閉；整層 2.4 GHz 覆蓋最多少 {MAX_DROP_PCT} 個百分點。
              只關 2.4 GHz，同一台的其他頻段不動；套用後可復原。
            </p>
            <label className="auto-place-modal__check">
              <input type="checkbox" checked={legacy} disabled={running} onChange={(e) => setLegacy(e.target.checked)} />
              場域有只支援 2.4 GHz 的舊設備（收銀機、IoT）
            </label>
            <p className="auto-power-modal__hint">
              勾選後改以整層的 2.4 GHz 覆蓋判斷，不看 5 / 6 GHz。
            </p>
          </section>
        )}

        {result && (
          <section className="auto-power-modal__section">
            <div className="auto-power-modal__progress">
              <div className="auto-power-modal__progress-row auto-power-modal__progress-row--score">
                <span>建議關閉</span>
                <span><strong>{names.length}</strong> / {stats.radios24} 個 2.4 GHz 射頻</span>
              </div>
              <div className="auto-power-modal__progress-row">
                <span>{stats.legacy ? '整層' : '需要 2.4 GHz 的區域'} 2.4 GHz 覆蓋率（≥ {COVERAGE_THRESHOLD_DBM} dBm）</span>
                <span>{fmtPct(stats.coverageBefore)} → {fmtPct(stats.coverageAfter)}</span>
              </div>
              {!stats.legacy && (
                <div className="auto-power-modal__progress-row">
                  <span>需要 2.4 GHz 的區域占平面圖</span>
                  <span>{stats.cells ? fmtPct(stats.needCells / stats.cells) : '—'}</span>
                </div>
              )}
            </div>
            <p className="auto-power-modal__hint">
              {names.length === 0
                ? '沒有可關閉的 2.4 GHz 射頻'
                : `${names.slice(0, 12).join('、')}${names.length > 12 ? `…等 ${names.length} 台` : ''}`}
            </p>
            {/* The panel's coverage counts the strongest band, 2.4 GHz included:
                where 5 / 6 GHz sits between the two thresholds, 2.4 GHz used
                to carry it over -- the phone still joins 5 / 6 GHz there. */}
            {!stats.legacy && names.length > 0 && (
              <p className="auto-power-modal__hint">
                設備規劃面板的「已涵蓋」（最強頻段）可能下降：5 / 6 GHz 在 {BAND_AVAILABLE_RSSI_DBM} ~ {COVERAGE_THRESHOLD_DBM} dBm
                的地方原本靠 2.4 GHz 過門檻，但手機在那裡仍會連 5 / 6 GHz。
              </p>
            )}
          </section>
        )}

        {error && (
          <section className="auto-power-modal__section">
            <p className="auto-power-modal__error">{error}</p>
          </section>
        )}

        <div className="auto-power-modal__actions">
          <button className="auto-power-modal__btn auto-power-modal__btn--cancel" onClick={handleCancel}>
            {running ? '中止' : '關閉'}
          </button>
          {!running && !result && (
            <button className="auto-power-modal__btn auto-power-modal__btn--primary" onClick={handleRun}>
              開始分析
            </button>
          )}
          {!running && result && (
            <>
              <button className="auto-power-modal__btn auto-power-modal__btn--cancel" onClick={() => setResult(null)}>
                重新設定
              </button>
              <button
                className="auto-power-modal__btn auto-power-modal__btn--primary"
                onClick={handleApply}
                disabled={names.length === 0}
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

export default Redundant24Modal
