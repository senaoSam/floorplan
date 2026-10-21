import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { currentScenarioEnv } from '@/features/heatmap/buildScenario'
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss'
import { useRadioPreview } from '@/hooks/useRadioPreview'
import BeforeAfterSwitch from '@/components/AutoPowerModal/BeforeAfterSwitch'
import { patchRadio } from '@/utils/apRadios'
import { runRedundant24Plan, COF_MIN, MAX_DROP_PCT } from '@/utils/redundant24Plan'
import { BAND_AVAILABLE_RSSI_DBM } from '@/features/clientView/simulate'
import { COVERAGE_THRESHOLD_DBM } from '@/constants/coverage'
// Same look as the other planning dialogs.
import '@/components/AutoPowerModal/AutoPowerModal.sass'
import '@/components/AutoPlaceModal/AutoPlaceModal.sass'

const EMPTY = []

// What the preview draws: the band map (where phones land -- next to no
// change is the point) or the 2.4 GHz signal itself (where it got weaker).
const PREVIEW_VIEWS = {
  band: { label: '頻段地圖', view: { mode: 'band' }, hint: '頻段地圖幾乎不變，代表手機連線不受影響' },
  rssi24: { label: '2.4 GHz 訊號', view: { mode: 'rssi', bandFilter: '2.4' }, hint: '變弱的地方，手機會改連 5 / 6 GHz' },
}
const fmtPct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)

// The plan floor's APs with the plan's 2.4 GHz radios switched off.
const withPlanApplied = (result, floorAps) => {
  const ids = new Set(result.disable.map((d) => d.apId))
  return floorAps.map((a) => (ids.has(a.id) ? { ...a, radios: patchRadio(a, 2.4, { enabled: false }) } : a))
}

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
  const [previewView, setPreviewView] = useState('band')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const runId = useRef(0)

  // Reset on open and on close (also by another planning dialog opening,
  // usePlanningDialogStore): a run in flight is dropped, a reopen never
  // previews an old plan.
  useEffect(() => {
    runId.current++
    setRunning(false)
    setResult(null)
    setError(null)
    setProgress(0)
  }, [open])

  const handleRun = useCallback(async () => {
    if (!floor?.scale) { setError('尚未設定比例尺'); return }
    const id = ++runId.current
    // The preview card leaves the canvas usable, so the user can switch
    // floors before applying: the plan carries its floor (53-G10).
    const planFloorId = activeFloorId
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
    setResult({ ...r, floorId: planFloorId })
  }, [floor, aps, floors, activeFloorId, legacy])

  const handleApply = useCallback(() => {
    if (!result) return
    if (!useFloorStore.getState().floors.some((f) => f.id === result.floorId)) {
      setError('規劃所屬的樓層已不存在，請重新分析')
      setResult(null)
      return
    }
    setAPs(result.floorId, withPlanApplied(result, useAPStore.getState().apsByFloor[result.floorId] ?? []))
    onClose()
  }, [result, setAPs, onClose])

  const handleCancel = useCallback(() => {
    if (running) {
      runId.current++
      setRunning(false)
      setError('已取消')
    } else {
      onClose()
    }
  }, [running, onClose])

  // Preview: the plan on the band map (where phones land once 2.4 GHz is off)
  // while the result is up, with the dialog docked as a card.
  const previewing = !running && !!result && result.disable.length > 0
  const previewPlan = useMemo(() => (previewing ? (floorAps) => withPlanApplied(result, floorAps) : null), [previewing, result])
  // Each new result starts on the band map.
  useEffect(() => { setPreviewView('band') }, [result])
  useRadioPreview(open && previewing ? result.floorId : null, previewPlan, PREVIEW_VIEWS[previewView].view)

  const dismiss = useOverlayDismiss(running || previewing ? null : onClose)
  if (!open) return null

  const stats = result?.stats
  const names = result?.disable.map((d) => d.name) ?? []

  return createPortal((
    <div className={`auto-power-modal-overlay${previewing ? ' auto-power-modal-overlay--preview' : ''}`} {...dismiss}>
      <div className="auto-power-modal">
        <div className="auto-power-modal__header">
          <span className="auto-power-modal__title">關閉多餘 2.4 GHz 射頻</span>
          <span className="auto-power-modal__sub">本層</span>
        </div>
        {previewing && (
          <>
            <BeforeAfterSwitch />
            <div className="auto-power-modal__compare">
              <span>顯示</span>
              <span className="auto-power-modal__seg" role="group" aria-label="預覽顯示的熱圖">
                {Object.entries(PREVIEW_VIEWS).map(([key, v]) => (
                  <button
                    key={key}
                    type="button"
                    className={`auto-power-modal__seg-btn${previewView === key ? ' auto-power-modal__seg-btn--active' : ''}`}
                    aria-pressed={previewView === key}
                    onClick={() => setPreviewView(key)}
                  >{v.label}</button>
                ))}
              </span>
            </div>
            <p className="auto-power-modal__hint auto-power-modal__compare-hint">{PREVIEW_VIEWS[previewView].hint}</p>
          </>
        )}

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
            {running ? '中止' : previewing ? '取消' : '關閉'}
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
