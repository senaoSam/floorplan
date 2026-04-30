// 16-3a + 16-3c + 16-3f — AI walls preprocessing & line extraction worker.
//
// Pipeline:
//   1. preprocess        : grayscale -> Gaussian blur -> Otsu (+ invert)
//   2. deskew (16-3c)    : HoughLinesP angle histogram → strongest peak in
//                          [-45°, +45°] gives skew; warpAffine rotates the
//                          binary so axis-aligned walls become truly axis-
//                          aligned. Skipped if peak < minDeg (already aligned)
//                          or > maxDeg (probably misdetection on rotated bldg).
//   3. long-line mask    : OPEN(H)∪OPEN(V) → dilate → AND src — preserves
//                          original line thickness while removing isolated
//                          text/furniture marks
//   4. HoughLinesP       : extract candidate wall line segments
//   5. mergeCollinear    : graph-based merge of collinear segments to handle
//                          door-gap fragmentation
//   6. extendEndpoints   : walk along each merged segment's direction one px
//                          at a time, extending while the morph mask is white
//                          — recovers the last few px Hough drops near walls'
//                          ends
//
// Why classic worker (not ES module): ES module workers don't support
// importScripts, OpenCV.js is a non-module UMD bundle, and evaluating its
// 10 MB source via eval/Function in an ES worker takes 1-2 minutes (no JIT
// path). importScripts is the fast path. Served from /public so Vite
// doesn't try to bundle it.
//
// Loaded by main thread as:
//   new Worker('/floorplan/workers/aiWalls.classic.worker.js')
//
// Message protocol:
//   in:  { type: 'run', payload: { imageData, options } }
//        { type: 'cancel' }
//   out: { type: 'progress', stage, message }
//        { type: 'done',     result: { binaryImageData, width, height,
//                                       whitePixels, segments, segStats,
//                                       elapsedMs } | { aborted: true } }
//        { type: 'error',    message }
//
// `options` (all optional):
//   { blurKernel: 3, invert: true,
//     deskewEnabled: true,        // false = skip deskew entirely
//     deskewMinDeg: 0.3,          // |skew| < this → already aligned, no-op
//     deskewMaxDeg: 15,           // |skew| > this → likely a rotated building,
//                                 // not skew; refuse to rotate
//     deskewVoteThreshold: 80,    // HoughLinesP vote threshold for skew probe
//     deskewMinSamples: 30,       // need this many segments to trust the peak
//     morphKernel: 15,            // 0 = skip morph mask
//     morphDilatePx: 3,           // mask dilation (tolerance) before AND-ing
//     houghThreshold: 50,
//     minLineLengthRatio: 0.02,   // multiplied by image diagonal
//     maxLineGapPx: 8,
//     mergeAngleTolDeg: 5,        // 0 = skip merge
//     mergeOffsetTol: 4,
//     mergeGapTol: 12,
//     extendMissThreshold: 3,     // 0 = skip endpoint extension
//     extendMaxStepsPx: 30 }

let cvReady = null
let aborted = false

function loadCV() {
  if (cvReady) return cvReady
  cvReady = (async () => {
    const ready = new Promise((resolve, reject) => {
      self.Module = {
        onRuntimeInitialized: () => resolve(),
        onAbort: (what) => reject(new Error('OpenCV abort: ' + what)),
      }
    })
    importScripts('/floorplan/vendor/opencv/opencv.js')
    await ready
    const cv = self.cv
    if (!cv || !cv.Mat) throw new Error('cv ready fired but cv.Mat missing')
    // CRITICAL: the OpenCV.js Module is itself a thenable in 4.x. Returning
    // it directly from an async function causes promise assimilation and
    // hangs the await forever. Wrap in a plain object.
    return { cv }
  })()
  cvReady.catch(() => { cvReady = null })
  return cvReady
}

