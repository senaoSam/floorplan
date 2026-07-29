import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useFloorStore } from '@/store/useFloorStore'
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss'
import ImageLightbox from '@/components/ImageLightbox/ImageLightbox'
import './ApiTestModal.sass'

// API test harness for the "Floorplan cv+graph pipeline" service (tmp.json).
//
// Exercises all seven endpoints:
//   GET  /healthz              — no auth
//   GET  /algorithms           — bearer
//   POST /jobs                 — bearer, multipart upload, returns 202 + job_id
//   GET  /jobs/{id}            — bearer, poll until finished
//   GET  /jobs/{id}/coords     — bearer, JSON
//   GET  /jobs/{id}/overlay    — bearer, image/png (full mode only)
//   GET  /jobs/{id}/denoised   — bearer, image/png (cnn* + full mode only)
//
// Both PNGs are fetched as Blobs and shown via createObjectURL so they render
// inline instead of downloading — a plain <img src> can't carry the
// Authorization header.

const DEFAULT_BASE_URL = 'https://floorplan.senao.net'
const DEFAULT_TOKEN = '5yF5qWsxew5RbOfMO5-V1BUwaCgIc8_Bjb9O7Cw4tCE'

const ALGORITHMS = [
  { id: 'cnn', label: 'cnn — ResNet34 (預設)' },
  { id: 'cnn2', label: 'cnn2 — ResNet50' },
  { id: 'cnn_crf', label: 'cnn_crf — ResNet34 + DenseCRF' },
  { id: 'cnn3', label: 'cnn3 — e2e ConvCRF' },
  { id: 'v1', label: 'v1 — cv+graph precision-first' },
  { id: 'v2', label: 'v2 — cv+graph 全集 F1 最高' },
  { id: 'baseline', label: 'baseline — cv+graph 未調參' },
]

const DEFAULT_ALGORITHM = 'cnn'

const POLL_INTERVAL_MS = 1500
const POLL_TIMEOUT_MS = 5 * 60 * 1000

// The two image endpoints, in display order.
const IMAGE_KINDS = [
  { kind: 'overlay', title: 'Overlay 疊圖（inline，未下載）' },
  { kind: 'denoised', title: 'Denoised 中間圖（CNN 去噪 4 色線稿）' },
]

const TERMINAL_OK = ['done', 'finished', 'succeeded', 'success', 'complete', 'completed']
const TERMINAL_BAD = ['error', 'failed', 'failure', 'cancelled', 'canceled']

function isTerminal(status) {
  const s = String(status || '').toLowerCase()
  return TERMINAL_OK.includes(s) || TERMINAL_BAD.includes(s)
}

function isFailure(status) {
  return TERMINAL_BAD.includes(String(status || '').toLowerCase())
}

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

