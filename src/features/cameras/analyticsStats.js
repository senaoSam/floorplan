// Analytics computations for Camera mode (Phase 34-5):
//   - tripwire crossing counts (directional)
//   - rectangular zone statistics (entries / avg dwell / peak hour / hourly histogram)
//   - flow grid (average movement direction per cell)
// All use the same analysis window [tFromSec, tToSec] as the occupancy
// heatmap, and the same sparse waypoint Track shape from mockTracks.

const SAMPLE_DT_SEC = 1

// ── Tripwire ──────────────────────────────────────────────────────────────
// Counts how many track legs cross the line A→B inside the window, split by
// direction: `forward` = movement along the line's left normal
// (perpendicular, 90° counter-clockwise from A→B in canvas coords), `backward`
// = the other way. The layer draws the two arrows so users never need the
// math — just "12 this way, 9 that way".
export function computeTripwireCounts(tripwire, tracks, tFromSec, tToSec) {
  const { x1, y1, x2, y2 } = tripwire
  const ex = x2 - x1
  const ey = y2 - y1
  let forward = 0
  let backward = 0
  for (const track of tracks ?? []) {
    if (track.t1 < tFromSec || track.t0 > tToSec) continue
    const s = track.samples
    for (let i = 0; i + 1 < s.length; i++) {
      const a = s[i], b = s[i + 1]
      if (b.t < tFromSec || a.t > tToSec) continue
      if (a.x === b.x && a.y === b.y) continue
      // segment-segment intersection (strict interior)
      const dx = b.x - a.x
      const dy = b.y - a.y
      const denom = dx * ey - dy * ex
      if (Math.abs(denom) < 1e-12) continue
      const t = ((x1 - a.x) * ey - (y1 - a.y) * ex) / denom
      const u = ((x1 - a.x) * dy - (y1 - a.y) * dx) / denom
      if (t <= 1e-9 || t >= 1 - 1e-9 || u < 0 || u > 1) continue
      // The crossing MOMENT (not just the leg) must fall inside the window —
      // a leg can straddle the window edge with its crossing outside it.
      const crossT = a.t + t * (b.t - a.t)
      if (crossT < tFromSec || crossT > tToSec) continue
      // side sign: cross(line dir, movement dir) > 0 → crossing toward the
      // left normal (canvas y-down) — call that "forward".
      const crossSign = ex * dy - ey * dx
      if (crossSign > 0) forward += 1
      else backward += 1
    }
  }
  return { forward, backward }
}

// ── Zone ──────────────────────────────────────────────────────────────────
// Integrates presence at 1s steps. Returns:
//   entries      — number of enter events (a track entering twice counts 2)
//   uniqueTracks — distinct tracks that were ever inside
//   totalSec     — accumulated person-seconds inside
//   avgDwellSec  — totalSec / entries
//   peakHour     — hour (0-23) with the most person-seconds, null when empty
//   hourly       — [{ hour, sec }] histogram over the window's hours
export function computeZoneStats(zone, tracks, tFromSec, tToSec) {
  const x0 = Math.min(zone.x, zone.x + zone.w)
  const x1 = Math.max(zone.x, zone.x + zone.w)
  const y0 = Math.min(zone.y, zone.y + zone.h)
  const y1 = Math.max(zone.y, zone.y + zone.h)
  const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1

  const hourSec = new Map()
  let entries = 0
  let uniqueTracks = 0
  let totalSec = 0

  for (const track of tracks ?? []) {
    const t0 = Math.max(track.t0, tFromSec)
    const t1 = Math.min(track.t1, tToSec)
    if (t1 <= t0) continue
    let wasInside = false
    let everInside = false
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
        const isIn = inside(x, y)
        if (isIn) {
          if (!wasInside) entries += 1
          if (!everInside) { everInside = true; uniqueTracks += 1 }
          const dt = Math.min(SAMPLE_DT_SEC, legT1 - t)
          totalSec += dt
          const hour = Math.floor(t / 3600)
          hourSec.set(hour, (hourSec.get(hour) ?? 0) + dt)
        }
        wasInside = isIn
      }
    }
  }

  let peakHour = null
  let peakSec = 0
  const hourly = []
  const hFrom = Math.floor(tFromSec / 3600)
  const hTo = Math.ceil(tToSec / 3600)
  for (let h = hFrom; h < hTo; h++) {
    const sec = hourSec.get(h) ?? 0
    hourly.push({ hour: h, sec })
    if (sec > peakSec) { peakSec = sec; peakHour = h }
  }

  return {
    entries,
    uniqueTracks,
    totalSec,
    avgDwellSec: entries > 0 ? totalSec / entries : 0,
    peakHour,
    hourly,
  }
}

// ── Flow grid ─────────────────────────────────────────────────────────────
// Average movement vector per cell over the window. Dwell steps (zero
// velocity) are skipped — the flow map shows WHERE PEOPLE MOVE, the dwell
// heatmap already covers where they stand still.
// Returns { cells: [{ cx, cy, vx, vy, count }], cols, rows, cellPx, maxCount }
export function computeFlowGrid({
  tracks, tFromSec, tToSec, imageWidth, imageHeight, pxPerM, cellM = 1,
}) {
  if (!tracks || tracks.length === 0 || !imageWidth || !imageHeight) return null
  const cellPx = Math.max(4, cellM * (pxPerM || 40))
  const cols = Math.max(1, Math.ceil(imageWidth / cellPx))
  const rows = Math.max(1, Math.ceil(imageHeight / cellPx))
  const sumX = new Float32Array(cols * rows)
  const sumY = new Float32Array(cols * rows)
  const cnt = new Float32Array(cols * rows)

  for (const track of tracks) {
    const t0 = Math.max(track.t0, tFromSec)
    const t1 = Math.min(track.t1, tToSec)
    if (t1 <= t0) continue
    const s = track.samples
    for (let i = 0; i + 1 < s.length; i++) {
      const a = s[i], b = s[i + 1]
      const legT0 = Math.max(a.t, t0)
      const legT1 = Math.min(b.t, t1)
      if (legT1 <= legT0) continue
      const legDur = b.t - a.t
      if (legDur <= 0) continue
      const vx = (b.x - a.x) / legDur   // px/s
      const vy = (b.y - a.y) / legDur
      if (Math.abs(vx) < 1e-9 && Math.abs(vy) < 1e-9) continue   // dwell
      for (let t = legT0; t < legT1; t += SAMPLE_DT_SEC) {
        const f = (t - a.t) / legDur
        const x = a.x + (b.x - a.x) * f
        const y = a.y + (b.y - a.y) * f
        const cx = Math.min(cols - 1, Math.max(0, Math.floor(x / cellPx)))
        const cy = Math.min(rows - 1, Math.max(0, Math.floor(y / cellPx)))
        const idx = cy * cols + cx
        sumX[idx] += vx
        sumY[idx] += vy
        cnt[idx] += 1
      }
    }
  }

  const cells = []
  let maxCount = 0
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const idx = cy * cols + cx
      const c = cnt[idx]
      if (c <= 0) continue
      const vx = sumX[idx] / c
      const vy = sumY[idx] / c
      // Counter-flows cancel out — only keep cells with a clear net direction.
      if (Math.hypot(vx, vy) < 1e-3) continue
      cells.push({ cx, cy, vx, vy, count: c })
      if (c > maxCount) maxCount = c
    }
  }
  if (cells.length === 0) return null
  return { cells, cols, rows, cellPx, maxCount }
}
