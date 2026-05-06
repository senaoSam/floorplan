// walls.md "Floorplan Vector Cleanup Spec" — Steps 1–7.
// Input: raw segments per type from extractVectors.
// Output: cleaned wall graph + attached doors/windows.

const DEFAULT_CONFIG = {
  minLength:       { wall: 12, door: 6, window: 6 },
  merge:           { axisTolerance: 4, gapTolerance: 10 },
  snapDistance:    6,
  attachDistance:  12,
}

// Step 1
function removeShortSegments(segments, minLength) {
  return segments.filter(seg => {
    const len = seg.orientation === 'horizontal'
      ? Math.abs(seg.x2 - seg.x1)
      : Math.abs(seg.y2 - seg.y1)
    return len >= minLength
  })
}

// Step 2
function mergeCollinearSegments(segments, axisTolerance, gapTolerance) {
  const list = segments.map(s => ({ ...s }))
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j]
        if (a.orientation !== b.orientation) continue
        if (a.orientation === 'horizontal') {
          const sameAxis = Math.abs(a.y1 - b.y1) <= axisTolerance
          const gap = Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2)
          if (sameAxis && gap <= gapTolerance) {
            list[i] = {
              ...a,
              x1: Math.min(a.x1, b.x1),
              x2: Math.max(a.x2, b.x2),
              y1: Math.round((a.y1 + b.y1) / 2),
              y2: Math.round((a.y1 + b.y1) / 2),
            }
            list.splice(j, 1)
            changed = true
            break outer
          }
        } else {
          const sameAxis = Math.abs(a.x1 - b.x1) <= axisTolerance
          const gap = Math.max(a.y1, b.y1) - Math.min(a.y2, b.y2)
          if (sameAxis && gap <= gapTolerance) {
            list[i] = {
              ...a,
              y1: Math.min(a.y1, b.y1),
              y2: Math.max(a.y2, b.y2),
              x1: Math.round((a.x1 + b.x1) / 2),
              x2: Math.round((a.x1 + b.x1) / 2),
            }
            list.splice(j, 1)
            changed = true
            break outer
          }
        }
      }
    }
  }
  return list
}

// Step 3
function snapEndpoints(segments, snapDistance) {
  const points = []
  for (const seg of segments) {
    points.push({ segment: seg, key: 'start', x: seg.x1, y: seg.y1 })
    points.push({ segment: seg, key: 'end',   x: seg.x2, y: seg.y2 })
  }
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i], b = points[j]
      const dx = a.x - b.x, dy = a.y - b.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > 0 && dist <= snapDistance) {
        const mx = Math.round((a.x + b.x) / 2)
        const my = Math.round((a.y + b.y) / 2)
        if (a.key === 'start') { a.segment.x1 = mx; a.segment.y1 = my }
        else                   { a.segment.x2 = mx; a.segment.y2 = my }
        if (b.key === 'start') { b.segment.x1 = mx; b.segment.y1 = my }
        else                   { b.segment.x2 = mx; b.segment.y2 = my }
        a.x = mx; a.y = my; b.x = mx; b.y = my
      }
    }
  }
  return segments
}

