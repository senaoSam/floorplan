// 16-3l — Confidence scoring for candidate wall segments.
//
// Goal: collapse the per-stage features (length, paired, oriented-ROI
// density) into a single 0-1 confidence per segment so 16-3n review UI
// can present them in three buckets — high (solid green), medium (dashed
// yellow), low (dim grey) — and so 16-3o can write the high-confidence
// ones directly into useWallStore.
//
// Minimal viable scoring (this version): three features that are already
// available after 16-3h merge + 16-3i pair detection + a quick on-mask
// density probe. Future stages (16-3d component scoring, 16-3g angle
// clustering, dimension-line / text-cluster penalties) plug in as
// additional weighted terms; the API shape doesn't change.
//
//   score = w_len · lengthScore + w_pair · pairedScore + w_dens · densityScore
//
// All sub-scores are normalized to [0, 1] BEFORE weighting so the weights
// directly express priority (the same lesson learned in HM-F4 cost-fn v2).
//
// Inputs:
//   segments     — [[x1,y1,x2,y2], ...]
//   perSegment   — wallThickness.perSegment[] from 16-3i
//   imageDiagonal — px, used to normalize length
//   densitySamples — Float32Array per segment, pre-computed by caller
//                    using sampleSegmentDensity (oriented ROI scan in the
//                    worker since it needs the morph mask Mat)
//
// Returns { perSegment: [{ score, lengthScore, pairedScore, densityScore }, ...],
//           thresholds: { high, medium } }.

const W_LENGTH  = 0.30
const W_PAIRED  = 0.45
const W_DENSITY = 0.25

// Bucket thresholds — empirical, tunable. High = "auto-write to store",
// medium = "show but require user confirm", low = "hide unless toggled".
const TH_HIGH   = 0.65
const TH_MEDIUM = 0.35

export function scoreSegments({ segments, perSegment, imageDiagonal, densitySamples }) {
  const n = segments.length
  const out = new Array(n)
  for (let i = 0; i < n; i++) {
    const [x1, y1, x2, y2] = segments[i]
    const len = Math.hypot(x2 - x1, y2 - y1)

    // Length: normalize to image diagonal, clamp at 0.3 of diag (no extra
    // credit for being absurdly long — diminishing returns past "spans a
    // wall of typical floor"). A 0.05 diag wall already maxes out at 1.0.
    const lengthRaw = imageDiagonal > 0 ? len / imageDiagonal : 0
    const lengthScore = Math.max(0, Math.min(1, lengthRaw / 0.05))

    // Paired: binary feature from 16-3i. Dampened: a non-paired segment
    // isn't necessarily not-a-wall (single-line drawings), so don't score
    // it 0; floor = 0.3.
    const pairedScore = perSegment?.[i]?.paired ? 1.0 : 0.3

    // Density: foreground ratio along an oriented ROI through the segment.
    // Real walls have continuous fill (>= 0.7), furniture/dimension lines
    // have low density (< 0.4) due to dashes / breaks / tick marks.
    // Pre-computed by caller; default 0.5 if missing.
    const densityRaw = densitySamples ? densitySamples[i] : 0.5
    // Map [0.4, 0.9] → [0, 1] linearly. Below 0.4 = noise. Above 0.9 = max.
    const densityScore = Math.max(0, Math.min(1, (densityRaw - 0.4) / 0.5))

    const score = W_LENGTH  * lengthScore
                + W_PAIRED  * pairedScore
                + W_DENSITY * densityScore

    out[i] = {
      score,
      lengthScore,
      pairedScore,
      densityScore,
      densityRaw,
      bucket: score >= TH_HIGH ? 'high' : (score >= TH_MEDIUM ? 'medium' : 'low'),
    }
  }
  return {
    perSegment: out,
    thresholds: { high: TH_HIGH, medium: TH_MEDIUM },
    weights: { length: W_LENGTH, paired: W_PAIRED, density: W_DENSITY },
  }
}
