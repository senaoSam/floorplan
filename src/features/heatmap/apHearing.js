// 57-33 / 57-34: do two APs hear each other? The engine's AP-to-AP RSSI
// (direct path; walls, slabs, antenna pattern, EIRP-capped TX), the louder of
// the two directions, at or above the scenario's min interfering RSSI -- the
// rule the heatmap's SINR / CCI and Client View use for interference.
import { rssiFromAp } from './propagation'
import { DEFAULT_MIN_INTERFERING_RSSI_DBM, PLANNER_SOFT_RANGE_DB, AP_ANT_GAIN_DBI, RX_ANT_GAIN_DBI } from './rfConstants'
import { channelBlockCenterMHz, channelRangeMHz } from './frequency'
import { eirpLimitDbm } from '@/constants/regulatoryDomains'
import { getDefaultTxPower } from '@/constants/apModels'
import { getPatternById } from '@/constants/antennaPatterns'
import { candidatesForWidth } from '@/utils/autoChannelPlan'

// 58-16: the direct ray only meets walls whose height band overlaps the
// span between the two radios (propagation's accumulateWallLoss skips the
// rest), so other floors' walls are dropped before the scan. Lists are kept
// per wall array and span; same result, less work on multi-floor scenarios.
const wallsBySpan = new WeakMap()
function wallsForSpan(walls, z1, z2) {
  if (!walls) return walls
  const zLo = Math.min(z1, z2), zHi = Math.max(z1, z2)
  let bySpan = wallsBySpan.get(walls)
  if (!bySpan) { bySpan = new Map(); wallsBySpan.set(walls, bySpan) }
  const key = zLo + '|' + zHi
  let list = bySpan.get(key)
  if (!list) {
    list = walls.filter((w) =>
      w.zLoM == null || w.zHiM == null || !(w.zHiM < zLo || w.zLoM > zHi))
    bySpan.set(key, list)
  }
  return list
}

export function apToApRssiDbm(scenario, a, b) {
  const opts = { maxReflOrder: 0, enableDiffraction: false, floorBoundaries: scenario.floorBoundaries ?? null }
  const walls = wallsForSpan(scenario.walls, a.zM ?? 0, b.zM ?? 0)
  const hear = (from, to) => rssiFromAp(from, { x: to.pos.x, y: to.pos.y, zM: to.zM ?? 0 },
    walls, scenario.corners, opts).rssiDbm
  return Math.max(hear(a, b), hear(b, a))
}

// 58-16 (C4): a radio's scenario entry at a channel-independent reference,
// for the channel planner's neighbour graph. The entry as built carries the
// radio's CURRENT channel: its TX is capped by that sub-band's EIRP limit and
// its centre frequency sets path and wall loss, so moving it to a louder
// sub-band could create a pair the planner never measured. The reference is
// the loudest the radio can be on any candidate channel of its width:
//   TX     = the highest EIRP-capped TX over the candidates
//   centre = the lowest candidate centre (least path / wall loss)
// so the actual RSSI on any candidate is never above the reference.
// `view` is the radio as planned (txPower = the set TX). Other floors' fixed
// radios (`fixedExternal`) keep the entry as is -- their channel is known.
// So does a radio the planner holds at its channel (`heldChannel`, the
// fixedChannels of greedyChannelAssign) when the entry is on that channel.
function referenceEntry(e, view, domainId) {
  if (!view || view.fixedExternal) return e
  if (view.heldChannel != null && view.heldChannel === e.channel) return e
  const band = e.frequency
  const width = e.channelWidth
  const cands = candidatesForWidth(domainId, band, width)
  if (cands.length === 0) return e
  const setTx = view.txPower ?? getDefaultTxPower(band)
  let tx = -Infinity
  let centerMHz = Infinity
  for (const ch of cands) {
    const [lo, hi] = channelRangeMHz(band, ch, width)
    const limit = eirpLimitDbm(domainId, lo, hi)
    tx = Math.max(tx, limit == null ? setTx : Math.min(setTx, limit - e.antGainDbi))
    centerMHz = Math.min(centerMHz, channelBlockCenterMHz(band, ch, width))
  }
  return { ...e, txDbm: tx, centerMHz }
}

// 58-16: a cheap ceiling on apToApRssiDbm, to skip the wall scan for pairs
// that can't reach the threshold (other floors' radios, far ones). Direct
// path only, like apToApRssiDbm, with every loss that can only add taken out
// or taken at its minimum:
//   TX + peak AP gain (+ the pattern's best H and V cut) + RX gain
//   - free-space loss at the 3D distance (no indoor per-metre term)
//   - each crossed slab at normal incidence (no oblique / Fresnel extra),
//     holes honoured as in propagation's accumulateSlabLoss
//   - no wall loss
function pointInPolyFlat(x, y, pts) {
  const n = pts.length / 2
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1]
    const xj = pts[j * 2], yj = pts[j * 2 + 1]
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside
  }
  return inside
}

