import React, { useEffect, useRef, useState } from 'react'

// Classic worker, served from /public so importScripts can fast-path opencv.js.
// (See public/workers/aiWalls.classic.worker.js for rationale.)
const WORKER_URL = `${import.meta.env.BASE_URL}workers/aiWalls.classic.worker.js`

const TEST_IMAGES = [
  { label: 'test-floorplan.png',       url: `${import.meta.env.BASE_URL}test-floorplan.png` },
  { label: 'sample-walls/myProj.png',  url: `${import.meta.env.BASE_URL}sample-walls/myProj.png` },
  { label: 'sample-walls/tmp1.png',    url: `${import.meta.env.BASE_URL}sample-walls/tmp1.png` },
  { label: 'sample-walls/tmp2.png',    url: `${import.meta.env.BASE_URL}sample-walls/tmp2.png` },
]

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

export default function AIWallsDebugPage() {
  const [status, setStatus] = useState('idle')
  const [progressMsg, setProgressMsg] = useState('')
  const [error, setError] = useState(null)
  const [picked, setPicked] = useState(TEST_IMAGES[0].url)
  const [blurKernel, setBlurKernel] = useState(3)
  const [invert, setInvert] = useState(true)
  const [stats, setStats] = useState(null)
  const srcCanvasRef = useRef(null)
  const binCanvasRef = useRef(null)
  const workerRef = useRef(null)

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [])

  function cancel() {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
    setStatus('idle')
    setProgressMsg('')
  }

  async function run() {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
    setError(null)
    setStats(null)
    setProgressMsg('')
    setStatus('loading-image')

    try {
      const img = await loadImage(picked)
      const srcCanvas = srcCanvasRef.current
      srcCanvas.width = img.naturalWidth
      srcCanvas.height = img.naturalHeight
      srcCanvas.getContext('2d').drawImage(img, 0, 0)

      const imageData = imageToImageData(img)

      const worker = new Worker(WORKER_URL)
      workerRef.current = worker

      worker.addEventListener('message', (e) => {
        const m = e.data
        if (m.type === 'progress') {
          setStatus(m.stage)
          setProgressMsg(m.message || '')
        } else if (m.type === 'done') {
          if (m.result?.aborted) {
            setStatus('idle')
            return
          }
          const { binaryImageData, width, height, whitePixels, elapsedMs } = m.result
          const binCanvas = binCanvasRef.current
          binCanvas.width = width
          binCanvas.height = height
          binCanvas.getContext('2d').putImageData(binaryImageData, 0, 0)
          setStats({
            width, height,
            elapsedMs: Math.round(elapsedMs),
            whitePixels,
            whiteRatio: (whitePixels / (width * height)).toFixed(3),
          })
          setStatus('done')
          setProgressMsg('')
          worker.terminate()
          workerRef.current = null
        } else if (m.type === 'error') {
          setError(m.message)
          setStatus('error')
          worker.terminate()
          workerRef.current = null
        }
      })

      worker.postMessage(
        { type: 'run', payload: { imageData, options: { blurKernel, invert } } },
        [imageData.data.buffer],
      )
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
      setStatus('error')
    }
  }

  const busy = status === 'loading-image' || status === 'loading-opencv' || status === 'processing'

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui', color: '#eee', background: '#1e1e1e', minHeight: '100vh' }}>
      <h2>AI Walls Debug — 16-3a preprocess (Web Worker)</h2>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label>
          Image:&nbsp;
          <select value={picked} onChange={(e) => setPicked(e.target.value)} disabled={busy}>
            {TEST_IMAGES.map((t) => (
              <option key={t.url} value={t.url}>{t.label}</option>
            ))}
          </select>
        </label>
        <label>
          Blur kernel:&nbsp;
          <input
            type="number" min={1} max={15} step={2}
            value={blurKernel}
            onChange={(e) => setBlurKernel(Number(e.target.value) || 3)}
            style={{ width: 50 }}
            disabled={busy}
          />
        </label>
        <label>
          <input
            type="checkbox" checked={invert}
            onChange={(e) => setInvert(e.target.checked)}
            disabled={busy}
          />
          &nbsp;Invert (walls = white)
        </label>
        <button onClick={run} disabled={busy}>Run</button>
        <button onClick={cancel} disabled={!busy}>Cancel</button>
        <span style={{ opacity: 0.7 }}>
          status: {status}{progressMsg ? ` — ${progressMsg}` : ''}
        </span>
      </div>

      {error && <div style={{ color: '#ff6b6b', marginBottom: 12 }}>Error: {error}</div>}
      {stats && (
        <div style={{ marginBottom: 12, fontSize: 13, opacity: 0.8 }}>
          {stats.width}×{stats.height} · {stats.elapsedMs}ms · white pixels {stats.whitePixels} ({stats.whiteRatio})
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ marginBottom: 4, opacity: 0.7 }}>Source</div>
          <canvas ref={srcCanvasRef} style={{ maxWidth: '100%', border: '1px solid #333', background: '#000' }} />
        </div>
        <div>
          <div style={{ marginBottom: 4, opacity: 0.7 }}>Binary (white = wall candidate)</div>
          <canvas ref={binCanvasRef} style={{ maxWidth: '100%', border: '1px solid #333', background: '#000' }} />
        </div>
      </div>
    </div>
  )
}