// Returns { thresh, whitePixels } — caller owns `thresh` Mat (must delete).
function binarize(cv, src, options) {
  const blurKernel = (options && options.blurKernel) || 3
  const invert = !options || options.invert !== false
  const gray = new cv.Mat()
  const blurred = new cv.Mat()
  const thresh = new cv.Mat()
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blurred, new cv.Size(blurKernel, blurKernel), 0, 0, cv.BORDER_DEFAULT)
    const flag = invert
      ? cv.THRESH_BINARY_INV + cv.THRESH_OTSU
      : cv.THRESH_BINARY + cv.THRESH_OTSU
    cv.threshold(blurred, thresh, 0, 255, flag)
    const whitePixels = cv.countNonZero(thresh)
    return { thresh, whitePixels }
  } finally {
    gray.delete()
    blurred.delete()
    // thresh ownership transferred to caller
  }
}

// 16-3c — Estimate skew angle from HoughLinesP segments.
//
// Why HoughLinesP not the regular HoughLines: probabilistic returns segment
// endpoints (so we can length-weight) and short walls / dimension lines
// don't dominate. The standard rho/theta accumulator would also work but
// gives every collinear pixel one vote, biasing toward long ink runs (e.g.
// a single thick page frame line outweighs a real wall cluster).
//
// Voting model: for every detected segment, compute its angle in
// [0°, 180°), fold to [-45°, +45°] mod 90° (since walls in floor plans
// are axis-aligned to **either** horizontal or vertical — both feed the
// same skew estimate), bin to 0.5° resolution, weight by segment length.
//
// Returns { angleDeg, samples, totalLengthPx, peakWeight, accepted }.
// `angleDeg` is the rotation needed to *unrotate* the image: rotating by
// `-angleDeg` brings axis-aligned walls back to true axes.
function estimateSkewAngleDeg(cv, thresh, options) {
  const W = thresh.cols, H = thresh.rows
  const diag = Math.sqrt(W * W + H * H)
  // Use slightly looser params than the main Hough pass — we want enough
  // samples to estimate the peak even on sparser inputs.
  const minLineLength = Math.max(20, Math.round(diag * 0.03))
  const maxLineGap = 4
  const voteThreshold = Math.max(20, Math.round(options?.deskewVoteThreshold ?? 80))

  const lines = new cv.Mat()
  try {
    cv.HoughLinesP(thresh, lines, 1, Math.PI / 180, voteThreshold, minLineLength, maxLineGap)
    const n = lines.rows
    if (n === 0) {
      return { angleDeg: 0, samples: 0, totalLengthPx: 0, peakWeight: 0, accepted: false }
    }

    // 0.5° bins across [-45°, +45°] = 180 bins.
    const BIN_SIZE_DEG = 0.5
    const BINS = Math.round(90 / BIN_SIZE_DEG)
    const hist = new Float64Array(BINS)
    const data = lines.data32S
    let totalLengthPx = 0

    for (let i = 0; i < n; i++) {
      const x1 = data[i * 4 + 0], y1 = data[i * 4 + 1]
      const x2 = data[i * 4 + 2], y2 = data[i * 4 + 3]
      const dx = x2 - x1, dy = y2 - y1
      const len = Math.hypot(dx, dy)
      if (len < 1) continue
      // angle in (-90°, 90°]
      let angDeg = Math.atan2(dy, dx) * 180 / Math.PI
      // fold to [-45°, +45°] modulo 90° — both H and V walls vote for the
      // same skew. A wall at 89° and a wall at -1° both indicate ~-1° skew.
      while (angDeg <= -45) angDeg += 90
      while (angDeg >   45) angDeg -= 90
      const bin = Math.max(0, Math.min(BINS - 1,
        Math.floor((angDeg + 45) / BIN_SIZE_DEG)))
      hist[bin] += len
      totalLengthPx += len
    }

    // Find peak.
    let peakIdx = 0, peakWeight = 0
    for (let i = 0; i < BINS; i++) {
      if (hist[i] > peakWeight) { peakWeight = hist[i]; peakIdx = i }
    }
    // Centre-of-mass refine within ±1 bin around the peak for sub-bin
    // resolution. Cheap and avoids quantization to 0.5°.
    const i0 = Math.max(0, peakIdx - 1)
    const i1 = Math.min(BINS - 1, peakIdx + 1)
    let wSum = 0, wxSum = 0
    for (let i = i0; i <= i1; i++) {
      wSum += hist[i]
      wxSum += hist[i] * (i + 0.5)
    }
    const refinedBin = wSum > 0 ? wxSum / wSum : peakIdx + 0.5
    const angleDeg = refinedBin * BIN_SIZE_DEG - 45

    return {
      angleDeg,
      samples: n,
      totalLengthPx: Math.round(totalLengthPx),
      peakWeight: Math.round(peakWeight),
      accepted: true,
    }
  } finally {
    lines.delete()
  }
}