function fmtMs(ms) {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// A single request row in the log.
function LogRow({ entry }) {
  const cls = entry.ok === null ? 'pending' : entry.ok ? 'ok' : 'fail'
  return (
    <div className={`api-test-modal__log-row api-test-modal__log-row--${cls}`}>
      <span className="api-test-modal__log-method">{entry.method}</span>
      <span className="api-test-modal__log-path">{entry.path}</span>
      <span className="api-test-modal__log-status">
        {entry.ok === null ? '…' : entry.status}
      </span>
      <span className="api-test-modal__log-time">{fmtMs(entry.ms)}</span>
      {entry.note && <span className="api-test-modal__log-note">{entry.note}</span>}
    </div>
  )
}

export default function ApiTestModal({ open, onClose }) {
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floors = useFloorStore((s) => s.floors)
  const floor = floors.find((f) => f.id === activeFloorId)

  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
  const [token, setToken] = useState(DEFAULT_TOKEN)
  const [algorithm, setAlgorithm] = useState(DEFAULT_ALGORITHM)
  const [outputMode, setOutputMode] = useState('full')
  const [source, setSource] = useState('floor') // floor | upload
  const [uploadFile, setUploadFile] = useState(null)

  const [running, setRunning] = useState(false)
  const [log, setLog] = useState([])
  const [healthz, setHealthz] = useState(null)
  const [algorithmsInfo, setAlgorithmsInfo] = useState(null)
  const [jobStatus, setJobStatus] = useState(null)
  const [coords, setCoords] = useState(null)
  // { overlay, denoised } — object URLs for the PNG endpoints.
  const [images, setImages] = useState({})
  // { src, title } while the full-screen viewer is open, else null.
  const [zoom, setZoom] = useState(null)
  const [error, setError] = useState(null)

  const cancelRef = useRef(false)
  const imagesRef = useRef({})
  const fileInputRef = useRef(null)

  // Track the live object URLs in a ref so the unmount cleanup can revoke
  // them — otherwise each run leaks a Blob for the document's lifetime.
  useEffect(() => {
    imagesRef.current = images
  }, [images])

  useEffect(() => () => {
    for (const url of Object.values(imagesRef.current)) {
      if (url) URL.revokeObjectURL(url)
    }
  }, [])

  const resetResults = useCallback(() => {
    setLog([])
    setHealthz(null)
    setAlgorithmsInfo(null)
    setJobStatus(null)
    setCoords(null)
    setError(null)
    // Close the viewer first — its src is about to be revoked.
    setZoom(null)
    setImages((prev) => {
      for (const url of Object.values(prev)) if (url) URL.revokeObjectURL(url)
      return {}
    })
  }, [])

  useEffect(() => {
    if (!open) {
      cancelRef.current = true
      setRunning(false)
      resetResults()
      setUploadFile(null)
    }
  }, [open, resetResults])

  // Perform one request, appending a log row and patching it with the result.
  const call = useCallback(async (method, path, opts = {}) => {
    const idx = { current: -1 }
    setLog((prev) => {
      idx.current = prev.length
      return [...prev, { method, path, status: null, ok: null, ms: null, note: null }]
    })
    const t0 = performance.now()
    let res
    try {
      res = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, opts)
    } catch (e) {
      const ms = performance.now() - t0
      setLog((prev) => prev.map((r, i) => (
        i === idx.current ? { ...r, status: 'ERR', ok: false, ms, note: e?.message || 'network error' } : r
      )))
      throw new Error(`${method} ${path} 連線失敗：${e?.message || e}`)
    }
    const ms = performance.now() - t0
    setLog((prev) => prev.map((r, i) => (
      i === idx.current ? { ...r, status: res.status, ok: res.ok, ms } : r
    )))
    return res
  }, [baseUrl])

  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${token.trim()}`,
  }), [token])

  // Resolve the image to upload — either the active floor's background or a
  // file the user picked.
  const resolveFile = useCallback(async () => {
    if (source === 'upload') {
      if (!uploadFile) throw new Error('請選擇一張圖片。')
      return uploadFile
    }
    if (!floor?.imageUrl) throw new Error('此樓層沒有底圖，請改用「上傳圖片」。')
    const res = await fetch(floor.imageUrl)
    if (!res.ok) throw new Error(`讀取底圖失敗 (HTTP ${res.status})`)
    const blob = await res.blob()
    return new File([blob], 'floorplan.png', { type: blob.type || 'image/png' })
  }, [source, uploadFile, floor])

  const runAll = useCallback(async () => {
    cancelRef.current = false
    resetResults()
    setRunning(true)
    try {
      // 1 — GET /healthz (no auth)
      const hz = await call('GET', '/healthz')
      if (!hz.ok) throw new Error(`/healthz 失敗：${await readError(hz)}`)
      setHealthz(await hz.json())
      if (cancelRef.current) return

      // 2 — GET /algorithms (bearer)
      const alg = await call('GET', '/algorithms', { headers: authHeaders() })
      if (alg.ok) {
        setAlgorithmsInfo(await alg.json())
      } else if (alg.status === 401 || alg.status === 403) {
        throw new Error(`/algorithms 認證失敗（HTTP ${alg.status}）— token 可能無效。`)
      } else {
        setAlgorithmsInfo({ _error: await readError(alg) })
      }
      if (cancelRef.current) return

      // 3 — POST /jobs (multipart)
      const file = await resolveFile()
      const fd = new FormData()
      fd.append('file', file, file.name || 'floorplan.png')
      fd.append('algorithm', algorithm)
      fd.append('output', outputMode)
      const created = await call('POST', '/jobs', {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      })
      if (!created.ok) throw new Error(`POST /jobs 失敗：${await readError(created)}`)
      const job = await created.json()
      const jobId = job.job_id
      if (!jobId) throw new Error('POST /jobs 回應沒有 job_id。')
      setJobStatus(job)
      if (cancelRef.current) return

      // 4 — GET /jobs/{id} — poll until terminal
      const deadline = performance.now() + POLL_TIMEOUT_MS
      let final = null
      while (!cancelRef.current) {
        const st = await call('GET', `/jobs/${jobId}`, { headers: authHeaders() })
        if (!st.ok) throw new Error(`GET /jobs/${jobId} 失敗：${await readError(st)}`)
        const data = await st.json()
        setJobStatus(data)
        if (isTerminal(data.status)) { final = data; break }
        if (performance.now() > deadline) {
          throw new Error(`輪詢逾時（${POLL_TIMEOUT_MS / 1000}s），最後狀態：${data.status}`)
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      }
      if (cancelRef.current || !final) return
      if (isFailure(final.status)) {
        throw new Error(`Job 失敗（${final.status}）：${final.error || '未提供錯誤訊息'}`)
      }

      // 5 — GET /jobs/{id}/coords
      const co = await call('GET', `/jobs/${jobId}/coords`, { headers: authHeaders() })
      if (co.ok) setCoords(await co.json())
      else setCoords({ _error: await readError(co) })
      if (cancelRef.current) return

      // 6 & 7 — the PNG endpoints, rendered inline and never downloaded.
      //
      // Availability is driven by the URLs the job advertises rather than
      // hardcoded rules: overlay only exists in `full` mode, and denoised only
      // for cnn* algorithms in `full` mode (cv+graph has no such intermediate).
      // A null *_url means "not produced", which is expected — not an error.
      for (const kind of ['overlay', 'denoised']) {
        if (cancelRef.current) return
        if (!final[`${kind}_url`]) continue
        const res = await call('GET', `/jobs/${jobId}/${kind}`, { headers: authHeaders() })
        if (res.ok) {
          const url = URL.createObjectURL(await res.blob())
          setImages((prev) => {
            if (prev[kind]) URL.revokeObjectURL(prev[kind])
            return { ...prev, [kind]: url }
          })
        } else {
          setError(`${kind} 取得失敗：${await readError(res)}`)
        }
      }
    } catch (e) {
      if (!cancelRef.current) setError(e?.message || String(e))
    } finally {
      setRunning(false)
    }
  }, [call, authHeaders, resolveFile, algorithm, outputMode, resetResults])

  const cancel = useCallback(() => {
    cancelRef.current = true
    setRunning(false)
  }, [])

  const dismiss = useOverlayDismiss(running ? null : onClose)

  if (!open) return null

  const lineCount = coords?.lines?.length ?? jobStatus?.lines?.length ?? null
  const typeCounts = (coords?.lines ?? jobStatus?.lines ?? []).reduce((acc, l) => {
    acc[l.type] = (acc[l.type] ?? 0) + 1
    return acc
  }, {})

  const modal = (
    <div className="api-test-modal-overlay" {...dismiss}>
      <div className="api-test-modal">
        <div className="api-test-modal__header">
          <span className="api-test-modal__title">API 測試 — Floorplan cv+graph pipeline</span>
          <span className="api-test-modal__sub">
            {floor ? `${floor.name} · ${floor.imageWidth}×${floor.imageHeight}` : '無樓層'}
          </span>
        </div>

        {/* ---- config ---- */}
        <div className="api-test-modal__config">
          <label className="api-test-modal__field">
            <span>Base URL</span>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={running}
              placeholder="https://…"
            />
          </label>

          <label className="api-test-modal__field">
            <span>Bearer token</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={running}
              placeholder="貼上 token"
            />
          </label>

          <label className="api-test-modal__field">
            <span>Algorithm</span>
            <select
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value)}
              disabled={running}
            >
              {ALGORITHMS.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </label>

          <label className="api-test-modal__field">
            <span>Output</span>
            <select
              value={outputMode}
              onChange={(e) => setOutputMode(e.target.value)}
              disabled={running}
            >
              <option value="full">full — 座標 + 疊圖</option>
              <option value="algo">algo — 只有座標</option>
            </select>
          </label>

          <label className="api-test-modal__field">
            <span>來源圖片</span>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={running}
            >
              <option value="floor">目前樓層底圖</option>
              <option value="upload">上傳圖片</option>
            </select>
          </label>

          {source === 'upload' && (
            <label className="api-test-modal__field">
              <span>檔案</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg"
                disabled={running}
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
            </label>
          )}
        </div>

        {/* ---- request log ---- */}
        {log.length > 0 && (
          <div className="api-test-modal__section">
            <div className="api-test-modal__section-title">請求紀錄</div>
            <div className="api-test-modal__log">
              {log.map((entry, i) => <LogRow key={i} entry={entry} />)}
            </div>
          </div>
        )}

        {error && <div className="api-test-modal__error">錯誤：{error}</div>}

        {/* ---- job status ---- */}
        {jobStatus && (
          <div className="api-test-modal__section">
            <div className="api-test-modal__section-title">
              Job 狀態
              <span className={`api-test-modal__badge api-test-modal__badge--${isFailure(jobStatus.status) ? 'bad' : isTerminal(jobStatus.status) ? 'ok' : 'run'}`}>
                {jobStatus.status}
              </span>
            </div>
            <div className="api-test-modal__kv">
              <div><b>job_id</b> {jobStatus.job_id}</div>
              <div><b>algorithm</b> {jobStatus.algorithm}</div>
              <div><b>output</b> {jobStatus.output}</div>
              <div><b>queue</b> {jobStatus.queue_position}</div>
              {jobStatus.size && <div><b>size</b> {jobStatus.size.join('×')}</div>}
              {jobStatus.profile && <div><b>profile</b> {jobStatus.profile}</div>}
              {jobStatus.started_at && jobStatus.finished_at && (
                <div><b>耗時</b> {fmtMs((jobStatus.finished_at - jobStatus.started_at) * 1000)}</div>
              )}
              {jobStatus.error && <div className="api-test-modal__error">{jobStatus.error}</div>}
            </div>
            {jobStatus.counts && (
              <pre className="api-test-modal__pre">{JSON.stringify(jobStatus.counts, null, 2)}</pre>
            )}
          </div>
        )}

        {/* ---- PNG endpoints, rendered inline ---- */}
        {IMAGE_KINDS.map(({ kind, title }) => images[kind] && (
          <div key={kind} className="api-test-modal__section">
            <div className="api-test-modal__section-title">
              {title}
              <button
                type="button"
                className="api-test-modal__zoom-btn"
                onClick={() => setZoom({ src: images[kind], title })}
              >
                🔍 放大
              </button>
            </div>
            <img
              className="api-test-modal__image api-test-modal__image--clickable"
              src={images[kind]}
              alt={kind}
              onClick={() => setZoom({ src: images[kind], title })}
            />
          </div>
        ))}

        {/* Explain a missing denoised image rather than silently omitting it —
            it's the most confusing absence, since it needs cnn* AND full. */}
        {jobStatus && isTerminal(jobStatus.status) && !isFailure(jobStatus.status)
          && !images.denoised && (
          <div className="api-test-modal__section">
            <div className="api-test-modal__section-title">Denoised 中間圖</div>
            <div className="api-test-modal__hint">
              此組合不產生 denoised 圖（需要 cnn* 演算法 + output=full）。
              目前為 {jobStatus.algorithm} / {jobStatus.output}。
            </div>
          </div>
        )}

        {/* ---- coords ---- */}
        {coords && (
          <div className="api-test-modal__section">
            <div className="api-test-modal__section-title">座標</div>
            {coords._error ? (
              <div className="api-test-modal__error">{coords._error}</div>
            ) : (
              <>
                <div className="api-test-modal__kv">
                  <div><b>image</b> {coords.image}</div>
                  <div><b>size</b> {coords.size?.join('×')}</div>
                  <div><b>method</b> {coords.method}</div>
                  {coords.profile && <div><b>profile</b> {coords.profile}</div>}
                  <div><b>lines</b> {lineCount}</div>
                </div>
                <div className="api-test-modal__kv">
                  {Object.entries(typeCounts).map(([t, n]) => (
                    <div key={t}><b>{t}</b> {n}</div>
                  ))}
                </div>
                <pre className="api-test-modal__pre api-test-modal__pre--tall">
                  {JSON.stringify((coords.lines ?? []).slice(0, 20), null, 2)}
                  {(coords.lines?.length ?? 0) > 20 && `\n… 其餘 ${coords.lines.length - 20} 條略`}
                </pre>
              </>
            )}
          </div>
        )}

        {/* ---- algorithms info ---- */}
        {algorithmsInfo && (
          <details className="api-test-modal__section">
            <summary className="api-test-modal__section-title">GET /algorithms 回應</summary>
            <pre className="api-test-modal__pre api-test-modal__pre--tall">
              {JSON.stringify(algorithmsInfo, null, 2)}
            </pre>
          </details>
        )}

        {healthz && (
          <details className="api-test-modal__section">
            <summary className="api-test-modal__section-title">GET /healthz 回應</summary>
            <pre className="api-test-modal__pre">{JSON.stringify(healthz, null, 2)}</pre>
          </details>
        )}

        <div className="api-test-modal__actions">
          <button className="api-test-modal__btn" onClick={onClose} disabled={running}>
            關閉
          </button>
          {running ? (
            <button className="api-test-modal__btn api-test-modal__btn--danger" onClick={cancel}>
              取消
            </button>
          ) : (
            <button
              className="api-test-modal__btn api-test-modal__btn--primary"
              onClick={runAll}
              disabled={!token.trim() || !baseUrl.trim()}
            >
              執行全部測試
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
