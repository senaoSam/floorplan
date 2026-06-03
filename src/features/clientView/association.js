// Association-area computation for Client View — Hamina's "show association
// area". Verified against Hamina's heatmap-vs-association comparison: the blue
// area is the COVERAGE region — every point where the client gets usable signal
// from at least one supported AP (RSSI ≥ a coverage threshold). It is the
// heatmap thresholded + binarised, unioned across APs. NOT "the outside" — blue
// = covered, white = no usable signal. More APs → larger union → more blue.
//
// Because it's a threshold on the (continuous) per-AP RSSI field, the boundary
// is naturally smooth — no serving-AP winner logic, no hole-cutting.
//
// Uses buildCandidates() (band filter + link direction + client tx) so coverage
// matches what the panel would actually let the client use.

import { buildCandidates } from './simulate'
import { maskToSmoothPolygons, cleanMask } from './contour'

// Grid step (meters). 0.4 m keeps the wall-shaped boundary faithful enough that
// Chaikin smoothing reads as a natural curve.
const GRID_STEP_M = 0.4
// Hard cap on cells swept; coarsen the step if a floor is huge.
const MAX_CELLS = 20000

// Fallback coverage threshold (dBm) if opts doesn't supply one. -67 is the
// common industry "good signal" coverage design target. Blue = good-signal
// area, NOT can/can't-associate (devices associate down to ~-85, just poorly).
const DEFAULT_COVERAGE_THRESHOLD_DBM = -67

// Compute the association-area (coverage) render data.
// Args:
//   scenario   — buildScenario() output (meters)
//   floorScale — px per meter
//   opts       — same simulation opts passed to simulateClient (device, bands,
//                linkDirection, clientTxDbm, …); buildCandidates honours them.
//                opts.coverageThresholdDbm sets the blue cutoff (user-adjustable).
// Returns:
//   { bounds:{x,y,w,h}, polygons:[flat[x,y,…]] }  (polygons = FILLED blue
//   coverage region, drawn directly — no cut), or null when no scenario.
export function computeAssociationArea(scenario, floorScale, opts) {
  if (!scenario || !floorScale) return null
  const { w, h } = scenario.size
  const threshold = opts?.coverageThresholdDbm ?? DEFAULT_COVERAGE_THRESHOLD_DBM

  let step = GRID_STEP_M
  while ((w / step) * (h / step) > MAX_CELLS) step *= 1.4

  const cols = Math.ceil(w / step)
  const rows = Math.ceil(h / step)
  const mask = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rx = { x: (c + 0.5) * step, y: (r + 0.5) * step }
      if (scenario.scopeMaskFn && !scenario.scopeMaskFn(rx.x, rx.y)) continue
      // candidates are band-filtered + sorted strongest-first; [0] is the best
      // usable AP. Covered iff that best RSSI clears the threshold.
      const { candidates } = buildCandidates(scenario, rx, opts)
      if (candidates.length && candidates[0].rssiDbm >= threshold) {
        mask[r * cols + c] = 1
      }
    }
  }

  // Morphological open+close tidies speckle / pinholes so the coverage reads as
  // clean blobs. (The threshold field is already fairly smooth; this just
  // removes lone cells near the boundary.)
  const cleaned = cleanMask(mask, cols, rows)

  const stepPx = step * floorScale
  const polygons = maskToSmoothPolygons(cleaned, cols, rows, stepPx, 0, 0)
  return {
    bounds: { x: 0, y: 0, w: w * floorScale, h: h * floorScale },
    polygons,
  }
}
