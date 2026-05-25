// Center frequency (MHz) for a given band + channel. Shared helper used by
// buildScenario (to tag each AP with its centerMHz) and SINR aggregation
// (to decide whether two APs' spectra actually overlap).
//
// Matches the simplified formulas in src/constants/channelWidths.js:
//   2.4 GHz: 2407 + 5·N   (ch1=2412, ch6=2437, ch11=2462)
//   5   GHz: 5000 + 5·N   (ch36=5180, ch149=5745)
//   6   GHz: 5950 + 5·N   (ch1=5955, ch5=5975, …)

export function channelCenterMHz(band, channel) {
  if (band === 2.4) return 2407 + 5 * channel
  if (band === 5)   return 5000 + 5 * channel
  if (band === 6)   return 5950 + 5 * channel
  return 0
}

// [lo, hi] MHz occupied by an AP at the given band/channel/width.
export function channelRangeMHz(band, channel, width) {
  const center = channelCenterMHz(band, channel)
  const half = (width ?? 20) / 2
  return [center - half, center + half]
}

// Two APs' spectra overlap iff same band AND their frequency ranges intersect.
export function apsShareSpectrum(apA, apB) {
  if ((apA.frequency ?? 5) !== (apB.frequency ?? 5)) return false
  const [loA, hiA] = channelRangeMHz(apA.frequency ?? 5, apA.channel ?? 36, apA.channelWidth ?? 20)
  const [loB, hiB] = channelRangeMHz(apB.frequency ?? 5, apB.channel ?? 36, apB.channelWidth ?? 20)
  return loA < hiB && loB < hiA
}
