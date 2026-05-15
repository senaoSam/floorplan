import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { floorplanFromLines } from '@/utils/floorplanFromLines'
import './AIWallsModal.sass'

// AI Wall flow:
//   1. Prompt user for API key (temporary — will move to settings later).
//   2. Pull a source image (currently just reuses the active floor's imageUrl;
//      placeholder for a future server-fetched image).
//   3. POST the image to the Python vectorize API.
//   4. Convert the returned line list into walls via floorplanFromLines
//      and REPLACE the active floor's walls.
//   5. Auto-derive px/m from the returned door segments:
//      sort door lengths, trim top & bottom 25%, average the middle 50%
//      (if <4 doors, just average all), then divide by REAL_DOOR_WIDTH_M.

const API_URL = 'https://analyzetovec.onrender.com/vectorize'
const REAL_DOOR_WIDTH_M = 0.9

// Placeholder for the upstream "fetch image" step. The product spec calls
// for first fetching an image from somewhere before vectorizing — until that
// endpoint exists, just hand back a Blob of the active floor's own image.
async function fetchSourceImage(floor /* , apiKey */) {
  const res = await fetch(floor.imageUrl)
  if (!res.ok) throw new Error(`讀取底圖失敗 (HTTP ${res.status})`)
  return await res.blob()
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

  // step: api-key | running | done | error
  const [step, setStep] = useState('api-key')
  const [apiKey, setApiKey] = useState('')
  const [progressMsg, setProgressMsg] = useState('')
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!open) {
      setStep('api-key')
      setApiKey('')
      setProgressMsg('')
      setError(null)
      setResult(null)
    }
  }, [open])

  const run = useCallback(async () => {
    if (!floor || !floor.imageUrl) {
      setError('此樓層沒有底圖。')
      setStep('error')
      return
    }
    if (!apiKey.trim()) {
      setError('請輸入 API key。')
      return
    }
    setError(null)
    setStep('running')
    try {
      setProgressMsg('取得來源圖片…')
      const blob = await fetchSourceImage(floor, apiKey)

      setProgressMsg('上傳並向量化…')
      const fd = new FormData()
      fd.append('file', blob, 'floorplan.png')
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
      })
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const j = await res.json()
          if (j?.detail) detail = j.detail
        } catch { /* ignore */ }
        throw new Error(detail)
      }
      const data = await res.json()
      if (!data?.lines || !data?.image_size) {
        throw new Error('回應格式不正確')
      }

      setProgressMsg('轉換並寫入樓層…')
      const { walls, stats } = floorplanFromLines(data.lines)
      const scaleInfo = autoScaleFromDoors(data.lines)

      setWalls(floor.id, walls)
      if (scaleInfo) setFloorScale(floor.id, scaleInfo.pxPerM)

      setResult({
        lines: data.lines,
        imageSize: data.image_size,
        wallCount: walls.length,
        stats,
        scaleInfo,
        elapsedMs: data.stats?.elapsed_ms ?? null,
      })
      setStep('done')
      setProgressMsg('')
    } catch (e) {
      setError(e?.message || String(e))
      setStep('error')
    }
  }, [floor, apiKey, setWalls, setFloorScale])

  if (!open) return null

  const counts = result?.lines?.reduce(
    (acc, l) => { acc[l.type] = (acc[l.type] ?? 0) + 1; return acc },
    {},
  )

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

        {step === 'api-key' && floor?.imageUrl && (
          <>
            <div className="ai-walls-modal__row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <label style={{ fontSize: 13, color: 'inherit' }}>API key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') run() }}
                placeholder="輸入暫時性的 API key"
                autoFocus
                style={{
                  background: '#0f0f12', border: '1px solid #2a2a30',
                  color: '#fff', padding: '6px 10px', borderRadius: 4,
                  fontSize: 13, outline: 'none',
                }}
              />
              {error && <div className="ai-walls-modal__error">{error}</div>}
            </div>
          </>
        )}

        {step === 'running' && (
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
              {result.elapsedMs != null && ` · 耗時 ${result.elapsedMs}ms`}
            </div>
            {counts && (
              <div style={{ marginTop: 4 }}>
                wall {counts.wall ?? 0} · door {counts.door ?? 0} · window {counts.window ?? 0}
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

        <div className="ai-walls-modal__actions">
          <button className="ai-walls-modal__btn" onClick={onClose}>
            {step === 'done' ? '關閉' : '取消'}
          </button>
          {step === 'api-key' && floor?.imageUrl && (
            <button
              className="ai-walls-modal__btn ai-walls-modal__btn--primary"
              onClick={run}
              disabled={!apiKey.trim()}
            >
              開始偵測
            </button>
          )}
          {step === 'error' && (
            <button
              className="ai-walls-modal__btn ai-walls-modal__btn--primary"
              onClick={() => { setError(null); setStep('api-key') }}
            >
              重試
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
