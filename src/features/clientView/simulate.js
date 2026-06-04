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
//                          beats it by ROAM_HYSTERESIS_DB (on effective RSSI).
//   4. per-band noise + min-interfering — SNR uses the band's noise floor;
//                          SINR's interference sum excludes APs below
//                          minInterferingRssiDbm.
//   5. data rate         — SNR → MCS → PHY rate, capped by device PHY/streams/width.

import { probeAt } from '@/features/heatmap/hoverProbe'
import { effectiveBands } from '@/constants/clientDevices'
import { apsShareSpectrum } from '@/features/heatmap/frequency'
import { estimateDataRate } from './dataRate'
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
  const rxAbs = { ...rx, zM: clientHeightM ?? rx.zM ?? 0 }
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

// Decide the serving AP among `candidates` (strongest-first by effective RSSI).
// Returns { serving } where serving is the chosen candidate, or null. When a
// manual `lockedApId` is set but that AP isn't a usable candidate here, returns
// { serving: null, lockUnreachable: true } — we do NOT silently fall back to
// another AP (the user explicitly picked one; honour it or report it can't be
// reached). Without a lock, applies roaming hysteresis against `priorServingId`.
function pickServing(candidates, priorServingId, lockedApId) {
  if (lockedApId != null) {
    const locked = candidates.find((c) => c.ap.id === lockedApId)
    return locked ? { serving: locked } : { serving: null, lockUnreachable: true }
  }
  if (candidates.length === 0) return { serving: null }
  const strongest = candidates[0]
  if (priorServingId == null) return { serving: strongest }
  const incumbent = candidates.find((c) => c.ap.id === priorServingId)
  if (!incumbent) return { serving: strongest }          // incumbent out of range → roam
  if (strongest.ap.id === incumbent.ap.id) return { serving: strongest }
  if (strongest.rssiDbm - incumbent.rssiDbm >= ROAM_HYSTERESIS_DB) return { serving: strongest }
  return { serving: incumbent }                          // sticky
}

// Effective PHY for the data-rate ladder: an 11be device with Wi-Fi 7 disabled
// falls back to 11ax (caps MCS 11 / 1024-QAM). Bands are unaffected.
function effectivePhy(device, wifi7On) {
  if (device.phy === '11be' && !wifi7On) return '11ax'
  return device.phy
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
  const isLocked = lockedApId != null && servingAp.id === lockedApId
  const rssiDbm = serving.rssiDbm           // effective (link-direction-aware)
  const band = servingAp.frequency
  const noiseDbm = (noiseFloor && noiseFloor[band] != null) ? noiseFloor[band] : -95

  // SNR uses the band's noise floor.
  const snrDb = rssiDbm - noiseDbm

  // SINR: serving signal vs noise + co-channel interference. Interferers are
  // OTHER APs that share spectrum AND whose downlink RSSI is at/above the
  // min-interfering threshold (weaker APs are ignored, per Hamina). Compared
  // on downlink RSSI (interference is what the receiver actually hears).
  let cciLin = 0
  for (const c of candidates) {
    if (c.ap.id === servingAp.id) continue
    if (!apsShareSpectrum(servingAp, c.ap)) continue
    if (c.downDbm < (minInterferingRssiDbm ?? -82)) continue
    cciLin += dbToLin(c.downDbm)
  }
  const sinrDb = rssiDbm - linToDb(dbToLin(noiseDbm) + cciLin)

  // Effective channel width / streams = min(AP, client). Wi-Fi 7 off → 11ax ladder.
  const channelWidth = Math.min(servingAp.channelWidth ?? 20, device.maxChannelWidth ?? 160)
  const spatialStreams = Math.max(1, device.spatialStreams ?? 1)
  const dr = estimateDataRate(snrDb, effectivePhy(device, wifi7On), channelWidth, spatialStreams)

  const distanceM = Math.hypot(rx.x - servingAp.pos.x, rx.y - servingAp.pos.y)

  // Roaming candidates (grey lines): other in-band APs within the window of the
  // serving effective RSSI.
  const roamCandidates = candidates
    .filter((c) => c.ap.id !== servingAp.id && rssiDbm - c.rssiDbm <= ROAM_CANDIDATE_WINDOW_DB)
    .map((c) => ({ id: c.ap.id, name: c.ap.name, rssiDbm: c.rssiDbm }))

  const reading = {
    servingApId: servingAp.id,
    servingApName: servingAp.name,
    distanceM,
    rssiDbm,
    snrDb,
    sinrDb,
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
