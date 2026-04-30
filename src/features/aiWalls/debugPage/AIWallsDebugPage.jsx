import React, { useEffect, useRef, useState } from 'react'

// Classic worker, served from /public so importScripts can fast-path opencv.js.
// (See public/workers/aiWalls.classic.worker.js for rationale.)
const WORKER_URL = `${import.meta.env.BASE_URL}workers/aiWalls.classic.worker.js`

const TEST_IMAGES = [
  { label: 'test-floorplan.png',  url: `${import.meta.env.BASE_URL}test-floorplan.png` },
  { label: 'sample-walls/1.png',  url: `${import.meta.env.BASE_URL}sample-walls/1.png` },
  { label: 'sample-walls/2.jpg',  url: `${import.meta.env.BASE_URL}sample-walls/2.jpg` },
  { label: 'sample-walls/3.png',  url: `${import.meta.env.BASE_URL}sample-walls/3.png` },
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

// Draw merged segments coloured by confidence bucket — high (green),
// medium (yellow), low (dim grey). 16-3l confidence visual gate.
function drawSegmentsByBucket(canvas, segments, scoringPer) {
  const ctx = canvas.getContext('2d')
  ctx.save()
  ctx.lineWidth = 1.5
  const buckets = { low: '#666', medium: '#ffd24a', high: '#3bff7b' }
  // Draw low → medium → high so high stays on top.
  for (const b of ['low', 'medium', 'high']) {
    ctx.strokeStyle = buckets[b]
    ctx.beginPath()
    for (let i = 0; i < segments.length; i++) {
      if (scoringPer?.[i]?.bucket !== b) continue
      const [x1, y1, x2, y2] = segments[i]
      ctx.moveTo(x1 + 0.5, y1 + 0.5)
      ctx.lineTo(x2 + 0.5, y2 + 0.5)
    }
    ctx.stroke()
  }
  ctx.restore()
}

// Draw merged segments split by paired-flag — paired in green, unpaired in
// dim grey. Lets you eyeball whether 16-3i pair detection is catching the
// real walls and rejecting furniture / dimension lines.
function drawSegmentsByPair(canvas, segments, perSegment, pairedColor, unpairedColor) {
  const ctx = canvas.getContext('2d')
  ctx.save()
  ctx.lineWidth = 1.5
  // Unpaired pass first so paired draws on top.
  ctx.strokeStyle = unpairedColor
  ctx.beginPath()
  for (let i = 0; i < segments.length; i++) {
    if (perSegment?.[i]?.paired) continue
    const [x1, y1, x2, y2] = segments[i]
    ctx.moveTo(x1 + 0.5, y1 + 0.5)
    ctx.lineTo(x2 + 0.5, y2 + 0.5)
  }
  ctx.stroke()
  ctx.strokeStyle = pairedColor
  ctx.beginPath()
  for (let i = 0; i < segments.length; i++) {
    if (!perSegment?.[i]?.paired) continue
    const [x1, y1, x2, y2] = segments[i]
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
  const [deskewEnabled, setDeskewEnabled] = useState(true)
  const [deskewMinDeg, setDeskewMinDeg] = useState(0.3)
  const [deskewMaxDeg, setDeskewMaxDeg] = useState(15)
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
  const [pairAngleTolDeg, setPairAngleTolDeg] = useState(5)
  const [minThicknessPx, setMinThicknessPx] = useState(2)
  const [maxThicknessPx, setMaxThicknessPx] = useState(30)
  const [pairOverlapRatio, setPairOverlapRatio] = useState(0.7)
  const [pairRelMaxRatio, setPairRelMaxRatio] = useState(0.3)
  const [adaptiveMorph, setAdaptiveMorph] = useState(true)
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
    const { morphImageData, segments, mergedSegments, perSegment, scoringPer } = last
    const segCanvas = segCanvasRef.current
    if (!segCanvas) return
    segCanvas.width = morphImageData.width
    segCanvas.height = morphImageData.height
    const ctx = segCanvas.getContext('2d')
    ctx.putImageData(morphImageData, 0, 0)
    if (showSegments) {
      if (overlayMode === 'raw') {
        drawSegments(segCanvas, segments, '#ff3b3b')
      } else if (overlayMode === 'merged') {
        drawSegments(segCanvas, mergedSegments, '#3bff7b')
      } else if (overlayMode === 'both') {
        drawSegments(segCanvas, segments, '#ff3b3b')
        drawSegments(segCanvas, mergedSegments, '#3bff7b')
      } else if (overlayMode === 'paired') {
        drawSegmentsByPair(segCanvas, mergedSegments, perSegment, '#3bff7b', '#666')
      } else if (overlayMode === 'confidence') {
        drawSegmentsByBucket(segCanvas, mergedSegments, scoringPer)
      }
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
            whitePixels, deskew, deskewWhitePixels, morphWhitePixels,
            segments, segStats, mergedSegments, mergedStats,
            wallThickness, scoring, adaptive, morphKernelUsed, maxLineGapUsed,
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
            if (overlayMode === 'raw') {
              drawSegments(segCanvas, segments, '#ff3b3b')
            } else if (overlayMode === 'merged') {
              drawSegments(segCanvas, mergedSegments, '#3bff7b')
            } else if (overlayMode === 'both') {
              drawSegments(segCanvas, segments, '#ff3b3b')
              drawSegments(segCanvas, mergedSegments, '#3bff7b')
            } else if (overlayMode === 'paired') {
              drawSegmentsByPair(segCanvas, mergedSegments, wallThickness?.perSegment, '#3bff7b', '#666')
            } else if (overlayMode === 'confidence') {
              drawSegmentsByBucket(segCanvas, mergedSegments, scoring?.perSegment)
            }
          }

          lastResultRef.current = {
            morphImageData, segments, mergedSegments,
            perSegment: wallThickness?.perSegment,
            scoringPer: scoring?.perSegment,
          }

          setStats({
            width, height,
            elapsedMs: Math.round(elapsedMs),
            whitePixels,
            whiteRatio: (whitePixels / (width * height)).toFixed(3),
            deskew,
            deskewWhitePixels,
            morphWhitePixels,
            morphWhiteRatio: (morphWhitePixels / (width * height)).toFixed(3),
            segCount: segStats.count,
            segTotalLength: segStats.totalLengthPx,
            mergedCount: mergedStats.count,
            mergedTotalLength: mergedStats.totalLengthPx,
            minLineLength: segStats.minLineLength,
            maxLineGap: segStats.maxLineGap,
            houghThreshold: segStats.threshold,
            wallThickness, scoring,
            adaptive, morphKernelUsed, maxLineGapUsed,
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
              deskewEnabled,
              deskewMinDeg,
              deskewMaxDeg,
              morphKernel,
              morphDilatePx,
              houghThreshold,
              minLineLengthRatio,
              maxLineGapPx,
              mergeAngleTolDeg,
              mergeOffsetTol,
              mergeGapTol,
              extendMissThreshold,
              pairAngleTolDeg,
              minThicknessPx,
              maxThicknessPx,
              pairOverlapRatio,
              relMaxRatio: pairRelMaxRatio,
              adaptiveMorph,
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
      <h2>AI Walls Debug — 16-3a preprocess + 16-3c deskew + 16-3e morph + 16-3f HoughLinesP + 16-3h merge</h2>

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
        <label title="Estimate skew via Hough angle histogram and warpAffine to true axes. Skipped if |angle| outside min/max range.">
          <input type="checkbox" checked={deskewEnabled}
            onChange={(e) => setDeskewEnabled(e.target.checked)} disabled={busy} />
          &nbsp;Deskew
        </label>
        <label title="If estimated |skew| < this many degrees, image is treated as already aligned (no rotation).">
          ⤳ min°:&nbsp;
          <input type="number" min={0} max={5} step={0.1}
            value={deskewMinDeg}
            onChange={(e) => setDeskewMinDeg(Number(e.target.value) || 0)}
            style={{ width: 50 }} disabled={busy || !deskewEnabled} />
        </label>
        <label title="If estimated |skew| > this many degrees, refuse to rotate (probably misdetection on a rotated building, not real skew).">
          ⤳ max°:&nbsp;
          <input type="number" min={1} max={45} step={1}
            value={deskewMaxDeg}
            onChange={(e) => setDeskewMaxDeg(Number(e.target.value) || 15)}
            style={{ width: 50 }} disabled={busy || !deskewEnabled} />
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
            <option value="paired">Paired only (16-3i)</option>
            <option value="confidence">Confidence buckets (16-3l)</option>
          </select>
        </label>
        <button onClick={run} disabled={busy}>Run</button>
        <button onClick={cancel} disabled={!busy}>Cancel</button>
        <span style={{ opacity: 0.7 }}>
          status: {status}{progressMsg ? ` — ${progressMsg}` : ''}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <strong style={{ opacity: 0.7 }}>16-3i pair detection:</strong>
        <label title="Pair search: max angle difference (deg) for two segments to count as parallel">
          ⤳ pair angle:&nbsp;
          <input type="number" min={0} max={20} step={0.5}
            value={pairAngleTolDeg}
            onChange={(e) => setPairAngleTolDeg(Number(e.target.value) || 0)}
            style={{ width: 50 }} disabled={busy} />
        </label>
        <label title="Min wall thickness (px). Below = same line, not a pair.">
          ⤳ min thick:&nbsp;
          <input type="number" min={0} max={20} step={1}
            value={minThicknessPx}
            onChange={(e) => setMinThicknessPx(Number(e.target.value) || 0)}
            style={{ width: 50 }} disabled={busy} />
        </label>
        <label title="Max wall thickness (px). Above = unrelated parallel.">
          ⤳ max thick:&nbsp;
          <input type="number" min={5} max={200} step={1}
            value={maxThicknessPx}
            onChange={(e) => setMaxThicknessPx(Number(e.target.value) || 30)}
            style={{ width: 50 }} disabled={busy} />
        </label>
        <label title="Min along-axis overlap / min(len_i, len_j). 0 = any touch counts.">
          ⤳ overlap:&nbsp;
          <input type="number" min={0} max={1} step={0.05}
            value={pairOverlapRatio}
            onChange={(e) => setPairOverlapRatio(Number(e.target.value) || 0)}
            style={{ width: 50 }} disabled={busy} />
        </label>
        <label title="Distance must be <= relMax × min(len). Wall is much longer than thick — kills 'two long diagonals across the room' false pairs.">
          ⤳ relMax:&nbsp;
          <input type="number" min={0.05} max={1} step={0.05}
            value={pairRelMaxRatio}
            onChange={(e) => setPairRelMaxRatio(Number(e.target.value) || 0.3)}
            style={{ width: 50 }} disabled={busy} />
        </label>
        <label title="If 16-3i pass-1 produces a credible thickness estimate AND it disagrees with current Morph K, re-run pass 2 with K ≈ 3 × thickness and maxLineGap ≈ 2 × thickness.">
          <input type="checkbox" checked={adaptiveMorph}
            onChange={(e) => setAdaptiveMorph(e.target.checked)} disabled={busy} />
          &nbsp;Adaptive morph (re-run pass 2)
        </label>
      </div>

      {error && <div style={{ color: '#ff6b6b', marginBottom: 12 }}>Error: {error}</div>}
      {stats && (
        <div style={{ marginBottom: 12, fontSize: 13, opacity: 0.85, lineHeight: 1.6 }}>
          <div>
            {stats.width}×{stats.height} · total {stats.elapsedMs}ms
            (binarize {stats.timings?.binarizeMs}ms +
             deskew {stats.timings?.deskewMs}ms +
             morph {stats.timings?.morphMs}ms +
             hough {stats.timings?.houghMs}ms +
             merge {stats.timings?.mergeMs}ms +
             extend {stats.timings?.extendMs}ms)
          </div>
          <div>
            Deskew:&nbsp;
            {stats.deskew?.applied ? (
              <span style={{ color: '#ffd24a' }}>
                applied {stats.deskew.angleDeg.toFixed(2)}° ·
                {stats.deskew.samples} samples ·
                peak weight {stats.deskew.peakWeight}px
              </span>
            ) : (
              <span style={{ opacity: 0.6 }}>
                skipped ({stats.deskew?.reason})
                {stats.deskew?.accepted
                  ? ` · estimated ${stats.deskew.angleDeg.toFixed(2)}° from ${stats.deskew.samples} samples`
                  : ''}
              </span>
            )}
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
          <div>
            Wall thickness:&nbsp;
            {stats.wallThickness?.estimatedPx != null ? (
              <span style={{ color: '#ffd24a' }}>
                ~{stats.wallThickness.estimatedPx.toFixed(2)} px (median)
              </span>
            ) : (
              <span style={{ opacity: 0.5 }}>n/a</span>
            )}
            {stats.wallThickness?.peakPx != null && (
              <span style={{ opacity: 0.7 }}>
                &nbsp;· peak {stats.wallThickness.peakPx.toFixed(2)} px (len-weighted)
              </span>
            )}
            &nbsp;· paired {stats.wallThickness?.pairedCount ?? 0} / {stats.wallThickness?.totalCount ?? 0}
            &nbsp;· thickness {stats.timings?.thicknessMs}ms
          </div>
          {stats.scoring?.perSegment && (() => {
            const counts = { high: 0, medium: 0, low: 0 }
            for (const p of stats.scoring.perSegment) counts[p.bucket]++
            const total = stats.scoring.perSegment.length || 1
            return (
              <div>
                Confidence:&nbsp;
                <span style={{ color: '#3bff7b' }}>high {counts.high} ({Math.round(counts.high * 100 / total)}%)</span>
                &nbsp;·&nbsp;
                <span style={{ color: '#ffd24a' }}>medium {counts.medium} ({Math.round(counts.medium * 100 / total)}%)</span>
                &nbsp;·&nbsp;
                <span style={{ color: '#888' }}>low {counts.low} ({Math.round(counts.low * 100 / total)}%)</span>
                &nbsp;· thresholds high≥{stats.scoring.thresholds.high} medium≥{stats.scoring.thresholds.medium}
                &nbsp;· scoring {stats.timings?.scoringMs}ms
              </div>
            )
          })()}
          <div>
            Adaptive: {stats.adaptive ? (
              <span style={{ color: '#9bd' }}>
                pass-1 K={stats.adaptive.initialK} → pass-2 K={stats.adaptive.targetK} ·
                gap {stats.adaptive.initialMaxGap}→{stats.adaptive.targetMaxGap} ·
                trigger est ~{stats.adaptive.firstPassEstimatedPx?.toFixed(2)}px
                ({stats.adaptive.firstPassPairedCount}/{stats.adaptive.firstPassTotalCount} paired)
              </span>
            ) : (
              <span style={{ opacity: 0.5 }}>
                no re-run · used K={stats.morphKernelUsed} maxGap={stats.maxLineGapUsed}
              </span>
            )}
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
