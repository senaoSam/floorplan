// Occupancy (footfall) grid for Camera mode (Phase 34-3).
//
// Two metrics over a selectable time window of the day:
//   traffic — how many distinct tracks touched each cell ("人潮多寡")
//   dwell   — total seconds spent in each cell ("平均停留哪裡久")
// Tracks are integrated at a fixed time step so a person lingering at a shelf
// piles seconds onto the same cell, while a passer-by leaves a thin line.

const SAMPLE_DT_SEC = 1
export const OCCUPANCY_CELL_M = 0.5

// Returns { grid: Float32Array(cols*rows), cols, rows, cellPx, maxVal, p95 }
// or null when there's nothing to integrate.
//
// `maskFn` (optional): (cols, rows, cellPx) => Uint8Array(cols*rows) | null.
// When it returns a mask, cells where mask[idx] === 0 are zeroed out — used to
// clip the heatmap to camera FOV coverage (Verkada renders footfall only inside
// FOV). Built by the caller (it owns cameras/walls) but applied here so it lands
// on the SAME grid this function computed.
export function computeOccupancyGrid({
  tracks,
  tFromSec,
  tToSec,
  imageWidth,
  imageHeight,
  pxPerM,
  mode,             // 'traffic' | 'dwell'
  maskFn,
}) {
  if (!tracks || tracks.length === 0 || !imageWidth || !imageHeight) return null
  const cellPx = Math.max(2, OCCUPANCY_CELL_M * (pxPerM || 40))
  const cols = Math.max(1, Math.ceil(imageWidth / cellPx))
  const rows = Math.max(1, Math.ceil(imageHeight / cellPx))
  const grid = new Float32Array(cols * rows)
  const isTraffic = mode === 'traffic'
  const visited = isTraffic ? new Set() : null

  for (const track of tracks) {
    const t0 = Math.max(track.t0, tFromSec)
    const t1 = Math.min(track.t1, tToSec)
    if (t1 <= t0) continue
    if (visited) visited.clear()

    // Walk the waypoint list directly (cheaper than sampleTrackAt per step —
    // no binary search), integrating each leg that overlaps the window.
    const s = track.samples
    for (let i = 0; i + 1 < s.length; i++) {
      const a = s[i], b = s[i + 1]
      const legT0 = Math.max(a.t, t0)
      const legT1 = Math.min(b.t, t1)
      if (legT1 <= legT0) continue
      const legDur = b.t - a.t
      for (let t = legT0; t < legT1; t += SAMPLE_DT_SEC) {
        const f = legDur > 0 ? (t - a.t) / legDur : 0
        const x = a.x + (b.x - a.x) * f
        const y = a.y + (b.y - a.y) * f
        // 52-B3: Math.max(0, NaN) is NaN, so the clamp below cannot stop a
        // bad coordinate on its own — grid[NaN] is silently dropped, and an
        // Infinity clamps to the last cell, heaping every track into the
        // bottom-right corner. Gate explicitly before indexing.
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        const cx = Math.min(cols - 1, Math.max(0, Math.floor(x / cellPx)))
        const cy = Math.min(rows - 1, Math.max(0, Math.floor(y / cellPx)))
        const idx = cy * cols + cx
        if (isTraffic) {
          if (!visited.has(idx)) { visited.add(idx); grid[idx] += 1 }
        } else {
          grid[idx] += Math.min(SAMPLE_DT_SEC, legT1 - t)
        }
      }
    }
  }

  // Clip to camera FOV coverage if a mask is supplied — zero every cell no
  // online camera can see, so the heatmap renders only inside FOV (and p99
  // below normalises against visible cells only, not the dark floor).
  const mask = maskFn ? maskFn(cols, rows, cellPx) : null
  if (mask) {
    for (let i = 0; i < grid.length; i++) if (!mask[i]) grid[i] = 0
  }

  // Robust scale anchor — p99 of non-zero cells: keeps a single extreme POI
  // from washing the map out, while staying high enough that "walked past
  // once or twice" cells normalise near zero (the colormap hides them — a
  // quiet corner must read as TRANSPARENT, that's the whole point).
  const nonzero = []
  let maxVal = 0
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i]
    if (v > 0) { nonzero.push(v); if (v > maxVal) maxVal = v }
  }
  if (nonzero.length === 0) return null
  nonzero.sort((a, b) => a - b)
  const p99 = nonzero[Math.min(nonzero.length - 1, Math.floor(nonzero.length * 0.99))]

  return { grid, cols, rows, cellPx, maxVal, p99 }
}

// Blue → cyan → green → yellow → red, alpha ramps with intensity. The first
// 5% stays fully transparent so cells someone merely strolled through once
// don't tint the whole floor — quiet corners must stay readable as "empty".
const STOPS = [
  { v: 0.00, r: 37,  g: 99,  b: 235, a: 0 },
  { v: 0.05, r: 37,  g: 99,  b: 235, a: 0 },
  { v: 0.20, r: 37,  g: 99,  b: 235, a: 100 },
  { v: 0.40, r: 6,   g: 182, b: 212, a: 145 },
  { v: 0.60, r: 34,  g: 197, b: 94,  a: 175 },
  { v: 0.80, r: 234, g: 179, b: 8,   a: 200 },
  { v: 1.00, r: 239, g: 68,  b: 68,  a: 220 },
]

export function occupancyColor(norm) {
  const v = Math.min(1, Math.max(0, norm))
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i].v) {
      const a = STOPS[i - 1], b = STOPS[i]
      const f = (v - a.v) / (b.v - a.v || 1e-9)
      return [
        Math.round(a.r + (b.r - a.r) * f),
        Math.round(a.g + (b.g - a.g) * f),
        Math.round(a.b + (b.b - a.b) * f),
        Math.round(a.a + (b.a - a.a) * f),
      ]
    }
  }
  const last = STOPS[STOPS.length - 1]
  return [last.r, last.g, last.b, last.a]
}

// Paint the grid into a small offscreen canvas (one px per cell) — the PIXI
// sprite stretches it over the floor with bilinear filtering for smoothing.
export function renderOccupancyCanvas(result) {
  const { grid, cols, rows, p99 } = result
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(cols, rows)
  const data = img.data
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i]
    if (v <= 0) continue
    const [r, g, b, a] = occupancyColor(v / (p99 || 1))
    const o = i * 4
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}