// Rotate a single-channel Mat about its centre by `angleDeg` (CCW positive).
// Border filled with 0 (black; matches our inverted convention where walls
// are white on black). Image dimensions kept the same — corners may be
// clipped but for small skew angles (< 15°) the centre stays inside.
//
// Returns a new Mat owned by the caller (must delete).
function deskewMat(cv, src, angleDeg) {
  const center = new cv.Point(src.cols / 2, src.rows / 2)
  const M = cv.getRotationMatrix2D(center, angleDeg, 1.0)
  const out = new cv.Mat()
  try {
    cv.warpAffine(
      src, out, M,
      new cv.Size(src.cols, src.rows),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(0, 0, 0, 0),
    )
    // After bilinear interpolation the binary may have grey edges; re-threshold.
    cv.threshold(out, out, 127, 255, cv.THRESH_BINARY)
    return out
  } catch (e) {
    out.delete()
    throw e
  } finally {
    M.delete()
  }
}

// Directional "long-line mask" filter — preserves original line thickness.
//
// Naive approach (just MORPH_OPEN with H+V kernels) erodes thin walls away
// and chops walls whose thickness varies along their length. Instead:
//
//   1. lineMask = OPEN(H, K) ∪ OPEN(V, K)   — survives only along long runs
//   2. keepMask = dilate(lineMask, dilate)  — small dilation as tolerance
//   3. result   = src AND keepMask          — keep ORIGINAL pixels, but only
//                                             where they are near a long run
//
// Result: text and isolated furniture marks (no long-line support) get
// removed; thin walls are preserved at original thickness because we only
// gate the original src by a mask, never erode it.
//
// Returns a fresh Mat owned by the caller (must delete).
function morphOpenHV(cv, src, K, dilatePx) {
  if (!K || K < 3) return src.clone()
  const horiz   = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(K, 1))
  const vert    = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, K))
  const openH   = new cv.Mat()
  const openV   = new cv.Mat()
  const lineMsk = new cv.Mat()
  const keepMsk = new cv.Mat()
  const out     = new cv.Mat()
  try {
    cv.morphologyEx(src, openH, cv.MORPH_OPEN, horiz)
    cv.morphologyEx(src, openV, cv.MORPH_OPEN, vert)
    cv.bitwise_or(openH, openV, lineMsk)

    const d = Math.max(1, dilatePx ?? 3)
    const dilateK = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(d * 2 + 1, d * 2 + 1))
    try {
      cv.dilate(lineMsk, keepMsk, dilateK)
    } finally {
      dilateK.delete()
    }

    cv.bitwise_and(src, keepMsk, out)
    return out.clone()
  } finally {
    horiz.delete()
    vert.delete()
    openH.delete()
    openV.delete()
    lineMsk.delete()
    keepMsk.delete()
    out.delete()
  }
}

// HoughLinesP returns a Mat<int32, Nx1x4>. Convert to a flat array of
// [x1, y1, x2, y2] tuples and compute simple stats.
function extractSegments(cv, thresh, options) {
  const w = thresh.cols
  const h = thresh.rows
  const diag = Math.sqrt(w * w + h * h)
  const minLineLengthRatio = options?.minLineLengthRatio ?? 0.02
  const minLineLength = Math.max(8, Math.round(diag * minLineLengthRatio))
  const maxLineGap = Math.max(2, Math.round(options?.maxLineGapPx ?? 8))
  const threshold = Math.max(1, Math.round(options?.houghThreshold ?? 50))

  const lines = new cv.Mat()
  try {
    // rho=1 px, theta=π/180 (1°). Threshold = min votes for a line.
    cv.HoughLinesP(thresh, lines, 1, Math.PI / 180, threshold, minLineLength, maxLineGap)

    const segments = []
    let totalLength = 0
    // lines.data32S is an Int32Array of [x1,y1,x2,y2,...]; lines.rows = N.
    const n = lines.rows
    const data = lines.data32S
    for (let i = 0; i < n; i++) {
      const x1 = data[i * 4 + 0]
      const y1 = data[i * 4 + 1]
      const x2 = data[i * 4 + 2]
      const y2 = data[i * 4 + 3]
      segments.push([x1, y1, x2, y2])
      const dx = x2 - x1, dy = y2 - y1
      totalLength += Math.sqrt(dx * dx + dy * dy)
    }
    return {
      segments,
      segStats: {
        count: n,
        totalLengthPx: Math.round(totalLength),
        minLineLength,
        maxLineGap,
        threshold,
      },
    }
  } finally {
    lines.delete()
  }
}

