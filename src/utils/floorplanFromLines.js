import { MATERIALS } from '@/constants/materials'
import { generateId } from '@/utils/id'

// Convert a flat list of `{type, x1, y1, x2, y2}` lines (e.g. produced by an
// image-vectorizer) into the editor's `walls[]` data model.
//
// Conceptually the input is a set of co-linear segments where doors and
// windows live in the same row/column as their parent wall. A door at
// `x ∈ [290, 375]` next to a wall at `x ∈ [39, 290]` is meant to be the
// opening between two pieces of one continuous wall — the JSON splits them
// because each segment was extracted as its own colored vector.
//
// Pipeline:
//   1. Diagonals pass straight through as standalone walls (no axis to merge
//      onto).
//   2. Group axis-aligned segments by orientation × axis bucket. Within a
//      bucket, walls + doors + windows are merged together by touch/overlap
//      so a (wall, door, wall) chain collapses into one continuous wall span.
//   3. For each merged span, build the wall and embed each contributing
//      door/window as an `opening` with `startFrac`/`endFrac` covering the
//      portion it originally occupied.
//   4. Door/window segments whose run isn't connected to any wall on the same
//      axis fall back to standalone walls (with door=WOOD / window=GLASS) so
//      input data is never silently dropped.

const DEFAULTS = {
  axisTolerance: 2,    // px; line counts as same row/column if axis diff <= this
  gapTolerance: 1,     // px; walls merge if gap on the major axis <= this
  snapDistance: 4,     // px; wall endpoints within this radius collapse to one
  wallMaterial: MATERIALS.METAL,
  topHeight: 3.0,
  bottomHeight: 0,
  // Opening vertical extents (m). Real heights aren't carried in the JSON, so
  // pick reasonable defaults that match `demoSampleScenario`.
  doorBottomHeight: 0,
  doorTopHeight: 2.1,
  windowBottomHeight: 0.9,
  windowTopHeight: 2.1,
}

const orientationOf = (l, axisTolerance) => {
  const dx = Math.abs(l.x2 - l.x1)
  const dy = Math.abs(l.y2 - l.y1)
  if (dy <= axisTolerance && dx > axisTolerance) return 'h'
  if (dx <= axisTolerance && dy > axisTolerance) return 'v'
  return 'd' // diagonal / point
}

// For a horizontal line, `axis` = y, `lo`/`hi` = sorted x. Vertical mirrors.
const projectLine = (l, orient) => {
  if (orient === 'h') {
    return {
      axis: (l.y1 + l.y2) / 2,
      lo: Math.min(l.x1, l.x2),
      hi: Math.max(l.x1, l.x2),
    }
  }
  return {
    axis: (l.x1 + l.x2) / 2,
    lo: Math.min(l.y1, l.y2),
    hi: Math.max(l.y1, l.y2),
  }
}

// Bucket projected segments by axis so noisy floats share a row. Naive
// "round to nearest step" splits at step boundaries (e.g. y=263.84 and 262.68
// both within ±2 of each other but rounding to 264/262 → different buckets).
// Instead, sort by axis and start a new bucket only when the gap to the
// previous item exceeds `axisTolerance`. Returns Map<centroidKey, items[]>.
function bucketByAxis(items, axisTolerance) {
  if (items.length === 0) return new Map()
  const sorted = items.slice().sort((a, b) => a.axis - b.axis)
  const buckets = []
  let cur = { axisSum: sorted[0].axis, items: [sorted[0]], lastAxis: sorted[0].axis }
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i]
    if (it.axis - cur.lastAxis <= axisTolerance) {
      cur.axisSum += it.axis
      cur.items.push(it)
      cur.lastAxis = it.axis
    } else {
      buckets.push(cur)
      cur = { axisSum: it.axis, items: [it], lastAxis: it.axis }
    }
  }
  buckets.push(cur)
  const out = new Map()
  for (const b of buckets) {
    const key = b.axisSum / b.items.length
    out.set(key, b.items)
  }
  return out
}

// Merge axis-aligned segments (mixed wall/door/window) on the same axis bucket
// into spans where everything overlaps or touches within `gapTolerance`. Each
// span tracks its contributing segments so we can later build the wall +
// embed openings in one pass.
function mergeBucket(items, gapTolerance) {
  if (items.length === 0) return []
  const sorted = items.slice().sort((a, b) => a.lo - b.lo)
  const spans = [{
    lo: sorted[0].lo,
    hi: sorted[0].hi,
    axisSum: sorted[0].axis,
    axisCount: 1,
    members: [sorted[0]],
  }]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    const last = spans[spans.length - 1]
    if (cur.lo - last.hi <= gapTolerance) {
      last.hi = Math.max(last.hi, cur.hi)
      last.axisSum += cur.axis
      last.axisCount += 1
      last.members.push(cur)
    } else {
      spans.push({
        lo: cur.lo, hi: cur.hi,
        axisSum: cur.axis, axisCount: 1,
        members: [cur],
      })
    }
  }
  return spans
}

const fracsForOpening = (wall, orient, openingLo, openingHi) => {
  const startVal = orient === 'h' ? wall.startX : wall.startY
  const endVal   = orient === 'h' ? wall.endX   : wall.endY
  const len = Math.abs(endVal - startVal)
  if (len <= 0) return null
  const reversed = endVal < startVal
  let s, e
  if (!reversed) {
    s = (openingLo - startVal) / len
    e = (openingHi - startVal) / len
  } else {
    s = (startVal - openingHi) / len
    e = (startVal - openingLo) / len
  }
  s = Math.max(0, Math.min(1, s))
  e = Math.max(0, Math.min(1, e))
  if (e - s < 1e-4) return null
  return { startFrac: s, endFrac: e }
}

