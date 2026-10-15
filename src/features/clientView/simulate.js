// Client View simulation core. Given the heatmap scenario, a receiver point,
// the selected client device and simulation options, decide which AP the
// client associates to (with roaming hysteresis) and compute the per-client
// statistics the panel shows.
//
// Builds on the existing RF engine: probeAt() returns each AP's *downlink* RSSI
// (AP→client) at the point. Client View layers on top:
//   1. band filtering    — a 2.4-GHz-only IoT device can't see 5/6 GHz APs;
//                          Wi-Fi 7 off caps the data-rate ladder at 11ax.
//   2. link direction    — downlink / uplink / worstlink. Uplink reuses path
//                          reciprocity: uplinkRSSI = downlinkRSSI − apTx + clientTx
//                          (antenna gains cancel), so no extra propagation pass.
//   3. roaming hysteresis — the incumbent serving AP stays unless a candidate
//                          beats it by ROAM_HYSTERESIS_DB (on band score, 58-11).
//   4. per-band noise + min-interfering — SNR uses the band's noise floor;
//                          SINR's interference sum excludes APs below
//                          minInterferingRssiDbm.
//   5. data rate         — SNR → MCS → PHY rate, capped by device PHY/streams/width.

import { probeAt } from '@/features/heatmap/hoverProbe'
import { effectiveBands } from '@/constants/clientDevices'
import { apsShareSpectrum } from '@/features/heatmap/frequency'
import { widthNoiseDelta } from '@/constants/channelWidths'
import { estimateDataRate, minPhy, phyOnBand } from './dataRate'
import { getAPModelById } from '@/constants/apModels'
import { ROAM_HYSTERESIS_DB, ROAM_CANDIDATE_WINDOW_DB } from '@/store/useClientViewStore'

// Usable-link floor — below this effective RSSI we treat the AP as "can't
// associate".
const MIN_USABLE_RSSI_DBM = -85

const dbToLin = (db) => Math.pow(10, db / 10)
const linToDb = (lin) => 10 * Math.log10(Math.max(lin, 1e-30))

// Effective RSSI for one AP given the link direction. `down` is the raw probe
// value; `up` adds the tx-power swap (reciprocity); `worst` takes the min.
function effectiveRssi(downDbm, apTxDbm, clientTxDbm, linkDirection) {
  if (linkDirection === 'down') return downDbm
  const upDbm = downDbm - (apTxDbm ?? 20) + (clientTxDbm ?? 10)
  if (linkDirection === 'up') return upDbm
  return Math.min(downDbm, upDbm) // 'worst' (default)
}

// Shared candidate builder — used by both simulateClient (panel) and the
// association-area sweep so their serving logic never drifts. Runs one probe,
// then for every AP computes: supported-band test, effective RSSI (link
// direction), usable-range test. Returns the probe plus a strongest-first
// candidate list of { ap, idx, downDbm, rssiDbm } (rssiDbm = effective).
export function buildCandidates(scenario, rx, opts) {
  const { device, sixGHzOn, wifi7On, linkDirection, clientTxDbm, clientHeightM } = opts
  // 57-17: clientHeightM is above the floor; the cross-floor scenario works in
  // absolute Z, so lift it by the floor's elevation.
  const rxAbs = {
    ...rx,
    zM: clientHeightM != null ? (scenario.floorElevationM ?? 0) + clientHeightM : (rx.zM ?? 0),
  }
  const probe = probeAt(scenario, rxAbs, { reflections: false, diffraction: false })
  if (!probe) return { probe: null, candidates: [] }

  // wifi7On only affects the data-rate ladder, not which bands are visible.
  const bands = effectiveBands(device, sixGHzOn)
  const candidates = []
  for (let i = 0; i < probe.apList.length; i++) {
    const ap = probe.apList[i]
    const downDbm = probe.perAp[i]
    if (!bands.includes(ap.frequency)) continue
    const rssiDbm = effectiveRssi(downDbm, ap.txDbm, clientTxDbm, linkDirection)
    if (rssiDbm < MIN_USABLE_RSSI_DBM) continue
    candidates.push({ ap, idx: i, downDbm, rssiDbm })
  }
  candidates.sort((a, b) => b.rssiDbm - a.rssiDbm)
  return { probe, candidates }
}

