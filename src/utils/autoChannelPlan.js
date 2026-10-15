import { allowedChannels, channelEntries } from '@/constants/regulatoryDomains'
import { DEFAULT_CHANNEL_WIDTH } from '@/constants/channelWidths'
import { channelBlockMembers, channelRangeMHz } from '@/features/heatmap/frequency'

// Non-overlapping channel sets per band (20 MHz spacing).
// 2.4 GHz: channels 1, 6, 11 are the classic non-overlapping trio -- kept in
// every domain, ETSI ones too (58-16 decision). The engine's hard 20 MHz
// rectangles would call 1/5/9/13 clean, but real spectral masks leak between
// them, so the fourth channel would score better here than it works on site.
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

// 58-16: 6 GHz Preferred Scanning Channels -- 5, 21, 37, ... (every fourth
// 20 MHz channel from 5). 6 GHz-only clients find an AP by scanning these.
export const isPscChannel = (ch) => ch % 16 === 5

// 57-16: candidate primaries for a given width. 20 MHz keeps the list above;
// wider channels get one primary per bonded block whose every 20 MHz member
// is allowed in the domain -- picking 36 and 40 for two 40 MHz neighbours
// would put both on the same 36+40 block. The primary is the block's lowest
// channel, except on 6 GHz where it is the block's PSC member when it has one
// (58-16). Falls back to the 20 MHz list if the domain has no complete block.
export function candidatesForWidth(domainId, band, width) {
  const base = getNonOverlappingChannels(domainId, band)
  if (!width || width <= 20) return base
  const allowed = allowedChannels(domainId, band)
  const allowedSet = new Set(allowed)
  const out = []
  for (const ch of allowed) {
    const members = channelBlockMembers(band, ch, width)
    if (members.length !== width / 20 || members[0] !== ch) continue
    if (!members.every((m) => allowedSet.has(m))) continue
    out.push(band === 6 ? (members.find(isPscChannel) ?? ch) : ch)
  }
  return out.length > 0 ? out : base
}

// 58-16: tie-break rank of a candidate (lower is preferred) once the
// interference cost is equal: 5 GHz prefers blocks with no DFS member (no
// radar moves / CAC wait), 6 GHz prefers a PSC primary. 2.4 GHz: none.
function preferenceRank(domainId, band, ch, width) {
  if (band === 5) {
    const dfs = new Set(channelEntries(domainId, band).filter((c) => c.dfs).map((c) => c.ch))
    return channelBlockMembers(band, ch, width).some((m) => dfs.has(m)) ? 1 : 0
  }
  if (band === 6) return isPscChannel(ch) ? 0 : 1
  return 0
}

