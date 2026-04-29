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

function drawSegments(canvas, segments, color) {
  const ctx = canvas.getContext('2d')
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (const [x1, y1, x2, y2] of segments) {
    ctx.moveTo(x1 + 0.5, y1 + 0.5)
    ctx.lineTo(x2 + 0.5, y2 + 0.5)
  }
  ctx.stroke()
  ctx.restore()
}

export default function AIWallsDebugPage() {
  const [status, setStatus] = useState('idle')
  const [progressMsg, setProgressMsg] = useState('')
  const [error, setError] = useState(null)
  const [picked, setPicked] = useState(TEST_IMAGES[0].url)
  const [blurKernel, setBlurKernel] = useState(3)
  const [invert, setInvert] = useState(true)
  const [morphKernel, setMorphKernel] = useState(15)
  const [morphDilatePx, setMorphDilatePx] = useState(3)
  const [houghThreshold, setHoughThreshold] = useState(50)
  const [minLineLengthRatio, setMinLineLengthRatio] = useState(0.02)
  const [maxLineGapPx, setMaxLineGapPx] = useState(8)
  const [showSegments, setShowSegments] = useState(true)
  const [overlayMode, setOverlayMode] = useState('merged') // 'raw' | 'merged' | 'both'
  const [mergeAngleTolDeg, setMergeAngleTolDeg] = useState(5)
  const [mergeOffsetTol, setMergeOffsetTol] = useState(4)
  const [mergeGapTol, setMergeGapTol] = useState(12)
  const [extendMissThreshold, setExtendMissThreshold] = useState(3)
  const [stats, setStats] = useState(null)
  const srcCanvasRef = useRef(null)
  const binCanvasRef = useRef(null)
  const morphCanvasRef = useRef(null)
  const segCanvasRef = useRef(null)
  const workerRef = useRef(null)
  const lastResultRef = useRef(null)

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

  // Re-render the seg overlay when toggle changes (no need to re-run worker).
  useEffect(() => {
    const last = lastResultRef.current
    if (!last) return
    const { morphImageData, segments, mergedSegments } = last
    const segCanvas = segCanvasRef.current
    if (!segCanvas) return
    segCanvas.width = morphImageData.width
    segCanvas.height = morphImageData.height
    const ctx = segCanvas.getContext('2d')
    ctx.putImageData(morphImageData, 0, 0)
    if (showSegments) {
      if (overlayMode === 'raw' || overlayMode === 'both') drawSegments(segCanvas, segments, '#ff3b3b')
      if (overlayMode === 'merged' || overlayMode === 'both') drawSegments(segCanvas, mergedSegments, '#3bff7b')
    }
  }, [showSegments, overlayMode])

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
          const {
            binaryImageData, morphImageData, width, height,
            whitePixels, morphWhitePixels,
            segments, segStats, mergedSegments, mergedStats,
            timings, elapsedMs,
          } = m.result

          // Binary preview canvas (Otsu output)
          const binCanvas = binCanvasRef.current
          binCanvas.width = width
          binCanvas.height = height
          binCanvas.getContext('2d').putImageData(binaryImageData, 0, 0)

          // Morph preview canvas (after directional open)
          const morphCanvas = morphCanvasRef.current
          morphCanvas.width = width
          morphCanvas.height = height
          morphCanvas.getContext('2d').putImageData(morphImageData, 0, 0)

          // Segments overlay (morph + lines — raw red, merged green)
          const segCanvas = segCanvasRef.current
          segCanvas.width = width
          segCanvas.height = height
          const segCtx = segCanvas.getContext('2d')
          segCtx.putImageData(morphImageData, 0, 0)
          if (showSegments) {
            if (overlayMode === 'raw' || overlayMode === 'both') drawSegments(segCanvas, segments, '#ff3b3b')
            if (overlayMode === 'merged' || overlayMode === 'both') drawSegments(segCanvas, mergedSegments, '#3bff7b')
          }

          lastResultRef.current = { morphImageData, segments, mergedSegments }

          setStats({
            width, height,
            elapsedMs: Math.round(elapsedMs),
            whitePixels,
            whiteRatio: (whitePixels / (width * height)).toFixed(3),
            morphWhitePixels,
            morphWhiteRatio: (morphWhitePixels / (width * height)).toFixed(3),
            segCount: segStats.count,
            segTotalLength: segStats.totalLengthPx,
            mergedCount: mergedStats.count,
            mergedTotalLength: mergedStats.totalLengthPx,
            minLineLength: segStats.minLineLength,
            maxLineGap: segStats.maxLineGap,
            houghThreshold: segStats.threshold,
            timings,
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
        {
          type: 'run',
          payload: {
            imageData,
            options: {
              blurKernel,
              invert,
              morphKernel,
              morphDilatePx,
              houghThreshold,
              minLineLengthRatio,
              maxLineGapPx,
              mergeAngleTolDeg,
              mergeOffsetTol,
              mergeGapTol,
              extendMissThreshold,
            },
          },
        },
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
      <h2>AI Walls Debug — 16-3a preprocess + 16-3e morph + 16-3f HoughLinesP + 16-3h merge</h2>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
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
          <input type="number" min={1} max={15} step={2}
            value={blurKernel} onChange={(e) => setBlurKernel(Number(e.target.value) || 3)}
            style={{ width: 50 }} disabled={busy} />
        </label>
        <label>
          <input type="checkbox" checked={invert}
            onChange={(e) => setInvert(e.target.checked)} disabled={busy} />
          &nbsp;Invert (walls = white)
        </label>
        <label title="Long-line detection kernel (H + V). 0 = skip. Bigger = require longer continuous run to qualify as a wall.">
          Morph K:&nbsp;
          <input type="number" min={0} max={51} step={2}
            value={morphKernel}
            onChange={(e) => setMorphKernel(Number(e.target.value) || 0)}
            style={{ width: 50 }} disabled={busy} />
        </label>
        <label title="Mask dilation in px — tolerance around detected long lines so original-thickness walls survive intact.">
          Mask dilate:&nbsp;
          <input type="number" min={0} max={20} step={1}
            value={morphDilatePx}
            onChange={(e) => setMorphDilatePx(Number(e.target.value) || 0)}
            style={{ width: 50 }} disabled={busy} />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label title="Hough vote threshold; higher = stricter">
          Hough thr:&nbsp;
          <input type="number" min={1} max={500} step={1}
            value={houghThreshold} onChange={(e) => setHoughThreshold(Number(e.target.value) || 50)}
            style={{ width: 60 }} disabled={busy} />
        </label>
        <label title="Min line length as ratio of image diagonal (e.g. 0.02 = 2%)">
          Min len ratio:&nbsp;
          <input type="number" min={0.005} max={0.2} step={0.005}
            value={minLineLengthRatio}
            onChange={(e) => setMinLineLengthRatio(Number(e.target.value) || 0.02)}
            style={{ width: 70 }} disabled={busy} />
        </label>
        <label title="Max gap (px) between collinear segments to merge">
          Max gap (px):&nbsp;
          <input type="number" min={1} max={50} step={1}
            value={maxLineGapPx} onChange={(e) => setMaxLineGapPx(Number(e.target.value) || 8)}
            style={{ width: 60 }} disabled={busy} />
        </label>
        <label title="Merge: max angle difference (deg). 0 = skip merge.">
          ⤳ angle:&nbsp;
          <input type="number" min={0} max={45} step={1}
            value={mergeAngleTolDeg}
            onChange={(e) => setMergeAngleTolDeg(Number(e.target.value) || 0)}
            style={{ width: 50 }} disabled={busy} />
        </label>
        <label title="Merge: max perpendicular offset (px) — half of typical wall thickness">
          ⤳ offset:&nbsp;
          <input type="number" min={1} max={30} step={1}
            value={mergeOffsetTol}
            onChange={(e) => setMergeOffsetTol(Number(e.target.value) || 1)}
            style={{ width: 50 }} disabled={busy} />
        </label>
        <label title="Merge: max along-axis gap (px) between collinear segments">
          ⤳ gap:&nbsp;
          <input type="number" min={1} max={100} step={1}
            value={mergeGapTol}
            onChange={(e) => setMergeGapTol(Number(e.target.value) || 1)}
            style={{ width: 50 }} disabled={busy} />
        </label>
        <label title="Endpoint extension: stop after this many consecutive empty px. 0 = skip.">
          ⇥ extend miss:&nbsp;
          <input type="number" min={0} max={20} step={1}
            value={extendMissThreshold}
            onChange={(e) => setExtendMissThreshold(Number(e.target.value) || 0)}
            style={{ width: 50 }} disabled={busy} />
        </label>
        <label>
          <input type="checkbox" checked={showSegments}
            onChange={(e) => setShowSegments(e.target.checked)} />
          &nbsp;Show segments
        </label>
        <label>
          Overlay:&nbsp;
          <select value={overlayMode} onChange={(e) => setOverlayMode(e.target.value)}>
            <option value="raw">Raw (red)</option>
            <option value="merged">Merged (green)</option>
            <option value="both">Both</option>
          </select>
        </label>
        <button onClick={run} disabled={busy}>Run</button>
        <button onClick={cancel} disabled={!busy}>Cancel</button>
        <span style={{ opacity: 0.7 }}>
          status: {status}{progressMsg ? ` — ${progressMsg}` : ''}
        </span>
      </div>

      {error && <div style={{ color: '#ff6b6b', marginBottom: 12 }}>Error: {error}</div>}
      {stats && (
        <div style={{ marginBottom: 12, fontSize: 13, opacity: 0.85, lineHeight: 1.6 }}>
          <div>
            {stats.width}×{stats.height} · total {stats.elapsedMs}ms
            (binarize {stats.timings?.binarizeMs}ms +
             morph {stats.timings?.morphMs}ms +
             hough {stats.timings?.houghMs}ms +
             merge {stats.timings?.mergeMs}ms +
             extend {stats.timings?.extendMs}ms)
          </div>
          <div>
            binary white {stats.whitePixels} ({stats.whiteRatio}) ·
            morph white {stats.morphWhitePixels} ({stats.morphWhiteRatio})
          </div>
          <div>
            <span style={{ color: '#ff6b6b' }}>raw {stats.segCount} segs / {stats.segTotalLength}px</span>
            &nbsp;→&nbsp;
            <span style={{ color: '#3bff7b' }}>merged {stats.mergedCount} segs / {stats.mergedTotalLength}px</span>
            &nbsp;· minLen {stats.minLineLength}px, maxGap {stats.maxLineGap}px, thr {stats.houghThreshold}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <div>
          <div style={{ marginBottom: 4, opacity: 0.7 }}>Source</div>
          <canvas ref={srcCanvasRef} style={{ maxWidth: '100%', border: '1px solid #333', background: '#000' }} />
        </div>
        <div>
          <div style={{ marginBottom: 4, opacity: 0.7 }}>Binary (Otsu)</div>
          <canvas ref={binCanvasRef} style={{ maxWidth: '100%', border: '1px solid #333', background: '#000' }} />
        </div>
        <div>
          <div style={{ marginBottom: 4, opacity: 0.7 }}>Long-line mask × original</div>
          <canvas ref={morphCanvasRef} style={{ maxWidth: '100%', border: '1px solid #333', background: '#000' }} />
        </div>
        <div>
          <div style={{ marginBottom: 4, opacity: 0.7 }}>
            Morph + segments (<span style={{ color: '#ff6b6b' }}>raw</span> / <span style={{ color: '#3bff7b' }}>merged</span>)
          </div>
          <canvas ref={segCanvasRef} style={{ maxWidth: '100%', border: '1px solid #333', background: '#000' }} />
        </div>
      </div>
    </div>
  )
}
