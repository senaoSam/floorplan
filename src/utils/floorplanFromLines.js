import {
  MATERIALS,
  DEFAULT_WALL_THICKNESS_M,
  MIN_WALL_THICKNESS_M,
  MAX_WALL_THICKNESS_M,
} from '@/constants/materials'
import { generateId } from '@/utils/id'

// Convert a flat list of `{type, x1, y1, x2, y2}` lines (e.g. produced by an
// image-vectorizer) into the editor's `walls[]` data model.
//
// Pipeline:
//   1. Diagonals pass straight through as standalone walls.
//   2. Group axis-aligned segments by orientation × axis bucket. Within a
//      bucket, walls + doors + windows merge by touch/overlap so a
//      (wall, door, wall) chain collapses into one continuous wall span.
//   3. For each merged span, build the wall and embed each contributing
//      door/window as an `opening` with startFrac/endFrac.
//   4. Orphan door/window segments fall back to standalone walls.

const DEFAULTS = {
  axisTolerance: 2,
  gapTolerance: 1,
  snapDistance: 4,
  // Two segments only merge when their detected thickness agrees to within
  // this many source pixels. Detectors quantize differently (cnn returns
  // integers, cv+graph returns floats like 2.8 vs 3.0), so an exact match
  // would split a uniform wall on rounding noise alone.
  thicknessTolerancePx: 2,
  wallMaterial: MATERIALS.CONCRETE,
  wallThickness: DEFAULT_WALL_THICKNESS_M,
  // px/m for converting the detector's pixel thickness into metres. Null
  // means no scale is known (no doors were detected, so the door-width
  // heuristic could not run) — every wall then keeps `wallThickness`.
  pxPerM: null,
  topHeight: 3.0,
  bottomHeight: 0,
  doorBottomHeight: 0,
  doorTopHeight: 2.1,
  windowBottomHeight: 0.9,
  windowTopHeight: 2.1,
}

// The detector reports thickness in source pixels, and only for segments it
// actually measured: cv+graph leaves it null on icon-derived openings, and
// `graph_fill` walls it inferred rather than measured come back as 0.
const thicknessPxOf = (line) => {
  const t = line?.thickness
  if (typeof t !== 'number' || !isFinite(t) || t <= 0) return null
  return t
}

// Only wall segments describe the wall's own thickness. CNN stamps a constant
// 6.0 onto every door and window, which is a placeholder rather than a
// measurement, so openings never vote on the span they sit in.
const wallThicknessPxOf = (item) =>
  item.line.type === 'wall' ? thicknessPxOf(item.line) : null

// Length-weighted median: a 400px run at 6px outweighs a 20px stub at 16px.
// Median rather than mean so one mis-measured stub cannot drag the result.
function representativeThicknessPx(items) {
  const samples = []
  for (const it of items) {
    const t = wallThicknessPxOf(it)
    if (t == null) continue
    samples.push({ t, w: Math.max(it.hi - it.lo, 1) })
  }
  if (samples.length === 0) return null
  samples.sort((a, b) => a.t - b.t)
  const total = samples.reduce((s, v) => s + v.w, 0)
  let acc = 0
  for (const s of samples) {
    acc += s.w
    if (acc >= total / 2) return s.t
  }
  return samples[samples.length - 1].t
}

// Convert detected pixels to the stored metre value, clamped to the same
// range the thickness UI enforces. Without a scale the caller's default wins.
function thicknessMFromPx(px, opts) {
  if (px == null || !opts.pxPerM || !isFinite(opts.pxPerM) || opts.pxPerM <= 0) {
    return opts.wallThickness
  }
  const m = px / opts.pxPerM
  if (!isFinite(m) || m <= 0) return opts.wallThickness
  return Math.min(MAX_WALL_THICKNESS_M, Math.max(MIN_WALL_THICKNESS_M, m))
}

const orientationOf = (l, axisTolerance) => {
  const dx = Math.abs(l.x2 - l.x1)
  const dy = Math.abs(l.y2 - l.y1)
  if (dy <= axisTolerance && dx > axisTolerance) return 'h'
  if (dx <= axisTolerance && dy > axisTolerance) return 'v'
  return 'd'
}

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

// A span tracks the thickness of the last wall segment that joined it, so the
// next candidate is compared against its immediate neighbour rather than
// against the span's average — a long run that drifts 2px at a time is a real
// taper and should split, not collapse into one averaged wall.
const newSpan = (item) => ({
  lo: item.lo,
  hi: item.hi,
  axisSum: item.axis,
  axisCount: 1,
  members: [item],
  lastWallThickness: wallThicknessPxOf(item),
})

// Openings carry no usable thickness, so they never break a span — a door
// between two equal-thickness walls still yields one wall with an opening.
// Two walls only stay together when both measured a thickness and the two
// agree within tolerance; an unmeasured wall (thickness 0 or null) is treated
// as "no opinion" and joins whatever it touches.
function thicknessAllowsMerge(span, item, tolerance) {
  const next = wallThicknessPxOf(item)
  if (next == null) return true
  const prev = span.lastWallThickness
  if (prev == null) return true
  return Math.abs(next - prev) <= tolerance
}

function mergeBucket(items, gapTolerance, thicknessTolerance) {
  if (items.length === 0) return []
  const sorted = items.slice().sort((a, b) => a.lo - b.lo)
  const spans = [newSpan(sorted[0])]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    const last = spans[spans.length - 1]
    if (cur.lo - last.hi <= gapTolerance && thicknessAllowsMerge(last, cur, thicknessTolerance)) {
      last.hi = Math.max(last.hi, cur.hi)
      last.axisSum += cur.axis
      last.axisCount += 1
      last.members.push(cur)
      const t = wallThicknessPxOf(cur)
      if (t != null) last.lastWallThickness = t
    } else {
      spans.push(newSpan(cur))
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

function makeWallFromRange(orient, axis, lo, hi, thicknessM, opts) {
  const isH = orient === 'h'
  return {
    id: generateId('wall'),
    startX: isH ? lo   : axis,
    startY: isH ? axis : lo,
    endX:   isH ? hi   : axis,
    endY:   isH ? axis : hi,
    material: opts.wallMaterial,
    thicknessM,
    topHeight: opts.topHeight,
    bottomHeight: opts.bottomHeight,
    openings: [],
  }
}

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
        // Only walls carry a measured thickness; a diagonal door/window keeps
        // the default rather than the detector's placeholder.
        thicknessM: thicknessMFromPx(
          l.type === 'wall' ? thicknessPxOf(l) : null,
          opts,
        ),
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
  let measuredWalls = 0
  const builtWalls = []

  for (const [orient, items] of [['h', hItems], ['v', vItems]]) {
    const buckets = bucketByAxis(items, opts.axisTolerance)
    for (const bucketItems of buckets.values()) {
      const spans = mergeBucket(bucketItems, opts.gapTolerance, opts.thicknessTolerancePx)
      for (const span of spans) {
        const axis = span.axisSum / span.axisCount
        const thicknessPx = representativeThicknessPx(span.members)
        if (thicknessPx != null) measuredWalls += 1
        const wall = makeWallFromRange(
          orient, axis, span.lo, span.hi,
          thicknessMFromPx(thicknessPx, opts),
          opts,
        )
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
      // How many merged walls got a thickness from the detector, and whether
      // a scale existed to turn those pixels into metres.
      measuredWalls,
      thicknessApplied: !!(opts.pxPerM && isFinite(opts.pxPerM) && opts.pxPerM > 0),
    },
  }
}
