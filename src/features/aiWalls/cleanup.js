// walls.md "Floorplan Vector Cleanup Spec" — Steps 1–7.
// Input: raw segments per type from extractVectors.
// Output: cleaned wall graph + attached doors/windows.

const DEFAULT_CONFIG = {
  minLength:       { wall: 12, door: 6, window: 6 },
  merge:           { axisTolerance: 4, gapTolerance: 10 },
  snapDistance:    6,
  attachDistance:  12,
  // axis-coalesce tolerance — pulls near-collinear segments to a shared axis
  // even when their gap exceeds merge.gapTolerance (e.g. walls split by a door).
  // 8 handles the column-vs-thin-wall centerline offset: a 24 px thick column
  // (post-dilation) and 12 px thin wall sharing an outer edge have centerlines
  // (24-12)/2 = 6 px apart. Tolerance 6 was borderline; 8 absorbs rounding.
  coalesceTolerance: 8,
  // T-junction repair tolerance — endpoint that's within N px of another wall's
  // interior gets extended to the wall and splits it. Closes the dangling /
  // undershoot / overshoot cases that splitCrossingSegments (strict inequality)
  // misses.
  tJunctionTolerance: 6,
  // Drop walls with both endpoints unconnected to any junction. After
  // repairTJunctions runs, surviving orphans are typically image noise
  // (text, scale tick marks, isolated artifacts).
  removeOrphans: true,
  // Drop tiny isolated wall clusters by bounding-box size. A "+" tick mark
  // forms its own X-junction (passes orphan filter) but its whole bbox is
  // ~20×20 px. Real floorplan areas have bbox ≥ 100×100 px, so 30 catches
  // noise without risk of nuking legitimate structures.
  maxNoiseClusterSize: 30,
  // Bonus subtracted from same-orientation candidate's distance when picking
  // an opening's parent wall. Architectural reality: doors/windows almost
  // always replace a section of same-direction wall, not attach perpendicular
  // to a different-direction wall. With bonus=4, a same-orient wall ties or
  // wins as long as it's within (perp_dist + 4) px — but a clearly-closer
  // perpendicular wall (dist gap > 4) still wins.
  sameOrientBonus: 4,
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

// Topology repair — weld near-miss T-junctions. Reviewer's "dangling endpoints
// / overshoot / undershoot" failure mode: an endpoint is 1-3 px from the
// perpendicular wall it should attach to, so detectJunctions can't pair them.
//
// For each segment endpoint, find the nearest perpendicular wall such that:
//   - perpendicular distance ≤ tolerance (axis offset)
//   - projection lies within the host's range (with tolerance margin for
//     overshoot past the corner)
// Extend the endpoint to the projection, axis-lock the segment, and split the
// host at the projection point if it lands strictly inside.
//
// Iterates because each repair can expose new ones (e.g. after extending a
// stub to a wall, the stub's other end may now reach another wall).
function repairTJunctions(segments, tolerance) {
  let list = segments.map(s => ({ ...s }))
  let changed = true
  let guard = list.length * list.length + 10  // safety cap
  while (changed && guard-- > 0) {
    changed = false
    outer: for (let i = 0; i < list.length; i++) {
      const seg = list[i]
      for (const which of ['start', 'end']) {
        const ex = which === 'start' ? seg.x1 : seg.x2
        const ey = which === 'start' ? seg.y1 : seg.y2
        let bestJ = -1, bestDist = Infinity, bestProj = null, bestSplit = false
        for (let j = 0; j < list.length; j++) {
          if (j === i) continue
          const host = list[j]
          if (host.orientation === seg.orientation) continue
          let projX, projY, perpDist, withinRange, strictlyInside
          if (host.orientation === 'horizontal') {
            projX = ex; projY = host.y1
            perpDist = Math.abs(ey - host.y1)
            withinRange = ex >= host.x1 - tolerance && ex <= host.x2 + tolerance
            strictlyInside = ex > host.x1 && ex < host.x2
          } else {
            projX = host.x1; projY = ey
            perpDist = Math.abs(ex - host.x1)
            withinRange = ey >= host.y1 - tolerance && ey <= host.y2 + tolerance
            strictlyInside = ey > host.y1 && ey < host.y2
          }
          if (!withinRange || perpDist > tolerance) continue
          // Skip if endpoint already coincides with host endpoint (L-junction —
          // detectJunctions handles this directly).
          if (perpDist === 0 &&
              ((host.orientation === 'horizontal' && (ex === host.x1 || ex === host.x2)) ||
               (host.orientation === 'vertical'   && (ey === host.y1 || ey === host.y2)))) continue
          // Skip exact T already formed (no work needed).
          if (perpDist === 0 && strictlyInside === false) continue
          if (perpDist < bestDist) {
            bestDist = perpDist; bestJ = j
            bestProj = { x: projX, y: projY }
            bestSplit = strictlyInside
          }
        }
        if (bestJ < 0) continue
        const updated = { ...seg }
        if (which === 'start') { updated.x1 = bestProj.x; updated.y1 = bestProj.y }
        else                   { updated.x2 = bestProj.x; updated.y2 = bestProj.y }
        // Re-axis-lock after move (perpDist could be > 0).
        if (updated.orientation === 'horizontal') updated.y2 = updated.y1
        else                                       updated.x2 = updated.x1
        // Skip if extension collapsed the segment.
        if (updated.x1 === updated.x2 && updated.y1 === updated.y2) continue
        if (bestSplit) {
          const host = list[bestJ]
          let hA, hB
          if (host.orientation === 'horizontal') {
            hA = { ...host, x2: bestProj.x }
            hB = { ...host, x1: bestProj.x }
          } else {
            hA = { ...host, y2: bestProj.y }
            hB = { ...host, y1: bestProj.y }
          }
          // Skip degenerate split (projection on host endpoint).
          const aZero = hA.x1 === hA.x2 && hA.y1 === hA.y2
          const bZero = hB.x1 === hB.x2 && hB.y1 === hB.y2
          if (aZero || bZero) {
            list[i] = updated
          } else {
            const next = []
            for (let k = 0; k < list.length; k++) {
              if (k === i) next.push(updated)
              else if (k === bestJ) { next.push(hA); next.push(hB) }
              else next.push(list[k])
            }
            list = next
          }
        } else {
          list[i] = updated
        }
        changed = true
        break outer
      }
    }
  }
  return list
}

// Drop fully-orphan walls. A wall whose neither endpoint sits at a junction
// node is disconnected from the structural graph — typically scale ticks,
// dimension marks, or noise pixels that survived minLength.
// Walls with at least one endpoint at a junction are kept (legit perimeter
// segments often have a free end, e.g. balcony-railing terminations).
function removeOrphanWalls(walls, nodes) {
  if (walls.length === 0) return walls
  const keys = new Set(nodes.map(n => `${n.x},${n.y}`))
  return walls.filter(w =>
    keys.has(`${w.x1},${w.y1}`) || keys.has(`${w.x2},${w.y2}`)
  )
}

// Remove wall clusters whose bbox fits inside maxSize × maxSize. Targets noise
// like "+" tick marks (bbox ~20×20 px) without risk to legitimate structures
// (any real room/area has bbox ≥ 100 px on at least one axis). Component
// graph: two walls are linked if they share an endpoint.
function removeTinyClusters(walls, maxSize) {
  if (walls.length === 0 || maxSize <= 0) return walls
  const n = walls.length
  const epToWalls = new Map()
  walls.forEach((w, i) => {
    for (const k of [`${w.x1},${w.y1}`, `${w.x2},${w.y2}`]) {
      if (!epToWalls.has(k)) epToWalls.set(k, [])
      epToWalls.get(k).push(i)
    }
  })
  const adj = Array.from({ length: n }, () => [])
  for (const ids of epToWalls.values()) {
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        adj[ids[a]].push(ids[b])
        adj[ids[b]].push(ids[a])
      }
    }
  }
  const comp = new Array(n).fill(-1)
  let cid = 0
  for (let i = 0; i < n; i++) {
    if (comp[i] !== -1) continue
    comp[i] = cid
    const stack = [i]
    while (stack.length) {
      const u = stack.pop()
      for (const v of adj[u]) {
        if (comp[v] === -1) { comp[v] = cid; stack.push(v) }
      }
    }
    cid++
  }
  // Compute bbox per component.
  const bbox = new Map()
  for (let i = 0; i < n; i++) {
    const w = walls[i]
    const c = comp[i]
    const minX = Math.min(w.x1, w.x2)
    const maxX = Math.max(w.x1, w.x2)
    const minY = Math.min(w.y1, w.y2)
    const maxY = Math.max(w.y1, w.y2)
    if (!bbox.has(c)) bbox.set(c, { minX, maxX, minY, maxY })
    else {
      const b = bbox.get(c)
      if (minX < b.minX) b.minX = minX
      if (maxX > b.maxX) b.maxX = maxX
      if (minY < b.minY) b.minY = minY
      if (maxY > b.maxY) b.maxY = maxY
    }
  }
  return walls.filter((_, i) => {
    const b = bbox.get(comp[i])
    const w = b.maxX - b.minX
    const h = b.maxY - b.minY
    // Keep if EITHER dimension exceeds threshold (legit structures elongate).
    return w > maxSize || h > maxSize
  })
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

