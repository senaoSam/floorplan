import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { MATERIALS } from '@/constants/materials'
import { generateId } from '@/utils/id'
import './AIWallsModal.sass'

// 16-3o — AI walls detection entry point.
//
// Click "AI 偵測牆壁" in the toolbar → opens this modal:
//   1. Loads the active floor's image into ImageData
//   2. Posts to the classic worker (16-3a-l pipeline)
//   3. On done: shows segment count, bucket stats, preview thumbnail
//   4. User picks "全部寫入 / 只寫入 high / 取消"
//   5. Selected segments converted to walls (canvas-coord pairs already)
//      and pushed to useWallStore — history store auto-snapshots so
//      Ctrl+Z reverts the whole batch.
//
// Single-shot 16-3n review UI is deferred; this is the minimum viable
// end-to-end so the AI pipeline is reachable from the main editor.

const WORKER_URL = `${import.meta.env.BASE_URL}workers/aiWalls.classic.worker.js`

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

function imageToImageData(img) {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

// Render a small preview canvas of the morph result with merged segments
// drawn on top, coloured by confidence bucket.
function drawPreview(canvas, morphImageData, segments, scoringPer) {
  canvas.width = morphImageData.width
  canvas.height = morphImageData.height
  const ctx = canvas.getContext('2d')
  ctx.putImageData(morphImageData, 0, 0)
  ctx.lineWidth = 1.5
  const colours = { low: '#666', medium: '#ffd24a', high: '#3bff7b' }
  for (const b of ['low', 'medium', 'high']) {
    ctx.strokeStyle = colours[b]
    ctx.beginPath()
    for (let i = 0; i < segments.length; i++) {
      if (scoringPer?.[i]?.bucket !== b) continue
      const [x1, y1, x2, y2] = segments[i]
      ctx.moveTo(x1 + 0.5, y1 + 0.5)
      ctx.lineTo(x2 + 0.5, y2 + 0.5)
    }
    ctx.stroke()
  }
}

export default function AIWallsModal({ open, onClose }) {
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floors = useFloorStore((s) => s.floors)
  const floor = floors.find((f) => f.id === activeFloorId)
  const setWalls = useWallStore((s) => s.setWalls)
  const existingWalls = useWallStore((s) =>
    activeFloorId ? (s.wallsByFloor[activeFloorId] ?? []) : []
  )

  const [status, setStatus] = useState('idle') // idle | loading | running | done | error
  const [progressMsg, setProgressMsg] = useState('')
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const previewRef = useRef(null)
  const workerRef = useRef(null)

  // Tear down worker if modal unmounts mid-run.
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [])

  // Reset when modal closes.
  useEffect(() => {
    if (!open) {
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
      setStatus('idle')
      setProgressMsg('')
      setError(null)
      setResult(null)
    }
  }, [open])

  // Draw preview when result lands.
  useEffect(() => {
    if (!result || !previewRef.current) return
    drawPreview(previewRef.current, result.morphImageData,
                result.mergedSegments, result.scoring?.perSegment)
  }, [result])

  const run = useCallback(async () => {
    if (!floor || !floor.imageUrl) {
      setError('此樓層沒有底圖。')
      setStatus('error')
      return
    }
    setError(null)
    setResult(null)
    setStatus('loading')
    setProgressMsg('載入圖片…')
    try {
      const img = await loadImage(floor.imageUrl)
      const imageData = imageToImageData(img)
      const worker = new Worker(WORKER_URL)
      workerRef.current = worker
      setStatus('running')
      worker.addEventListener('message', (e) => {
        const m = e.data
        if (m.type === 'progress') {
          setProgressMsg(m.message || m.stage || '')
        } else if (m.type === 'done') {
          if (m.result?.aborted) {
            setStatus('idle')
            return
          }
          setResult(m.result)
          setStatus('done')
          setProgressMsg('')
          worker.terminate()
          workerRef.current = null
        } else if (m.type === 'error') {
          setError(m.message || '偵測失敗')
          setStatus('error')
          worker.terminate()
          workerRef.current = null
        }
      })
      worker.postMessage(
        { type: 'run', payload: { imageData, options: {} } },
        [imageData.data.buffer],
      )
    } catch (e) {
      setError(e.message || String(e))
      setStatus('error')
    }
  }, [floor])

  // Convert worker output segments to walls and commit. `mode` decides
  // which buckets to keep: 'all' = high+medium+low, 'high' = high only,
  // 'high-medium' = high + medium.
  const commit = useCallback((mode) => {
    if (!result || !activeFloorId) return
    const { mergedSegments, scoring } = result
    const allowed = mode === 'all'
      ? new Set(['high', 'medium', 'low'])
      : mode === 'high-medium'
        ? new Set(['high', 'medium'])
        : new Set(['high'])
    const newWalls = []
    for (let i = 0; i < mergedSegments.length; i++) {
      const bucket = scoring?.perSegment?.[i]?.bucket
      if (bucket && !allowed.has(bucket)) continue
      const [x1, y1, x2, y2] = mergedSegments[i]
      newWalls.push({
        id: generateId('wall'),
        startX: x1, startY: y1,
        endX: x2,   endY: y2,
        material: MATERIALS.CONCRETE,
        topHeight: 3.0,
        bottomHeight: 0,
      })
    }
    // Append (don't replace) so user's manually-drawn walls survive.
    setWalls(activeFloorId, [...existingWalls, ...newWalls])
    onClose()
  }, [result, activeFloorId, existingWalls, setWalls, onClose])

  if (!open) return null

  const busy = status === 'loading' || status === 'running'
  const counts = result?.scoring?.perSegment
    ? result.scoring.perSegment.reduce(
        (acc, p) => { acc[p.bucket]++; return acc },
        { high: 0, medium: 0, low: 0 },
      )
    : null

  const modal = (
    <div className="ai-walls-modal-overlay" onClick={onClose}>
      <div className="ai-walls-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ai-walls-modal__header">
          <span className="ai-walls-modal__title">AI 偵測牆壁</span>
          <span className="ai-walls-modal__sub">
            {floor ? `${floor.name} · ${floor.imageWidth}×${floor.imageHeight}` : '無樓層'}
          </span>
        </div>

        {!floor?.imageUrl && (
          <div className="ai-walls-modal__error">此樓層沒有底圖，無法偵測。</div>
        )}

        {status === 'idle' && floor?.imageUrl && (
          <div className="ai-walls-modal__row">
            <button className="ai-walls-modal__btn ai-walls-modal__btn--primary" onClick={run}>
              開始偵測
            </button>
            <span style={{ opacity: 0.6, fontSize: 12 }}>
              將以 OpenCV.js 處理底圖（耗時數秒至十幾秒）
            </span>
          </div>
        )}

        {busy && (
          <div className="ai-walls-modal__row">
            <span>{status === 'loading' ? '載入圖片中…' : '偵測中…'}</span>
            <span style={{ opacity: 0.6 }}>{progressMsg}</span>
          </div>
        )}

        {error && (
          <div className="ai-walls-modal__error">錯誤：{error}</div>
        )}

        {status === 'done' && result && (
          <>
            <div className="ai-walls-modal__stats">
              <div>
                偵測完成 · 共 {result.mergedSegments.length} 條候選牆 ·
                耗時 {Math.round(result.elapsedMs)}ms
              </div>
              {counts && (
                <div>
                  <span className="ai-walls-modal__bucket ai-walls-modal__bucket--high">
                    高信心 {counts.high}
                  </span>
                  <span className="ai-walls-modal__bucket ai-walls-modal__bucket--medium">
                    中信心 {counts.medium}
                  </span>
                  <span className="ai-walls-modal__bucket ai-walls-modal__bucket--low">
                    低信心 {counts.low}
                  </span>
                </div>
              )}
              {result.wallThickness?.estimatedPx != null && (
                <div style={{ opacity: 0.6 }}>
                  估計牆厚 ~{result.wallThickness.estimatedPx.toFixed(1)} px ·
                  配對 {result.wallThickness.pairedCount}/{result.wallThickness.totalCount}
                </div>
              )}
            </div>
            <canvas ref={previewRef} className="ai-walls-modal__preview" />
          </>
        )}

        <div className="ai-walls-modal__actions">
          <button className="ai-walls-modal__btn" onClick={onClose}>
            {status === 'done' ? '取消' : '關閉'}
          </button>
          {status === 'done' && (
            <>
              <button className="ai-walls-modal__btn"
                onClick={() => commit('high')}
                title="只寫入 high 信心的線段"
                disabled={!counts || counts.high === 0}>
                寫入高信心 ({counts?.high ?? 0})
              </button>
              <button className="ai-walls-modal__btn"
                onClick={() => commit('high-medium')}
                title="寫入 high + medium"
                disabled={!counts || counts.high + counts.medium === 0}>
                寫入高+中 ({(counts?.high ?? 0) + (counts?.medium ?? 0)})
              </button>
              <button className="ai-walls-modal__btn ai-walls-modal__btn--primary"
                onClick={() => commit('all')}
                title="寫入全部偵測結果">
                寫入全部 ({result.mergedSegments.length})
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
