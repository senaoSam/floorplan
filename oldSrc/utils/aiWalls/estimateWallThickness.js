// 16-3i — Estimate wall thickness via parallel-pair detection.
//
// After 16-3h merges collinear fragments, every real wall in a floor plan
// is typically drawn as TWO parallel lines (the inner and outer face of the
// wall). Furniture edges, dimension lines, and tile-grout marks are not
// drawn this way — they appear as single lines or non-parallel clusters.
// So "is this segment paired with a parallel neighbour at a small, plausible
// distance?" is a strong wall-vs-noise discriminator AND gives us a numeric
// estimate of typical wall thickness (peak of the pair-distance histogram),
// which downstream stages (16-3e morph K, 16-3f maxLineGap, 16-3j ROI width)
// need to become resolution-adaptive.
//
// Algorithm:
//   For each segment i:
//     For each segment j (j != i):
//       - direction must match within `pairAngleTolDeg`
//       - projected overlap on i's u-axis must be >= overlapRatio of min length
//       - perpendicular distance |offset_j - offset_i| must be in
//         [minThicknessPx, maxThicknessPx]
//       - distance must also be <= relMaxRatio * min(len_i, len_j) — a wall
//         is much longer than it is thick, so two parallels separated by
//         more than ~30% of their own length are almost certainly different
//         walls (catches "long diagonal vs other long diagonal across the
//         room" false pairs that pass overlap but aren't actually one wall)
//     Keep the j with the smallest qualifying distance — that's i's pair.
//   Build a length-weighted histogram of paired distances (1 px bins),
//   find the peak, refine with ±1 bin centre-of-mass for sub-bin resolution.
//
// Returns { estimatedPx, pairedCount, totalCount, histogram, perSegment }.
// `perSegment[i]` is { paired: bool, pairedDist: number|null, pairedIdx: number|null }.

const TWO_PI = Math.PI * 2

function angleDiff(a, b) {
  let d = Math.abs(a - b)
  if (d > Math.PI) d = TWO_PI - d
  if (d > Math.PI / 2) d = Math.PI - d
  return d
}

// Same canonicalisation as mergeSegments — keep features consistent across
// the two stages (a segment that merge sees as direction u must also be
// seen as direction u here, otherwise offsets won't compare).
function makeFeatures(seg) {
  const [x1, y1, x2, y2] = seg
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return null
  let cx = dx / len, cy = dy / len
  if (cx < 0 || (cx === 0 && cy < 0)) { cx = -cx; cy = -cy }
  const angle = Math.atan2(cy, cx)
  const nx = -cy, ny = cx
  const t1 = x1 * cx + y1 * cy
  const t2 = x2 * cx + y2 * cy
  const tMin = Math.min(t1, t2)
  const tMax = Math.max(t1, t2)
  const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2
  const offset = midX * nx + midY * ny
  return { len, ux: cx, uy: cy, angle, offset, tMin, tMax }
}