// Axis coalesce — pull near-collinear segments to a shared axis without merging.
// Unlike mergeCollinearSegments this ignores gap distance, so walls split by an
// opening (door/window 30–60 px wide) still align to the same y/x. Group axes
// greedily and resolve each group to its median.
function coalesceAxes(segments, tolerance) {
  if (!tolerance || segments.length === 0) return segments
  const out = segments.map(s => ({ ...s }))
  for (const orient of ['horizontal', 'vertical']) {
    const idx = []
    for (let i = 0; i < out.length; i++) {
      if (out[i].orientation === orient) idx.push(i)
    }
    if (idx.length < 2) continue
    const axisOf = (s) => orient === 'horizontal' ? s.y1 : s.x1
    idx.sort((a, b) => axisOf(out[a]) - axisOf(out[b]))
    // Chain-based grouping: consecutive segments within tolerance form one
    // group, even if total spread exceeds tolerance. This is correct for
    // floorplans where column/wall/opening centerlines drift in chains
    // (column at y=98 → window at y=104 → door at y=110, each gap 6 px).
    // The "spread runaway" failure mode (200 walls each 1 px apart all merging)
    // doesn't occur in practice — real parallel walls in floorplans are
    // separated by ≥50 px, far beyond any reasonable tolerance.
    const groups = []
    let cur = [idx[0]]
    let prevVal = axisOf(out[idx[0]])
    for (let k = 1; k < idx.length; k++) {
      const here = axisOf(out[idx[k]])
      if (here - prevVal <= tolerance) {
        cur.push(idx[k])
      } else {
        groups.push(cur)
        cur = [idx[k]]
      }
      prevVal = here
    }
    groups.push(cur)
    for (const g of groups) {
      if (g.length < 2) continue
      const vals = g.map(i => axisOf(out[i])).sort((a, b) => a - b)
      const median = vals[Math.floor(vals.length / 2)]
      for (const i of g) {
        if (orient === 'horizontal') { out[i].y1 = median; out[i].y2 = median }
        else                          { out[i].x1 = median; out[i].x2 = median }
      }
    }
  }
  return out
}

