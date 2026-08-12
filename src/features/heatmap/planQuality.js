// Plan-quality statistics for Plan mode (A-domain planning-quality panel).
// Wi-Fi analogue of cameras/coverageStats.js: instead of rasterising FOV
// polygons, we sample the RF field on a coarse grid (the same JS reference
// engine the heatmap uses) and classify each in-scope cell as covered / blind
// by RSSI threshold. Runs independently of whether the user has the heatmap
// turned on — the quality report must always be available while planning.
//
// Coordinates: buildScenario works in metres, so sampleField's grid is already
// in metre space. Each cell covers gridStepM² m² — simpler than the camera
// path, which samples in image-px and converts. biggestGap is returned in
// IMAGE-PX so the panel can recentre the viewport, matching CoveragePanel.

import { buildScenario } from './buildScenario'
import { sampleField } from './sampleField'
import { apsShareSpectrum } from './frequency'

const GRID_STEP_M = 1.0   // coarse enough to run debounced without a GPU
const GAP_GRID = 8        // 8×8 coarse cells to locate the densest blind area
const CONFLICT_DIST_M = 12   // physical interference radius (metres)

// 52-C6: cost is cells × APs, and this runs SYNCHRONOUSLY on the main thread —
// it never joined the async pipeline Phase 46 built for the heatmap. A fixed
// 1 m step is fine on the demo floor (300 APs = 256 ms) but not on a real
// large one: measured 100×75 m / 600 walls / 300 APs = 12.9 s of frozen UI,
// and useAPStore hands back a new array identity on every action, so dragging
// an AP re-enters this repeatedly (the 200 ms debounce delays the freeze
// rather than preventing it).
//
// Coarsening the grid is the right lever here: this panel reports a coverage
// PERCENTAGE and a blind-area location, neither of which needs metre
// resolution — and the alternative levers are worse (a worker means porting
// the whole propagation path; refusing to compute removes the feature).
//
// The budget counts cells × APs × WALLS, not just cells × APs: every sample
// ray is tested against every wall segment, so walls are a first-class factor.
// Measured on the 100×75 m plan at 300 APs — 0 walls 1.2 s, 150 walls 3.8 s,
// 600 walls 12.9 s, i.e. linear in walls. Budgeting without them leaves the
// step unchanged on exactly the plans that need it most.
//
// The constant is calibrated from those measurements: ~2.3 M cells×APs with
// 600 walls (1.4 G total) took 12.9 s, so ~100 M lands near a quarter-second.
const MAX_SAMPLE_WORK = 100_000_000   // cells × APs × wall segments

function fitQualityStep(scenario, apCount) {
  if (apCount <= 0) return GRID_STEP_M
  const { w, h } = scenario.size
  const cells = (Math.ceil(w / GRID_STEP_M) + 1) * (Math.ceil(h / GRID_STEP_M) + 1)
  // At least 1 — a wall-free plan still costs one distance evaluation per ray.
  const wallFactor = Math.max(1, scenario.walls?.length ?? 0)
  const work = cells * apCount * wallFactor
  if (work <= MAX_SAMPLE_WORK) return GRID_STEP_M
  // Cells scale with 1/step², so the step grows with the square root of the
  // overshoot. Capped so a pathological plan still returns something usable.
  return Math.min(GRID_STEP_M * Math.sqrt(work / MAX_SAMPLE_WORK), 8)
}

// Detect co-channel conflicts: two APs whose spectra overlap (same band AND
// intersecting frequency ranges — so ch36@80 vs ch44@20 counts, not just exact
// channel matches) and that sit within CONFLICT_DIST_M metres of each other.
// Distance uses the floor scale (px/m) so the radius tracks the plan's scale
// instead of a fixed canvas-px number. (A,B) pairs are de-duped — each
// unordered pair is reported once.
export function detectChannelConflicts(aps, scale) {
  const list = aps ?? []
  const conflicts = []
  // scale is px per metre; fall back to a pure-px radius when unset so the
  // check still runs before a scale is calibrated.
  const distPx = scale ? CONFLICT_DIST_M * scale : 300
  const r2 = distPx * distPx
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      if (a.channel == null || b.channel == null) continue
      if (!apsShareSpectrum(a, b)) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      if (dx * dx + dy * dy > r2) continue
      conflicts.push({ apA: a.id, apB: b.id, band: a.frequency, channel: a.channel })
    }
  }
  return conflicts
}

