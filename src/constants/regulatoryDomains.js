// Per-country allowed Wi-Fi channels. Indoor-only / DFS channels are included
// with a flag so the UI can mark them; the auto-planner may still choose them.
//
// Channel lists reflect common practice (not formal legal text). Edit freely
// when you need to narrow or widen the allowed set per deployment.

// Channel entry: number, optional { dfs: true, indoorOnly: true }.
const plain = (...nums) => nums.map((n) => ({ ch: n }))
const dfs   = (...nums) => nums.map((n) => ({ ch: n, dfs: true }))
const indoor = (...nums) => nums.map((n) => ({ ch: n, indoorOnly: true }))

export const REGULATORY_DOMAINS = {
  TW: {
    id: 'TW',
    label: '台灣',
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
