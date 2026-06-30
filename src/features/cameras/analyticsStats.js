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

// ── Floor-wide occupancy trend (Verkada "Occupancy Trends" parity) ──────────
// Per-hour activity for the WHOLE floor (not a single zone): how many distinct
// people/cars were present, and accumulated person-seconds, in each hour of
// the day. Drives the trend panel's bar chart + peak-hour callout. Counts a
// track in an hour if it has any sample inside that hour. Returns:
//   hourly  — [{ hour, people, cars, presentSec }]
//   peakHour, peakPresent — busiest hour by head-count (people, ties → earliest)
//   totalPeople, totalCars — distinct tracks over the whole day
export function computeFloorTrend(tracks, dayStartSec, dayEndSec) {
  const hFrom = Math.floor(dayStartSec / 3600)
  const hTo = Math.ceil(dayEndSec / 3600)
  const hourly = []
  for (let h = hFrom; h < hTo; h++) hourly.push({ hour: h, people: 0, cars: 0, presentSec: 0 })
  const idxOf = (h) => h - hFrom

  const peoplePerHour = hourly.map(() => new Set())
  const carsPerHour = hourly.map(() => new Set())
  const allPeople = new Set()
  const allCars = new Set()

  for (const track of tracks ?? []) {
    const isCar = track.type === 'car'
    if (isCar) allCars.add(track.id); else allPeople.add(track.id)
    // Mark presence per hour from the track's sample span, and accumulate
    // person-seconds bucketed by the hour each second falls in.
    const s = track.samples
    for (let i = 0; i + 1 < s.length; i++) {
      const a = s[i], b = s[i + 1]
      const hA = Math.max(hFrom, Math.floor(a.t / 3600))
      const hB = Math.min(hTo - 1, Math.floor(b.t / 3600))
      for (let h = hA; h <= hB; h++) {
        const set = isCar ? carsPerHour[idxOf(h)] : peoplePerHour[idxOf(h)]
        if (set) set.add(track.id)
      }
      // person-seconds: clamp the leg to each hour boundary it spans
      const segStart = a.t, segEnd = b.t
      if (segEnd <= segStart) continue
      for (let h = hA; h <= hB; h++) {
        const hStart = h * 3600, hEnd = (h + 1) * 3600
        const lo = Math.max(segStart, hStart)
        const hi = Math.min(segEnd, hEnd)
        if (hi > lo && hourly[idxOf(h)]) hourly[idxOf(h)].presentSec += hi - lo
      }
    }
  }

  let peakHour = null, peakPresent = 0
  for (let i = 0; i < hourly.length; i++) {
    hourly[i].people = peoplePerHour[i].size
    hourly[i].cars = carsPerHour[i].size
    if (hourly[i].people > peakPresent) { peakPresent = hourly[i].people; peakHour = hourly[i].hour }
  }

  return {
    hourly,
    peakHour,
    peakPresent,
    totalPeople: allPeople.size,
    totalCars: allCars.size,
  }
}

// ── Multi-day rollup (trend report, daily view) ─────────────────────────────
// Per-DAY distinct people/cars + accumulated person-seconds across a week of
// tracks (generateWeekTracks). Distinct counts use DAY-LEVEL Sets — the same
// allPeople/allCars pattern as computeFloorTrend — so a person seen in many
// hours counts once per day. NEVER sum hourly distinct counts: a track present
// at 10:00 and 14:00 would otherwise be double-counted.
//
// Each track is assigned to a day via its `day` tag (set by generateDayTracks),
// falling back to floor(t0 / 86400) for untagged data. Returns one entry per
// day that has any tracks, ascending: [{ day, people, cars, presentSec }].
const SECONDS_PER_DAY = 24 * 3600

export function computeDayRollup(tracks) {
  const peopleByDay = new Map()   // day → Set(id)
  const carsByDay = new Map()
  const presentSecByDay = new Map()

  for (const track of tracks ?? []) {
    const day = track.day ?? Math.floor((track.t0 ?? 0) / SECONDS_PER_DAY)
    const isCar = track.type === 'car'
    const byDay = isCar ? carsByDay : peopleByDay
    let set = byDay.get(day)
    if (!set) { set = new Set(); byDay.set(day, set) }
    set.add(track.id)

    // person-seconds: sum each leg's duration (sparse waypoint samples).
    let sec = presentSecByDay.get(day) ?? 0
    const s = track.samples
    for (let i = 0; i + 1 < s.length; i++) {
      const dt = s[i + 1].t - s[i].t
      if (dt > 0) sec += dt
    }
    presentSecByDay.set(day, sec)
  }

  const days = new Set([...peopleByDay.keys(), ...carsByDay.keys()])
  const rollup = []
  for (const day of [...days].sort((a, b) => a - b)) {
    rollup.push({
      day,
      people: peopleByDay.get(day)?.size ?? 0,
      cars: carsByDay.get(day)?.size ?? 0,
      presentSec: presentSecByDay.get(day) ?? 0,
    })
  }
  return rollup
}

