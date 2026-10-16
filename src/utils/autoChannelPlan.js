import { allowedChannels, channelEntries } from '@/constants/regulatoryDomains'
import { DEFAULT_CHANNEL_WIDTH } from '@/constants/channelWidths'
import { channelBlockMembers, channelRangeMHz } from '@/features/heatmap/frequency'
import { PLANNER_SOFT_RANGE_DB } from '@/features/heatmap/rfConstants'

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

// 58-16 (C2): how much two radios bother each other when they share spectrum,
// as [hard, soft]. With the engine's hearing model (makeApHearingFn exposes
// refRssiDbm): hard = received power in mW of the channel-independent AP-to-AP
// RSSI at or above the min interfering RSSI -- a conflict the panel counts.
// A plain boolean predicate or the legacy canvas-px radius counts every heard
// neighbour as hard 1 and has no soft tier.
//
// Soft = the same mW for pairs within PLANNER_SOFT_RANGE_DB below the
// threshold. Two APs that just miss hearing each other (-84 dBm) cover a shared edge
// where a client hears both well above it (-67 dBm each at the midpoint, SINR
// ~0 dB on one channel). With soft at 0 every channel tied and the tie went
// to the lowest one, so a sparse floor sat on 36/44 with nine channels idle:
// 19 % of cells under 20 dB SINR vs 1 % spread out. Soft is ranked after the
// hard cost and the DFS / PSC preference (better()), so it only spreads radios
// among channels that are otherwise equal -- it never trades a counted
// conflict, and never pushes a radio onto DFS, to separate weak pairs.
function pairWeightFn(near, domainId) {
  if (typeof near === 'function' && typeof near.refRssiDbm === 'function') {
    const thr = near.thresholdDbm
    const softFloor = thr - PLANNER_SOFT_RANGE_DB
    return (a, b) => {
      const r = near.refRssiDbm(a, b, domainId)
      if (r >= thr) return [10 ** (r / 10), 0]
      return r >= softFloor ? [0, 10 ** (r / 10)] : [0, 0]
    }
  }
  if (typeof near === 'function') return (a, b) => [near(a, b) ? 1 : 0, 0]
  const r2 = near * near
  return (a, b) => [dist2(a, b) <= r2 ? 1 : 0, 0]
}

// Soft neighbours kept per radio (its loudest ones; a pair stays if either
// radio keeps it). Spreading channels only needs the nearest few, and on an
// open floor with few walls the soft range reaches most of the floor: uncapped,
// 1024 APs on one band took 5.5 s instead of 1.2 s.
const SOFT_MAX_NEIGHBOURS = 8

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
// A start beats the warm start on soft cost alone only by this much.
const SOFT_SWITCH_DB = 1
// Channel tie-break key offset that puts a radio's current channel first.
const CURRENT_FIRST = 1e6