// 58-11: a 5 / 6 GHz radio counts as "available" (worth staying off 2.4 GHz
// for) only at/above this -- AOSP's 5 GHz minimum usable RSSI. Below it the
// radio is still associable down to MIN_USABLE_RSSI_DBM, but competes with 2.4.
const BAND_AVAILABLE_RSSI_DBM = -77
// 58-11: wpa_supplicant-style band bias -- each band step up adds this much to
// the score radios are ranked by (5 GHz +2, 6 GHz +4 over 2.4). Ranking only;
// the displayed / coverage RSSI stays the real one.
const BAND_STEP_BONUS_DB = 2
const BAND_STEP = { 2.4: 0, 5: 1, 6: 2 }

const bandScore = (c) => c.rssiDbm + BAND_STEP_BONUS_DB * (BAND_STEP[c.ap.frequency] ?? 0)
const byScore = (a, b) => bandScore(b) - bandScore(a)

// 58: band preference. A dual-band client joins 2.4 GHz only when no 5 / 6
// GHz radio is available -- Hamina's Client View: a client roams "to an AP in
// 2.4 GHz, when no 5 GHz option is available". Without it 2.4 GHz, which
// reaches furthest, won almost every association once APs carry several
// radios. 58-11: "available" = >= BAND_AVAILABLE_RSSI_DBM; a 5 / 6 GHz
// `incumbent` keeps counting down to that minus ROAM_HYSTERESIS_DB, so the
// 2.4 <-> 5/6 change has the same 6 dB hysteresis as roaming (join 5/6 at
// -77, fall back at -83) instead of flapping at the threshold. Returns the
// pool ordered by band score, best first. While such an incumbent is held, the
// other 5 / 6 GHz radios down to the same extended floor stay in the pool too,
// so a 5 <-> 6 / AP <-> AP move is still judged by the score margin.
function preferredPool(candidates, incumbent) {
  const heldFloor = BAND_AVAILABLE_RSSI_DBM - ROAM_HYSTERESIS_DB
  const held = incumbent && incumbent.ap.frequency !== 2.4 && incumbent.rssiDbm >= heldFloor
  const floor = held ? heldFloor : BAND_AVAILABLE_RSSI_DBM
  const high = candidates.filter((c) => c.ap.frequency !== 2.4 && c.rssiDbm >= floor)
  return (high.length ? high : candidates).slice().sort(byScore)
}

// The radio a fresh client would join here first (association area, single-AP
// area, stats mock clients, roaming-candidate list).
export function preferredCandidates(candidates) {
  return preferredPool(candidates, null)
}

// 58-11: pick a radio with roaming hysteresis. The incumbent stays while it is
// in the preferred pool and the pool's best does not beat it by
// ROAM_HYSTERESIS_DB on band score (5 <-> 6 and AP <-> AP alike). It is left
// when it drops out of the pool: below MIN_USABLE_RSSI_DBM, or a 2.4 GHz
// incumbent once a 5 / 6 GHz radio is available (that switch's hysteresis is
// the -77 / -83 band above, not the score margin -- otherwise a client on a
// strong 2.4 GHz would never move to an available 5 GHz).
function chooseRadio(candidates, priorServingId) {
  const incumbent = priorServingId != null ? candidates.find((c) => c.ap.id === priorServingId) : null
  const pool = preferredPool(candidates, incumbent)
  const best = pool[0]
  if (!incumbent || !pool.includes(incumbent)) return best   // fresh / incumbent left the pool → roam
  if (best === incumbent) return best
  if (bandScore(best) - bandScore(incumbent) >= ROAM_HYSTERESIS_DB) return best
  return incumbent                                           // sticky
}