// ── Flow grid ─────────────────────────────────────────────────────────────
// Movement direction field per cell over the window. Dwell steps (zero
// velocity) are skipped — the flow map shows WHERE PEOPLE MOVE, the dwell
// heatmap already covers where they stand still.
// Returns { cells, cols, rows, cellPx, maxCount, bins, binSumX/Y/Cnt }
//
// FLOW_BINS direction bins per cell, one per compass octant. A net-average
// field cancels a busy two-way corridor to nothing (equal up + down → ~zero),
// so a main aisle would vanish — and over a LONG window every cell also
// collects diagonal cut-throughs and detours, which two opposed bins can't
// hold: the leftover directions get crammed into A/B and smear both averages
// toward zero, so the field reads as "stalled" and the streamlines die short.
// Splitting each cell into 8 octant bins keeps every distinct travel direction
// (the two corridor directions AND the crossing/diagonal ones) as its own
// coherent bundle, so long windows still trace clean lines per direction.
const FLOW_BINS = 8
export function computeFlowGrid({
  tracks, tFromSec, tToSec, imageWidth, imageHeight, pxPerM, cellM = 1,
}) {
  if (!tracks || tracks.length === 0 || !imageWidth || !imageHeight) return null
  const cellPx = Math.max(4, cellM * (pxPerM || 40))
  const cols = Math.max(1, Math.ceil(imageWidth / cellPx))
  const rows = Math.max(1, Math.ceil(imageHeight / cellPx))
  const n = cols * rows
  // Per-cell, per-bin running sums (bin-major within each cell):
  // binSumX[idx * FLOW_BINS + bin]. cnt is the same layout.
  const binSumX = new Float32Array(n * FLOW_BINS)
  const binSumY = new Float32Array(n * FLOW_BINS)
  const binCnt = new Float32Array(n * FLOW_BINS)
  const TWO_PI = Math.PI * 2
  const binOf = (vx, vy) => {
    let a = Math.atan2(vy, vx)
    if (a < 0) a += TWO_PI
    return Math.floor((a / TWO_PI) * FLOW_BINS) % FLOW_BINS
  }

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
      const bin = binOf(vx, vy)
      for (let t = legT0; t < legT1; t += SAMPLE_DT_SEC) {
        const f = (t - a.t) / legDur
        const x = a.x + (b.x - a.x) * f
        const y = a.y + (b.y - a.y) * f
        const cx = Math.min(cols - 1, Math.max(0, Math.floor(x / cellPx)))
        const cy = Math.min(rows - 1, Math.max(0, Math.floor(y / cellPx)))
        const bidx = (cy * cols + cx) * FLOW_BINS + bin
        binSumX[bidx] += vx; binSumY[bidx] += vy; binCnt[bidx] += 1
      }
    }
  }

  // One cell entry per NON-EMPTY bin. `bin` (0..FLOW_BINS-1) lets streamlines
  // integrate each direction bundle on its own field. `count` drives
  // seeding/opacity. Adjacent bins are NOT merged here — the streamline
  // integrator follows whichever bin field it's seeded on, and bilinear
  // sampling across neighbours smooths the slight octant quantisation.
  const cells = []
  let maxCount = 0
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const base = (cy * cols + cx) * FLOW_BINS
      for (let bin = 0; bin < FLOW_BINS; bin++) {
        const c = binCnt[base + bin]
        if (c <= 0) continue
        const vx = binSumX[base + bin] / c
        const vy = binSumY[base + bin] / c
        if (Math.hypot(vx, vy) < 1e-3) continue
        cells.push({ cx, cy, vx, vy, count: c, bin })
        if (c > maxCount) maxCount = c
      }
    }
  }
  if (cells.length === 0) return null
  // Hand back the raw per-bin fields so streamlines can bilinearly sample the
  // direction field for whichever bin a line belongs to.
  return { cells, cols, rows, cellPx, maxCount, bins: FLOW_BINS, binSumX, binSumY, binCnt }
}

