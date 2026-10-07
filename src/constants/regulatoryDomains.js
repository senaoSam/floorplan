// Per-country allowed Wi-Fi channels. Indoor-only / DFS channels are included
// with a flag so the UI can mark them; the auto-planner may still choose them.
//
// Channel lists reflect common practice (not formal legal text). Edit freely
// when you need to narrow or widen the allowed set per deployment.

// Channel entry: number, optional { dfs: true, indoorOnly: true }.
const plain = (...nums) => nums.map((n) => ({ ch: n }))
const dfs   = (...nums) => nums.map((n) => ({ ch: n, dfs: true }))
const indoor = (...nums) => nums.map((n) => ({ ch: n, indoorOnly: true }))

// 57-23: EIRP limits (dBm) by frequency range (MHz). A rule may also carry a
// PSD limit (dBm/MHz) that scales with the occupied width -- 6 GHz LPI. Like
// the channel lists these are practical approximations of each regime's
// indoor AP rules, NOT the legal text: FCC (point-to-multipoint, 6 GHz LPI)
// and ETSI; TW follows FCC, JP and CN their closest regime.
const FCC_EIRP = [
  { lo: 2400, hi: 2483.5, maxDbm: 36 },
  { lo: 5150, hi: 5250, maxDbm: 36 },              // U-NII-1
  { lo: 5250, hi: 5350, maxDbm: 30 },              // U-NII-2A
  { lo: 5470, hi: 5730, maxDbm: 30 },              // U-NII-2C
  { lo: 5725, hi: 5850, maxDbm: 36 },              // U-NII-3
  { lo: 5925, hi: 7125, maxDbm: 30, psdDbmPerMhz: 5 },  // 6 GHz LPI
]
const ETSI_EIRP = [
  { lo: 2400, hi: 2483.5, maxDbm: 20 },
  { lo: 5150, hi: 5350, maxDbm: 23 },
  { lo: 5470, hi: 5725, maxDbm: 30 },
  { lo: 5925, hi: 6425, maxDbm: 23, psdDbmPerMhz: 10 },
]
const CN_EIRP = [
  { lo: 2400, hi: 2483.5, maxDbm: 20 },
  { lo: 5150, hi: 5350, maxDbm: 23 },
  { lo: 5725, hi: 5850, maxDbm: 33 },
]

export const REGULATORY_DOMAINS = {
  TW: {
    id: 'TW',
    label: '台灣',
    eirp: FCC_EIRP,
    channels: {
      2.4: plain(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11),
      5:   [
        ...plain(36, 40, 44, 48),
        ...dfs(52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140),
        ...plain(149, 153, 157, 161, 165),
      ],
      6:   plain(1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85, 89, 93),
    },
  },
  US: {
    id: 'US',
    label: '美國',
    eirp: FCC_EIRP,
    channels: {
      2.4: plain(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11),
      5:   [
        ...plain(36, 40, 44, 48),
        ...dfs(52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144),
        ...plain(149, 153, 157, 161, 165),
      ],
      6:   plain(1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85, 89, 93, 97, 101, 105, 109, 113, 117, 121, 125, 129, 133, 137, 141, 145, 149, 153, 157, 161, 165, 169, 173, 177, 181, 185, 189, 193, 197, 201, 205, 209, 213, 217, 221, 225, 229, 233),
    },
  },
  EU: {
    id: 'EU',
    label: '歐盟',
    eirp: ETSI_EIRP,
    channels: {
      2.4: plain(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13),
      5:   [
        ...indoor(36, 40, 44, 48),
        ...dfs(52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140),
      ],
      6:   plain(1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85, 89, 93),
    },
  },
  JP: {
    id: 'JP',
    label: '日本',
    eirp: ETSI_EIRP,
    channels: {
      2.4: plain(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13),
      5:   [
        ...plain(36, 40, 44, 48),
        ...dfs(52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140),
      ],
      // Japan 6 GHz (Wi-Fi 6E) allocation roughly covers U-NII-5/6.
      6:   plain(1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85, 89, 93),
    },
  },
  CN: {
    id: 'CN',
    label: '中國',
    eirp: CN_EIRP,
    channels: {
      2.4: plain(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13),
      5:   [
        ...plain(36, 40, 44, 48),
        ...dfs(52, 56, 60, 64),
        ...plain(149, 153, 157, 161, 165),
      ],
      // China has no general 6 GHz Wi-Fi allocation as of 2024; keep empty.
      6:   [],
    },
  },
}

export const REGULATORY_LIST = Object.values(REGULATORY_DOMAINS)

export const DEFAULT_DOMAIN_ID = 'TW'

export const getDomain = (id) => REGULATORY_DOMAINS[id] ?? REGULATORY_DOMAINS[DEFAULT_DOMAIN_ID]

// Return the channel numbers (numbers only, no flags) allowed for a given band under a domain.
export const allowedChannels = (domainId, band) =>
  (getDomain(domainId).channels[band] ?? []).map((c) => c.ch)

// Return the full channel entries (with flags) for UI display.
export const channelEntries = (domainId, band) =>
  getDomain(domainId).channels[band] ?? []

// Is a specific channel allowed in this domain+band?
export const isChannelAllowed = (domainId, band, channel) =>
  allowedChannels(domainId, band).includes(channel)

// 57-23: EIRP limit (dBm) for a transmission occupying [loMHz, hiMHz] -- the
// tightest rule it overlaps (a bonded block can straddle two sub-bands).
// null when no rule covers it (no cap applied).
export function eirpLimitDbm(domainId, loMHz, hiMHz) {
  let limit = null
  for (const r of getDomain(domainId).eirp ?? []) {
    if (!(loMHz < r.hi && hiMHz > r.lo)) continue
    let v = r.maxDbm
    if (r.psdDbmPerMhz != null) v = Math.min(v, r.psdDbmPerMhz + 10 * Math.log10(hiMHz - loMHz))
    limit = limit == null ? v : Math.min(limit, v)
  }
  return limit
}