// Align opening (door/window) to its parent wall geometry. Same-orientation
// openings snap to the wall's axis (so an offset door sits flush). Perpendicular
// openings extend the endpoint nearest the wall to lie on the wall centerline,
// closing the half-wall-thickness gap that's geometrically inevitable in raw
// extraction.
function alignOpeningsToWalls(walls, openings) {
  return openings.map(op => {
    if (op.parentWallIndex == null) return op
    const w = walls[op.parentWallIndex]
    if (!w) return op
    if (w.orientation === op.orientation) {
      if (op.orientation === 'horizontal') return { ...op, y1: w.y1, y2: w.y1 }
      return                                       { ...op, x1: w.x1, x2: w.x1 }
    }
    if (op.orientation === 'horizontal') {
      const wx = w.x1
      return Math.abs(op.x1 - wx) < Math.abs(op.x2 - wx)
        ? { ...op, x1: wx }
        : { ...op, x2: wx }
    }
    const wy = w.y1
    return Math.abs(op.y1 - wy) < Math.abs(op.y2 - wy)
      ? { ...op, y1: wy }
      : { ...op, y2: wy }
  })
}

// Step 7 — attach door/window to nearest wall.
// Same orientation: opening sits on wall axis, distance = axis offset.
// Perpendicular: opening's endpoint touches wall, distance = min endpoint→axis
// (using opening *center* fails for any opening longer than 2×attachDistance —
// e.g. a 50 px horizontal door touching a vertical wall has cx 25 px away).
//
// Tiebreak: bias toward same-orient parent (architectural prior — doors/
// windows almost always replace a wall section). Bias is small (sameOrientBonus)
// so a clearly-closer perpendicular wall still wins.
function attachOpenings(walls, openings, attachDistance, sameOrientBonus = 0) {
  return openings.map(op => {
    let bestSame = null, bestSameDist = Infinity
    let bestPerp = null, bestPerpDist = Infinity
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]
      let d
      if (w.orientation === op.orientation) {
        if (op.orientation === 'horizontal') {
          const opMin = Math.min(op.x1, op.x2)
          const opMax = Math.max(op.x1, op.x2)
          const overlapX = !(opMax < w.x1 - attachDistance || opMin > w.x2 + attachDistance)
          if (!overlapX) continue
          d = Math.abs(((op.y1 + op.y2) / 2) - w.y1)
        } else {
          const opMin = Math.min(op.y1, op.y2)
          const opMax = Math.max(op.y1, op.y2)
          const overlapY = !(opMax < w.y1 - attachDistance || opMin > w.y2 + attachDistance)
          if (!overlapY) continue
          d = Math.abs(((op.x1 + op.x2) / 2) - w.x1)
        }
        if (d < bestSameDist) { bestSameDist = d; bestSame = i }
      } else {
        if (op.orientation === 'horizontal') {
          const opY = (op.y1 + op.y2) / 2
          const insideY = opY >= w.y1 - attachDistance && opY <= w.y2 + attachDistance
          if (!insideY) continue
          d = Math.min(Math.abs(op.x1 - w.x1), Math.abs(op.x2 - w.x1))
        } else {
          const opX = (op.x1 + op.x2) / 2
          const insideX = opX >= w.x1 - attachDistance && opX <= w.x2 + attachDistance
          if (!insideX) continue
          d = Math.min(Math.abs(op.y1 - w.y1), Math.abs(op.y2 - w.y1))
        }
        if (d < bestPerpDist) { bestPerpDist = d; bestPerp = i }
      }
    }
    // Pick: same-orient wins if within (perp_dist + bonus). Otherwise perp.
    const sameValid = bestSame != null && bestSameDist <= attachDistance
    const perpValid = bestPerp != null && bestPerpDist <= attachDistance
    if (sameValid && (!perpValid || bestSameDist <= bestPerpDist + sameOrientBonus)) {
      return { ...op, parentWallIndex: bestSame, attachDistance: bestSameDist }
    }
    if (perpValid) {
      return { ...op, parentWallIndex: bestPerp, attachDistance: bestPerpDist }
    }
    return { ...op, parentWallIndex: null, attachDistance: Infinity }
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

  // Cross-type axis-coalesce — pull walls + doors + windows onto shared axes.
  // Critical for cases where a wall stub between an opening and its parent
  // wall got filtered (too short for minSegmentLength), leaving the opening
  // and the wall on slightly different axes that per-type coalesce can't
  // bridge. After this pass, a vertical door, vertical window, and vertical
  // wall that were originally collinear in the source will share one x axis.
  {
    const combined = [...after.wall, ...after.door, ...after.window]
    const coalesced = coalesceAxes(combined, cfg.coalesceTolerance)
    after.wall   = coalesced.filter(s => s.type === 'wall')
    after.door   = coalesced.filter(s => s.type === 'door')
    after.window = coalesced.filter(s => s.type === 'window')
  }

  // 5 — only on walls (door/window 不做穿越分割)
  after.wall = splitCrossingSegments(after.wall)
  // 6 again on walls (split 後重新整理)
  after.wall = normalizeAndDedupe(after.wall)

  // Topology repair — weld T-junctions that were 1-3 px short of contact.
  // splitCrossingSegments only catches strict X crossings; this catches the
  // dangling/undershoot/overshoot cases that detectJunctions would otherwise miss.
  after.wall = repairTJunctions(after.wall, cfg.tJunctionTolerance)
  // NOTE: do NOT run mergeCollinearSegments after split/repair. Split halves
  // share an endpoint at the junction (gap=0, same axis) and would merge back,
  // erasing the very T-junctions we just formed. mergeCollinear already ran
  // pre-split in the per-type loop.
  after.wall = normalizeAndDedupe(after.wall)

  // 4 — junctions on wall graph (preliminary, used to detect orphans)
  let nodes = detectJunctions(after.wall)
  if (cfg.removeOrphans) {
    after.wall = removeOrphanWalls(after.wall, nodes)
    nodes = detectJunctions(after.wall)
  }
  // Drop tiny self-contained noise clusters by bbox size (e.g. "+" markers).
  after.wall = removeTinyClusters(after.wall, cfg.maxNoiseClusterSize)
  nodes = detectJunctions(after.wall)

  // 7 — attach openings to their nearest wall…
  let doors   = attachOpenings(after.wall, after.door,   cfg.attachDistance, cfg.sameOrientBonus)
  let windows = attachOpenings(after.wall, after.window, cfg.attachDistance, cfg.sameOrientBonus)
  // …then align: snap to wall axis (same-orient) or extend to centerline (perp).
  doors   = alignOpeningsToWalls(after.wall, doors)
  windows = alignOpeningsToWalls(after.wall, windows)

  return { walls: after.wall, doors, windows, nodes, config: cfg }
}
