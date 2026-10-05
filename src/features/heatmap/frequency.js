// Center frequency (MHz) for a given band + channel. Shared helper used by
// buildScenario (to tag each AP with its centerMHz) and SINR aggregation
// (to decide whether two APs' spectra actually overlap).
//
// Simplified formulas:
//   2.4 GHz: 2407 + 5·N   (ch1=2412, ch6=2437, ch11=2462)
//   5   GHz: 5000 + 5·N   (ch36=5180, ch149=5745)
//   6   GHz: 5950 + 5·N   (ch1=5955, ch5=5975, …)

export function channelCenterMHz(band, channel) {
  if (band === 2.4) return 2407 + 5 * channel
  if (band === 5)   return 5000 + 5 * channel
  if (band === 6)   return 5950 + 5 * channel
  return 0
}

// 57-16: a 40/80/160 MHz channel occupies a fixed IEEE bonded block, not
// "primary channel centre +- width/2" -- ch36@80 is 5170-5250 MHz (block
// 36-48), not 5140-5220. `channel` is the primary 20 MHz channel.
// 5 GHz blocks are irregular (UNII gaps), so they come from the standard
// centre-channel table; 6 GHz blocks are aligned from channel 1.
const BLOCK_CENTERS_5G = {
  40: [38, 46, 54, 62, 102, 110, 118, 126, 134, 142, 151, 159, 167, 175],
  80: [42, 58, 106, 122, 138, 155, 171],
  160: [50, 114, 163],
}

// Centre channel number of the bonded block holding `channel`, or null when
// the combination doesn't exist (e.g. ch165 @ 80). 20 MHz returns `channel`.
function blockCenterChannel(band, channel, width) {
  if (!width || width <= 20) return channel
  if (band === 5) {
    const list = BLOCK_CENTERS_5G[width]
    if (!list) return null
    const half = width / 10            // block half-width in channel numbers
    for (const c of list) if (Math.abs(channel - c) < half) return c
    return null
  }
  if (band === 6) {
    const n = width / 20               // 20 MHz channels per block
    const k = Math.floor((channel - 1) / 4)
    const first = 1 + 4 * (Math.floor(k / n) * n)
    return first + 2 * (n - 1)
  }
  return null                          // 2.4 GHz is 20 MHz only
}

// 20 MHz primary channels that make up the bonded block holding `channel`
// (just [channel] for 20 MHz or an unknown combination).
export function channelBlockMembers(band, channel, width) {
  const c = blockCenterChannel(band, channel, width)
  if (c == null || !width || width <= 20) return [channel]
  const n = width / 20
  const first = c - 2 * (n - 1)
  return Array.from({ length: n }, (_, i) => first + 4 * i)
}

// Centre frequency (MHz) of what the AP actually transmits on: the bonded
// block's centre. An unknown combination falls back to the primary channel.
export function channelBlockCenterMHz(band, channel, width) {
  const c = blockCenterChannel(band, channel, width)
  return channelCenterMHz(band, c ?? channel)
}

// [lo, hi] MHz occupied by an AP at the given band/channel/width.
export function channelRangeMHz(band, channel, width) {
  const center = channelBlockCenterMHz(band, channel, width ?? 20)
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