export function estimateWallThickness(segments, options = {}) {
  const pairAngleTolDeg  = options.pairAngleTolDeg  ?? 5
  const minThicknessPx   = options.minThicknessPx   ?? 2
  const maxThicknessPx   = options.maxThicknessPx   ?? 30
  const overlapRatio     = options.overlapRatio     ?? 0.7
  const relMaxRatio      = options.relMaxRatio      ?? 0.3
  const angleTol = (pairAngleTolDeg * Math.PI) / 180

  const n = segments.length
  const perSegment = new Array(n)
  for (let i = 0; i < n; i++) {
    perSegment[i] = { paired: false, pairedDist: null, pairedIdx: null }
  }
  if (n < 2) {
    return { estimatedPx: null, pairedCount: 0, totalCount: n, histogram: [], perSegment }
  }

  const feats = new Array(n)
  for (let i = 0; i < n; i++) feats[i] = makeFeatures(segments[i])

  // Pair search: O(n^2). n is post-merge segment count, typically << raw
  // Hough output (50-500 in practice). Bucketing by angle would give a
  // constant-factor win but adds complexity not worth it at this scale.
  for (let i = 0; i < n; i++) {
    const a = feats[i]
    if (!a) continue
    let bestDist = Infinity
    let bestJ = -1
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      const b = feats[j]
      if (!b) continue
      if (angleDiff(a.angle, b.angle) > angleTol) continue
      const dist = Math.abs(b.offset - a.offset)
      if (dist < minThicknessPx || dist > maxThicknessPx) continue
      const minLen = Math.min(a.len, b.len)
      if (minLen <= 0) continue
      // Wall-shape sanity: real walls have length >> thickness. Two long
      // parallels separated by more than ~30% of their length are almost
      // certainly two different walls (e.g. opposite walls of a corridor),
      // not the two faces of one wall. Filters out "long diagonal vs long
      // diagonal" false pairs that survive the overlap test.
      if (dist > minLen * relMaxRatio) continue
      // Project j's endpoints onto i's u-axis to test along-axis overlap.
      // We already have a.tMin/tMax in i's frame (since canonical u is the
      // same when angles match within tol — directions parallel by
      // construction). For b in i's frame we project i's u onto b's
      // endpoints; equivalent to b.tMin/tMax up to angleTol drift, which
      // we accept since the ratio test is loose anyway.
      const overlap = Math.max(0,
        Math.min(a.tMax, b.tMax) - Math.max(a.tMin, b.tMin))
      if (overlap / minLen < overlapRatio) continue
      if (dist < bestDist) { bestDist = dist; bestJ = j }
    }
    if (bestJ >= 0) {
      perSegment[i] = { paired: true, pairedDist: bestDist, pairedIdx: bestJ }
    }
  }

  // Length-weighted histogram of paired distances, 1-px bins.
  const binCount = Math.ceil(maxThicknessPx) + 1
  const hist = new Float64Array(binCount)
  let pairedCount = 0
  let totalLengthPaired = 0
  for (let i = 0; i < n; i++) {
    const ps = perSegment[i]
    if (!ps.paired) continue
    pairedCount++
    const w = feats[i] ? feats[i].len : 1
    const bin = Math.max(0, Math.min(binCount - 1, Math.round(ps.pairedDist)))
    hist[bin] += w
    totalLengthPaired += w
  }

  // Estimate via median paired distance — robust against a small number of
  // very-long-but-non-wall paired segments (e.g. a scale bar's two outlines)
  // dominating a length-weighted histogram peak. Each paired segment counts
  // once; the median is invariant to extreme length weights.
  let estimatedPx = null
  if (pairedCount > 0) {
    const dists = []
    for (let i = 0; i < n; i++) {
      const ps = perSegment[i]
      if (ps.paired) dists.push(ps.pairedDist)
    }
    dists.sort((a, b) => a - b)
    const mid = Math.floor(dists.length / 2)
    estimatedPx = dists.length % 2 === 0
      ? (dists[mid - 1] + dists[mid]) / 2
      : dists[mid]
  }

  // Also keep a length-weighted peak for diagnostics — useful when the
  // median and peak disagree (signals scale-bar or repeated-pattern bias).
  let peakPx = null
  if (pairedCount > 0 && totalLengthPaired > 0) {
    let peakIdx = 0, peakWeight = 0
    for (let i = 0; i < binCount; i++) {
      if (hist[i] > peakWeight) { peakWeight = hist[i]; peakIdx = i }
    }
    const i0 = Math.max(0, peakIdx - 1)
    const i1 = Math.min(binCount - 1, peakIdx + 1)
    let wSum = 0, wxSum = 0
    for (let i = i0; i <= i1; i++) {
      wSum += hist[i]
      wxSum += hist[i] * i
    }
    peakPx = wSum > 0 ? wxSum / wSum : peakIdx
  }

  return {
    estimatedPx,
    peakPx,
    pairedCount,
    totalCount: n,
    histogram: Array.from(hist),
    perSegment,
  }
}
