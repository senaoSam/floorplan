// Tx / Rx assumptions (typical enterprise AP)
export const AP_ANT_GAIN_DBI = 3   // omni ceiling
export const RX_ANT_GAIN_DBI = 0   // client device
export const NOISE_FLOOR_DBM = -95

// Indoor distance loss (dB per meter), layered on top of free-space Friis.
// Pure Friis ≈ log-distance with n=2 — too optimistic for indoor (signal
// carries too far). A small per-meter term lifts the effective path-loss
// exponent toward ~2.5, matching real indoor coverage. It grows with distance,
// so it's negligible near the AP (1m → 0.25 dB) and only bites at range (20m →
// 5 dB) — exactly where pure Friis over-predicts. Kept in sync with the GLSL
// `indoorLossPerM()` in propagationGL.js.
export function indoorLossPerMeter(freqMhz) {
  if (freqMhz < 3000) return 0.15
  if (freqMhz < 5925) return 0.25
  return 0.35
}