// Step 6 (run early): integer snap + dedupe + axis-lock.
function normalizeAndDedupe(segments) {
  const out = []
  const seen = new Set()
  for (const s of segments) {
    let x1 = Math.round(s.x1), y1 = Math.round(s.y1)
    let x2 = Math.round(s.x2), y2 = Math.round(s.y2)
    if (s.orientation === 'horizontal') {
      const y = Math.round((y1 + y2) / 2); y1 = y; y2 = y
      if (x1 > x2) [x1, x2] = [x2, x1]
    } else {
      const x = Math.round((x1 + x2) / 2); x1 = x; x2 = x
      if (y1 > y2) [y1, y2] = [y2, y1]
    }
    const key = `${s.orientation}|${x1},${y1}|${x2},${y2}|${s.type ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...s, x1, y1, x2, y2 })
  }
  return out
}

// Step 5 — split H × V crossings. Run after Step 6 so coords are axis-locked.
function splitCrossingSegments(segments) {
  let list = segments.slice()
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < list.length; i++) {
      const h = list[i]
      if (h.orientation !== 'horizontal') continue
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue
        const v = list[j]
        if (v.orientation !== 'vertical') continue
        const hits =
          v.x1 > h.x1 && v.x1 < h.x2 &&
          h.y1 > v.y1 && h.y1 < v.y2
        if (!hits) continue
        const ix = v.x1, iy = h.y1
        const newH1 = { ...h, x1: h.x1, x2: ix }
        const newH2 = { ...h, x1: ix, x2: h.x2 }
        const newV1 = { ...v, y1: v.y1, y2: iy }
        const newV2 = { ...v, y1: iy, y2: v.y2 }
        const replaced = []
        for (let k = 0; k < list.length; k++) {
          if (k === i)      replaced.push(newH1, newH2)
          else if (k === j) replaced.push(newV1, newV2)
          else              replaced.push(list[k])
        }
        list = replaced
        changed = true
        break
      }
      if (changed) break
    }
  }
  return list
}

// Step 4 — junction nodes. Endpoints sharing the same (x,y) form a node.
function detectJunctions(segments) {
  const buckets = new Map()
  segments.forEach((s, idx) => {
    const ends = [
      { x: s.x1, y: s.y1, end: 'start' },
      { x: s.x2, y: s.y2, end: 'end'   },
    ]
    for (const e of ends) {
      const k = `${e.x},${e.y}`
      if (!buckets.has(k)) buckets.set(k, { x: e.x, y: e.y, segIds: [] })
      buckets.get(k).segIds.push(idx)
    }
  })
  const nodes = []
  let nid = 0
  for (const b of buckets.values()) {
    if (b.segIds.length >= 2) {
      nodes.push({ id: `n${nid++}`, x: b.x, y: b.y, connectedSegments: b.segIds })
    }
  }
  return nodes
}

// Step 7 — attach door/window centers to nearest wall centerline.
function attachOpenings(walls, openings, attachDistance) {
  return openings.map(op => {
    const cx = (op.x1 + op.x2) / 2
    const cy = (op.y1 + op.y2) / 2
    let best = null
    let bestDist = Infinity
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]
      let d
      if (w.orientation === 'horizontal') {
        const insideX = cx >= w.x1 - attachDistance && cx <= w.x2 + attachDistance
        if (!insideX) continue
        d = Math.abs(cy - w.y1)
      } else {
        const insideY = cy >= w.y1 - attachDistance && cy <= w.y2 + attachDistance
        if (!insideY) continue
        d = Math.abs(cx - w.x1)
      }
      if (d < bestDist) { bestDist = d; best = i }
    }
    return {
      ...op,
      parentWallIndex: bestDist <= attachDistance ? best : null,
      attachDistance: bestDist,
    }
  })
}

export function cleanupVectors(rawByType, configOverride = {}) {
  const cfg = {
    ...DEFAULT_CONFIG,
    ...configOverride,
    minLength: { ...DEFAULT_CONFIG.minLength, ...(configOverride.minLength || {}) },
    merge:     { ...DEFAULT_CONFIG.merge,     ...(configOverride.merge     || {}) },
  }

  const after = {}
  for (const type of ['wall', 'door', 'window']) {
    let segs = (rawByType[type] || []).map(s => ({ ...s, type }))

    // 1
    segs = removeShortSegments(segs, cfg.minLength[type])
    // 2
    segs = mergeCollinearSegments(segs, cfg.merge.axisTolerance, cfg.merge.gapTolerance)
    // 3
    segs = snapEndpoints(segs, cfg.snapDistance)
    // 6 (early)
    segs = normalizeAndDedupe(segs)

    after[type] = segs
  }

  // 5 — only on walls (door/window 不做穿越分割)
  after.wall = splitCrossingSegments(after.wall)
  // 6 again on walls (split 後重新整理)
  after.wall = normalizeAndDedupe(after.wall)

  // 4 — junctions on wall graph
  const nodes = detectJunctions(after.wall)

  // 7 — attach openings
  const doors   = attachOpenings(after.wall, after.door,   cfg.attachDistance)
  const windows = attachOpenings(after.wall, after.window, cfg.attachDistance)

  return { walls: after.wall, doors, windows, nodes, config: cfg }
}