function peakGainBoundDbi(e) {
  const peak = e.antGainDbi ?? AP_ANT_GAIN_DBI
  if ((e.antennaMode ?? 'omni') !== 'custom') return peak
  const p = getPatternById(e.patternId)
  return peak + Math.max(0, ...p.samples) + Math.max(0, ...(p.samplesV ?? p.samples))
}

export function rssiBoundDbm(from, to, boundaries) {
  const freqMhz = from.centerMHz || 5190
  const dx = to.pos.x - from.pos.x
  const dy = to.pos.y - from.pos.y
  const z1 = from.zM ?? 0, z2 = to.zM ?? 0
  const dz = z2 - z1
  const dxy = Math.max(Math.hypot(dx, dy), 0.25)
  const d = Math.max(Math.hypot(dxy, dz), 0.5)
  let slab = 0
  if (boundaries && Math.abs(dz) > 1e-9) {
    const zLo = Math.min(z1, z2), zHi = Math.max(z1, z2)
    const fOver24 = freqMhz / 1000 / 2.4
    for (const b of boundaries) {
      if (!(b.yM > zLo && b.yM < zHi)) continue
      const t = (b.yM - z1) / dz
      const xAt = from.pos.x + dx * t, yAt = from.pos.y + dy * t
      if ((b.bypassHoles ?? []).some((poly) => pointInPolyFlat(xAt, yAt, poly))) continue
      slab += b.slabDb * (b.slabLossB ? Math.pow(fOver24, b.slabLossB) : 1)
    }
  }
  return from.txDbm + peakGainBoundDbi(from) + RX_ANT_GAIN_DBI
    - (20 * Math.log10(d) + 20 * Math.log10(freqMhz) - 27.55) - slab
}

// Returns (apA, apB) => boolean keyed by AP id (scenario entries looked up by
// id; unknown ids never hear each other). Pairs are cached.
// 58-16: the function also carries, for greedyChannelAssign --
//   thresholdDbm               the min interfering RSSI
//   refRssiDbm(a, b, domainId) the pair's AP-to-AP RSSI at the reference
//                              (referenceEntry); -Infinity for unknown ids
//                              and for pairs whose ceiling (rssiBoundDbm)
//                              is below the planner's soft floor (threshold
//                              - PLANNER_SOFT_RANGE_DB): the planner weighs
//                              pairs down to there
//   externalRadios(planned)    with `crossFloorFixed`: the scenario's radios
//                              that are not being planned (other floors'),
//                              as fixed neighbours; null otherwise
export function makeApHearingFn(scenario, { crossFloorFixed = false } = {}) {
  const thr = scenario.rf?.minInterfDbm ?? DEFAULT_MIN_INTERFERING_RSSI_DBM
  const byId = new Map(scenario.aps.map((e) => [e.id, e]))
  const cache = new Map()
  const fn = (apA, apB) => {
    const a = byId.get(apA.id), b = byId.get(apB.id)
    if (!a || !b) return false
    const key = apA.id < apB.id ? apA.id + '|' + apB.id : apB.id + '|' + apA.id
    let v = cache.get(key)
    if (v === undefined) {
      v = apToApRssiDbm(scenario, a, b) >= thr
      cache.set(key, v)
    }
    return v
  }

  // A held radio's entry differs from its reference, so it is cached apart.
  const viewKey = (view) => view.id + (view.heldChannel != null ? '@' + view.heldChannel : '')
  const refEntries = new Map()
  const refOf = (view, domainId) => {
    const key = domainId + '|' + viewKey(view)
    if (!refEntries.has(key)) {
      const e = byId.get(view.id)
      refEntries.set(key, e ? referenceEntry(e, view, domainId) : null)
    }
    return refEntries.get(key)
  }
  const refCache = new Map()
  fn.thresholdDbm = thr
  fn.refRssiDbm = (apA, apB, domainId) => {
    const a = refOf(apA, domainId), b = refOf(apB, domainId)
    if (!a || !b) return -Infinity
    const kA = viewKey(apA), kB = viewKey(apB)
    const key = domainId + '|' + (kA < kB ? kA + '|' + kB : kB + '|' + kA)
    let v = refCache.get(key)
    if (v === undefined) {
      const bounds = scenario.floorBoundaries ?? null
      v = Math.max(rssiBoundDbm(a, b, bounds), rssiBoundDbm(b, a, bounds)) < thr - PLANNER_SOFT_RANGE_DB
        ? -Infinity
        : apToApRssiDbm(scenario, a, b)
      refCache.set(key, v)
    }
    return v
  }
  fn.externalRadios = crossFloorFixed
    ? (planned) => {
        const ids = new Set(planned.map((a) => a.id))
        return scenario.aps.filter((e) => !ids.has(e.id)).map((e) => ({ ...e, fixedExternal: true }))
      }
    : null
  return fn
}
