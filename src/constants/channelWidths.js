// Channel bandwidth (MHz) support. Based on Cisco enterprise best practice:
//   2.4 GHz → 20 MHz only (band is crowded; 40 MHz causes severe co-channel interference)
//   5   GHz → 20 / 40 (80/160 allowed but discouraged in high-density deployments)
//   6   GHz → 80 MHz default (1200 MHz clean spectrum — wide channels finally practical)

export const CHANNEL_WIDTHS = [20, 40, 80, 160]

export const DEFAULT_CHANNEL_WIDTH = {
  2.4: 20,
  5:   40,
  6:   80,
}

// Widths physically supported by each band. 2.4 GHz is locked to 20 by policy.
const ALLOWED_BY_BAND = {
  2.4: [20],
  5:   [20, 40, 80, 160],
  6:   [20, 40, 80, 160],
}

export function allowedWidthsForBand(band) {
  return ALLOWED_BY_BAND[band] ?? [20]
}

export function clampWidthForBand(band, width) {
  const allowed = allowedWidthsForBand(band)
  if (allowed.includes(width)) return width
  return DEFAULT_CHANNEL_WIDTH[band] ?? 20
}

// ── Frequency range helpers ──────────────────────────────────────────────
// Center frequency (MHz) of a channel within a band. Simplified:
//   2.4 GHz: 2407 + 5·N   (ch1=2412, ch6=2437, ch11=2462)
//   5   GHz: 5000 + 5·N   (ch36=5180, ch149=5745)
//   6   GHz: 5950 + 5·N   (ch1=5955, ch5=5975, …)
function channelCenterMHz(band, channel) {
  if (band === 2.4) return 2407 + 5 * channel
  if (band === 5)   return 5000 + 5 * channel
  if (band === 6)   return 5950 + 5 * channel
  return 0
}

// Return [loMHz, hiMHz] occupied by an AP's channel at the given width.
export function channelRangeMHz(band, channel, width) {
  const center = channelCenterMHz(band, channel)
  const half = width / 2
  return [center - half, center + half]
}

// Two APs' channels overlap iff they are on the same band and their frequency
// ranges intersect. A 40 MHz AP on ch36 overlaps a 20 MHz AP on ch40, etc.
export function channelsOverlap(bandA, chA, wA, bandB, chB, wB) {
  if (bandA !== bandB) return false
  const [loA, hiA] = channelRangeMHz(bandA, chA, wA)
  const [loB, hiB] = channelRangeMHz(bandB, chB, wB)
  return loA < hiB && loB < hiA
}

// ── Data rate / SNR adjustments ──────────────────────────────────────────
// Approximate PHY rate multiplier (Wi-Fi 5/6) relative to 20 MHz:
//   40  →  ×2.1
//   80  →  ×4.5
//   160 →  ×9.0
export function widthRateMultiplier(width) {
  if (width >= 160) return 9.0
  if (width >= 80)  return 4.5
  if (width >= 40)  return 2.1
  return 1.0
}

// Noise floor rises by 10·log10(W/20) dB as bandwidth grows (wider receiver → more noise).
// 20→0 dB, 40→+3, 80→+6, 160→+9.
export function widthNoiseDelta(width) {
  return 10 * Math.log10(width / 20)
}