const openingFromMember = (m, wall, orient, opts) => {
  const fracs = fracsForOpening(wall, orient, m.lo, m.hi)
  if (!fracs) return null
  const isWindow = m.line.type === 'window'
  return {
    id: generateId('opening'),
    type: isWindow ? 'window' : 'door',
    startFrac: fracs.startFrac,
    endFrac: fracs.endFrac,
    material: isWindow ? MATERIALS.GLASS : MATERIALS.WOOD,
    bottomHeight: isWindow ? opts.windowBottomHeight : opts.doorBottomHeight,
    topHeight:    isWindow ? opts.windowTopHeight    : opts.doorTopHeight,
  }
}

function makeWallFromRange(orient, axis, lo, hi, opts) {
  const isH = orient === 'h'
  return {
    id: generateId('wall'),
    startX: isH ? lo   : axis,
    startY: isH ? axis : lo,
    endX:   isH ? hi   : axis,
    endY:   isH ? axis : hi,
    material: opts.wallMaterial,
    topHeight: opts.topHeight,
    bottomHeight: opts.bottomHeight,
    openings: [],
  }
}

// Collapse wall endpoints that are within `snapDistance` of each other onto a
// shared coordinate. Uses union-find on a list of {wall, endpoint} entries:
// every pair within radius gets merged into one cluster, then each cluster's
// average position is written back to all its endpoints in-place.
//
// Mutates `walls` (their startX/Y/endX/Y); openings keep their fractional
// positions so they automatically stretch/shrink with the snapped endpoints.
function snapEndpoints(walls, snapDistance) {
  if (snapDistance <= 0 || walls.length === 0) return
  const points = []
  for (const w of walls) {
    points.push({ wall: w, end: 'start', x: w.startX, y: w.startY })
    points.push({ wall: w, end: 'end',   x: w.endX,   y: w.endY })
  }
  const parent = points.map((_, i) => i)
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }

  const r2 = snapDistance * snapDistance
  // O(n^2) — fine for floor-plan-sized inputs (n < a few hundred). If this
  // ever becomes a hot path, swap in a spatial grid keyed by (x, y) / snap.
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].x - points[j].x
      const dy = points[i].y - points[j].y
      if (dx * dx + dy * dy <= r2) union(i, j)
    }
  }

  const groups = new Map()
  for (let i = 0; i < points.length; i++) {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, { sx: 0, sy: 0, n: 0, idxs: [] })
    const g = groups.get(root)
    g.sx += points[i].x; g.sy += points[i].y; g.n += 1
    g.idxs.push(i)
  }
  for (const g of groups.values()) {
    if (g.n < 2) continue
    const ax = g.sx / g.n
    const ay = g.sy / g.n
    for (const i of g.idxs) {
      const p = points[i]
      if (p.end === 'start') { p.wall.startX = ax; p.wall.startY = ay }
      else                   { p.wall.endX   = ax; p.wall.endY   = ay }
    }
  }
}

export function floorplanFromLines(lines, options = {}) {
  const opts = { ...DEFAULTS, ...options }
  const standalone = []
  const hItems = []
  const vItems = []

  for (const l of lines) {
    const o = orientationOf(l, opts.axisTolerance)
    if (o === 'd') {
      standalone.push({
        id: generateId('wall'),
        startX: l.x1, startY: l.y1,
        endX:   l.x2, endY:   l.y2,
        material: l.type === 'window' ? MATERIALS.GLASS
               : l.type === 'door'   ? MATERIALS.WOOD
               : opts.wallMaterial,
        topHeight: opts.topHeight,
        bottomHeight: opts.bottomHeight,
        openings: [],
      })
      continue
    }
    const proj = projectLine(l, o)
    ;(o === 'h' ? hItems : vItems).push({ ...proj, line: l })
  }

  let mergedWallCount = 0
  let attachedOpenings = 0
  let orphanCount = 0
  const builtWalls = []

  for (const [orient, items] of [['h', hItems], ['v', vItems]]) {
    const buckets = bucketByAxis(items, opts.axisTolerance)
    for (const bucketItems of buckets.values()) {
      const spans = mergeBucket(bucketItems, opts.gapTolerance)
      for (const span of spans) {
        // Whether or not the span contains an explicit wall segment, treat
        // the union of all members as a continuous wall and embed any
        // door/window members as openings. Doors/windows that show up alone
        // on a row are typically the "horizontal opening" between two
        // perpendicular walls — the wall is implied by the floor plan even
        // though no `type=wall` segment was authored along that row.
        const axis = span.axisSum / span.axisCount
        const wall = makeWallFromRange(orient, axis, span.lo, span.hi, opts)
        for (const m of span.members) {
          if (m.line.type === 'wall') continue
          const op = openingFromMember(m, wall, orient, opts)
          if (op) {
            wall.openings.push(op)
            attachedOpenings += 1
          } else {
            orphanCount += 1
          }
        }
        builtWalls.push(wall)
        mergedWallCount += 1
      }
    }
  }

  const allWalls = [...builtWalls, ...standalone]
  snapEndpoints(allWalls, opts.snapDistance)

  return {
    walls: allWalls,
    stats: {
      input: lines.length,
      mergedWalls: mergedWallCount,
      attachedOpenings,
      standalone: standalone.length,
      orphans: orphanCount,
    },
  }
}