// ── Streamlines ─────────────────────────────────────────────────────────────
// Trace continuous "movement corridors" through the flow field instead of
// drawing one arrow per cell. We seed at the busiest cells, then integrate the
// average-velocity field with RK2 (midpoint) in both directions until the line
// leaves the field, stalls, or hits its length cap. The result reads as the
// paths people actually take (entrance → aisle → checkout), which a grid of
// disconnected arrows never makes legible.
//
// Returns { lines: [{ pts: [{x,y}], strength }], cellPx } in CANVAS PX, or null.
const STREAM_STEP_CELLS = 0.5      // integration step, in cell pitch
const STREAM_MAX_STEPS = 90        // hard cap per direction. Raised with the
                                   // octant bins: cleaner per-direction fields
                                   // let a line run further before it stalls,
                                   // so longer corridors trace end to end.
const STREAM_MIN_PTS = 6           // drop stubs shorter than this (a touch lower
                                   // so short secondary corridors survive)
// Seeding uses an ABSOLUTE traffic floor, not a fraction of the window's own
// peak. A fractional floor (0.18 × maxCount) only reflects the SHAPE of the
// flow — which corridors are relatively busiest — so a 1-hour window and a
// 14-hour window with the same layout seed nearly the same lines. An absolute
// floor reflects VOLUME: a sample is one person-second, so a corridor clears
// the bar once enough people-seconds have accumulated. A long window pushes
// many more bins over the bar → visibly more (and, via `strength`, thicker)
// lines than a quiet single hour. A relative cap still applies so a window with
// one mega-busy spot doesn't suppress everything else.
const STREAM_SEED_MIN_COUNT = 90   // person-seconds a direction bin needs before
                                   // it seeds a line (≈ a handful of people
                                   // having walked through over the window)
const STREAM_SEED_MAX_FRAC = 0.06  // …but never demand more than 6% of the
                                   // window's peak, so a window dominated by one
                                   // hot bin still seeds its lesser corridors
const STREAM_STRENGTH_FULL_COUNT = 400   // person-seconds at which a line draws
                                         // at full width/opacity (absolute). Set
                                         // well above a quiet hour's peak (~160)
                                         // but below a full day's (~1200+) so a
                                         // 1h window stays thin while the all-day
                                         // window renders most corridors heavy —
                                         // volume reads as line weight, since the
                                         // seed dedup caps the line COUNT.
const STREAM_MIN_SPEED = 1e-3      // px/s below which the field is "stalled"
const STREAM_MAX_TURN = Math.PI * 2    // stop once a line has curled this much
                                       // total — kills spirals from circulating
                                       // flow cells. Per-bin fields curve less,
                                       // so allow a full loop before bailing.
const STREAM_SEED_SPACING_CELLS = 3    // a new seed must be this far (in cells)
                                       // from any line already drawn

