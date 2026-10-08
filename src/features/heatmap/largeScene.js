// Large-scene downgrade: drop refl/diff for the WHOLE compute — idle and
// drag alike — forcing the cheap aggregated single-pass (canUseAggregated
// becomes true). 57-36: shared by the 2D heatmap and the 3D all-floors stack
// so the same floor gets the same physics in both views.
//
// The criterion is AP-per-wall-segment, NOT the old wall×AP product.
// Measured 2026-09-21 over 216 scenarios (4 wall densities × 6 AP counts ×
// 3 AP layouts × 3 seeds) against a visual budget of "≤10% of grid points
// cross a colormap contour" — i.e. how much of the picture changes the
// green/yellow/orange/red band a viewer actually reads:
//
//   ratio ≥ 0.25 → worst observed band movement 7.56%, 0/108 cases over
//                  budget, and a 20–137× speedup (up to 27 s saved on a
//                  243-segment / 150-AP plan).
//
// Why a ratio and not a product: every over-budget case was "many walls,
// few APs" (ratio < 0.13), and their wall×AP products ranged 1930–7290 —
// overlapping the safe cases, so no product threshold separates them.
// Physically, refl/diff earns its cost by lighting corners that no AP
// reaches directly; once APs are dense relative to the walls, direct paths
// already fill those shadows and the reflected contribution loses the max().
//
// Software rendering keeps a stricter (lower) ratio: the same compute costs
// far more there, so it trades picture for responsiveness sooner.
const SW_AP_PER_SEG_THRESHOLD = 0.15
const HW_AP_PER_SEG_THRESHOLD = 0.25

export function shouldSimplifyScene(scenario, isSoftwareRender) {
  const segCount = Math.max(1, scenario.walls.length)
  const apPerSegment = scenario.aps.length / segCount
  const threshold = isSoftwareRender ? SW_AP_PER_SEG_THRESHOLD : HW_AP_PER_SEG_THRESHOLD
  return apPerSegment >= threshold
}