// Decide the serving AP among `candidates` (strongest-first by effective RSSI).
// Returns { serving } where serving is the chosen candidate, or null. When a
// manual `lockedApId` is set but that AP isn't a usable candidate here, returns
// { serving: null, lockUnreachable: true } — we do NOT silently fall back to
// another AP (the user explicitly picked one; honour it or report it can't be
// reached). Applies roaming hysteresis against `priorServingId`.
function pickServing(candidates, priorServingId, lockedApId) {
  if (lockedApId != null) {
    // 58: the lock is a device -- the same band rule among its own radios.
    const own = candidates.filter((c) => (c.ap.deviceId ?? c.ap.id) === lockedApId)
    return own.length ? { serving: chooseRadio(own, priorServingId) } : { serving: null, lockUnreachable: true }
  }
  if (candidates.length === 0) return { serving: null }
  return { serving: chooseRadio(candidates, priorServingId) }
}

// Effective PHY for the data-rate ladder: an 11be device with Wi-Fi 7 disabled
// falls back to 11ax (caps MCS 11 / 1024-QAM). Bands are unaffected.
function effectivePhy(device, wifi7On) {
  if (device.phy === '11be' && !wifi7On) return '11ax'
  return device.phy
}

// 57-29: the AP model's PHY generation (Wi-Fi 6 / 6E → 11ax, 7 → 11be).
function apPhy(model) {
  const gen = model.wifiGen ?? ''
  if (gen.startsWith('Wi-Fi 7')) return '11be'
  if (gen.startsWith('Wi-Fi 5')) return '11ac'
  return '11ax'
}

