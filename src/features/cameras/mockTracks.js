import { getPxPerM } from '@/store/useFloorStore'

// Mock people/vehicle tracks for Camera mode (Phase 34-2).
//
// Simulates one business day (08:00–22:00) of person/car movement on the
// active floor, in CANVAS PX coordinates — the same shape a future live
// backend would push after mapping camera detections to world space
// (design consensus: the frontend only ever consumes mapped coordinates).
//
// Movement model: random-waypoint with POI attractors. Each track spawns at
// a random walkable point, hops between waypoints in short legs that may not
// cross a wall, lingers at POIs (heavy-tailed dwell), then despawns. Walls
// block MOVEMENT regardless of material — glass stops a person even though
// the camera sees through it — while DOOR openings are passable. (Exactly
// complementary to fovPolygon's line-of-sight rules.)
//
// Track shape (sparse waypoint samples, linearly interpolated):
//   { id, type: 'person'|'car', t0, t1, samples: [{ t, x, y }] }
// `samples` is time-ascending; consecutive equal positions encode a dwell.

// Deterministic seedable RNG (mulberry32) so the same seed reproduces the
// same crowd — verification and replay stay stable.
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const DAY_START_SEC = 8 * 3600    // 08:00
export const DAY_END_SEC = 22 * 3600     // 22:00

// Multi-day mock (Tier2 #4 trend report). One simulated week so the trend
// panel's daily view aggregates real per-day data instead of repeating day 0.
// Each day's samples are offset by `day * SECONDS_PER_DAY`, so a track's `t`
// is an ABSOLUTE timestamp from the week's origin and `Math.floor(t / 86400)`
// recovers its day index. Day 0 keeps t in [DAY_START_SEC, DAY_END_SEC] — i.e.
// the existing single-day shape — so every current consumer (heatmap /
// counting / 3D / calibration) reads day 0 exactly as before.
export const SECONDS_PER_DAY = 24 * 3600
export const DAYS_PER_WEEK = 7

// On-screen minimums (user ask): baseline relay slots keep at least this many
// people / cars present at every moment of the day; the hourly spawns below
// add the rush-hour peaks on top.
const MIN_ON_SCREEN_PERSON = 30
const MIN_ON_SCREEN_CAR = 5

// Hourly spawn intensity (tracks per hour) — lunch + evening peaks so the
// occupancy heatmap (34-3) shows believable busy/quiet periods.
// RATE_MULTIPLIER scales the bursty visitors layered on the baseline.
const RATE_MULTIPLIER = 3
const HOURLY_RATE = {
  8: 12, 9: 14, 10: 18, 11: 24, 12: 33, 13: 30, 14: 18, 15: 16,
  16: 18, 17: 26, 18: 33, 19: 30, 20: 21, 21: 12,
}

const PERSON_SPEED_MPS = [0.9, 1.5]     // walking range
const CAR_SPEED_MPS = [2.5, 6]          // parking-lot creep
// High enough that 1-3 cars are usually on screen at busy times — at 0.06 the
// expected concurrent car count was ~0.5 and users never saw one.
const CAR_FRACTION = 0.18
const TRACK_DURATION_SEC = [8 * 60, 20 * 60]
const CAR_DURATION_SEC = [20 * 60, 50 * 60]   // cars stay on site longer than people
const POI_COUNT = 6
const POI_DWELL_SEC = [20, 110]         // heavy linger at attractors
const HOP_DWELL_SEC = [0, 4]
const HOP_DIST_M = [2, 8]
// Cars drive ~3× faster, so their hops are ~3× longer — keeps the FRACTION of
// time spent moving on par with people (same dwell cadence, same duty cycle).
const CAR_HOP_DIST_M = [7, 26]
const POI_PICK_PROB = 0.55              // chance a hop targets a reachable POI
// Only POIs within this straight-line distance attract — without the cap the
// whole outdoor population funnels across the map to the one or two POIs it
// can see (the demo floor's big top-left lawn collected ~40% of everyone).
const POI_ATTRACT_RADIUS_M = 12
// Cars rarely visit POIs (shelves/counters are a people thing) — also keeps
// their moving-time share on par with people despite driving ~3× faster.
const CAR_POI_PICK_PROB = 0.1
// Scatter radius around a POI (m): crowds gather NEAR an attractor, never on
// the exact same pixel (3× crowds made identical-POI stacking very visible).
// Wide enough that even a popular POI reads as "a busy area", not one blob.
const POI_SCATTER_M = [0.6, 3]
// Minimum spacing between POIs, as a fraction of min(W, H) — without it a
// seed can drop several POIs into the same corner and pile half the crowd
// onto one spot (user-visible clump at the top-left on the demo floor).
const POI_MIN_SPACING_FRAC = 0.22

