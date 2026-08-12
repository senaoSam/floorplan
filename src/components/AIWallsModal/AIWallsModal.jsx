import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAIPreviewStore } from '@/store/useAIPreviewStore'
import { floorplanFromLines } from '@/utils/floorplanFromLines'
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss'
import ImageLightbox from '@/components/ImageLightbox/ImageLightbox'
import './AIWallsModal.sass'

// AI Wall flow — backed by the "Floorplan cv+graph pipeline" service.
//
//   1. POST the active floor's image to /jobs (multipart) and get a job_id.
//   2. Poll GET /jobs/{id} until the job reaches a terminal state.
//   3. Convert the returned line list into walls via floorplanFromLines
//      and REPLACE the active floor's walls.
//   4. Auto-derive px/m from the returned door segments:
//      sort door lengths, trim top & bottom 25%, average the middle 50%
//      (if <4 doors, just average all), then divide by REAL_DOOR_WIDTH_M.
//   5. Fetch GET /jobs/{id}/overlay as a Blob and keep it as the preview
//      image so the user can compare detected walls against the source.
//
// The service runs its own denoising stage (cv+graph or CNN, see `algorithm`),
// so the raw floor image is uploaded directly — no pre-cleaning pass, and the
// returned coordinates are already in the source image's pixel space.

const API_BASE_URL = 'https://floorplan.senao.net'
const API_TOKEN = '5yF5qWsxew5RbOfMO5-V1BUwaCgIc8_Bjb9O7Cw4tCE'
const REAL_DOOR_WIDTH_M = 0.9

const POLL_INTERVAL_MS = 1500
const POLL_TIMEOUT_MS = 5 * 60 * 1000

// Stage-A profiles offered by GET /algorithms. The CNN variants lead the list
// because cnn is our default; note the service's own default is still v1, so
// `algorithm` is always sent explicitly rather than relying on the server.
const ALGORITHMS = [
  { id: 'cnn', label: 'cnn — ResNet34（預設）' },
  { id: 'cnn2', label: 'cnn2 — ResNet50' },
  { id: 'cnn_crf', label: 'cnn_crf — ResNet34+DenseCRF' },
  { id: 'cnn3', label: 'cnn3 — e2e ConvCRF' },
  { id: 'v1', label: 'v1 — cv+graph 精準優先' },
  { id: 'v2', label: 'v2 — cv+graph 全集 F1 最高' },
  { id: 'baseline', label: 'baseline — cv+graph 未調參' },
]

const DEFAULT_ALGORITHM = 'cnn'

const TERMINAL_OK = ['done', 'finished', 'succeeded', 'success', 'complete', 'completed']
const TERMINAL_BAD = ['error', 'failed', 'failure', 'cancelled', 'canceled']

const isTerminal = (s) => {
  const v = String(s || '').toLowerCase()
  return TERMINAL_OK.includes(v) || TERMINAL_BAD.includes(v)
}
const isFailure = (s) => TERMINAL_BAD.includes(String(s || '').toLowerCase())

const authHeaders = () => ({ Authorization: `Bearer ${API_TOKEN}` })

// Pull a human-readable message out of a non-2xx response (FastAPI puts it in
// `detail`, which may itself be a validation-error array).
async function readError(res) {
  try {
    const j = await res.json()
    if (typeof j?.detail === 'string') return j.detail
    if (Array.isArray(j?.detail)) {
      return j.detail.map((d) => `${(d.loc ?? []).join('.')}: ${d.msg}`).join('; ')
    }
    if (j?.detail) return JSON.stringify(j.detail)
    return JSON.stringify(j)
  } catch {
    return `HTTP ${res.status} ${res.statusText}`
  }
}

function autoScaleFromDoors(lines) {
  const doorLengths = []
  for (const l of lines) {
    if (l.type !== 'door') continue
    const dx = l.x2 - l.x1
    const dy = l.y2 - l.y1
    doorLengths.push(Math.hypot(dx, dy))
  }
  if (doorLengths.length === 0) return null
  doorLengths.sort((a, b) => a - b)
  let sample = doorLengths
  if (doorLengths.length >= 4) {
    const lo = Math.floor(doorLengths.length * 0.25)
    const hi = Math.ceil(doorLengths.length * 0.75)
    sample = doorLengths.slice(lo, hi)
    if (sample.length === 0) sample = doorLengths
  }
  const avgPx = sample.reduce((s, v) => s + v, 0) / sample.length
  if (!isFinite(avgPx) || avgPx <= 0) return null
  return {
    pxPerM: avgPx / REAL_DOOR_WIDTH_M,
    avgDoorPx: avgPx,
    doorCount: doorLengths.length,
    sampledCount: sample.length,
  }
}