function dist2(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

// 58-16 (C5): radios on a band the domain has no channel for (e.g. 6 GHz
// after switching to CN). greedyChannelAssign leaves them out; callers report
// them instead of skipping silently. Returns those radio entries.
export function radiosWithoutChannels(aps, domainId) {
  return (aps ?? []).filter((a) => getNonOverlappingChannels(domainId, a.frequency).length === 0)
}

// 58-16 (C2): how much two radios bother each other when they share spectrum.
// With the engine's hearing model (makeApHearingFn exposes refRssiDbm): the
// received power in mW of the channel-independent AP-to-AP RSSI, 0 below the
// min interfering RSSI. A plain boolean predicate or the legacy canvas-px
// radius counts every heard neighbour as 1.
function pairWeightFn(near, domainId) {
  if (typeof near === 'function' && typeof near.refRssiDbm === 'function') {
    const thr = near.thresholdDbm
    return (a, b) => {
      const r = near.refRssiDbm(a, b, domainId)
      return r >= thr ? 10 ** (r / 10) : 0
    }
  }
  if (typeof near === 'function') return (a, b) => (near(a, b) ? 1 : 0)
  const r2 = near * near
  return (a, b) => (dist2(a, b) <= r2 ? 1 : 0)
}

// Local-search passes after the greedy (C3). Every move lowers the plan's
// total interference, so it normally settles within a few passes.
const MAX_REFINE_PASSES = 20
// 58-15: extra deterministic starts (radio orders) after the main one. One
// radio moving at a time stops at plans where only a joint change helps
// (two floors' 2.4 GHz demo: 1/11/1/6/6 vs 1/6/1/11/11, 6.7 dB apart);
// pair moves and a few restarts get out of most of them. Fewer starts on big
// bands (per-band free radios) so the synchronous call stays bounded: 1000
// APs went from ~1 s to ~2 s with all 8 starts.
const EXTRA_STARTS = 7
const extraStartsFor = (nFree) => (nFree > 400 ? 0 : nFree > 200 ? 3 : EXTRA_STARTS)
// Costs within this relative margin count as equal (float sums).
const COST_EPS = 1e-9

// Minimum-interference channel assignment, per band (58-16):
//   1. Neighbours: radios that hear each other, weighted by received power
//      (pairWeightFn). With the engine's hearing model the RSSI is taken at
//      a channel-independent reference (apHearing refRssiDbm), so moving a
//      radio to a louder sub-band can't create a pair the planner never saw.
//   2. Greedy: radios with the most (then loudest) neighbours pick first;
//      each takes the candidate with the lowest cost = summed weight of the
//      already-placed neighbours whose spectrum it overlaps.
//   3. Refinement: re-pick every radio given all the others until no move
//      helps, then try pair moves -- two neighbouring radios re-picked
//      together (swap or both move) -- and go back to single moves while a
//      pair move helps (bounded). Fixed radios never move.
//   4. Multi-start (58-15): steps 2-3 again from a few other radio orders
//      (reverse, loudest first, input order, fixed-seed shuffles); the plan
//      with the lowest total cost wins, the first one on a tie. Bands with
//      >200 free radios get 3 extra starts, >400 none (pair moves stay).
// Equal cost goes to the preferred candidate (preferenceRank: non-DFS, PSC),
// then the lowest channel -- the same input always gives the same plan.
//
// Parameters:
//   aps              — array of AP objects (must have id, x, y, frequency)
//   domainId         — regulatory domain id ('TW', 'US', …)
//   interferenceRadius — 57-34: a function (apA, apB) => boolean "these two
//                      hear each other" (features/heatmap/apHearing; its
//                      refRssiDbm / externalRadios are used when present), or
//                      the legacy canvas-px radius when no scale / scenario
//   fixedChannels    — optional Map<apId, channel>：這些 AP 的頻道視為已定，
//                      不重新指派、但計入鄰居重疊（Phase 49 fill 模式：
//                      新 AP 繞著現有 AP 的頻道排）
//
// 58-16 (C1): when the hearing function carries `externalRadios` (other
// floors' radios, storeChannelNeighbors), they are fixed neighbours too --
// counted, never reassigned, and not part of the result.
//
// Bands the domain has no channel for are left out (radiosWithoutChannels).
// Returns: Map<apId, { channel }>（含 fixed 的 AP，方便呼叫端統一讀）
export function greedyChannelAssign(aps, domainId, interferenceRadius = 300, fixedChannels = null) {
  const weightOf = pairWeightFn(interferenceRadius, domainId)
  const external = typeof interferenceRadius === 'function' && typeof interferenceRadius.externalRadios === 'function'
    ? interferenceRadius.externalRadios(aps)
    : []
  const result = new Map()

  // Group APs by frequency band
  const bands = [...new Set(aps.map((a) => a.frequency))]

  for (const band of bands) {
    if (getNonOverlappingChannels(domainId, band).length === 0) continue
    const planned = aps.filter((a) => a.frequency === band)
    const nodes = [...planned, ...external.filter((a) => a.frequency === band)]
    const n = planned.length
    const widthOf = (a) => a.channelWidth ?? DEFAULT_CHANNEL_WIDTH[band] ?? 20
    const width = nodes.map(widthOf)
    // Fixed: pre-assigned radios and other floors' radios.
    const fixed = nodes.map((a, i) => i >= n || (fixedChannels?.has(a.id) ?? false))
    const chan = nodes.map((a, i) => (i >= n ? a.channel : fixed[i] ? fixedChannels.get(a.id) : null))

    // Candidates per width, with their spectrum precomputed so the overlap
    // tests below are plain number compares.
    const candCache = new Map()
    const candidatesFor = (w) => {
      if (!candCache.has(w)) {
        candCache.set(w, candidatesForWidth(domainId, band, w).map((ch) => {
          const [lo, hi] = channelRangeMHz(band, ch, w)
          return { ch, rank: preferenceRank(domainId, band, ch, w), lo, hi }
        }))
      }
      return candCache.get(w)
    }

    // Neighbour lists (index, weight). A pair of two fixed radios never
    // changes any cost, so it is not measured.
    // A pre-assigned radio is weighed at its held channel (`heldChannel`),
    // like other floors' radios; only free radios use the reference.
    const view = nodes.map((a, i) => (i < n && fixed[i] ? { ...a, heldChannel: chan[i] } : a))
    const nbr = nodes.map(() => [])
    const nbrW = nodes.map(() => [])
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (fixed[i] && fixed[j]) continue
        const w = weightOf(view[i], view[j])
        if (w > 0) { nbr[i].push(j); nbrW[i].push(w); nbr[j].push(i); nbrW[j].push(w) }
      }
    }

    // Spectrum each radio holds now, as its bonded-block MHz range (57-16:
    // mixed widths and same-block primaries overlap; the old test was
    // channel-number equality). NaN: not placed yet -- every overlap test
    // with NaN is false. Fixed radios keep theirs; a free radio holds
    // candidate pick[i] of cands[i].
    const lo = new Float64Array(nodes.length).fill(NaN)
    const hi = new Float64Array(nodes.length).fill(NaN)
    nodes.forEach((a, i) => {
      if (fixed[i] && chan[i] != null) [lo[i], hi[i]] = channelRangeMHz(band, chan[i], width[i])
    })
    const cands = nodes.map((a, i) => (i < n && !fixed[i] ? candidatesFor(width[i]) : null))
    const pick = new Int32Array(nodes.length).fill(-1)
    // Cost vectors are cached per radio and recomputed only after one of its
    // neighbours moved. ver[i] counts changes to radio i or its cost vector.
    const cache = nodes.map(() => null)
    const ver = new Float64Array(nodes.length)
    const place = (i, k) => {
      pick[i] = k
      lo[i] = k < 0 ? NaN : cands[i][k].lo
      hi[i] = k < 0 ? NaN : cands[i][k].hi
      ver[i]++
      for (const j of nbr[i]) { cache[j] = null; ver[j]++ }
    }

    // Interference radio i would get on each of its candidates from the
    // radios placed so far.
    const costVec = (i) => {
      if (cache[i]) return cache[i]
      const list = cands[i]
      const out = new Float64Array(list.length)
      const js = nbr[i]
      const ws = nbrW[i]
      for (let m = 0; m < js.length; m++) {
        const l = lo[js[m]]
        const h = hi[js[m]]
        if (!(l < h)) continue
        for (let k = 0; k < list.length; k++) {
          if (list[k].lo < h && l < list[k].hi) out[k] += ws[m]
        }
      }
      cache[i] = out
      return out
    }
    // The same, leaving out neighbour j (weight w), written into `out`.
    const costVecWithout = (i, j, w, out) => {
      const list = cands[i]
      const v = costVec(i)
      const l = lo[j]
      const h = hi[j]
      for (let k = 0; k < list.length; k++) {
        out[k] = list[k].lo < h && l < list[k].hi ? v[k] - w : v[k]
      }
      return out
    }
    // Is (cost a, rank ra, channel xa) strictly better than (b, rb, xb)?
    const better = (a, ra, xa, b, rb, xb) => {
      const tol = COST_EPS * Math.max(a, b)
      if (a < b - tol) return true
      if (a > b + tol) return false
      if (ra !== rb) return ra < rb
      return xa < xb
    }
    const bestIndex = (list, v) => {
      let best = 0
      for (let k = 1; k < list.length; k++) {
        if (better(v[k], list[k].rank, list[k].ch, v[best], list[best].rank, list[best].ch)) best = k
      }
      return best
    }

    // Pair moves: for each neighbouring pair of free radios, the best joint
    // (channel, channel) -- a swap or both moving. The pair's own link is
    // counted once, the rest of each radio's cost with the partner left out.
    // Equal cost goes to the lower summed rank, then the lower summed
    // channel -- each accepted move lowers (total cost, total rank, total
    // channel), so the search can't cycle. A pair is looked at again only
    // after one of the two, or a neighbour of either, moved (pairSeen).
    const pairSeen = nodes.map((a, i) => new Float64Array(nbr[i].length))
    const maxK = Math.max(0, ...cands.map((c) => c?.length ?? 0))
    const vi = new Float64Array(maxK)
    const vj = new Float64Array(maxK)
    const pairPass = (order) => {
      let moved = false
      for (const i of order) {
        const js = nbr[i]
        for (let m = 0; m < js.length; m++) {
          const j = js[m]
          if (j >= n || fixed[j] || j < i) continue
          if (pairSeen[i][m] === ver[i] + ver[j]) continue
          const w = nbrW[i][m]
          const ci = cands[i]
          const cj = cands[j]
          costVecWithout(i, j, w, vi)
          costVecWithout(j, i, w, vj)
          let minJ = Infinity
          for (let b = 0; b < cj.length; b++) if (vj[b] < minJ) minJ = vj[b]
          let ba = pick[i]
          let bb = pick[j]
          let bCost = vi[ba] + vj[bb] + (ci[ba].lo < cj[bb].hi && cj[bb].lo < ci[ba].hi ? w : 0)
          for (let a = 0; a < ci.length; a++) {
            // No b can beat the best so far on this row.
            if (vi[a] + minJ > bCost + COST_EPS * Math.max(vi[a] + minJ, bCost)) continue
            const { lo: aLo, hi: aHi, rank: aRank, ch: aCh } = ci[a]
            for (let b = 0; b < cj.length; b++) {
              const cost = vi[a] + vj[b] + (aLo < cj[b].hi && cj[b].lo < aHi ? w : 0)
              if (better(cost, aRank + cj[b].rank, aCh + cj[b].ch,
                bCost, ci[ba].rank + cj[bb].rank, ci[ba].ch + cj[bb].ch)) {
                ba = a
                bb = b
                bCost = cost
              }
            }
          }
          if (ba !== pick[i] || bb !== pick[j]) { place(i, ba); place(j, bb); moved = true }
          pairSeen[i][m] = ver[i] + ver[j]
        }
      }
      return moved
    }

    // Single moves until none helps; then pair moves; back to single moves
    // while a pair move helped.
    const refine = (order) => {
      for (let pass = 0; pass < MAX_REFINE_PASSES; pass++) {
        let moved = false
        for (const i of order) {
          const list = cands[i]
          const v = costVec(i)
          const k = bestIndex(list, v)
          const c = pick[i]
          if (k !== c && better(v[k], list[k].rank, list[k].ch, v[c], list[c].rank, list[c].ch)) {
            place(i, k)
            moved = true
          }
        }
        if (!moved && !pairPass(order)) break
      }
    }

    // Total cost of the band (every measured pair once) and summed rank.
    const totalCost = () => {
      let c = 0
      for (let i = 0; i < n; i++) {
        const js = nbr[i]
        for (let m = 0; m < js.length; m++) {
          const j = js[m]
          if (j > i && lo[i] < hi[j] && lo[j] < hi[i]) c += nbrW[i][m]
        }
      }
      return c
    }
    const totalRank = () => {
      let r = 0
      for (let i = 0; i < n; i++) if (!fixed[i]) r += cands[i][pick[i]].rank
      return r
    }

    // Order: more neighbours first, then louder ones, then input order.
    const sumW = nbrW.map((ws) => ws.reduce((s, w) => s + w, 0))
    const free = []
    for (let i = 0; i < n; i++) if (!fixed[i]) free.push(i)
    const mainOrder = [...free].sort((a, b) => (nbr[b].length - nbr[a].length) || (sumW[b] - sumW[a]) || (a - b))
    const orders = [mainOrder]
    const extra = extraStartsFor(free.length)
    if (extra > 0 && free.length > 1 && free.some((i) => nbr[i].length > 0)) {
      orders.push([...mainOrder].reverse())
      orders.push([...free].sort((a, b) => (sumW[b] - sumW[a]) || (a - b)))
      orders.push(free)
      // Fixed-seed shuffles (Park-Miller), so the same input gives the same plan.
      for (let k = orders.length; k <= extra; k++) {
        let seed = 7919 * k
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
        const o = [...free]
        for (let m = o.length - 1; m > 0; m--) {
          const r = Math.floor(rnd() * (m + 1))
          ;[o[m], o[r]] = [o[r], o[m]]
        }
        orders.push(o)
      }
    }

    // Each start: greedy in its order, then refine. Lowest (cost, rank) wins;
    // the earlier start keeps a tie.
    let bestPlan = null
    for (const order of orders) {
      for (const seen of pairSeen) seen.fill(-1)
      for (const i of free) place(i, -1)
      for (const i of order) place(i, bestIndex(cands[i], costVec(i)))
      refine(order)
      const plan = { cost: totalCost(), rank: totalRank(), pick: Int32Array.from(pick) }
      if (!bestPlan || better(plan.cost, plan.rank, 0, bestPlan.cost, bestPlan.rank, 0)) bestPlan = plan
    }
    for (const i of free) chan[i] = cands[i][bestPlan.pick[i]].ch

    for (let i = 0; i < n; i++) result.set(nodes[i].id, { channel: chan[i] })
  }

  return result
}
