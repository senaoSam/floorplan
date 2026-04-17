import { allowedChannels } from '@/constants/regulatoryDomains'

// Non-overlapping channel sets per band (20 MHz spacing).
// 2.4 GHz: channels 1, 6, 11 are the classic non-overlapping trio.
// 5 GHz / 6 GHz: every channel in the list is already 20 MHz apart (step 4),
// so the full allowed list is used — no extra filtering needed.
const NON_OVERLAPPING_2_4 = [1, 6, 11]

function getNonOverlappingChannels(domainId, band) {
  const allowed = allowedChannels(domainId, band)
  if (band === 2.4) {
    const filtered = NON_OVERLAPPING_2_4.filter((ch) => allowed.includes(ch))
    return filtered.length > 0 ? filtered : allowed
  }
  return allowed
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
//   interferenceRadius — canvas-px radius within which two APs can interfere
//
// Returns: Map<apId, { channel }>
export function greedyChannelAssign(aps, domainId, interferenceRadius = 300) {
  const r2 = interferenceRadius * interferenceRadius
  const result = new Map()

  // Group APs by frequency band
  const bands = [...new Set(aps.map((a) => a.frequency))]

  for (const band of bands) {
    const bandAPs = aps.filter((a) => a.frequency === band)
    const candidates = getNonOverlappingChannels(domainId, band)
    if (candidates.length === 0) continue

    // Sort: APs with more neighbours first so they get first pick.
    const sorted = [...bandAPs].sort((a, b) => {
      const na = bandAPs.filter((x) => x.id !== a.id && dist2(x, a) <= r2).length
      const nb = bandAPs.filter((x) => x.id !== b.id && dist2(x, b) <= r2).length
      return nb - na
    })

    for (const ap of sorted) {
      // Count how many already-assigned neighbours use each candidate channel.
      const score = candidates.map((ch) => {
        let overlap = 0
        for (const other of bandAPs) {
          if (other.id === ap.id) continue
          if (!result.has(other.id)) continue
          if (dist2(ap, other) > r2) continue
          if (result.get(other.id).channel === ch) overlap++
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
