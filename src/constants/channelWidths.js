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

// ── Data rate / SNR adjustments ──────────────────────────────────────────
// Noise floor rises by 10·log10(W/20) dB as bandwidth grows (wider receiver → more noise).
// 20→0 dB, 40→+3, 80→+6, 160→+9.
export function widthNoiseDelta(width) {
  return 10 * Math.log10(width / 20)
}
