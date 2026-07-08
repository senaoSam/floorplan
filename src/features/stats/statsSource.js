// Stats domain data source (B-domain, spec §1). This is the ADAPTER seam: today
// it derives everything from the plan + a seeded mock; when the real cloud
// backend exists, only the internals here change — deriveTopology/getSnapshot
// keep their shapes and the dashboard UI stays untouched.
//
// The cloud will only hand us raw per-device data; ALL aggregation is the
// frontend's job (user's decision). So the honest mock is: build ONE seeded
// topology (the single source of truth — spec §1.0) that ties AP ↔ switch ↔
// port ↔ client together, then project every API off it. That guarantees the
// cross-source invariants (spec §2 INV-1..10) hold by construction rather than
// by luck.

import { mulberry32, hashStringToSeed } from '@/utils/seededRng'
import { buildScenario } from '@/features/heatmap/buildScenario'
import { buildCandidates } from '@/features/clientView/simulate'
import { getCachedRoutes } from '@/features/cable/routesCache'
import { getAPPoeWattage } from '@/constants/apModels'
import { CLIENT_DEVICE_LIST } from '@/constants/clientDevices'

const DEFAULT_SEED = 20260706

// Time-of-day occupancy multiplier (0..1) — spec §3.2 diurnal shape: morning
// and afternoon peaks, lunch dip, night trough, weekend low. `ts` is epoch ms;
// we read local hour + weekday off it. A quiet baseline keeps counts non-zero.
function occupancyFactor(ts) {
  const d = new Date(ts)
  const hour = d.getHours() + d.getMinutes() / 60
  const day = d.getDay() // 0=Sun..6=Sat
  const weekend = day === 0 || day === 6
  // Two-humped work curve, ~0.08 floor overnight.
  const morning = Math.exp(-Math.pow((hour - 10) / 2.2, 2))
  const afternoon = Math.exp(-Math.pow((hour - 15) / 2.4, 2))
  const lunchDip = 1 - 0.35 * Math.exp(-Math.pow((hour - 12.5) / 0.8, 2))
  let f = 0.08 + 0.92 * Math.max(morning, afternoon) * lunchDip
  if (hour < 6 || hour > 21) f = 0.08 + 0.04 * Math.max(0, morning)
  if (weekend) f *= 0.35
  return Math.max(0.04, Math.min(1, f))
}

