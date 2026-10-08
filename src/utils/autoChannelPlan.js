import { allowedChannels } from '@/constants/regulatoryDomains'
import { DEFAULT_CHANNEL_WIDTH } from '@/constants/channelWidths'
import { channelBlockMembers, channelRangeMHz } from '@/features/heatmap/frequency'

// Non-overlapping channel sets per band (20 MHz spacing).
// 2.4 GHz: channels 1, 6, 11 are the classic non-overlapping trio.
// 5 GHz / 6 GHz: every channel in the list is already 20 MHz apart (step 4),
// so the full allowed list is used at 20 MHz. Wider channels pick one primary
// per bonded block instead (candidatesForWidth, 57-16).
const NON_OVERLAPPING_2_4 = [1, 6, 11]

function getNonOverlappingChannels(domainId, band) {
  const allowed = allowedChannels(domainId, band)
  if (band === 2.4) {
    const filtered = NON_OVERLAPPING_2_4.filter((ch) => allowed.includes(ch))
    return filtered.length > 0 ? filtered : allowed
  }
  return allowed
}

// 57-16: candidate primaries for a given width. 20 MHz keeps the list above;
// wider channels get one primary (the block's lowest channel) per bonded
// block whose every 20 MHz member is allowed in the domain -- picking 36 and
// 40 for two 40 MHz neighbours would put both on the same 36+40 block.
// Falls back to the 20 MHz list if the domain has no complete block.
function candidatesForWidth(domainId, band, width) {
  const base = getNonOverlappingChannels(domainId, band)
  if (!width || width <= 20) return base
  const allowed = allowedChannels(domainId, band)
  const allowedSet = new Set(allowed)
  const out = []
  for (const ch of allowed) {
    const members = channelBlockMembers(band, ch, width)
    if (members.length !== width / 20 || members[0] !== ch) continue
    if (members.every((m) => allowedSet.has(m))) out.push(ch)
  }
  return out.length > 0 ? out : base
}

// 57-16: do two (channel, width) assignments share spectrum? Bonded-block
// ranges, so mixed widths and same-block primaries are caught (the old test
// was channel-number equality).
function spectraOverlap(band, chA, wA, chB, wB) {
  const [loA, hiA] = channelRangeMHz(band, chA, wA)
  const [loB, hiB] = channelRangeMHz(band, chB, wB)
  return loA < hiB && loB < hiA
}

function dist2(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

// Greedy minimum-interference channel assignment.
// For each AP (sorted by descending neighbour count within interferenceRadius),
// pick the channel that minimises co-channel overlap with already-assigned
// nearby APs.  Ties broken by taking the first in the candidate list.
//
// Parameters:
//   aps              — array of AP objects (must have id, x, y, frequency)
//   domainId         — regulatory domain id ('TW', 'US', …)
//   interferenceRadius — 57-34: a function (apA, apB) => boolean "these two
//                      hear each other" (features/heatmap/apHearing), or the
//                      legacy canvas-px radius when no scale / scenario exists
//   fixedChannels    — optional Map<apId, channel>：這些 AP 的頻道視為已定，
//                      不重新指派、但計入鄰居重疊（Phase 49 fill 模式：
//                      新 AP 繞著現有 AP 的頻道排）
//
// Returns: Map<apId, { channel }>（含 fixed 的 AP，方便呼叫端統一讀）
export function greedyChannelAssign(aps, domainId, interferenceRadius = 300, fixedChannels = null) {
  const r2 = typeof interferenceRadius === 'number' ? interferenceRadius * interferenceRadius : 0
  const near = typeof interferenceRadius === 'function'
    ? interferenceRadius
    : (a, b) => dist2(a, b) <= r2
  const result = new Map()

  // Group APs by frequency band
  const bands = [...new Set(aps.map((a) => a.frequency))]

  for (const band of bands) {
    const bandAPs = aps.filter((a) => a.frequency === band)
    if (getNonOverlappingChannels(domainId, band).length === 0) continue
    const widthOf = (a) => a.channelWidth ?? DEFAULT_CHANNEL_WIDTH[band] ?? 20
    const candCache = new Map()
    const candidatesFor = (w) => {
      if (!candCache.has(w)) candCache.set(w, candidatesForWidth(domainId, band, w))
      return candCache.get(w)
    }

    // Seed pre-assigned (fixed) APs first so the greedy loop counts their
    // overlap but never reassigns them.
    if (fixedChannels) {
      for (const ap of bandAPs) {
        if (fixedChannels.has(ap.id)) {
          result.set(ap.id, { channel: fixedChannels.get(ap.id) })
        }
      }
    }

    // Sort: APs with more neighbours first so they get first pick.
    const sorted = [...bandAPs].sort((a, b) => {
      const na = bandAPs.filter((x) => x.id !== a.id && near(x, a)).length
      const nb = bandAPs.filter((x) => x.id !== b.id && near(x, b)).length
      return nb - na
    })

    for (const ap of sorted) {
      if (result.has(ap.id)) continue  // fixed — keep as-is
      // Count how many already-assigned neighbours share spectrum with each
      // candidate (57-16: bonded-block overlap, not channel equality).
      const myW = widthOf(ap)
      const score = candidatesFor(myW).map((ch) => {
        let overlap = 0
        for (const other of bandAPs) {
          if (other.id === ap.id) continue
          if (!result.has(other.id)) continue
          if (!near(ap, other)) continue
          if (spectraOverlap(band, ch, myW, result.get(other.id).channel, widthOf(other))) overlap++
        }
        return { ch, overlap }
      })
      // Pick candidate with fewest overlaps.
      score.sort((a, b) => a.overlap - b.overlap)
      result.set(ap.id, { channel: score[0].ch })
    }
  }

  return result
}