// ---- Inlined from src/utils/aiWalls/mergeSegments.js — keep in sync ----
const TWO_PI = Math.PI * 2
function _angleDiff(a, b) {
  let d = Math.abs(a - b)
  if (d > Math.PI) d = TWO_PI - d
  if (d > Math.PI / 2) d = Math.PI - d
  return d
}
function _makeFeatures(seg) {
  const [x1, y1, x2, y2] = seg
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return null
  const ux = dx / len, uy = dy / len
  let cx = ux, cy = uy
  if (cx < 0 || (cx === 0 && cy < 0)) { cx = -cx; cy = -cy }
  const angle = Math.atan2(cy, cx)
  const nx = -cy, ny = cx
  const t1 = x1 * cx + y1 * cy
  const t2 = x2 * cx + y2 * cy
  const tMin = Math.min(t1, t2)
  const tMax = Math.max(t1, t2)
  const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2
  const offset = midX * nx + midY * ny
  return { x1, y1, x2, y2, len, ux: cx, uy: cy, angle, offset, tMin, tMax }
}
class _UF {
  constructor(n) { this.p = new Int32Array(n); for (let i = 0; i < n; i++) this.p[i] = i }
  find(i) {
    let r = i
    while (this.p[r] !== r) r = this.p[r]
    while (this.p[i] !== r) { const next = this.p[i]; this.p[i] = r; i = next }
    return r
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p[ra] = rb }
}
function mergeCollinearSegments(segments, options) {
  const angleTolDeg = options?.angleTolDeg ?? 5
  const offsetTol = options?.offsetTol ?? 4
  const gapTol = options?.gapTol ?? 12
  const angleTol = (angleTolDeg * Math.PI) / 180
  const feats = []
  for (let i = 0; i < segments.length; i++) {
    const f = _makeFeatures(segments[i])
    if (f) feats.push(f)
  }
  const n = feats.length
  if (n === 0) return []
  const uf = new _UF(n)
  for (let i = 0; i < n; i++) {
    const a = feats[i]
    for (let j = i + 1; j < n; j++) {
      const b = feats[j]
      if (_angleDiff(a.angle, b.angle) > angleTol) continue
      if (Math.abs(a.offset - b.offset) > offsetTol) continue
      const gap = Math.max(0, Math.max(a.tMin, b.tMin) - Math.min(a.tMax, b.tMax))
      if (gap > gapTol) continue
      uf.union(i, j)
    }
  }
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
    let sumUx = 0, sumUy = 0, sumLen = 0
    for (const i of memberIdxs) {
      const f = feats[i]
      sumUx += f.ux * f.len; sumUy += f.uy * f.len; sumLen += f.len
    }
    const norm = Math.hypot(sumUx, sumUy) || 1
    const ux = sumUx / norm, uy = sumUy / norm
    const nx = -uy, ny = ux
    let sumOffset = 0
    for (const i of memberIdxs) sumOffset += feats[i].offset * feats[i].len
    const offset = sumOffset / sumLen
    let tMin = +Infinity, tMax = -Infinity
    for (const i of memberIdxs) {
      const f = feats[i]
      const p1 = f.x1 * ux + f.y1 * uy
      const p2 = f.x2 * ux + f.y2 * uy
      if (p1 < tMin) tMin = p1
      if (p2 < tMin) tMin = p2
      if (p1 > tMax) tMax = p1
      if (p2 > tMax) tMax = p2
    }
    const ax = offset * nx, ay = offset * ny
    const x1 = ax + tMin * ux, y1 = ay + tMin * uy
    const x2 = ax + tMax * ux, y2 = ay + tMax * uy
    merged.push([Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)])
  }
  return merged
}
// ---- end inline ----

