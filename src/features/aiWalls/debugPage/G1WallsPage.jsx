import React, { useEffect, useRef, useState, useCallback } from 'react'
import { cleanupVectors } from '@/features/aiWalls/cleanup'

// walls.md pipeline — pure JS color-segmentation extractor.
//   image → classifyPixel → masks → row/col scan → merge → vectors
// Target: public/sample-walls/g1.png (clean orthogonal floorplan with
// black walls / yellow doors / blue windows).

const G1_URL = `${import.meta.env.BASE_URL}sample-walls/g1.png`

const DEFAULT_CONFIG = {
  blackThreshold: 50,
  yellow: { r: 180, g: 150, b: 120 },
  blue:   { r: 130, g: 120, b: 150 },
  minSegmentLength: 8,
  mergeTolerance: 5,
}

const TYPE_COLORS = {
  wall:   '#000000',
  door:   '#e6a300',
  window: '#3b82f6',
}

function classifyPixel(r, g, b, cfg) {
  if (r < cfg.blackThreshold && g < cfg.blackThreshold && b < cfg.blackThreshold) return 'wall'
  if (r > cfg.yellow.r && g > cfg.yellow.g && b < cfg.yellow.b) return 'door'
  if (r < cfg.blue.r   && g > cfg.blue.g   && b > cfg.blue.b)   return 'window'
  return null
}

function buildMasks(imageData, cfg) {
  const { width, height, data } = imageData
  const masks = {
    wall:   new Uint8Array(width * height),
    door:   new Uint8Array(width * height),
    window: new Uint8Array(width * height),
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const t = classifyPixel(data[i], data[i + 1], data[i + 2], cfg)
      if (t) masks[t][y * width + x] = 1
    }
  }
  return masks
}

function extractHorizontalSegments(mask, width, height, minLength) {
  const segments = []
  for (let y = 0; y < height; y++) {
    let start = null
    for (let x = 0; x < width; x++) {
      const v = mask[y * width + x]
      if (v && start === null) start = x
      if ((!v || x === width - 1) && start !== null) {
        const end = (v && x === width - 1) ? x : x - 1
        if (end - start + 1 >= minLength) {
          segments.push({ x1: start, y1: y, x2: end, y2: y, orientation: 'horizontal' })
        }
        start = null
      }
    }
  }
  return segments
}

function extractVerticalSegments(mask, width, height, minLength) {
  const segments = []
  for (let x = 0; x < width; x++) {
    let start = null
    for (let y = 0; y < height; y++) {
      const v = mask[y * width + x]
      if (v && start === null) start = y
      if ((!v || y === height - 1) && start !== null) {
        const end = (v && y === height - 1) ? y : y - 1
        if (end - start + 1 >= minLength) {
          segments.push({ x1: x, y1: start, x2: x, y2: end, orientation: 'vertical' })
        }
        start = null
      }
    }
  }
  return segments
}

function mergeHorizontalSegments(segments, tolerance) {
  const groups = []
  for (const seg of segments) {
    let matched = null
    for (const g of groups) {
      const sameY = Math.abs(g.cy - seg.y1) <= tolerance
      const overlap = !(seg.x2 < g.x1 - tolerance || seg.x1 > g.x2 + tolerance)
      if (sameY && overlap) { matched = g; break }
    }
    if (matched) {
      matched.items.push(seg)
      matched.x1 = Math.min(matched.x1, seg.x1)
      matched.x2 = Math.max(matched.x2, seg.x2)
      matched.cy = Math.round(matched.items.reduce((s, x) => s + x.y1, 0) / matched.items.length)
    } else {
      groups.push({ items: [seg], x1: seg.x1, x2: seg.x2, cy: seg.y1 })
    }
  }
  return groups.map(g => ({
    x1: g.x1, y1: g.cy, x2: g.x2, y2: g.cy,
    thickness: g.items.length, orientation: 'horizontal',
  }))
}