// Movement blockers: every wall sub-segment EXCEPT door openings. Glass
// blocks (it stops people), windows block, doors pass.
export function buildMovementSegments(walls) {
  const segs = []
  for (const wall of walls ?? []) {
    const ax = wall.startX, ay = wall.startY
    const bx = wall.endX,   by = wall.endY
    const openings = (wall.openings ?? []).slice().sort((a, b) => a.startFrac - b.startFrac)
    if (openings.length === 0) {
      segs.push({ ax, ay, bx, by })
      continue
    }
    const px = (f) => ax + (bx - ax) * f
    const py = (f) => ay + (by - ay) * f
    let cursor = 0
    for (const op of openings) {
      const s = Math.max(cursor, op.startFrac)
      const e = Math.min(1, op.endFrac)
      if (s > cursor + 1e-4) segs.push({ ax: px(cursor), ay: py(cursor), bx: px(s), by: py(s) })
      if (op.type !== 'door') segs.push({ ax: px(s), ay: py(s), bx: px(e), by: py(e) })
      cursor = e
    }
    if (cursor < 1 - 1e-4) segs.push({ ax: px(cursor), ay: py(cursor), bx: px(1), by: py(1) })
  }
  return segs
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx - ax, d1y = by - ay
  const d2x = dx - cx, d2y = dy - cy
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-12) return false
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / denom
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / denom
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9
}

function walkClear(segs, x0, y0, x1, y1) {
  for (const s of segs) {
    if (segmentsIntersect(x0, y0, x1, y1, s.ax, s.ay, s.bx, s.by)) return false
  }
  return true
}

const lerp = (a, b, f) => a + (b - a) * f
const randIn = (rng, [lo, hi]) => lerp(lo, hi, rng())