// Box-Muller standard normal (for AP-centric client scatter).
function gaussian(rng) {
  let u = 0, v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Pick a client position (image-px) by scattering around a randomly-chosen
// online AP with a gaussian spread. This gives spatial coherence (clients
// cluster near APs — spec §3.1) WITHOUT depending on scopes, so the stats mock
// never touches the planning heatmap's scope mask. Spread scales with the
// floor size so it reads as "people in the room around the AP", clamped to the
// floor rect.
function samplePoint(rng, floor, onlineAps) {
  const ap = onlineAps[Math.floor(rng() * onlineAps.length)]
  const spread = Math.min(floor.imageWidth, floor.imageHeight) * 0.08
  const x = Math.max(0, Math.min(floor.imageWidth, ap.x + gaussian(rng) * spread))
  const y = Math.max(0, Math.min(floor.imageHeight, ap.y + gaussian(rng) * spread))
  return { x, y }
}

const randMac = (rng) => {
  const h = () => Math.floor(rng() * 256).toString(16).padStart(2, '0')
  return `${h()}:${h()}:${h()}:${h()}:${h()}:${h()}`.toUpperCase()
}

// Measured-vs-theoretical degradation (dB, ≥0 = measured is WORSE than the
// propagation model predicts). Real deployments lose signal the planner can't
// see: furniture, bodies, unmodelled walls, interference. We make it SPATIAL
// (quantise to a ~3m grid and seed off that cell) so nearby clients share the
// same environmental penalty — a coherent "dead zone", not per-client noise.
// Most cells lose a little (1–4 dB); a minority of "problem" cells lose a lot
// (10–18 dB) so the plan-vs-measured overlay has real gaps to surface. Pure
// function of (floorId, cellX, cellY) → reproducible.
function measuredDegradationDb(floorId, xM, yM) {
  const cx = Math.floor(xM / 3)
  const cy = Math.floor(yM / 3)
  const r = mulberry32(hashStringToSeed(`${floorId}:deg:${cx}:${cy}`))
  const roll = r()
  const base = 1 + r() * 3                     // 1–4 dB everywhere
  // ~38% "problem" cells model real dead spots (metal cabinet, lift shaft,
  // dense partition) with a HEAVY loss (22–40 dB) — big enough that even a
  // mid-range client there drops below the coverage threshold. The generous
  // proportion keeps the plan-vs-measured overlay reliably populated at busy
  // hours regardless of how the client-scatter rng stream lands.
  if (roll > 0.62) return base + 22 + r() * 18
  return base
}

// ── Single source of truth ─────────────────────────────────────────────────
// Build the AP↔switch↔port↔client topology for a floor at time `ts`, from a
// seed. `building` carries the same slice refs the stores hold (so getCachedRoutes
// hits its cache). Returns everything getSnapshot projects from.
export function deriveTopology(building, floorId, ts, seed = DEFAULT_SEED) {
  const floor = building.floors.find((f) => f.id === floorId)
  const aps = building.apsByFloor?.[floorId] ?? []
  const switches = building.switchesByFloor?.[floorId] ?? []
  const walls = building.wallsByFloor?.[floorId] ?? []

  const rng = mulberry32(hashStringToSeed(floorId) ^ seed)
  // Build the RF scenario WITHOUT scopes: the stats client association must run
  // over the whole floor regardless of any planning scope the user drew — the
  // stats domain (real devices) is decoupled from the planning scope mask, and
  // this also guarantees the stats mock never affects the planning heatmap.
  const scenario = floor ? buildScenario(floor, walls, aps, []) : null
  const pxToM = floor?.scale ? 1 / floor.scale : 1 / 40

  // AP → switch routing (reuse the shared cache; route.switchId is the link).
  const { routes } = getCachedRoutes(building)

  // Per-AP online status. An AP pins its status via `mockStatus`
  // ('online' | 'offline'); everything else is online. Keeping this
  // deterministic (no random flapping) means the demo always shows exactly the
  // pinned offline unit — stable for testing. When real cloud data arrives it
  // supplies the real status here instead.
  const apStatus = new Map()
  for (const ap of aps) {
    apStatus.set(ap.id, ap.mockStatus === 'offline' ? 'offline' : 'online')
  }

  // Client count target for the floor, scaled by time of day.
  const occ = occupancyFactor(ts)
  const onlineAps = aps.filter((a) => apStatus.get(a.id) === 'online')
  const baseClients = onlineAps.length * 14   // ~14 clients per AP at peak
  const targetClients = Math.round(baseClients * occ)

  // Scatter clients across the floor and associate each to its serving AP via
  // the real RF engine — so client.byAp is spatially coherent with the plan.
  const clients = []
  const onlineApIds = new Set(onlineAps.map((a) => a.id))
  if (scenario && scenario.aps.length && onlineAps.length) {
    for (let i = 0; i < targetClients; i++) {
      const pt = samplePoint(rng, floor, onlineAps)
      const rxM = { x: pt.x * pxToM, y: pt.y * pxToM }
      const device = CLIENT_DEVICE_LIST[Math.floor(rng() * CLIENT_DEVICE_LIST.length)]
      const { candidates } = buildCandidates(scenario, rxM, {
        device, sixGHzOn: true, wifi7On: true, linkDirection: 'down',
        clientTxDbm: device.txPowerDbm, clientHeightM: 1.2,
      })
      // Serving AP must be ONLINE — skip candidates on offline APs.
      const serving = candidates.find((c) => onlineApIds.has(c.ap.id))
      if (!serving) continue
      // Theoretical = what the propagation model predicts here; measured =
      // theoretical minus a spatial environmental penalty (the real-world loss
      // the plan can't see). The plan-vs-measured overlay compares these two.
      const theoretical = serving.rssiDbm
      const measured = theoretical - measuredDegradationDb(floorId, rxM.x, rxM.y)
      const linkMbps = Math.max(6, Math.round((measured + 90) * 12))
      clients.push({
        mac: randMac(rng),
        apId: serving.ap.id,
        x: pt.x, y: pt.y,
        rssiDbm: Math.round(measured),
        theoreticalRssiDbm: Math.round(theoretical),
        band: serving.ap.frequency,
        linkMbps,
        assocSince: ts - Math.floor(rng() * 3 * 3600 * 1000),
      })
    }
  }

  // Group clients per AP (INV-3 by construction).
  const clientsByAp = new Map()
  for (const c of clients) {
    if (!clientsByAp.has(c.apId)) clientsByAp.set(c.apId, [])
    clientsByAp.get(c.apId).push(c)
  }

  // AP → switch + LLDP port assignment (groupBy switchId, number ports 1..N).
  const apToSwitch = new Map()
  for (const ap of aps) {
    const r = routes.get(ap.id)
    if (r?.switchId) apToSwitch.set(ap.id, r.switchId)
  }
  const portBySwitch = new Map()   // swId → [{ port, deviceId }]
  for (const sw of switches) portBySwitch.set(sw.id, [])
  // Deterministic order: by AP id so port numbers are stable.
  const apsSorted = [...aps].sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const ap of apsSorted) {
    const swId = apToSwitch.get(ap.id)
    if (!swId || !portBySwitch.has(swId)) continue
    const list = portBySwitch.get(swId)
    list.push({ port: list.length + 1, deviceId: ap.id })
  }

  return {
    floor, aps, switches, scenario, pxToM,
    apStatus, clients, clientsByAp, apToSwitch, portBySwitch,
    ts, occ,
  }
}

