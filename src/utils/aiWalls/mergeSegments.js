// 16-3h — Graph-based collinear segment merge.
//
// HoughLinesP often returns the same wall as several short, slightly offset
// segments (gaps at door openings, jitter at endpoints, parallel runs along
// thick walls). Pairwise greedy merge is fragile because the result depends
// on iteration order. We model the problem as a graph instead:
//
//   node = candidate segment
//   edge = "these two are collinear and close enough":
//     angleDiff(u_i, u_j) < ANGLE_TOL  (treat ±180° as equal)
//     |offset_i - offset_j|  < OFFSET_TOL   (perpendicular distance)
//     projGap along u        < GAP_TOL      (along-axis gap)
//
// Union-find connects the components, then each component is collapsed by
// projecting all endpoints onto a consensus direction (length-weighted
// average u) and taking the min/max projections as the merged endpoints.
//
// Inputs are HoughLinesP-style segments [[x1,y1,x2,y2], ...].
// Returns merged segments in the same shape, with shorter members dropped.

const TWO_PI = Math.PI * 2

function angleDiff(a, b) {
  // Both a and b in (-π, π]; we treat lines as undirected, so wrap to [0, π).
  let d = Math.abs(a - b)
  if (d > Math.PI) d = TWO_PI - d
  if (d > Math.PI / 2) d = Math.PI - d
  return d
}

function makeFeatures(seg) {
  const [x1, y1, x2, y2] = seg
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return null
  const ux = dx / len, uy = dy / len
  // Canonicalize direction so ux >= 0 (or uy >= 0 if vertical) — makes the
  // comparison invariant to which endpoint Hough listed first.
  let cx = ux, cy = uy
  if (cx < 0 || (cx === 0 && cy < 0)) { cx = -cx; cy = -cy }
  const angle = Math.atan2(cy, cx)
  // Normal vector (rotate u by 90°): n = (-uy, ux). Use canonical (cx, cy).
  const nx = -cy, ny = cx
  // Projections of both endpoints onto u-axis (canonical) and n-axis.
  const t1 = x1 * cx + y1 * cy
  const t2 = x2 * cx + y2 * cy
  const tMin = Math.min(t1, t2)
  const tMax = Math.max(t1, t2)
  // Offset = signed perpendicular distance from origin along n.
  // Use midpoint to make this stable.
  const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2
  const offset = midX * nx + midY * ny
  return { x1, y1, x2, y2, len, ux: cx, uy: cy, angle, offset, tMin, tMax }
}

class UnionFind {
  constructor(n) {
    this.p = new Int32Array(n)
    for (let i = 0; i < n; i++) this.p[i] = i
  }
  find(i) {
    let r = i
    while (this.p[r] !== r) r = this.p[r]
    while (this.p[i] !== r) { const next = this.p[i]; this.p[i] = r; i = next }
    return r
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b)
    if (ra !== rb) this.p[ra] = rb
  }
}

export function mergeCollinearSegments(segments, options = {}) {
  const angleTolDeg = options.angleTolDeg ?? 5
  const offsetTol   = options.offsetTol   ?? 4
  const gapTol      = options.gapTol      ?? 12
  const angleTol = (angleTolDeg * Math.PI) / 180

  const feats = []
  const idxMap = []
  for (let i = 0; i < segments.length; i++) {
    const f = makeFeatures(segments[i])
    if (f) { idxMap.push(i); feats.push(f) }
  }
  const n = feats.length
  if (n === 0) return []

  // O(n^2) connectivity check. n is HoughLinesP output, typically 100-2000;
  // fine without spatial indexing. If it ever gets slow, bucket by angle
  // first (groups within ANGLE_TOL of dominant orientations).
  const uf = new UnionFind(n)
  for (let i = 0; i < n; i++) {
    const a = feats[i]
    for (let j = i + 1; j < n; j++) {
      const b = feats[j]
      if (angleDiff(a.angle, b.angle) > angleTol) continue
      if (Math.abs(a.offset - b.offset) > offsetTol) continue
      // Along-axis gap: if intervals overlap, gap = 0; else gap = positive.
      const gap = Math.max(0, Math.max(a.tMin, b.tMin) - Math.min(a.tMax, b.tMax))
      if (gap > gapTol) continue
      uf.union(i, j)
    }
  }

  // Group by root.
  const groups = new Map()
  for (let i = 0; i < n; i++) {
    const r = uf.find(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(i)
  }

  const merged = []
  for (const memberIdxs of groups.values()) {
    if (memberIdxs.length === 1) {
      const f = feats[memberIdxs[0]]
      merged.push([f.x1, f.y1, f.x2, f.y2])
      continue
    }
    // Length-weighted average direction.
    let sumUx = 0, sumUy = 0, sumLen = 0
    for (const i of memberIdxs) {
      const f = feats[i]
      sumUx += f.ux * f.len
      sumUy += f.uy * f.len
      sumLen += f.len
    }
    const norm = Math.hypot(sumUx, sumUy) || 1
    const ux = sumUx / norm, uy = sumUy / norm
    const nx = -uy, ny = ux

    // Length-weighted average offset (along n).
    let sumOffset = 0
    for (const i of memberIdxs) sumOffset += feats[i].offset * feats[i].len
    const offset = sumOffset / sumLen

    // Project all endpoints onto the consensus u-axis; take min/max.
    let tMin = +Infinity, tMax = -Infinity
    for (const i of memberIdxs) {
      const f = feats[i]
      const proj1 = f.x1 * ux + f.y1 * uy
      const proj2 = f.x2 * ux + f.y2 * uy
      if (proj1 < tMin) tMin = proj1
      if (proj2 < tMin) tMin = proj2
      if (proj1 > tMax) tMax = proj1
      if (proj2 > tMax) tMax = proj2
    }
    // Reconstruct the merged segment: anchor at offset along n, span [tMin,tMax] along u.
    const ax = offset * nx, ay = offset * ny
    const x1 = ax + tMin * ux, y1 = ay + tMin * uy
    const x2 = ax + tMax * ux, y2 = ay + tMax * uy
    merged.push([Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)])
  }
  return merged
}