// Endpoint extension: walk outward along the segment direction one px at a
// time, sampling the mask. Stop after `missThreshold` consecutive zero
// samples; otherwise keep extending to the last hit.
//
// Fixes the "last few pixels of a wall not covered" case where HoughLinesP's
// vote count drops below threshold near endpoints. Operates on the morph
// (long-line × original) mask so it won't run away into text or empty space
// — by construction the mask is only white where there's wall support.
//
// `mask` is an OpenCV Mat (CV_8UC1). `maxStepsPx` caps runaway extensions.
function extendEndpoints(mask, segments, missThreshold, maxStepsPx) {
  if (!missThreshold || missThreshold <= 0) return segments
  const W = mask.cols, H = mask.rows
  const data = mask.data  // Uint8Array, row-major
  const at = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0
    return data[y * W + x]
  }
  const out = []
  for (const [x1, y1, x2, y2] of segments) {
    const dx = x2 - x1, dy = y2 - y1
    const len = Math.hypot(dx, dy)
    if (len < 1) { out.push([x1, y1, x2, y2]); continue }
    const ux = dx / len, uy = dy / len

    // Extend forward from (x2, y2).
    let fx = x2, fy = y2
    let lastHitFx = x2, lastHitFy = y2
    let miss = 0
    for (let s = 1; s <= maxStepsPx; s++) {
      const px = Math.round(x2 + ux * s)
      const py = Math.round(y2 + uy * s)
      if (at(px, py) > 0) {
        lastHitFx = px; lastHitFy = py
        miss = 0
      } else {
        miss++
        if (miss >= missThreshold) break
      }
    }
    fx = lastHitFx; fy = lastHitFy

    // Extend backward from (x1, y1).
    let bx = x1, by = y1
    let lastHitBx = x1, lastHitBy = y1
    miss = 0
    for (let s = 1; s <= maxStepsPx; s++) {
      const px = Math.round(x1 - ux * s)
      const py = Math.round(y1 - uy * s)
      if (at(px, py) > 0) {
        lastHitBx = px; lastHitBy = py
        miss = 0
      } else {
        miss++
        if (miss >= missThreshold) break
      }
    }
    bx = lastHitBx; by = lastHitBy

    out.push([bx, by, fx, fy])
  }
  return out
}

function matToImageData(cv, gray) {
  const rgba = new cv.Mat()
  try {
    cv.cvtColor(gray, rgba, cv.COLOR_GRAY2RGBA)
    return new ImageData(
      new Uint8ClampedArray(rgba.data),
      rgba.cols,
      rgba.rows,
    )
  } finally {
    rgba.delete()
  }
}