// ── Snapshot projection (spec §1.2) ─────────────────────────────────────────
export function getSnapshot(building, floorId, { ts } = {}) {
  const now = ts ?? building.nowTs ?? DEFAULT_SEED * 1000 // caller passes a real ts; fallback stable
  const topo = deriveTopology(building, floorId, now)
  if (!topo.floor) return null
  const { aps, switches, apStatus, clientsByAp, clients, apToSwitch, portBySwitch } = topo

  // Per-AP snapshot.
  const perAp = aps.map((ap) => {
    const status = apStatus.get(ap.id)
    if (status === 'offline') {
      return {
        apId: ap.id, name: ap.name, clientCount: 0,
        radio: null, channelUtil: null, status: 'offline', band: ap.frequency,
      }
    }
    const list = clientsByAp.get(ap.id) ?? []
    const clientCount = list.length
    // Radio split: all clients are on this AP's band (single-radio AP model).
    const band = String(ap.frequency)
    const util = Math.min(1, clientCount / 25 + 0.05)
    const txbps = clientCount * 4_000_000
    const rxbps = clientCount * 1_500_000
    const radio = { '2.4': null, '5': null, '6': null }
    radio[band] = { clients: clientCount, util, txbps, rxbps }
    return {
      apId: ap.id, name: ap.name, clientCount,
      radio, channelUtil: util, status: 'online', band: ap.frequency,
    }
  })
  const apOnline = perAp.filter((a) => a.status === 'online').length

  // Per-switch snapshot: PoE watts + port usage from routing (reuse SwitchPanel
  // formula — Σ getAPPoeWattage over APs whose route lands here).
  const perSwitch = switches.map((sw) => {
    const neighbors = portBySwitch.get(sw.id) ?? []
    let poeWatts = 0
    for (const n of neighbors) {
      const ap = aps.find((a) => a.id === n.deviceId)
      if (ap && apStatus.get(ap.id) === 'online') poeWatts += getAPPoeWattage(ap)
    }
    const uplinkUsed = sw.uplinkTo ? 1 : 0
    const portsUp = neighbors.length + uplinkUsed
    const trafficBps = neighbors.reduce((s, n) => {
      const a = perAp.find((p) => p.apId === n.deviceId)
      return s + (a?.radio ? (a.radio[String(a.band)]?.txbps ?? 0) : 0)
    }, 0)
    return {
      swId: sw.id, name: sw.name, kind: sw.kind,
      portsUp, portsTotal: sw.portCount ?? 24,
      poeWatts: Math.round(poeWatts), poeBudget: sw.poeBudget ?? 0,
      trafficBps, neighbors, status: 'online',
    }
  })

  // Client aggregate.
  const byBand = { '2.4': 0, '5': 0, '6': 0 }
  const byAp = {}
  const rssiBins = {}   // binLowDbm → count, 5 dB bins
  for (const c of clients) {
    byBand[String(c.band)] = (byBand[String(c.band)] ?? 0) + 1
    byAp[c.apId] = (byAp[c.apId] ?? 0) + 1
    const bin = Math.floor(c.rssiDbm / 5) * 5
    rssiBins[bin] = (rssiBins[bin] ?? 0) + 1
  }
  const rssiHistogram = Object.keys(rssiBins)
    .map((k) => ({ binLowDbm: Number(k), count: rssiBins[k] }))
    .sort((a, b) => a.binLowDbm - b.binLowDbm)

  // Alerts (spec §1.2 alerts[]): offline APs, PoE overload, high channel util.
  const alerts = []
  for (const a of perAp) {
    if (a.status === 'offline') {
      alerts.push({ id: `off-${a.apId}`, severity: 'critical', kind: 'ap_offline', targetId: a.apId, ts: now, msg: `${a.name} 離線` })
    } else if (a.channelUtil != null && a.channelUtil > 0.8) {
      alerts.push({ id: `util-${a.apId}`, severity: 'warning', kind: 'high_util', targetId: a.apId, ts: now, msg: `${a.name} 頻道使用率 ${Math.round(a.channelUtil * 100)}%` })
    }
  }
  for (const s of perSwitch) {
    if (s.poeBudget > 0 && s.poeWatts > s.poeBudget) {
      alerts.push({ id: `poe-${s.swId}`, severity: 'critical', kind: 'poe_overload', targetId: s.swId, ts: now, msg: `${s.name} PoE 超載 ${s.poeWatts}/${s.poeBudget}W` })
    }
  }
  const sevRank = { critical: 0, warning: 1, info: 2 }
  alerts.sort((a, b) => (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3))

  return {
    ts: now,
    ap: { total: aps.length, online: apOnline, offline: aps.length - apOnline, perAp },
    switchStat: { total: switches.length, online: switches.length, offline: 0, perSwitch },
    client: { total: clients.length, byBand, byAp, rssiHistogram, list: clients },
    alerts,
  }
}

