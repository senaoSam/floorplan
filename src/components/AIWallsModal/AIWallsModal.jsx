import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAIPreviewStore } from '@/store/useAIPreviewStore'
import { floorplanFromLines } from '@/utils/floorplanFromLines'
import './AIWallsModal.sass'

// AI Wall flow:
//   1. Prompt user for the Gemini API key (temporary input — will move to
//      settings later).
//   2. Send the active floor's image to Gemini (gemini-3-pro-image-preview)
//      with a prompt that strips everything except walls/doors/windows and
//      re-renders them as clean colored lines.
//   3. POST the cleaned image to the Python vectorize API.
//   4. Convert the returned line list into walls via floorplanFromLines
//      and REPLACE the active floor's walls.
//   5. Auto-derive px/m from the returned door segments:
//      sort door lengths, trim top & bottom 25%, average the middle 50%
//      (if <4 doors, just average all), then divide by REAL_DOOR_WIDTH_M.

const VECTORIZE_API_URL = 'https://analyzetovec.onrender.com/vectorize'
const REAL_DOOR_WIDTH_M = 0.9

const GEMINI_MODEL = 'gemini-3-pro-image-preview'
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent`
const GEMINI_PROMPT = [
  '過濾成簡單乾淨線圖,直接產新圖片,不用其他回應',
  '1.除了門,窗,及柱子外,移除所有不是牆壁的部分',
  '2.去掉任何文字描述及標記、註記',
  '3.牆用#000,門用#FFD42A,窗戶用#4FAEE3,都是單直線 ',
  '4.從牆面施工的角度, 移除不需要的線條',
  '5.特別注意門窗兩側必須要連接著牆壁,門應該是關門狀態,注意門是否合理,千萬不要扇形',
  'note 所有東西皆以直線標示,門不要有扇形或雙線,門只能是直線',
].join('\n')

// Read a Blob/File as base64 (without the "data:...;base64," prefix).
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      const comma = typeof result === 'string' ? result.indexOf(',') : -1
      if (comma < 0) reject(new Error('FileReader 結果格式錯誤'))
      else resolve(result.slice(comma + 1))
    }
    reader.onerror = () => reject(reader.error || new Error('讀取圖片失敗'))
    reader.readAsDataURL(blob)
  })
}

function base64ToBlob(b64, mimeType) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mimeType || 'image/png' })
}

// Walk a streamGenerateContent response (a JSON array of chunks) and return
// the first inlineData image part it can find.
function extractFirstImagePart(payload) {
  const chunks = Array.isArray(payload) ? payload : [payload]
  for (const chunk of chunks) {
    const candidates = chunk?.candidates ?? []
    for (const c of candidates) {
      const parts = c?.content?.parts ?? []
      for (const p of parts) {
        const inline = p?.inlineData || p?.inline_data
        if (inline?.data) {
          return { data: inline.data, mimeType: inline.mimeType || inline.mime_type || 'image/png' }
        }
      }
    }
  }
  return null
}

// Step 2 — hand the floor image to Gemini and get back a cleaned-up image
// (walls/doors/windows only) as a Blob.
async function fetchCleanedImageFromGemini(floor, apiKey) {
  const srcRes = await fetch(floor.imageUrl)
  if (!srcRes.ok) throw new Error(`讀取底圖失敗 (HTTP ${srcRes.status})`)
  const srcBlob = await srcRes.blob()
  const b64 = await blobToBase64(srcBlob)

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: srcBlob.type || 'image/png', data: b64 } },
        { text: GEMINI_PROMPT },
      ],
    }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: { /*aspectRatio: 'Auto',*/ imageSize: '1K' },
    },
    tools: [{ googleSearch: {} }],
  }

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      detail = j?.error?.message || j?.error || detail
    } catch { /* ignore */ }
    throw new Error(`Gemini API 失敗：${detail}`)
  }
  const payload = await res.json()
  const img = extractFirstImagePart(payload)
  if (!img) throw new Error('Gemini 回應未包含圖片')
  return { cleanedBlob: base64ToBlob(img.data, img.mimeType) }
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
      setProgressMsg('Gemini 清理底圖中…')
      const { cleanedBlob } = await fetchCleanedImageFromGemini(floor, apiKey.trim())

      setProgressMsg('Python向量化…')
      const fd = new FormData()
      fd.append('file', cleanedBlob, 'floorplan.png')
      const res = await fetch(VECTORIZE_API_URL, {
        method: 'POST',
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
      // Gemini may return the cleaned image at a different resolution than the
      // original floor image (e.g. 685×511 → 1200×895). The vectorize API's
      // coordinates are in the cleaned image's pixel space, so remap them back
      // to the original image's pixel space before building walls.
      const sx = floor.imageWidth  / data.image_size.width
      const sy = floor.imageHeight / data.image_size.height
      const remappedLines = data.lines.map((l) => ({
        type: l.type,
        x1: l.x1 * sx, y1: l.y1 * sy,
        x2: l.x2 * sx, y2: l.y2 * sy,
      }))
      const { walls, stats } = floorplanFromLines(remappedLines)
      const scaleInfo = autoScaleFromDoors(remappedLines)

      setWalls(floor.id, walls)
      if (scaleInfo) setFloorScale(floor.id, scaleInfo.pxPerM)

      // Persist Gemini cleaned image (what the vectorizer saw) outside the
      // modal so the user can toggle it on/off from the canvas after closing.
      setGeminiPreview(URL.createObjectURL(cleanedBlob))

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
  }, [floor, apiKey, setWalls, setFloorScale, setGeminiPreview])

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
              <label style={{ fontSize: 13, color: 'inherit' }}>Gemini API key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') run() }}
                placeholder="貼上 Gemini API key"
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