function runPipeline(cv, imageData, options) {
  const src = cv.matFromImageData(imageData)
  let thresh = null
  let morph = null
  try {
    const t1 = performance.now()
    const bin = binarize(cv, src, options)
    thresh = bin.thresh
    const tBinarize = performance.now() - t1

    // ---- Deskew (16-3c) ----
    const deskewEnabled = options.deskewEnabled !== false
    const deskewMinDeg = options.deskewMinDeg ?? 0.3
    const deskewMaxDeg = options.deskewMaxDeg ?? 15
    const deskewMinSamples = options.deskewMinSamples ?? 30
    const tD0 = performance.now()
    let deskewInfo = {
      enabled: deskewEnabled,
      angleDeg: 0,
      samples: 0,
      totalLengthPx: 0,
      peakWeight: 0,
      applied: false,
      reason: deskewEnabled ? 'pending' : 'disabled',
    }
    if (deskewEnabled) {
      const est = estimateSkewAngleDeg(cv, thresh, options)
      deskewInfo = Object.assign(deskewInfo, est, { applied: false })
      if (!est.accepted) {
        deskewInfo.reason = 'no-segments'
      } else if (est.samples < deskewMinSamples) {
        deskewInfo.reason = `too-few-samples (${est.samples} < ${deskewMinSamples})`
      } else if (Math.abs(est.angleDeg) < deskewMinDeg) {
        deskewInfo.reason = 'within-min-deg'
      } else if (Math.abs(est.angleDeg) > deskewMaxDeg) {
        deskewInfo.reason = 'exceeds-max-deg'
      } else {
        // Apply: rotate by -angleDeg to unrotate the skew.
        const rotated = deskewMat(cv, thresh, -est.angleDeg)
        thresh.delete()
        thresh = rotated
        deskewInfo.applied = true
        deskewInfo.reason = 'applied'
      }
    }
    const deskewWhitePixels = deskewInfo.applied ? cv.countNonZero(thresh) : bin.whitePixels
    const tDeskew = performance.now() - tD0

    const morphKernel = options.morphKernel ?? 15
    const morphDilatePx = options.morphDilatePx ?? 3
    const t2 = performance.now()
    morph = morphOpenHV(cv, thresh, morphKernel, morphDilatePx)
    const tMorph = performance.now() - t2

    const t3 = performance.now()
    const { segments, segStats } = extractSegments(cv, morph, options)
    const tHough = performance.now() - t3

    const t4 = performance.now()
    const mergeAngleTolDeg = options.mergeAngleTolDeg ?? 5
    const mergedRaw = mergeAngleTolDeg > 0
      ? mergeCollinearSegments(segments, {
          angleTolDeg: mergeAngleTolDeg,
          offsetTol:   options.mergeOffsetTol ?? 4,
          gapTol:      options.mergeGapTol ?? 12,
        })
      : segments.map((s) => [...s])
    const tMerge = performance.now() - t4

    const t5 = performance.now()
    const extendMissThreshold = options.extendMissThreshold ?? 3
    const extendMaxStepsPx = options.extendMaxStepsPx ?? 30
    const mergedSegments = extendEndpoints(morph, mergedRaw, extendMissThreshold, extendMaxStepsPx)
    const tExtend = performance.now() - t5

    let mergedTotalLength = 0
    for (const [x1, y1, x2, y2] of mergedSegments) {
      mergedTotalLength += Math.hypot(x2 - x1, y2 - y1)
    }

    return {
      binaryImageData: matToImageData(cv, thresh),
      morphImageData:  matToImageData(cv, morph),
      width: thresh.cols,
      height: thresh.rows,
      whitePixels: bin.whitePixels,
      deskew: deskewInfo,
      deskewWhitePixels,
      morphWhitePixels: cv.countNonZero(morph),
      segments,
      segStats,
      mergedSegments,
      mergedStats: {
        count: mergedSegments.length,
        totalLengthPx: Math.round(mergedTotalLength),
      },
      timings: {
        binarizeMs: Math.round(tBinarize),
        deskewMs:   Math.round(tDeskew),
        morphMs:    Math.round(tMorph),
        houghMs:    Math.round(tHough),
        mergeMs:    Math.round(tMerge),
        extendMs:   Math.round(tExtend),
      },
    }
  } finally {
    src.delete()
    if (thresh) thresh.delete()
    if (morph) morph.delete()
  }
}

self.addEventListener('message', async (e) => {
  const msg = e.data
  if (!msg || !msg.type) return

  if (msg.type === 'cancel') { aborted = true; return }

  if (msg.type === 'run') {
    aborted = false
    try {
      self.postMessage({ type: 'progress', stage: 'loading-opencv', message: 'Loading OpenCV.js…' })
      const { cv } = await loadCV()
      if (aborted) { self.postMessage({ type: 'done', result: { aborted: true } }); return }

      self.postMessage({ type: 'progress', stage: 'processing', message: 'Binarize + HoughLinesP…' })
      const t0 = performance.now()
      const out = runPipeline(cv, msg.payload.imageData, msg.payload.options || {})
      const elapsedMs = performance.now() - t0

      self.postMessage(
        { type: 'done', result: Object.assign(out, { elapsedMs }) },
        [out.binaryImageData.data.buffer, out.morphImageData.data.buffer],
      )
    } catch (err) {
      self.postMessage({ type: 'error', message: (err && err.message) || String(err) })
    }
  }
})
