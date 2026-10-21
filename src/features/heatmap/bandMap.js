// 58-12: band map -- each cell coloured by the band a newly joining phone
// would use there. The rule is Client View's preferredCandidates (one source
// of thresholds: clientView/simulate), applied per cell to the strongest
// radio of each band (within a band, score and RSSI rank alike, so the band's
// best radio stands for the band):
//   1. no band >= MIN_USABLE_RSSI_DBM            -> no service
//   2. 5 / 6 GHz >= BAND_AVAILABLE_RSSI_DBM     -> pick among those only
//   3. highest RSSI + BAND_STEP_BONUS_DB * step  -> the band (ties: lower band)
// No roaming hysteresis (a static map shows a fresh join). Downlink only, a
// tri-band phone. The chosen band's RSSI below COVERAGE_THRESHOLD_DBM is the
// faded ("reachable, under the design target") shade.
//
// The GLSL copy of this rule lives in heatmapGL.js (FS_BANDMAP); keep the two
// in step.

import {
  MIN_USABLE_RSSI_DBM, BAND_AVAILABLE_RSSI_DBM, BAND_STEP_BONUS_DB, BAND_STEP,
} from '@/features/clientView/simulate'
import { COVERAGE_THRESHOLD_DBM } from '@/constants/coverage'

export const BAND_MAP_BANDS = [2.4, 5, 6]

// Stand-in for "no radio on this band reaches here" in the packed field: low
// enough to lose every comparison, finite so bicubic / blur stay numeric.
export const BAND_MAP_NO_SIGNAL_DBM = -150

export const BAND_MAP_RULE = {
  usableDbm: MIN_USABLE_RSSI_DBM,
  availableDbm: BAND_AVAILABLE_RSSI_DBM,
  bonusDb: BAND_STEP_BONUS_DB,
  goodDbm: COVERAGE_THRESHOLD_DBM,
}

// -> { band: 2.4 | 5 | 6 | null, rssiDbm, good }
export function classifyBand(r24, r5, r6) {
  const r = { 2.4: r24, 5: r5, 6: r6 }
  const high = r5 >= BAND_AVAILABLE_RSSI_DBM || r6 >= BAND_AVAILABLE_RSSI_DBM
  let band = null
  let best = -Infinity
  for (const b of BAND_MAP_BANDS) {
    if (high ? (b === 2.4 || r[b] < BAND_AVAILABLE_RSSI_DBM) : r[b] < MIN_USABLE_RSSI_DBM) continue
    const score = r[b] + BAND_STEP_BONUS_DB * BAND_STEP[b]
    if (score > best) { best = score; band = b }
  }
  if (band == null) return { band: null, rssiDbm: Math.max(r24, r5, r6), good: false }
  return { band, rssiDbm: r[band], good: r[band] >= COVERAGE_THRESHOLD_DBM }
}

// Share of the cells inside the plan (and the scope mask) per class, from a
// packed band field (Float32Array, 4 per cell: 2.4 / 5 / 6 / unused).
// -> { 2.4, 5, 6, none } fractions summing to 1, or null without cells.
export function bandMapShares(field, planW, planH, maskFn = null) {
  const { band, nx, ny, gridStepM, originX, originY } = field
  if (!band) return null
  const counts = { 2.4: 0, 5: 0, 6: 0, none: 0 }
  let total = 0
  for (let j = 0; j < ny; j++) {
    const y = originY + j * gridStepM
    if (y < 0 || y > planH) continue
    for (let i = 0; i < nx; i++) {
      const x = originX + i * gridStepM
      if (x < 0 || x > planW) continue
      if (maskFn && !maskFn(x, y)) continue
      const k = (j * nx + i) * 4
      const c = classifyBand(band[k], band[k + 1], band[k + 2])
      counts[c.band ?? 'none']++
      total++
    }
  }
  if (total === 0) return null
  return { 2.4: counts[2.4] / total, 5: counts[5] / total, 6: counts[6] / total, none: counts.none / total }
}
