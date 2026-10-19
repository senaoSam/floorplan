// Tx / Rx assumptions (typical enterprise AP)
export const AP_ANT_GAIN_DBI = 3   // omni ceiling
export const RX_ANT_GAIN_DBI = 0   // client device
// 57-28: noise floor (dBm, 20 MHz) per band and the weakest co-channel AP
// still counted as an interferer. One set for the heatmap, hover readout and
// Client View (whose panel edits them); defaults mirror Hamina's pane.
export const DEFAULT_NOISE_FLOOR_BY_BAND = { 2.4: -92, 5: -95, 6: -96 }
export const DEFAULT_MIN_INTERFERING_RSSI_DBM = -82
// Channel planner's soft tier (autoChannelPlan): AP-to-AP pairs this many dB
// under the min interfering RSSI still nudge the plan to spread channels, and
// the hearing function (apHearing refRssiDbm) measures pairs down to there.
export const PLANNER_SOFT_RANGE_DB = 20
export const DEFAULT_RF = {
  noiseByBand: DEFAULT_NOISE_FLOOR_BY_BAND,
  minInterfDbm: DEFAULT_MIN_INTERFERING_RSSI_DBM,
}

// 59-3: reflected / diffracted paths longer than this (horizontal metres,
// AP → bounce point → rx) are not summed; the direct path is never cut. Each
// such path skips its two wall scans, the bulk of refl/diff cost. Measured
// 2026-10-16 on the UHD 770 against the uncut field, 2.4 and 5 GHz, offices
// of 15 / 40 / 4 APs and a 60-AP warehouse: 0% of grid points change RSSI
// band and ≤ 0.05% change SINR band (cells already below -100 dBm on the
// warehouse's outer wall line); a 40-AP / 997-segment floor 8.8 s → 1.8 s.
// 30 m was not enough: SINR bands moved on small floors, since interference
// sums other APs' far paths.
export const MULTIPATH_MAX_M = 40

// Indoor distance loss (dB per meter), layered on top of free-space Friis.
// Pure Friis ≈ log-distance with n=2 — too optimistic for indoor (signal
// carries too far). A small per-meter term lifts the effective path-loss
// exponent toward ~2.5, matching real indoor coverage. It grows with distance,
// so it's negligible near the AP (5 GHz: 1m → 0.25 dB) and only bites at range
// (5 GHz: 20m → 5 dB) — exactly where pure Friis over-predicts. Kept in sync with the GLSL
// `indoorLossPerM()` in propagationGL.js.
export function indoorLossPerMeter(freqMhz) {
  if (freqMhz < 3000) return 0.15
  if (freqMhz < 5925) return 0.25
  return 0.35
}