// One day of tracks for a floor.
//   floor: { imageWidth, imageHeight, scale }   walls: Wall[]
//   opts:  { seed, dayIndex }
// `dayIndex` (default 0) shifts every timestamp by day*86400 so multiple days
// can live in one flat track list with absolute `t`. dayIndex 0 reproduces the
// historical single-day output byte-for-byte (offset 0, same seed).
export function generateDayTracks(floor, walls, opts = {}) {
  const seed = opts.seed ?? 20260611
  const dayIndex = opts.dayIndex ?? 0
  const dayOffsetSec = dayIndex * SECONDS_PER_DAY
  const dayStart = DAY_START_SEC + dayOffsetSec
  const dayEnd = DAY_END_SEC + dayOffsetSec
  const rng = mulberry32(seed)
  // 53-G8: was `|| 40` — a scale of exactly 0 also fell through to it.
  const pxPerM = getPxPerM(floor)
  const W = floor.imageWidth
  const H = floor.imageHeight
  const margin = 0.04
  const segs = buildMovementSegments(walls)

  const randPoint = () => ({
    x: lerp(W * margin, W * (1 - margin), rng()),
    y: lerp(H * margin, H * (1 - margin), rng()),
  })

  // POI attractors. Poisson-disc-ish rejection keeps each set spread out (no
  // corner pile-ups), candidates are inset from the canvas border so a
  // hot-spot crowd never sits glued to a corner, and the whole set ROTATES
  // every two hours — one lucky spot can't collect a crowd all day long,
  // and the dwell heatmap gets believable time-of-day hot-spots.
  const poiPoint = () => ({
    x: lerp(W * 0.12, W * 0.88, rng()),
    y: lerp(H * 0.12, H * 0.88, rng()),
  })
  const poiMinD = Math.min(W, H) * POI_MIN_SPACING_FRAC
  const makePoiSet = () => {
    const set = []
    for (let guard = 0; set.length < POI_COUNT && guard < 400; guard++) {
      const p = poiPoint()
      if (set.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= poiMinD)) set.push(p)
    }
    while (set.length < POI_COUNT) set.push(poiPoint())
    return set
  }
  const POI_SLOT_SEC = 2 * 3600
  const poiSlots = Array.from(
    { length: Math.ceil((dayEnd - dayStart) / POI_SLOT_SEC) },
    makePoiSet,
  )
  const poisAt = (t) => poiSlots[Math.min(
    poiSlots.length - 1,
    Math.max(0, Math.floor((t - dayStart) / POI_SLOT_SEC)),
  )]

  const tracks = []
  let trackSeq = 0

  // One track from t0 to (at most) tEnd. Returns null when the start point is
  // boxed in before producing any movement.
  const buildTrack = (t0, tEnd, isCar) => {
    const speed = randIn(rng, isCar ? CAR_SPEED_MPS : PERSON_SPEED_MPS) * pxPerM  // px/s
    let pos = randPoint()
    let t = t0
    const samples = [{ t, x: pos.x, y: pos.y }]

    while (t < tEnd) {
      // Pick the next waypoint: a reachable POI, else a short clear hop.
      let next = null
      let isPoi = false
      if (rng() < (isCar ? CAR_POI_PICK_PROB : POI_PICK_PROB)) {
        const attractPx = POI_ATTRACT_RADIUS_M * pxPerM
        const order = poisAt(t)
          .filter((p) => Math.hypot(p.x - pos.x, p.y - pos.y) <= attractPx)
          .sort(() => rng() - 0.5)
        for (const p of order) {
          // Land NEAR the POI, not on its exact pixel. sqrt-sampled radius =
          // uniform density over the scatter DISC — plain uniform radius
          // piles everyone near the centre (≈11 in one 20px blob at rush).
          const [r0, r1] = POI_SCATTER_M
          const sr = Math.sqrt(lerp(r0 * r0, r1 * r1, rng())) * pxPerM
          const sa = rng() * Math.PI * 2
          const cand = { x: p.x + Math.cos(sa) * sr, y: p.y + Math.sin(sa) * sr }
          if (walkClear(segs, pos.x, pos.y, cand.x, cand.y)) { next = cand; isPoi = true; break }
        }
      }
      if (!next) {
        // A hop that would leave the margin box is SHORTENED along its own
        // direction to stop inside it (per-axis coordinate clamping snapped
        // many long car hops onto the exact margin corners — a visible
        // pile-up of cars at one point). Directions are continuous, so the
        // shortened endpoints spread along the edges instead of stacking.
        const xLo = W * margin, xHi = W * (1 - margin)
        const yLo = H * margin, yHi = H * (1 - margin)
        for (let tries = 0; tries < 30; tries++) {
          const ang = rng() * Math.PI * 2
          const dist = randIn(rng, isCar ? CAR_HOP_DIST_M : HOP_DIST_M) * pxPerM
          const c = Math.cos(ang), sn = Math.sin(ang)
          // distance along (c,sn) from pos to the margin box edge
          let tMax = Infinity
          if (c > 1e-9) tMax = Math.min(tMax, (xHi - pos.x) / c)
          else if (c < -1e-9) tMax = Math.min(tMax, (xLo - pos.x) / c)
          if (sn > 1e-9) tMax = Math.min(tMax, (yHi - pos.y) / sn)
          else if (sn < -1e-9) tMax = Math.min(tMax, (yLo - pos.y) / sn)
          const effDist = Math.min(dist, tMax * 0.95)
          if (effDist < 1 * pxPerM) continue   // boxed against the edge — try another angle
          const cand = { x: pos.x + c * effDist, y: pos.y + sn * effDist }
          if (walkClear(segs, pos.x, pos.y, cand.x, cand.y)) { next = cand; break }
        }
      }
      if (!next) break   // boxed in — end the track here

      const legLen = Math.hypot(next.x - pos.x, next.y - pos.y)
      t += Math.max(1, legLen / speed)
      samples.push({ t, x: next.x, y: next.y })
      pos = next

      // Dwell — same cadence for cars and people (user ask: cars should
      // move as often as people): long linger at POIs, short pause on a
      // plain hop. What the dwell heatmap surfaces.
      const dwell = isPoi ? randIn(rng, POI_DWELL_SEC) : randIn(rng, HOP_DWELL_SEC)
      if (dwell > 1) {
        t += dwell
        samples.push({ t, x: pos.x, y: pos.y })
      }
    }

    if (samples.length < 2) return null
    return {
      id: `trk-${seed}-d${dayIndex}-${++trackSeq}`,
      type: isCar ? 'car' : 'person',
      day: dayIndex,
      t0: samples[0].t,
      t1: samples[samples.length - 1].t,
      samples,
    }
  }

  // A boxed-in spawn point ends a track within seconds (or yields null) —
  // re-rolling the spawn costs no simulated time, so retry a few times until
  // the track actually lives a while. Keeps the relay slots gap-free.
  const buildTrackRetry = (t0, tEnd, isCar, minLifeSec = 60) => {
    let last = null
    for (let i = 0; i < 8; i++) {
      const tr = buildTrack(t0, tEnd, isCar)
      if (!tr) continue
      last = tr
      if (tr.t1 - tr.t0 >= Math.min(minLifeSec, tEnd - t0 - 1)) return tr
    }
    return last
  }

  // Baseline slots — guarantee the on-screen MINIMUMS all day (user ask:
  // ≥30 people, ≥5 cars at any moment). Each slot is a relay of back-to-back
  // tracks covering 08:00–22:00: when one leaves, the next takes over.
  const relay = (isCar, durRange) => {
    let t = dayStart
    while (t < dayEnd - 60) {
      const tr = buildTrackRetry(t, Math.min(dayEnd, t + randIn(rng, durRange)), isCar)
      if (tr) {
        tracks.push(tr)
        t = tr.t1   // hand over the same second — a 1s seam would dip the minimum
      } else {
        t += 120   // every retry boxed in (extremely rare) — nudge forward
      }
    }
  }
  for (let i = 0; i < MIN_ON_SCREEN_PERSON; i++) relay(false, TRACK_DURATION_SEC)
  for (let i = 0; i < MIN_ON_SCREEN_CAR; i++) relay(true, CAR_DURATION_SEC)

  // Bursty hourly visitors on top of the baseline — the rush-hour texture
  // that the occupancy heatmap and analysis-window comparisons surface.
  for (let hour = 8; hour < 22; hour++) {
    const n = (HOURLY_RATE[hour] ?? 10) * RATE_MULTIPLIER
    for (let i = 0; i < n; i++) {
      const t0 = hour * 3600 + dayOffsetSec + rng() * 3600
      const isCar = rng() < CAR_FRACTION
      const tEnd = Math.min(dayEnd, t0 + randIn(rng, isCar ? CAR_DURATION_SEC : TRACK_DURATION_SEC))
      // Retry boxed-in spawns here too — otherwise indoor visitors die young
      // and the surviving population skews toward the open outdoor areas.
      const tr = buildTrackRetry(t0, tEnd, isCar)
      if (tr) tracks.push(tr)
    }
  }

  return tracks
}

