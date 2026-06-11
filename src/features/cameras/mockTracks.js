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

// Hourly spawn intensity (tracks per hour) — lunch + evening peaks so the
// occupancy heatmap (34-3) shows believable busy/quiet periods.
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
//   opts:  { seed }
export function generateDayTracks(floor, walls, opts = {}) {
  const seed = opts.seed ?? 20260611
  const rng = mulberry32(seed)
  const pxPerM = floor.scale || 40
  const W = floor.imageWidth
  const H = floor.imageHeight
  const margin = 0.04
  const segs = buildMovementSegments(walls)

  const randPoint = () => ({
    x: lerp(W * margin, W * (1 - margin), rng()),
    y: lerp(H * margin, H * (1 - margin), rng()),
  })

  // POI attractors — fixed for the whole day so dwell hot-spots emerge.
  const pois = Array.from({ length: POI_COUNT }, randPoint)

  const tracks = []
  let trackSeq = 0

  for (let hour = 8; hour < 22; hour++) {
    const n = HOURLY_RATE[hour] ?? 10
    for (let i = 0; i < n; i++) {
      const t0 = hour * 3600 + rng() * 3600
      const isCar = rng() < CAR_FRACTION
      const speed = randIn(rng, isCar ? CAR_SPEED_MPS : PERSON_SPEED_MPS) * pxPerM  // px/s
      const tEnd = Math.min(DAY_END_SEC, t0 + randIn(rng, isCar ? CAR_DURATION_SEC : TRACK_DURATION_SEC))

      let pos = randPoint()
      let t = t0
      const samples = [{ t, x: pos.x, y: pos.y }]

      while (t < tEnd) {
        // Pick the next waypoint: a reachable POI, else a short clear hop.
        let next = null
        let isPoi = false
        if (rng() < POI_PICK_PROB) {
          const order = pois.slice().sort(() => rng() - 0.5)
          for (const p of order) {
            if (walkClear(segs, pos.x, pos.y, p.x, p.y)) { next = p; isPoi = true; break }
          }
        }
        if (!next) {
          for (let tries = 0; tries < 20; tries++) {
            const ang = rng() * Math.PI * 2
            const dist = randIn(rng, isCar ? CAR_HOP_DIST_M : HOP_DIST_M) * pxPerM
            const cand = {
              x: Math.min(W * (1 - margin), Math.max(W * margin, pos.x + Math.cos(ang) * dist)),
              y: Math.min(H * (1 - margin), Math.max(H * margin, pos.y + Math.sin(ang) * dist)),
            }
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

      if (samples.length >= 2) {
        tracks.push({
          id: `trk-${seed}-${++trackSeq}`,
          type: isCar ? 'car' : 'person',
          t0: samples[0].t,
          t1: samples[samples.length - 1].t,
          samples,
        })
      }
    }
  }

  return tracks
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