function mergeVerticalSegments(segments, tolerance) {
  const groups = []
  for (const seg of segments) {
    let matched = null
    for (const g of groups) {
      const sameX = Math.abs(g.cx - seg.x1) <= tolerance
      const overlap = !(seg.y2 < g.y1 - tolerance || seg.y1 > g.y2 + tolerance)
      if (sameX && overlap) { matched = g; break }
    }
    if (matched) {
      matched.items.push(seg)
      matched.y1 = Math.min(matched.y1, seg.y1)
      matched.y2 = Math.max(matched.y2, seg.y2)
      matched.cx = Math.round(matched.items.reduce((s, x) => s + x.x1, 0) / matched.items.length)
    } else {
      groups.push({ items: [seg], y1: seg.y1, y2: seg.y2, cx: seg.x1 })
    }
  }
  return groups.map(g => ({
    x1: g.cx, y1: g.y1, x2: g.cx, y2: g.y2,
    thickness: g.items.length, orientation: 'vertical',
  }))
}

function extractVectors(imageData, cfg) {
  const { width, height } = imageData
  const masks = buildMasks(imageData, cfg)
  const result = {}
  for (const type of ['wall', 'door', 'window']) {
    const mask = masks[type]
    const h = extractHorizontalSegments(mask, width, height, cfg.minSegmentLength)
    const v = extractVerticalSegments(mask, width, height, cfg.minSegmentLength)
    const mh = mergeHorizontalSegments(h, cfg.mergeTolerance)
    const mv = mergeVerticalSegments(v, cfg.mergeTolerance)
    result[type] = [
      ...mh.map(seg => ({ ...seg, type })),
      ...mv.map(seg => ({ ...seg, type })),
    ]
  }
  return { masks, vectors: result, width, height }
}

function maskToImageData(mask, width, height, [r, g, b]) {
  const out = new ImageData(width, height)
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      const j = i * 4
      out.data[j] = r; out.data[j + 1] = g; out.data[j + 2] = b; out.data[j + 3] = 255
    }
  }
  return out
}