export default function AIWallsModal({ open, onClose }) {
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floors = useFloorStore((s) => s.floors)
  const floor = floors.find((f) => f.id === activeFloorId)
  const setFloorScale = useFloorStore((s) => s.setFloorScale)
  const setWalls = useWallStore((s) => s.setWalls)
  const setGeminiPreview = useAIPreviewStore((s) => s.setGeminiPreview)
  const overlayPreviewUrl = useAIPreviewStore((s) => s.geminiPreviewUrl)

  // step: idle | running | done | error
  const [step, setStep] = useState('idle')
  const [algorithm, setAlgorithm] = useState(DEFAULT_ALGORITHM)
  const [progressMsg, setProgressMsg] = useState('')
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  // { src, title } while the full-screen viewer is open, else null.
  const [zoom, setZoom] = useState(null)

  // 52-B5: monotonic run counter. A run stays valid only while it owns the
  // latest id; cancelling or re-running bumps it and orphans the old one.
  const runIdRef = useRef(0)
  // The denoised object URL is owned by this component (unlike the overlay,
  // which is handed to useAIPreviewStore and revoked there), so it has to be
  // released on replace and on close.
  const denoisedUrlRef = useRef(null)

  const releaseDenoised = useCallback(() => {
    if (denoisedUrlRef.current) URL.revokeObjectURL(denoisedUrlRef.current)
    denoisedUrlRef.current = null
  }, [])

  useEffect(() => {
    if (!open) {
      runIdRef.current += 1   // orphan any in-flight run
      setStep('idle')
      setProgressMsg('')
      setError(null)
      setResult(null)
      setZoom(null)
      releaseDenoised()
    }
  }, [open, releaseDenoised])

  useEffect(() => () => releaseDenoised(), [releaseDenoised])

  const run = useCallback(async () => {
    if (!floor || !floor.imageUrl) {
      setError('此樓層沒有底圖。')
      setStep('error')
      return
    }
    // 52-B5: a single shared boolean let a re-run resurrect a cancelled one —
    // `cancelRef.current = false` here also un-cancelled the previous run,
    // which was still parked in an await and would go on to setWalls() and
    // overwrite this run's result (whichever finished last won). Tag each run
    // with its own id and treat "I am no longer the current run" as cancelled,
    // so an abandoned run can never be revived.
    const runId = ++runIdRef.current
    const cancelled = () => runIdRef.current !== runId
    setError(null)
    // A re-detect revokes the previous images, so drop the viewer holding them.
    setZoom(null)
    setStep('running')
    const t0 = performance.now()
    try {
      // 1 — upload the raw floor image and enqueue the job.
      setProgressMsg('上傳底圖…')
      const srcRes = await fetch(floor.imageUrl)
      if (!srcRes.ok) throw new Error(`讀取底圖失敗 (HTTP ${srcRes.status})`)
      const srcBlob = await srcRes.blob()

      const fd = new FormData()
      fd.append('file', srcBlob, 'floorplan.png')
      fd.append('algorithm', algorithm)
      fd.append('output', 'full')

      const created = await fetch(`${API_BASE_URL}/jobs`, {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      })
      if (!created.ok) throw new Error(`排入佇列失敗：${await readError(created)}`)
      const job = await created.json()
      const jobId = job.job_id
      if (!jobId) throw new Error('伺服器回應沒有 job_id。')
      if (cancelled()) return

      // 2 — poll until the job reaches a terminal state.
      const deadline = performance.now() + POLL_TIMEOUT_MS
      let final = null
      while (!cancelled()) {
        const st = await fetch(`${API_BASE_URL}/jobs/${jobId}`, { headers: authHeaders() })
        if (!st.ok) throw new Error(`查詢進度失敗：${await readError(st)}`)
        const data = await st.json()
        if (isTerminal(data.status)) { final = data; break }
        setProgressMsg(
          data.queue_position > 0
            ? `排隊中（前面還有 ${data.queue_position} 個）…`
            : '辨識中…',
        )
        if (performance.now() > deadline) {
          throw new Error(`等待逾時（${POLL_TIMEOUT_MS / 1000}s），最後狀態：${data.status}`)
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      }
      if (cancelled() || !final) return
      if (isFailure(final.status)) {
        throw new Error(`辨識失敗（${final.status}）：${final.error || '未提供錯誤訊息'}`)
      }

      // 3 — the coordinates ride along on the completed job; /coords would
      // return the same lines, so there's no need for a second round trip.
      const lines = final.lines ?? []
      if (lines.length === 0) throw new Error('辨識完成，但沒有偵測到任何線段。')

      setProgressMsg('轉換並寫入樓層…')
      const { walls, stats } = floorplanFromLines(lines)
      const scaleInfo = autoScaleFromDoors(lines)

      // 52-B5: last check before the destructive write — setWalls replaces the
      // whole layer, so a stale run landing here would clobber the live one.
      if (cancelled()) return
      setWalls(floor.id, walls)
      if (scaleInfo) setFloorScale(floor.id, scaleInfo.pxPerM)

      // 4 — the preview images are best-effort: the walls are already written,
      // so a failed image fetch must not fail the whole run.
      //
      // `denoised` is the CNN denoiser's intermediate 4-colour line drawing —
      // only produced by cnn* algorithms, so cv+graph runs skip it. It's a
      // diagnostic: a dirty denoised image blames the denoiser, while a clean
      // one paired with bad walls blames vectorization.
      let overlayUrl = null
      let denoisedUrl = null
      try {
        setProgressMsg('取得疊圖…')
        const ov = await fetch(`${API_BASE_URL}/jobs/${jobId}/overlay`, { headers: authHeaders() })
        if (ov.ok) {
          const blob = await ov.blob()
          // 52-B5: setGeminiPreview revokes whatever URL it currently holds.
          // A stale run publishing here would revoke the winner's overlay and
          // leave a broken image, so bail before minting the URL at all.
          if (cancelled()) return
          overlayUrl = URL.createObjectURL(blob)
          setGeminiPreview(overlayUrl)
        }
      } catch { /* overlay is optional */ }
      releaseDenoised()
      if (final.denoised_url) {
        try {
          setProgressMsg('取得去噪線稿…')
          const dn = await fetch(`${API_BASE_URL}/jobs/${jobId}/denoised`, { headers: authHeaders() })
          if (dn.ok) {
            const blob = await dn.blob()
            if (cancelled()) return   // 52-B5: don't leak a URL nobody will revoke
            denoisedUrl = URL.createObjectURL(blob)
            denoisedUrlRef.current = denoisedUrl
          }
        } catch { /* denoised is optional */ }
      }

      if (cancelled()) return   // 52-B5
      setResult({
        lines,
        wallCount: walls.length,
        stats,
        scaleInfo,
        overlayUrl,
        denoisedUrl,
        algorithm: final.algorithm ?? algorithm,
        profile: final.profile ?? null,
        size: final.size ?? null,
        elapsedMs: (final.started_at != null && final.finished_at != null)
          ? (final.finished_at - final.started_at) * 1000
          : performance.now() - t0,
      })
      setStep('done')
      setProgressMsg('')
    } catch (e) {
      if (cancelled()) return
      setError(e?.message || String(e))
      setStep('error')
    }
  }, [floor, algorithm, setWalls, setFloorScale, setGeminiPreview, releaseDenoised])

  const cancel = useCallback(() => {
    runIdRef.current += 1   // orphan the in-flight run (see 52-B5 in `run`)
    setStep('idle')
    setProgressMsg('')
  }, [])

  const running = step === 'running'
  const dismiss = useOverlayDismiss(running ? null : onClose)

  if (!open) return null

  const counts = result?.lines?.reduce(
    (acc, l) => { acc[l.type] = (acc[l.type] ?? 0) + 1; return acc },
    {},
  )

  // After a run the store holds this run's overlay; before one it may still
  // hold the previous run's, which is exactly the comparison view we want.
  const previewUrl = result?.overlayUrl ?? overlayPreviewUrl

  const modal = (
    <div className="ai-walls-modal-overlay" {...dismiss}>
      <div className="ai-walls-modal">
        <div className="ai-walls-modal__header">
          <span className="ai-walls-modal__title">AI 偵測牆壁</span>
          <span className="ai-walls-modal__sub">
            {floor ? `${floor.name} · ${floor.imageWidth}×${floor.imageHeight}` : '無樓層'}
          </span>
        </div>

        {!floor?.imageUrl && (
          <div className="ai-walls-modal__error">此樓層沒有底圖，無法偵測。</div>
        )}

        {floor?.imageUrl && (
          <div className="ai-walls-modal__row">
            <label htmlFor="ai-walls-algo">演算法</label>
            <select
              id="ai-walls-algo"
              className="ai-walls-modal__select"
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value)}
              disabled={running}
            >
              {ALGORITHMS.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>
        )}

        {running && (
          <div className="ai-walls-modal__row">
            <span>處理中…</span>
            <span style={{ opacity: 0.6 }}>{progressMsg}</span>
          </div>
        )}

        {step === 'error' && (
          <div className="ai-walls-modal__error">錯誤：{error}</div>
        )}

        {step === 'done' && result && (
          <div className="ai-walls-modal__stats">
            <div>
              寫入 {result.wallCount} 條牆 ·
              共 {result.lines.length} 條原始線段
              {` · 耗時 ${Math.round(result.elapsedMs)}ms`}
            </div>
            {counts && (
              <div style={{ marginTop: 4 }}>
                wall {counts.wall ?? 0} · door {counts.door ?? 0} · window {counts.window ?? 0}
                {result.profile && ` · profile ${result.profile}`}
              </div>
            )}
            {result.scaleInfo ? (
              <div style={{ marginTop: 4 }}>
                自動比例尺：{result.scaleInfo.pxPerM.toFixed(2)} px/m
                {' '}（門平均 {result.scaleInfo.avgDoorPx.toFixed(1)} px ÷ {REAL_DOOR_WIDTH_M} m，
                取樣 {result.scaleInfo.sampledCount}/{result.scaleInfo.doorCount} 條）
              </div>
            ) : (
              <div style={{ marginTop: 4, opacity: 0.6 }}>
                沒有偵測到門，無法自動計算比例尺。
              </div>
            )}
          </div>
        )}

        {step === 'done' && (previewUrl || result?.denoisedUrl) && (
          <div className="ai-walls-modal__previews">
            {[
              { src: previewUrl, label: '辨識疊圖' },
              { src: result?.denoisedUrl, label: '去噪線稿（CNN）' },
            ].filter((p) => p.src).map((p) => (
              <div key={p.label} className="ai-walls-modal__preview-item">
                <span className="ai-walls-modal__preview-label">{p.label}</span>
                <img
                  className="ai-walls-modal__preview ai-walls-modal__preview--clickable"
                  src={p.src}
                  alt={p.label}
                  onClick={() => setZoom({ src: p.src, title: p.label })}
                />
                <button
                  type="button"
                  className="ai-walls-modal__zoom-btn"
                  onClick={() => setZoom({ src: p.src, title: p.label })}
                >
                  🔍 放大
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="ai-walls-modal__actions">
          <button className="ai-walls-modal__btn" onClick={running ? cancel : onClose}>
            {running ? '取消' : step === 'done' ? '關閉' : '取消'}
          </button>
          {(step === 'idle' || step === 'done') && floor?.imageUrl && (
            <button
              className="ai-walls-modal__btn ai-walls-modal__btn--primary"
              onClick={run}
            >
              {step === 'done' ? '重新偵測' : '開始偵測'}
            </button>
          )}
          {step === 'error' && (
            <button
              className="ai-walls-modal__btn ai-walls-modal__btn--primary"
              onClick={() => { setError(null); setStep('idle') }}
            >
              重試
            </button>
          )}
        </div>
      </div>

      <ImageLightbox
        open={!!zoom}
        src={zoom?.src}
        title={zoom?.title}
        onClose={() => setZoom(null)}
      />
    </div>
  )

  return createPortal(modal, document.body)
}