// A simulated WEEK of tracks for a floor, as one flat list with absolute
// timestamps (each track tagged `day` 0..days-1 and offset by day*86400).
//   opts: { seed, days }   (days defaults to DAYS_PER_WEEK)
// Day d is generated with seed (seed + d) so every day differs while staying
// deterministic; each day keeps the bimodal lunch/evening shape and the same
// wall-avoidance model. Day 0 (seed, dayIndex 0) is identical to
// generateDayTracks(floor, walls, { seed }) — so the single-day store and the
// week share day 0 exactly. Use computeDayRollup() to aggregate per day.
export function generateWeekTracks(floor, walls, opts = {}) {
  const baseSeed = opts.seed ?? 20260611
  const days = opts.days ?? DAYS_PER_WEEK
  const all = []
  for (let d = 0; d < days; d++) {
    const dayTracks = generateDayTracks(floor, walls, { seed: baseSeed + d, dayIndex: d })
    for (const tr of dayTracks) all.push(tr)
  }
  return all
}

// Position of a track at wall-clock second `t` — linear interpolation between
// waypoint samples; null when the track isn't present at `t`.
export function sampleTrackAt(track, t) {
  if (t < track.t0 || t > track.t1) return null
  const s = track.samples
  let lo = 0, hi = s.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (s[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = s[lo], b = s[hi]
  if (b.t <= a.t) return { x: b.x, y: b.y }
  const f = (t - a.t) / (b.t - a.t)
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) }
}

// Instantaneous speed (px/s) around `t` — central difference over 1s.
export function trackSpeedAt(track, t) {
  const a = sampleTrackAt(track, Math.max(track.t0, t - 0.5))
  const b = sampleTrackAt(track, Math.min(track.t1, t + 0.5))
  if (!a || !b) return 0
  return Math.hypot(b.x - a.x, b.y - a.y)
}

// Heading (radians, atan2 convention) at `t` — the current leg's direction,
// falling back to the last MOVING leg when the track is dwelling so a parked
// car keeps facing the way it drove in. 0 when the track never moved.
export function trackHeadingAt(track, t) {
  const s = track.samples
  let lo = 0, hi = s.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (s[mid].t <= t) lo = mid
    else hi = mid
  }
  for (let i = lo; i >= 0; i--) {
    const a = s[i], b = s[i + 1]
    const dx = b.x - a.x, dy = b.y - a.y
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) return Math.atan2(dy, dx)
  }
  return 0
}

export function formatClock(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// HH:MM:SS — for the live playback clock readout where the second matters.
export function formatClockSec(sec) {
  const s = Math.floor(sec % 60)
  return `${formatClock(sec)}:${String(s).padStart(2, '0')}`
}