export function computeStreamlines(flow) {
  if (!flow) return null
  const { cols, rows, cellPx, maxCount, bins, binSumX, binSumY, binCnt } = flow
  if (!binCnt) return null

  // Bilinearly sample the (normalised) velocity field of bin `b` at a point.
  // Reads the per-bin sums (bin-major within each cell).
  const sampleField = (px, py, b) => {
    const gx = px / cellPx - 0.5
    const gy = py / cellPx - 0.5
    const x0 = Math.floor(gx), y0 = Math.floor(gy)
    const fx = gx - x0, fy = gy - y0
    let vx = 0, vy = 0, wsum = 0
    for (let j = 0; j <= 1; j++) {
      for (let i = 0; i <= 1; i++) {
        const cx = x0 + i, cy = y0 + j
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue
        const bidx = (cy * cols + cx) * bins + b
        const c = binCnt[bidx]
        if (c <= 0) continue
        const w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy)
        vx += (binSumX[bidx] / c) * w
        vy += (binSumY[bidx] / c) * w
        wsum += w
      }
    }
    if (wsum <= 0) return null
    return { vx: vx / wsum, vy: vy / wsum }
  }

  const step = STREAM_STEP_CELLS * cellPx
  // Integrate from a seed along bin `b`'s field (sign +1 forward / -1 back).
  const integrate = (sx, sy, sign, b) => {
    const pts = [{ x: sx, y: sy }]
    let px = sx, py = sy
    let turn = 0          // accumulated absolute heading change
    let prevHx = 0, prevHy = 0, haveHeading = false
    for (let n = 0; n < STREAM_MAX_STEPS; n++) {
      const f = sampleField(px, py, b)
      if (!f) break
      const sp = Math.hypot(f.vx, f.vy)
      if (sp < STREAM_MIN_SPEED) break
      // RK2 midpoint: probe half a step, then take a full step along the
      // midpoint direction — straighter, less drift than plain Euler.
      const ux = (sign * f.vx) / sp, uy = (sign * f.vy) / sp
      const mx = px + ux * step * 0.5, my = py + uy * step * 0.5
      const fm = sampleField(mx, my, b)
      if (!fm) break
      const ms = Math.hypot(fm.vx, fm.vy)
      if (ms < STREAM_MIN_SPEED) break
      const hx = (sign * fm.vx) / ms, hy = (sign * fm.vy) / ms
      // accumulate how much the heading has turned; bail when it has curled
      // past STREAM_MAX_TURN so circulating cells don't spiral forever.
      if (haveHeading) {
        const dot = Math.max(-1, Math.min(1, hx * prevHx + hy * prevHy))
        turn += Math.acos(dot)
        if (turn > STREAM_MAX_TURN) break
      }
      prevHx = hx; prevHy = hy; haveHeading = true
      px += hx * step
      py += hy * step
      pts.push({ x: px, y: py })
    }
    return pts
  }

  // Seed at the busiest cells, busiest first. A seed is skipped if it falls in
  // the dilated footprint of a line already drawn, so each corridor is traced
  // once instead of a dozen near-parallel copies. The floor is an ABSOLUTE
  // person-second count (so volume drives line count across windows), capped by
  // a small fraction of the peak (so a single hot bin can't raise the bar above
  // every other corridor).
  const seedFloor = Math.min(STREAM_SEED_MIN_COUNT, STREAM_SEED_MAX_FRAC * maxCount)
  const seeds = flow.cells
    .filter((c) => c.count >= seedFloor)
    .sort((a, b) => b.count - a.count)
  // PER-BIN occupancy: directions that share a corridor run on top of each
  // other, so a shared grid would let one direction's footprint suppress
  // another's seed and we'd lose those flows. Keep one grid per bin.
  const occupied = Array.from({ length: bins }, () => new Uint8Array(cols * rows))
  const R = STREAM_SEED_SPACING_CELLS
  const markFootprint = (occ, cx, cy) => {
    for (let dy = -R; dy <= R; dy++) {
      const yy = cy + dy
      if (yy < 0 || yy >= rows) continue
      for (let dx = -R; dx <= R; dx++) {
        const xx = cx + dx
        if (xx < 0 || xx >= cols) continue
        occ[yy * cols + xx] = 1
      }
    }
  }
  const lines = []
  for (const seed of seeds) {
    const b = seed.bin
    const occ = occupied[b]
    if (occ[seed.cy * cols + seed.cx]) continue
    const sx = (seed.cx + 0.5) * cellPx
    const sy = (seed.cy + 0.5) * cellPx
    const back = integrate(sx, sy, -1, b).reverse()
    const fwd = integrate(sx, sy, +1, b)
    const pts = back.concat(fwd.slice(1))   // join, drop the duplicated seed
    if (pts.length < STREAM_MIN_PTS) continue
    // Dilate every cell the line touches into THIS bin's grid so nearby
    // same-direction seeds are suppressed (parallel copies), while the opposite
    // direction can still seed the same corridor.
    for (const p of pts) {
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(p.x / cellPx)))
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(p.y / cellPx)))
      markFootprint(occ, cx, cy)
    }
    // Cumulative arc length per vertex — lets the renderer place flow chevrons
    // at exact distances along the line without re-measuring each frame.
    const cum = new Float32Array(pts.length)
    for (let k = 1; k < pts.length; k++) {
      cum[k] = cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y)
    }
    // strength → line width/opacity. Take the LARGER of an absolute measure
    // (person-seconds saturating at STREAM_STRENGTH_FULL_COUNT, so a long window
    // reads as thicker/brighter lines) and the within-window relative measure
    // (so the busiest corridor of a quiet hour still stands out). Capped at 1.
    const absStrength = Math.min(1, seed.count / STREAM_STRENGTH_FULL_COUNT)
    const relStrength = seed.count / (maxCount || 1)
    lines.push({ pts, cum, strength: Math.min(1, Math.max(absStrength, relStrength)) })
  }
  if (lines.length === 0) return null
  return { lines, cellPx }
}