// ── Time series (spec §1.3, stage 3) ────────────────────────────────────────
// Sample a metric across `range` at `bucket` granularity. We just walk the
// range and run getSnapshot at each point — measured at ~2ms/point on the demo
// (5 AP), so a 24-point sweep is ~44ms, well within an idle useMemo. Because
// the trend uses the SAME getSnapshot the scrubber reads, the trend value at a
// given ts is bit-identical to the dashboard when the playhead sits there
// (spec §2 cross-time invariant, by construction). If AP counts ever grow
// enough to make this sweep janky, switch to a diurnal-curve estimate — the
// perf-family trigger, not needed at real single-floor scale.

const BUCKET_MS = { hour: 3600 * 1000, day: 24 * 3600 * 1000 }

// Pull a scalar metric value out of a snapshot.
function metricValue(snap, metric) {
  if (!snap) return null
  switch (metric) {
    case 'clientCount': return snap.client.total
    case 'poeWatts':    return snap.switchStat.perSwitch.reduce((s, x) => s + x.poeWatts, 0)
    case 'apLoadUtil': {
      const on = snap.ap.perAp.filter((a) => a.status === 'online' && a.channelUtil != null)
      if (on.length === 0) return 0
      return on.reduce((s, a) => s + a.channelUtil, 0) / on.length
    }
    case 'occupancy':   return snap.client.total   // raw head-count for now
    default:            return snap.client.total
  }
}

export function getTimeSeries(building, floorId, { metric = 'clientCount', range, bucket = 'hour' } = {}) {
  const step = BUCKET_MS[bucket] ?? BUCKET_MS.hour
  if (!range || range.from == null || range.to == null) return { metric, range, bucket, points: [], byEntity: [] }
  if (range.from > range.to) throw new Error('getTimeSeries: range.from > range.to')

  const points = []
  // Inclusive of both ends; align to the step from `to` backward so the last
  // point is exactly the live edge.
  for (let t = range.to; t >= range.from; t -= step) {
    const snap = getSnapshot(building, floorId, { ts: t })
    points.push({ ts: t, value: metricValue(snap, metric) })
  }
  points.reverse()   // ascending time
  return { metric, range, bucket, points, byEntity: [] }
}