// Run one Client View simulation.
// Args:
//   scenario — buildScenario() output (meters)
//   rx       — { x, y } in meters
//   opts     — { device, sixGHzOn, wifi7On, linkDirection, clientTxDbm,
//                clientHeightM, noiseFloor:{2.4,5,6}, minInterferingRssiDbm,
//                priorServingId, lockedApId }
// Returns: { reading, servingApId }.
export function simulateClient(scenario, rx, opts) {
  const empty = { reading: null, servingApId: null }
  if (!scenario || !scenario.aps.length) return empty

  const { device, wifi7On, linkDirection, noiseFloor, minInterferingRssiDbm, priorServingId, lockedApId } = opts
  const { probe, candidates } = buildCandidates(scenario, rx, opts)
  if (!probe) return empty

  const { serving, lockUnreachable } = pickServing(candidates, priorServingId, lockedApId)
  if (!serving) {
    // No serving AP. Either nothing usable here, OR a manual lock whose AP isn't
    // reachable at this point (lockUnreachable) — the panel shows a specific
    // message and we keep the lock (no silent fall-back to another AP).
    return {
      reading: {
        servingApId: null, outOfRange: true, deviceName: device.name, linkDirection,
        lockedApId: lockedApId ?? null, lockUnreachable: !!lockUnreachable,
      },
      servingApId: null,
    }
  }

  const servingAp = serving.ap
  // Whether the served AP is the manual lock (so the panel shows the 🔒 badge).
  const isLocked = lockedApId != null && (servingAp.deviceId ?? servingAp.id) === lockedApId
  const rssiDbm = serving.rssiDbm           // effective (link-direction-aware)
  const band = servingAp.frequency

  // Effective channel width / streams / PHY = min(AP, client) (57-29: the AP
  // side comes from its model). Wi-Fi 7 off → 11ax ladder; 11ac on 2.4 → 11n.
  const apModel = getAPModelById(servingAp.modelId)
  const channelWidth = Math.min(servingAp.channelWidth ?? 20, device.maxChannelWidth ?? 160)
  const spatialStreams = Math.max(1, Math.min(device.spatialStreams ?? 1, apModel.streamCount?.[band] ?? 1))
  const linkPhy = phyOnBand(minPhy(effectivePhy(device, wifi7On), apPhy(apModel)), band)

  // Noise floor = per-band base + bandwidth widening. A wider receiver admits
  // proportionally more thermal noise (+10·log10(W/20) dB), so 160 MHz sits
  // ~9 dB above 20 MHz — without this the SNR (and thus MCS/rate) is inflated.
  const baseNoiseDbm = (noiseFloor && noiseFloor[band] != null) ? noiseFloor[band] : -95
  const noiseDbm = baseNoiseDbm + widthNoiseDelta(channelWidth)

  // SNR uses the band's noise floor.
  const snrDb = rssiDbm - noiseDbm

  // SINR: serving signal vs noise + co-channel interference. Interferers are
  // OTHER APs that share spectrum AND whose downlink RSSI is at/above the
  // min-interfering threshold (weaker APs are ignored, per Hamina). Compared
  // on downlink RSSI (interference is what the receiver actually hears).
  // 57-29: taken from EVERY AP in the probe (same rule as the heatmap), not
  // the usable-candidate list -- that one is filtered on the link-direction
  // RSSI, which dropped real downlink interferers in up / worst mode.
  let cciLin = 0
  for (let i = 0; i < probe.apList.length; i++) {
    const ap = probe.apList[i]
    if (ap.id === servingAp.id) continue
    if (!apsShareSpectrum(servingAp, ap)) continue
    if (probe.perAp[i] < (minInterferingRssiDbm ?? -82)) continue
    cciLin += dbToLin(probe.perAp[i])
  }
  // 57-29: SINR per direction, signal and interference from the same side.
  // Downlink: AP signal vs what the client hears. Uplink: AP-side
  // interference (other clients) isn't modelled, so it is the uplink SNR.
  // Worst link: the weaker of the two.
  const sinrDown = serving.downDbm - linToDb(dbToLin(noiseDbm) + cciLin)
  const snrUp = effectiveRssi(serving.downDbm, servingAp.txDbm, opts.clientTxDbm, 'up') - noiseDbm
  let sinrDb, sinrSource
  if (linkDirection === 'down') { sinrDb = sinrDown; sinrSource = 'down' }
  else if (linkDirection === 'up') { sinrDb = snrUp; sinrSource = 'up' }
  else if (sinrDown <= snrUp) { sinrDb = sinrDown; sinrSource = 'down' }
  else { sinrDb = snrUp; sinrSource = 'up' }

  const dr = estimateDataRate(snrDb, linkPhy, channelWidth, spatialStreams)

  const distanceM = Math.hypot(rx.x - servingAp.pos.x, rx.y - servingAp.pos.y)

  // Roaming candidates (grey lines): other in-band APs within the window of the
  // serving effective RSSI. 58: per device -- the serving device's other
  // radios are not roaming targets, and each other device appears once (its
  // best-scored radio among the bands the client would roam to).
  const servingDev = servingAp.deviceId ?? servingAp.id
  const seenDev = new Set([servingDev])
  const roamCandidates = []
  for (const c of preferredCandidates(candidates)) {
    const dev = c.ap.deviceId ?? c.ap.id
    if (seenDev.has(dev)) continue
    seenDev.add(dev)
    if (rssiDbm - c.rssiDbm > ROAM_CANDIDATE_WINDOW_DB) continue
    roamCandidates.push({ id: c.ap.id, name: c.ap.name, band: c.ap.frequency, rssiDbm: c.rssiDbm })
  }

  const reading = {
    servingApId: servingAp.id,
    servingApName: servingAp.name,
    distanceM,
    rssiDbm,
    snrDb,
    sinrDb,
    sinrSource,   // 57-29: 'down' | 'up' (uplink = SNR, interference not modelled)
    band,
    channelWidth,
    spatialStreams,
    mcs: dr.mcs,
    mcsLabel: dr.mcsLabel,
    phyRateMbps: dr.phyRateMbps,
    candidates: roamCandidates,
    deviceName: device.name,
    linkDirection,
    isLocked,
    outOfRange: false,
  }
  return { reading, servingApId: servingAp.id }
}