// Minimum-interference channel assignment, per band (58-16):
//   1. Neighbours: radios that hear each other, weighted by received power
//      (pairWeightFn). With the engine's hearing model the RSSI is taken at
//      a channel-independent reference (apHearing refRssiDbm), so moving a
//      radio to a louder sub-band can't create a pair the planner never saw.
//      Pairs just under the threshold carry a separate soft weight.
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
//      A DSATUR start runs on every band, whatever its size: the radio with
//      the most candidates already blocked by placed neighbours picks next.
//      A fixed order builds a seam across a uniform lattice that single and
//      pair moves can't undo (hex 16x16 on 1/6/11: 80 conflicts, DSATUR 0).
//   5. Warm start (58-15): the radios' current channels are the first start,
//      so the result is never worse than the plan the user already has, and
//      a radio keeps its channel on an exact tie. Another start replaces the
//      warm one only with a lower hard cost or rank, or a soft cost at least
//      SOFT_SWITCH_DB lower -- re-running on an unchanged floor, or after one
//      AP is added, doesn't reshuffle the whole floor for a tie-break.
// Costs compare as (hard, preference rank, soft, channel): equal hard cost
// goes to the preferred candidate (preferenceRank: non-DFS, PSC), then the
// lower soft cost, then the radio's current channel, then the lowest channel
// -- the same input always gives the same plan.
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
    // nbrW = hard weight, nbrS = soft weight of the same pair (one of the two
    // is 0); hardDeg counts the hard ones. Soft pairs are kept only when they
    // are among the SOFT_MAX_NEIGHBOURS loudest soft pairs of either radio.
    const nbr = nodes.map(() => [])
    const nbrW = nodes.map(() => [])
    const nbrS = nodes.map(() => [])
    const hardDeg = new Int32Array(nodes.length)
    const link = (i, j, w, sw) => {
      nbr[i].push(j); nbrW[i].push(w); nbrS[i].push(sw)
      nbr[j].push(i); nbrW[j].push(w); nbrS[j].push(sw)
    }
    const softOf = nodes.map(() => [])   // [partner, soft weight]
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (fixed[i] && fixed[j]) continue
        const [w, sw] = weightOf(view[i], view[j])
        if (w > 0) {
          link(i, j, w, 0)
          hardDeg[i]++
          hardDeg[j]++
        } else if (sw > 0) {
          softOf[i].push([j, sw])
          softOf[j].push([i, sw])
        }
      }
    }
    const keepSoft = nodes.map(() => new Set())
    for (let i = 0; i < nodes.length; i++) {
      softOf[i].sort((p, q) => (q[1] - p[1]) || (p[0] - q[0]))
      for (let m = 0; m < Math.min(SOFT_MAX_NEIGHBOURS, softOf[i].length); m++) keepSoft[i].add(softOf[i][m][0])
    }
    for (let i = 0; i < nodes.length; i++) {
      for (const [j, sw] of softOf[i]) {
        if (j > i && (keepSoft[i].has(j) || keepSoft[j].has(i))) link(i, j, 0, sw)
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
    // Index of each free radio's current block among its candidates, -1 when
    // it has no channel or its spectrum isn't a candidate block. Matched by
    // spectrum, not number: a wide candidate is one primary per block (5 GHz
    // the lowest, 6 GHz the PSC member), and 44@80 or a 6 GHz default 1@80
    // sit in a candidate block under another number.
    const curIdx = nodes.map((a, i) => {
      if (!cands[i] || a.channel == null) return -1
      const [l, h] = channelRangeMHz(band, a.channel, width[i])
      return cands[i].findIndex((c) => c.lo === l && c.hi === h)
    })
    // Channel tie-break key: the current channel first, then the lowest.
    const chKey = (i, k) => (k === curIdx[i] ? cands[i][k].ch - CURRENT_FIRST : cands[i][k].ch)
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
    // radios placed so far: { h: hard, s: soft } per candidate.
    const costVec = (i) => {
      if (cache[i]) return cache[i]
      const list = cands[i]
      const outH = new Float64Array(list.length)
      const outS = new Float64Array(list.length)
      const js = nbr[i]
      const ws = nbrW[i]
      const ss = nbrS[i]
      for (let m = 0; m < js.length; m++) {
        const l = lo[js[m]]
        const h = hi[js[m]]
        if (!(l < h)) continue
        for (let k = 0; k < list.length; k++) {
          if (list[k].lo < h && l < list[k].hi) { outH[k] += ws[m]; outS[k] += ss[m] }
        }
      }
      cache[i] = { h: outH, s: outS }
      return cache[i]
    }
    // The same, leaving out neighbour j (weights w / sw), into outH / outS.
    const costVecWithout = (i, j, w, sw, outH, outS) => {
      const list = cands[i]
      const v = costVec(i)
      const l = lo[j]
      const h = hi[j]
      for (let k = 0; k < list.length; k++) {
        const ov = list[k].lo < h && l < list[k].hi
        outH[k] = ov ? v.h[k] - w : v.h[k]
        outS[k] = ov ? v.s[k] - sw : v.s[k]
      }
    }
    // Is (hard a, rank ra, soft sa, channel xa) strictly better than
    // (b, rb, sb, xb)? Hard and soft each compare within COST_EPS.
    const better = (a, ra, sa, xa, b, rb, sb, xb) => {
      const tol = COST_EPS * Math.max(a, b)
      if (a < b - tol) return true
      if (a > b + tol) return false
      if (ra !== rb) return ra < rb
      const stol = COST_EPS * Math.max(sa, sb)
      if (sa < sb - stol) return true
      if (sa > sb + stol) return false
      return xa < xb
    }
    const bestIndex = (i) => {
      const list = cands[i]
      const v = costVec(i)
      let best = 0
      for (let k = 1; k < list.length; k++) {
        if (better(v.h[k], list[k].rank, v.s[k], chKey(i, k),
          v.h[best], list[best].rank, v.s[best], chKey(i, best))) best = k
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
    // Pairs are tried only across a hard link: a soft-only pair never costs a
    // counted conflict, and single moves already spread those.
    const pairSeen = nodes.map((a, i) => new Float64Array(nbr[i].length))
    const maxK = Math.max(0, ...cands.map((c) => c?.length ?? 0))
    const vi = new Float64Array(maxK)
    const vj = new Float64Array(maxK)
    const si = new Float64Array(maxK)
    const sj = new Float64Array(maxK)
    const pairPass = (order) => {
      let moved = false
      for (const i of order) {
        const js = nbr[i]
        for (let m = 0; m < js.length; m++) {
          const j = js[m]
          if (j >= n || fixed[j] || j < i) continue
          const w = nbrW[i][m]
          if (w === 0) continue
          if (pairSeen[i][m] === ver[i] + ver[j]) continue
          const sw = nbrS[i][m]
          const ci = cands[i]
          const cj = cands[j]
          costVecWithout(i, j, w, sw, vi, si)
          costVecWithout(j, i, w, sw, vj, sj)
          let minJ = Infinity
          for (let b = 0; b < cj.length; b++) if (vj[b] < minJ) minJ = vj[b]
          const ovAB = (a, b) => ci[a].lo < cj[b].hi && cj[b].lo < ci[a].hi
          let ba = pick[i]
          let bb = pick[j]
          let bCost = vi[ba] + vj[bb] + (ovAB(ba, bb) ? w : 0)
          let bSoft = si[ba] + sj[bb] + (ovAB(ba, bb) ? sw : 0)
          for (let a = 0; a < ci.length; a++) {
            // No b can beat the best so far on this row.
            if (vi[a] + minJ > bCost + COST_EPS * Math.max(vi[a] + minJ, bCost)) continue
            const aRank = ci[a].rank
            const aKey = chKey(i, a)
            for (let b = 0; b < cj.length; b++) {
              const ov = ovAB(a, b)
              const cost = vi[a] + vj[b] + (ov ? w : 0)
              const soft = si[a] + sj[b] + (ov ? sw : 0)
              if (better(cost, aRank + cj[b].rank, soft, aKey + chKey(j, b),
                bCost, ci[ba].rank + cj[bb].rank, bSoft, chKey(i, ba) + chKey(j, bb))) {
                ba = a
                bb = b
                bCost = cost
                bSoft = soft
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
          const k = bestIndex(i)
          const c = pick[i]
          if (k !== c && better(v.h[k], list[k].rank, v.s[k], chKey(i, k),
            v.h[c], list[c].rank, v.s[c], chKey(i, c))) {
            place(i, k)
            moved = true
          }
        }
        if (!moved && !pairPass(order)) break
      }
    }

    // Total hard / soft cost of the band (every measured pair once) and
    // summed rank.
    const totalCost = () => {
      let c = 0
      let sc = 0
      for (let i = 0; i < n; i++) {
        const js = nbr[i]
        for (let m = 0; m < js.length; m++) {
          const j = js[m]
          if (j > i && lo[i] < hi[j] && lo[j] < hi[i]) { c += nbrW[i][m]; sc += nbrS[i][m] }
        }
      }
      return [c, sc]
    }
    const totalRank = () => {
      let r = 0
      for (let i = 0; i < n; i++) if (!fixed[i]) r += cands[i][pick[i]].rank
      return r
    }

    // Order: more (hard) neighbours first, then louder ones, then input order.
    const sumW = nbrW.map((ws) => ws.reduce((s, w) => s + w, 0))
    const free = []
    for (let i = 0; i < n; i++) if (!fixed[i]) free.push(i)
    const mainOrder = [...free].sort((a, b) => (hardDeg[b] - hardDeg[a]) || (sumW[b] - sumW[a]) || (a - b))
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

    // DSATUR greedy: next is the free radio with the most candidates already
    // carrying hard interference (saturation), then more hard neighbours,
    // then louder ones, then input order. Returns the order it placed in, so
    // refine() walks the radios the same way.
    const dsaturGreedy = () => {
      const placed = new Uint8Array(nodes.length)
      const order = []
      for (let step = 0; step < free.length; step++) {
        let best = -1
        let bestSat = -1
        for (const i of free) {
          if (placed[i]) continue
          const v = costVec(i).h
          let sat = 0
          for (let k = 0; k < v.length; k++) if (v[k] > 0) sat++
          const wins = best < 0 || sat > bestSat || (sat === bestSat
            && ((hardDeg[i] - hardDeg[best]) || (sumW[i] - sumW[best]) || (best - i)) > 0)
          if (wins) { best = i; bestSat = sat }
        }
        placed[best] = 1
        order.push(best)
        place(best, bestIndex(best))
      }
      return order
    }

    // Each start: greedy in its order (or DSATUR's, or the current channels),
    // then refine. Lowest (hard, rank, soft) wins; the earlier start keeps a
    // tie, and the warm start keeps a soft-only win under SOFT_SWITCH_DB.
    let bestPlan = null
    const hasCurrent = free.some((i) => curIdx[i] >= 0)
    const starts = [...(hasCurrent ? ['warm'] : []), ...orders, 'dsatur']
    const softSwitch = 10 ** (-SOFT_SWITCH_DB / 10)
    for (const start of starts) {
      for (const seen of pairSeen) seen.fill(-1)
      for (const i of free) place(i, -1)
      let order = start
      if (start === 'warm') {
        order = mainOrder
        for (const i of free) if (curIdx[i] >= 0) place(i, curIdx[i])
        for (const i of order) if (pick[i] < 0) place(i, bestIndex(i))
      } else if (start === 'dsatur') {
        order = dsaturGreedy()
      } else {
        for (const i of order) place(i, bestIndex(i))
      }
      refine(order)
      const [cost, soft] = totalCost()
      const plan = { cost, soft, rank: totalRank(), pick: Int32Array.from(pick), warm: start === 'warm' }
      const softTarget = bestPlan?.warm ? bestPlan.soft * softSwitch : bestPlan?.soft
      if (!bestPlan || better(plan.cost, plan.rank, plan.soft, 0, bestPlan.cost, bestPlan.rank, softTarget, 0)) bestPlan = plan
    }
    // A radio that stays in its block keeps its own primary -- same spectrum,
    // no reason to renumber it -- except a 6 GHz non-PSC primary, which moves
    // to the block's PSC member (58-16).
    for (const i of free) {
      const k = bestPlan.pick[i]
      const own = nodes[i].channel
      const keepOwn = k === curIdx[i] && (band !== 6 || isPscChannel(own))
      chan[i] = keepOwn ? own : cands[i][k].ch
    }

    for (let i = 0; i < n; i++) result.set(nodes[i].id, { channel: chan[i] })
  }

  return result
}
