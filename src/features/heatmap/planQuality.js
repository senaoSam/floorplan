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

const GRID_STEP_M = 1.0   // coarse enough to run debounced without a GPU
const GAP_GRID = 8        // 8×8 coarse cells to locate the densest blind area
const CONFLICT_DIST_PX = 300   // same interference radius as autoChannelPlan

// Detect co-channel conflicts: two APs on the same band + same channel that
// sit within CONFLICT_DIST_PX of each other. (A,B) pairs are de-duped — each
// unordered pair is reported once. Mirrors autoChannelPlan's dist/radius idea
// but reports conflicts rather than assigning channels.
export function detectChannelConflicts(aps) {
  const list = aps ?? []
  const conflicts = []
  const r2 = CONFLICT_DIST_PX * CONFLICT_DIST_PX
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      if (a.frequency !== b.frequency) continue
      if (a.channel == null || b.channel == null) continue
      if (a.channel !== b.channel) continue
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

  const channelConflicts = detectChannelConflicts(apList)
  if (apList.length === 0) {
    return {
      coveragePct: 0,
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
  const field = sampleField(scenario, GRID_STEP_M, { maxReflOrder: 0, enableDiffraction: false })
  const { rssi, nx, ny, gridStepM, originX, originY } = field
  const pxToM = 1 / floor.scale

  let inScope = 0     // non-NaN cells inside the plan → denominator
  let covered = 0
  const cellM2 = gridStepM * gridStepM

  // Blind density per coarse cell, to locate the biggest gap (image-px).
  const cellW = Math.ceil(nx / GAP_GRID)
  const cellH = Math.ceil(ny / GAP_GRID)
  const blindPerCell = new Int32Array(GAP_GRID * GAP_GRID)

  for (let j = 0; j < ny; j++) {
    const gy = Math.min(GAP_GRID - 1, Math.floor(j / cellH))
    for (let i = 0; i < nx; i++) {
      const v = rssi[j * nx + i]
      if (Number.isNaN(v)) continue   // out-of-scope / padding
      inScope += 1
      if (v >= thresholdDbm) {
        covered += 1
      } else {
        const gx = Math.min(GAP_GRID - 1, Math.floor(i / cellW))
        blindPerCell[gy * GAP_GRID + gx] += 1
      }
    }
  }

  if (inScope === 0) {
    return {
      coveragePct: 0, blindPct: 0, coveredAreaM2: 0, blindAreaM2: 0,
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
    blindPct: (blind / inScope) * 100,
    coveredAreaM2: covered * cellM2,
    blindAreaM2: blind * cellM2,
    apCount: apList.length,
    channelConflicts,
    biggestGap,
    thresholdDbm,
  }
}
