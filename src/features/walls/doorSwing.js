import { DOUBLE_DOOR_MIN_M, DEFAULT_WALL_THICKNESS_M } from '@/constants/materials'

// Door swing for the 2D plan symbol. A door has four ways to hang — hinge at
// either end × swing to either side of its wall. Imported plans carry none of
// that, and a fixed default swings half the doors straight through the next
// wall, where the leaf reads as a door on THAT wall. So until the user flips a
// door themselves (hingeAtEnd / swingFlip stored on the opening), the swing is
// picked automatically: the first hanging whose leaf and arc clear every other
// wall on the floor, or the one that hits the fewest.

export const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0))

// The parts of a wall (as [startFrac, endFrac] pairs) not covered by any
// opening — what still gets painted, and collided with, as wall.
export function solidSpans(openings) {
  const cuts = (openings ?? [])
    .map((o) => [clamp01(o.startFrac), clamp01(o.endFrac)])
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0])
  const spans = []
  let cur = 0
  for (const [a, b] of cuts) {
    if (a > cur) spans.push([cur, a])
    cur = Math.max(cur, b)
  }
  if (cur < 1) spans.push([cur, 1])
  return spans
}

export const isDoubleDoor = (wall, op, pxPerM) => {
  const len = Math.hypot(wall.endX - wall.startX, wall.endY - wall.startY)
  return ((clamp01(op.endFrac) - clamp01(op.startFrac)) * len) / pxPerM > DOUBLE_DOOR_MIN_M
}

const hasUserSwing = (op) => op.hingeAtEnd !== undefined || op.swingFlip !== undefined

// Leaves for one hanging, as [hingeFrac, freeFrac] pairs along the wall. A
// double door has a hinge at each end, so hingeAtEnd doesn't apply to it.
export function doorLeaves(op, double, hingeAtEnd) {
  const s0 = clamp01(op.startFrac)
  const s1 = clamp01(op.endFrac)
  if (double) return [[s0, (s0 + s1) / 2], [s1, (s0 + s1) / 2]]
  return [hingeAtEnd ? [s1, s0] : [s0, s1]]
}

function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx)
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx)
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax)
  return d1 * d2 < 0 && d3 * d4 < 0
}

function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 1e-9 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// A piece of the swing "hits" a wall when it crosses it OR runs within the
// wall's half-thickness plus a margin of it. The distance half matters: the
// worst misread is a leaf lying flat along a neighbouring wall, which never
// properly crosses it.
const CLEARANCE_M = 0.06
function segHitsObstacle(ax, ay, bx, by, o) {
  if (segmentsCross(ax, ay, bx, by, o[0], o[1], o[2], o[3])) return true
  return Math.min(
    pointSegDist(ax, ay, o[0], o[1], o[2], o[3]),
    pointSegDist(bx, by, o[0], o[1], o[2], o[3]),
    pointSegDist(o[0], o[1], ax, ay, bx, by),
    pointSegDist(o[2], o[3], ax, ay, bx, by),
  ) < o[4]
}

const ARC_SAMPLES = 8

// Hits for one hanging: leaf hits count double (a leaf lying through or along
// a wall is what misreads), arc hits once. Leaf and arc both start on the
// door's own wall, so that end is trimmed back by `trim` world px — otherwise
// a neighbour meeting the door's wall right at the jamb always registers.
function scoreHanging(wall, op, double, hingeAtEnd, swingFlip, obstacles, trimPx) {
  const dx = wall.endX - wall.startX
  const dy = wall.endY - wall.startY
  const len = Math.hypot(dx, dy)
  const ux = dx / len
  const uy = dy / len
  const side = swingFlip ? -1 : 1
  const nx = -uy * side
  const ny = ux * side
  const hitCount = (ax, ay, bx, by) => {
    let n = 0
    for (const o of obstacles) if (segHitsObstacle(ax, ay, bx, by, o)) n++
    return n
  }
  let score = 0
  for (const [hingeF, freeF] of doorLeaves(op, double, hingeAtEnd)) {
    const hx = wall.startX + dx * hingeF
    const hy = wall.startY + dy * hingeF
    const r = Math.abs(freeF - hingeF) * len
    if (r <= 1e-6) continue
    const trim = Math.min(trimPx / r, 0.3)
    score += 2 * hitCount(hx + nx * r * trim, hy + ny * r * trim, hx + nx * r, hy + ny * r)
    // Arc from the free edge (on the wall) round to the leaf tip.
    const fx = Math.sign(freeF - hingeF) * ux
    const fy = Math.sign(freeF - hingeF) * uy
    let px = null
    let py = null
    for (let i = 0; i <= ARC_SAMPLES; i++) {
      const a = (trim + ((1 - trim) * i) / ARC_SAMPLES) * (Math.PI / 2)
      const qx = hx + (fx * Math.cos(a) + nx * Math.sin(a)) * r
      const qy = hy + (fy * Math.cos(a) + ny * Math.sin(a)) * r
      if (px !== null) score += hitCount(px, py, qx, qy)
      px = qx
      py = qy
    }
  }
  return score
}

// Cache per walls array (the store replaces it on every edit, which is
// exactly when a swing can change) and pxPerM (it decides double doors).
const cache = new WeakMap()

export function resolveDoorSwing(wall, op, walls, pxPerM) {
  const double = isDoubleDoor(wall, op, pxPerM)
  if (hasUserSwing(op)) {
    return { hingeAtEnd: !!op.hingeAtEnd, swingFlip: !!op.swingFlip, double }
  }
  const len = Math.hypot(wall.endX - wall.startX, wall.endY - wall.startY)
  if (!walls || len <= 1e-6) return { hingeAtEnd: false, swingFlip: false, double }

  let perWalls = cache.get(walls)
  if (!perWalls || perWalls.pxPerM !== pxPerM) {
    perWalls = { pxPerM, byOp: new Map() }
    cache.set(walls, perWalls)
  }
  const key = `${wall.id}:${op.id}`
  const hit = perWalls.byOp.get(key)
  if (hit) return hit

  // Other walls' solid spans — a leaf swinging through a neighbour's own
  // doorway isn't a clash.
  const obstacles = []
  for (const w of walls) {
    if (w.id === wall.id) continue
    const wdx = w.endX - w.startX
    const wdy = w.endY - w.startY
    const reach = (((w.thicknessM ?? DEFAULT_WALL_THICKNESS_M) / 2) + CLEARANCE_M) * pxPerM
    for (const [a, b] of solidSpans(w.openings)) {
      obstacles.push([w.startX + wdx * a, w.startY + wdy * a, w.startX + wdx * b, w.startY + wdy * b, reach])
    }
  }

  // Trim past the door's own wall face plus the clearance, so the jamb
  // neighbours sit outside what gets tested.
  const trimPx = (((wall.thicknessM ?? DEFAULT_WALL_THICKNESS_M) / 2) + CLEARANCE_M * 2) * pxPerM

  // Ties keep the earlier (default-first) hanging.
  const hangings = double
    ? [[false, false], [false, true]]
    : [[false, false], [true, false], [false, true], [true, true]]
  let best = null
  for (const [hingeAtEnd, swingFlip] of hangings) {
    const score = scoreHanging(wall, op, double, hingeAtEnd, swingFlip, obstacles, trimPx)
    if (!best || score < best.score) best = { hingeAtEnd, swingFlip, score }
    if (score === 0) break
  }
  const result = { hingeAtEnd: best.hingeAtEnd, swingFlip: best.swingFlip, double }
  perWalls.byOp.set(key, result)
  return result
}