// butt cap so endpoints don't bulge past the segment.
function drawVecs(ctx, list, type, strokeMode) {
  ctx.strokeStyle = TYPE_COLORS[type]
  ctx.lineCap = 'butt'
  for (const v of list) {
    ctx.lineWidth = strokeMode === 'scaled'
      ? Math.max(1, Math.min(v.thickness ?? 1, 12))
      : 1.5
    ctx.beginPath()
    ctx.moveTo(v.x1 + 0.5, v.y1 + 0.5)
    ctx.lineTo(v.x2 + 0.5, v.y2 + 0.5)
    ctx.stroke()
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

export default function G1WallsPage() {
  const [cfg, setCfg] = useState(DEFAULT_CONFIG)
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [strokeMode, setStrokeMode] = useState('thin') // 'thin' | 'scaled'

  const srcRef         = useRef(null)
  const wallMaskRef    = useRef(null)
  const doorMaskRef    = useRef(null)
  const windowMaskRef  = useRef(null)
  const vectorRef      = useRef(null)
  const cleanRef       = useRef(null)
  const graphRef       = useRef(null)
  const imgRef         = useRef(null)

  const run = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      let img = imgRef.current
      if (!img) {
        img = await loadImage(G1_URL)
        imgRef.current = img
      }
      const w = img.naturalWidth, h = img.naturalHeight

      // Source
      const src = srcRef.current
      src.width = w; src.height = h
      const sctx = src.getContext('2d')
      sctx.drawImage(img, 0, 0)
      const imageData = sctx.getImageData(0, 0, w, h)

      const t0 = performance.now()
      const { masks, vectors } = extractVectors(imageData, cfg)
      const tExtract = performance.now() - t0

      const tC0 = performance.now()
      const cleaned = cleanupVectors(vectors)
      const tCleanup = performance.now() - tC0

      // Mask previews — coloured pixels on white background.
      const drawMask = (canvas, mask, rgb) => {
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, w, h)
        ctx.putImageData(maskToImageData(mask, w, h, rgb), 0, 0)
      }
      drawMask(wallMaskRef.current,   masks.wall,   [0, 0, 0])
      drawMask(doorMaskRef.current,   masks.door,   [230, 163, 0])
      drawMask(windowMaskRef.current, masks.window, [59, 130, 246])

      // Vector output canvas — the "new canvas" with extracted vectors only.
      const vec = vectorRef.current
      vec.width = w; vec.height = h
      const vctx = vec.getContext('2d')
      vctx.fillStyle = '#fff'
      vctx.fillRect(0, 0, w, h)
      // Draw walls last so they sit on top of openings at intersections.
      drawVecs(vctx, vectors.window, 'window', strokeMode)
      drawVecs(vctx, vectors.door,   'door',   strokeMode)
      drawVecs(vctx, vectors.wall,   'wall',   strokeMode)

      // Cleaned vectors → second canvas (View 2 in walls.md spec).
      const clean = cleanRef.current
      clean.width = w; clean.height = h
      const cctx = clean.getContext('2d')
      cctx.fillStyle = '#fff'
      cctx.fillRect(0, 0, w, h)
      drawVecs(cctx, cleaned.windows, 'window', 'thin')
      drawVecs(cctx, cleaned.doors,   'door',   'thin')
      drawVecs(cctx, cleaned.walls,   'wall',   'thin')

      // Topology graph → third canvas (View 3): wall edges + junction nodes.
      const gph = graphRef.current
      gph.width = w; gph.height = h
      const gctx = gph.getContext('2d')
      gctx.fillStyle = '#fff'
      gctx.fillRect(0, 0, w, h)
      gctx.strokeStyle = '#444'
      gctx.lineWidth = 1
      gctx.beginPath()
      for (const v of cleaned.walls) {
        gctx.moveTo(v.x1 + 0.5, v.y1 + 0.5)
        gctx.lineTo(v.x2 + 0.5, v.y2 + 0.5)
      }
      gctx.stroke()
      // Nodes — colour-coded by degree (L=2 yellow, T=3 orange, X=4+ red).
      for (const n of cleaned.nodes) {
        const deg = n.connectedSegments.length
        gctx.fillStyle = deg >= 4 ? '#ef4444' : deg === 3 ? '#f97316' : '#eab308'
        gctx.beginPath()
        gctx.arc(n.x, n.y, 3.5, 0, Math.PI * 2)
        gctx.fill()
      }

      const sumLen = (arr) => arr.reduce((s, v) => s + Math.hypot(v.x2 - v.x1, v.y2 - v.y1), 0)
      const attachedCount = (arr) => arr.filter(o => o.parentWallIndex != null).length
      setStats({
        width: w, height: h,
        extractMs: Math.round(tExtract),
        cleanupMs: Math.round(tCleanup),
        raw: {
          wall:   { count: vectors.wall.length,   length: Math.round(sumLen(vectors.wall)) },
          door:   { count: vectors.door.length,   length: Math.round(sumLen(vectors.door)) },
          window: { count: vectors.window.length, length: Math.round(sumLen(vectors.window)) },
        },
        clean: {
          wall:   { count: cleaned.walls.length,   length: Math.round(sumLen(cleaned.walls)) },
          door:   { count: cleaned.doors.length,   length: Math.round(sumLen(cleaned.doors)),   attached: attachedCount(cleaned.doors) },
          window: { count: cleaned.windows.length, length: Math.round(sumLen(cleaned.windows)), attached: attachedCount(cleaned.windows) },
          nodes:  cleaned.nodes.length,
        },
      })
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }, [cfg, strokeMode])

  useEffect(() => { run() }, [strokeMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const setNum = (key) => (e) => {
    const n = Number(e.target.value)
    setCfg((c) => ({ ...c, [key]: Number.isFinite(n) ? n : c[key] }))
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui', color: '#eee', background: '#1e1e1e', minHeight: '100vh' }}>
      <h2>G1 Walls — walls.md pipeline (pure JS, no OpenCV)</h2>
      <div style={{ opacity: 0.7, marginBottom: 8, fontSize: 13 }}>
        Source: <code>public/sample-walls/g1.png</code>　·
        Pipeline: classifyPixel → masks → row/col scan → merge → vectors
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label title="r,g,b all below this = wall">
          Black thr:&nbsp;
          <input type="number" min={1} max={120} value={cfg.blackThreshold}
                 onChange={setNum('blackThreshold')} style={{ width: 60 }} disabled={busy} />
        </label>
        <label>Min seg len:&nbsp;
          <input type="number" min={1} max={50} value={cfg.minSegmentLength}
                 onChange={setNum('minSegmentLength')} style={{ width: 60 }} disabled={busy} />
        </label>
        <label>Merge tol:&nbsp;
          <input type="number" min={0} max={20} value={cfg.mergeTolerance}
                 onChange={setNum('mergeTolerance')} style={{ width: 60 }} disabled={busy} />
        </label>
        <label>Stroke:&nbsp;
          <select value={strokeMode} onChange={(e) => setStrokeMode(e.target.value)} disabled={busy}>
            <option value="thin">thin (1.5px centerline)</option>
            <option value="scaled">scaled by thickness</option>
          </select>
        </label>
        <button onClick={run} disabled={busy}>{busy ? 'Running…' : 'Re-run'}</button>
        {error && <span style={{ color: '#ff6b6b' }}>Error: {error}</span>}
      </div>

      {stats && (
        <div style={{ marginBottom: 12, fontSize: 13, opacity: 0.85, lineHeight: 1.6 }}>
          <div>{stats.width}×{stats.height} · extract {stats.extractMs}ms · cleanup {stats.cleanupMs}ms</div>
          <div>
            raw —&nbsp;
            <span style={{ color: '#fff' }}>wall {stats.raw.wall.count}/{stats.raw.wall.length}px</span>
            &nbsp;·&nbsp;
            <span style={{ color: '#e6a300' }}>door {stats.raw.door.count}/{stats.raw.door.length}px</span>
            &nbsp;·&nbsp;
            <span style={{ color: '#3b82f6' }}>window {stats.raw.window.count}/{stats.raw.window.length}px</span>
          </div>
          <div>
            cleaned —&nbsp;
            <span style={{ color: '#fff' }}>wall {stats.clean.wall.count}/{stats.clean.wall.length}px</span>
            &nbsp;·&nbsp;
            <span style={{ color: '#e6a300' }}>door {stats.clean.door.count}/{stats.clean.door.length}px ({stats.clean.door.attached} attached)</span>
            &nbsp;·&nbsp;
            <span style={{ color: '#3b82f6' }}>window {stats.clean.window.count}/{stats.clean.window.length}px ({stats.clean.window.attached} attached)</span>
            &nbsp;·&nbsp;
            <span style={{ color: '#eab308' }}>{stats.clean.nodes} nodes</span>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <div>
          <div style={{ marginBottom: 4, opacity: 0.7 }}>Source (g1.png)</div>
          <canvas ref={srcRef} style={{ maxWidth: '100%', border: '1px solid #333', background: '#fff' }} />
        </div>
        <div>
          <div style={{ marginBottom: 4, opacity: 0.7 }}>
            View 1 — Raw vectors (before cleanup)
          </div>
          <canvas ref={vectorRef} style={{ maxWidth: '100%', border: '1px solid #333', background: '#fff' }} />
        </div>
        <div>
          <div style={{ marginBottom: 4, opacity: 0.7 }}>
            View 2 — Cleaned vectors (Steps 1–7)
          </div>
          <canvas ref={cleanRef} style={{ maxWidth: '100%', border: '1px solid #3bff7b', background: '#fff' }} />
        </div>
        <div>
          <div style={{ marginBottom: 4, opacity: 0.7 }}>
            View 3 — Topology graph (junctions:&nbsp;
            <span style={{ color: '#eab308' }}>L</span>&nbsp;·&nbsp;
            <span style={{ color: '#f97316' }}>T</span>&nbsp;·&nbsp;
            <span style={{ color: '#ef4444' }}>X</span>)
          </div>
          <canvas ref={graphRef} style={{ maxWidth: '100%', border: '1px solid #333', background: '#fff' }} />
        </div>
        <div>
          <div style={{ marginBottom: 4, opacity: 0.7 }}>Wall mask</div>
          <canvas ref={wallMaskRef} style={{ maxWidth: '100%', border: '1px solid #333', background: '#fff' }} />
        </div>
        <div>
          <div style={{ marginBottom: 4, opacity: 0.7 }}>Door mask</div>
          <canvas ref={doorMaskRef} style={{ maxWidth: '100%', border: '1px solid #333', background: '#fff' }} />
        </div>
        <div>
          <div style={{ marginBottom: 4, opacity: 0.7 }}>Window mask</div>
          <canvas ref={windowMaskRef} style={{ maxWidth: '100%', border: '1px solid #333', background: '#fff' }} />
        </div>
      </div>
    </div>
  )
}
