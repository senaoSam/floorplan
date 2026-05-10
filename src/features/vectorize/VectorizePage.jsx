import React, { useCallback, useRef, useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { floorplanFromLines } from '@/utils/floorplanFromLines'
import './VectorizePage.sass'

const API_URL = 'https://analyzetovec.onrender.com/vectorize'

const LINE_COLORS = {
  wall:   '#ffffff',
  door:   '#3bff7b',
  window: '#4fc3f7',
}

function readImageMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

function drawResultCanvas(canvas, imgUrl, imageSize, lines) {
  const img = new Image()
  img.onload = () => {
    canvas.width  = imageSize.width
    canvas.height = imageSize.height
    const ctx = canvas.getContext('2d')
    // Slightly dim the original so vectors pop.
    ctx.drawImage(img, 0, 0, imageSize.width, imageSize.height)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.fillRect(0, 0, imageSize.width, imageSize.height)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    for (const l of lines) {
      ctx.strokeStyle = LINE_COLORS[l.type] ?? '#ff6b6b'
      ctx.beginPath()
      ctx.moveTo(l.x1, l.y1)
      ctx.lineTo(l.x2, l.y2)
      ctx.stroke()
    }
  }
  img.src = imgUrl
}

export default function VectorizePage() {
  const importFloorFromUrl = useFloorStore((s) => s.importFloorFromUrl)
  const setWalls           = useWallStore((s) => s.setWalls)

  const [file, setFile]       = useState(null)
  const [srcUrl, setSrcUrl]   = useState(null)
  const [srcSize, setSrcSize] = useState(null)  // natural size of uploaded image
  const [status, setStatus]   = useState('idle') // idle | uploading | done | error
  const [error, setError]     = useState(null)
  const [result, setResult]   = useState(null)   // { lines, image_size, stats }
  const resultCanvasRef = useRef(null)

  const onPick = useCallback(async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setError(null)
    setResult(null)
    setStatus('idle')
    try {
      const meta = await readImageMeta(f)
      if (srcUrl) URL.revokeObjectURL(srcUrl)
      setFile(f)
      setSrcUrl(meta.url)
      setSrcSize({ width: meta.width, height: meta.height })
    } catch (err) {
      setError(`讀取圖片失敗：${err?.message || err}`)
    }
  }, [srcUrl])

  const onSubmit = useCallback(async () => {
    if (!file) return
    setStatus('uploading')
    setError(null)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(API_URL, { method: 'POST', body: fd })
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
      setResult(data)
      setStatus('done')
      // Draw on next tick so the canvas ref has mounted.
      requestAnimationFrame(() => {
        if (resultCanvasRef.current && srcUrl) {
          drawResultCanvas(resultCanvasRef.current, srcUrl, data.image_size, data.lines)
        }
      })
    } catch (err) {
      setError(err?.message || String(err))
      setStatus('error')
    }
  }, [file, srcUrl])

  const onApply = useCallback(() => {
    if (!result || !srcUrl || !file) return
    const { lines, image_size } = result
    // Use API-side processed image_size as the canvas-coord basis (lines align to it).
    // 30 m default field width, matching DemoLoader's heuristic.
    const pxPerM = image_size.width / 30
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'Vectorized'
    const floor = importFloorFromUrl(
      srcUrl,
      image_size.width,
      image_size.height,
      baseName,
      pxPerM,
    )
    const { walls } = floorplanFromLines(lines)
    setWalls(floor.id, walls)
    // Switch back to main editor; this floor is now active.
    window.location.hash = ''
  }, [result, srcUrl, file, importFloorFromUrl, setWalls])

  const counts = result?.lines?.reduce(
    (acc, l) => { acc[l.type] = (acc[l.type] ?? 0) + 1; return acc },
    {},
  )

  return (
    <div className="vectorize-page">
      <header className="vectorize-page__header">
        <div className="vectorize-page__title">Floorplan Vectorizer</div>
        <div className="vectorize-page__sub">
          上傳平面圖 → server 回傳 wall/door/window 線段 → Apply 即可建立新樓層
        </div>
        <div className="vectorize-page__back">
          <a href="#">← 回主編輯器</a>
        </div>
      </header>

      <div className="vectorize-page__controls">
        <label className="vectorize-page__pick">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/bmp" onChange={onPick} />
          <span>選擇圖片</span>
        </label>
        <span className="vectorize-page__filename">
          {file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : '尚未選擇'}
        </span>
        <button
          className="vectorize-page__btn vectorize-page__btn--primary"
          onClick={onSubmit}
          disabled={!file || status === 'uploading'}
        >
          {status === 'uploading' ? '分析中…' : '上傳並向量化'}
        </button>
        <button
          className="vectorize-page__btn vectorize-page__btn--accent"
          onClick={onApply}
          disabled={!result}
          title="以分析結果建立新樓層並導入主程式"
        >
          Apply（建立樓層）
        </button>
      </div>

      {error && <div className="vectorize-page__error">錯誤：{error}</div>}

      {result && (
        <div className="vectorize-page__stats">
          共 {result.lines.length} 條線段
          {counts && (
            <>
              {' · '}
              <span style={{ color: LINE_COLORS.wall }}>wall {counts.wall ?? 0}</span>
              {' · '}
              <span style={{ color: LINE_COLORS.door }}>door {counts.door ?? 0}</span>
              {' · '}
              <span style={{ color: LINE_COLORS.window }}>window {counts.window ?? 0}</span>
            </>
          )}
          {result.stats?.elapsed_ms != null && ` · 耗時 ${result.stats.elapsed_ms} ms`}
          {' · 處理後尺寸 '}{result.image_size.width}×{result.image_size.height}
        </div>
      )}

      <div className="vectorize-page__panes">
        <div className="vectorize-page__pane">
          <div className="vectorize-page__pane-title">Source</div>
          <div className="vectorize-page__pane-body">
            {srcUrl ? (
              <img src={srcUrl} alt="source" />
            ) : (
              <div className="vectorize-page__placeholder">尚未選擇圖片</div>
            )}
            {srcSize && (
              <div className="vectorize-page__pane-meta">
                原始 {srcSize.width}×{srcSize.height}
              </div>
            )}
          </div>
        </div>

        <div className="vectorize-page__pane">
          <div className="vectorize-page__pane-title">Vectorized</div>
          <div className="vectorize-page__pane-body">
            {result ? (
              <canvas ref={resultCanvasRef} />
            ) : (
              <div className="vectorize-page__placeholder">
                {status === 'uploading' ? '分析中…' : '尚未分析'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
