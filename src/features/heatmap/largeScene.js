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
  // 58: devices, not radios -- the calibration measured AP density, and a
  // device's co-located radios add no spatial density.
  const devices = new Set(scenario.aps.map((a) => a.deviceId ?? a.id)).size
  const apPerSegment = devices / segCount
  const threshold = isSoftwareRender ? SW_AP_PER_SEG_THRESHOLD : HW_AP_PER_SEG_THRESHOLD
  return apPerSegment >= threshold
}

// 57-39: time budgets. The ratio above is a picture criterion; it never fires
// on "many walls, few APs" (big DXF imports), where refl/diff can run for
// minutes. So the compute also steps down by measured time, in quality
// tiers -- diffraction goes first: it is the expensive term (463 segments,
// 1 AP: reflections 30 ms, diffraction 8.5 s on the UHD 770 baseline).
//   fine (idle) render: 5 s, projected from progress and checked as it runs
//   drag render: 33 ms per frame
// 59-4: 10 s was tried and dropped. With the fine pass in small GPU slices
// (smooth panning) a 100-AP / 2400-segment floor needs ~8 s, ~10 s under
// panning -- it then hit the cap and fell to direct only after the whole
// wait, instead of ~2 s. Up to ~40 APs / 1000 segments fits in 5 s.
export const FINE_BUDGET_MS = 5000
export const DRAG_BUDGET_MS = 33
// Projecting from less than this much work is too noisy (per-AP cost varies
// ~15× with AP position).
const PROJECT_AFTER_MS = 300
// Before the first AP lands, the rate reads low (tile ramp-up, first-time
// bakes): a 4288-segment, 5-AP reflections pass projected 10 s at 6% done
// yet fits in ~4 s. So an early projection only aborts when it is clearly
// over; from `settleFrac` on it is trusted as is.
const EARLY_PROJECT_MARGIN = 3

export const QUALITY = { FULL: 'full', NO_DIFFRACTION: 'noDiffraction', DIRECT: 'direct' }

// The tiers below `opts`, cheapest last: [{ level, opts }]. Only the first
// tier carries refl/diff exactly as requested.
export function qualityTiers(opts) {
  const refl = opts.maxReflOrder > 0
  const tiers = [{ level: QUALITY.FULL, opts }]
  if (refl && opts.enableDiffraction) {
    tiers.push({ level: QUALITY.NO_DIFFRACTION, opts: { ...opts, enableDiffraction: false } })
  }
  if (refl || opts.enableDiffraction) {
    tiers.push({ level: QUALITY.DIRECT, opts: { ...opts, maxReflOrder: 0, enableDiffraction: false } })
  }
  return tiers
}

// Budget for one compute. `onProgress` takes the engine's 0..1 progress;
// `exceeded()` is polled through the engine's isStale and latches true once
// the elapsed time passes `budgetMs`, or the projection from progress does.
// `startMs` lets several tiers share one budget; `settleFrac` is the progress
// of one AP (1 / AP count).
export function makeTimeBudget(budgetMs, { project = true, startMs = performance.now(), settleFrac = 0 } = {}) {
  const tierStart = performance.now()
  let frac = 0
  let over = false
  return {
    onProgress: (f) => { frac = f },
    exceeded: () => {
      if (over) return true
      const now = performance.now()
      const left = budgetMs - (tierStart - startMs)
      const spent = now - tierStart
      if (now - startMs > budgetMs) over = true
      else if (project && spent > PROJECT_AFTER_MS && frac > 0) {
        const projected = spent / frac
        const limit = frac >= settleFrac ? left : left * EARLY_PROJECT_MARGIN
        if (projected > limit) over = true
      }
      return over
    },
  }
}

// 57-39: the JS engine is the fallback when the GPU path fails, and it runs
// synchronously on the main thread -- with refl/diff on a big scene it froze
// the page. Its cost tracks cells × APs × walls × (walls + corners) at
// ~6–7.5 ns per unit (UHD 770 baseline machine; demo with 5 APs at 0.5 m =
// 2.3e8 units = 1.7 s). Past ~2 s it drops to the direct path.
const JS_REFL_DIFF_MAX_UNITS = 3e8
export function jsFallbackOpts(scenario, stepM, opts) {
  if (!(opts.maxReflOrder > 0) && !opts.enableDiffraction) return opts
  const cells = (Math.ceil(scenario.size.w / stepM) + 1) * (Math.ceil(scenario.size.h / stepM) + 1)
  const walls = scenario.walls.length
  const units = cells * scenario.aps.length * walls * (walls + (scenario.corners?.length ?? 0))
  return units > JS_REFL_DIFF_MAX_UNITS ? { ...opts, maxReflOrder: 0, enableDiffraction: false } : opts
}