// Returns null when there's nothing to measure (no floor scale / no APs), else:
//   { coveragePct, blindPct, coveredAreaM2, blindAreaM2, apCount,
//     channelConflicts: [...], biggestGap: {x,y}|null, thresholdDbm }
export function computePlanQualityStats({ floor, walls, aps, scopes, thresholdDbm = -67 }) {
  const apList = aps ?? []
  const scenario = buildScenario(floor, walls ?? [], apList, scopes ?? [])
  if (!scenario) return null

  const channelConflicts = detectChannelConflicts(apList, floor.scale)
  if (apList.length === 0) {
    return {
      coveragePct: 0,
      secondaryCoveragePct: 0,
      blindPct: 100,
      coveredAreaM2: 0,
      blindAreaM2: 0,
      apCount: 0,
      channelConflicts,
      biggestGap: null,
      thresholdDbm,
    }
  }

  // Sample RSSI with the coarse JS engine. Reflections/diffraction OFF keeps a
  // debounced full-floor sweep cheap; the panel is a coverage summary, not the
  // final heatmap, so first-order accuracy is plenty for a %.
  const field = sampleField(scenario, fitQualityStep(scenario, apList.length), {
    maxReflOrder: 0,
    enableDiffraction: false,
    redundancyThresholdDbm: thresholdDbm,   // 47-9: per-cell count of APs ≥ threshold
  })
  const { rssi, redundancy, nx, ny, gridStepM, originX, originY } = field
  const pxToM = 1 / floor.scale
  const { w: planW, h: planH } = scenario.size
  const maskFn = scenario.scopeMaskFn ?? (() => true)

  let inScope = 0     // in-plane, in-scope cells → denominator
  let covered = 0
  let secondary = 0   // 47-9: cells with ≥2 APs ≥ threshold (voice/roaming safe)
  const cellM2 = gridStepM * gridStepM

  // Blind density per coarse cell, to locate the biggest gap (image-px).
  const cellW = Math.ceil(nx / GAP_GRID)
  const cellH = Math.ceil(ny / GAP_GRID)
  const blindPerCell = new Int32Array(GAP_GRID * GAP_GRID)

  // sampleField samples the whole padded rectangle and never writes NaN, so we
  // must clip in-scope ourselves: (1) drop the trailing out-of-plane row/column
  // the `+1` grid sizing adds, and (2) drop cells outside the scope polygons —
  // otherwise excluded regions inflate the coverage denominator and blind area.
  for (let j = 0; j < ny; j++) {
    const gy = Math.min(GAP_GRID - 1, Math.floor(j / cellH))
    const y = originY + j * gridStepM
    if (y < 0 || y > planH) continue
    for (let i = 0; i < nx; i++) {
      const x = originX + i * gridStepM
      if (x < 0 || x > planW) continue
      if (!maskFn(x, y)) continue     // out-of-scope
      const idx = j * nx + i
      const v = rssi[idx]
      if (Number.isNaN(v)) continue
      inScope += 1
      if (v >= thresholdDbm) {
        covered += 1
        if (redundancy && redundancy[idx] >= 2) secondary += 1
      } else {
        const gx = Math.min(GAP_GRID - 1, Math.floor(i / cellW))
        blindPerCell[gy * GAP_GRID + gx] += 1
      }
    }
  }

  if (inScope === 0) {
    return {
      coveragePct: 0, secondaryCoveragePct: 0, blindPct: 0, coveredAreaM2: 0, blindAreaM2: 0,
      apCount: apList.length, channelConflicts, biggestGap: null, thresholdDbm,
    }
  }

  // Densest blind cell → its centre in image-px (grid is in metres offset by
  // origin; metre → image-px is × scale).
  let worstCell = -1
  let worstBlind = 0
  for (let k = 0; k < blindPerCell.length; k++) {
    if (blindPerCell[k] > worstBlind) { worstBlind = blindPerCell[k]; worstCell = k }
  }
  let biggestGap = null
  if (worstCell >= 0 && worstBlind > 0) {
    const gx = worstCell % GAP_GRID
    const gy = Math.floor(worstCell / GAP_GRID)
    const cxCells = (gx + 0.5) * cellW    // cell centre in grid-index units
    const cyCells = (gy + 0.5) * cellH
    const xM = originX + cxCells * gridStepM
    const yM = originY + cyCells * gridStepM
    biggestGap = { x: xM / pxToM, y: yM / pxToM }   // metre → image-px
  }

  const blind = inScope - covered
  return {
    coveragePct: (covered / inScope) * 100,
    // 47-9: fraction of in-scope area with ≥2 APs above threshold — the area
    // where a client can roam / sustain voice without a coverage gap.
    secondaryCoveragePct: (secondary / inScope) * 100,
    blindPct: (blind / inScope) * 100,
    coveredAreaM2: covered * cellM2,
    blindAreaM2: blind * cellM2,
    apCount: apList.length,
    channelConflicts,
    biggestGap,
    thresholdDbm,
  }
}
