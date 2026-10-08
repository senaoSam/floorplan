// 57-33 / 57-34: do two APs hear each other? The engine's AP-to-AP RSSI
// (direct path; walls, slabs, antenna pattern, EIRP-capped TX), the louder of
// the two directions, at or above the scenario's min interfering RSSI -- the
// rule the heatmap's SINR / CCI and Client View use for interference.
import { rssiFromAp } from './propagation'
import { DEFAULT_MIN_INTERFERING_RSSI_DBM } from './rfConstants'

export function apToApRssiDbm(scenario, a, b) {
  const opts = { maxReflOrder: 0, enableDiffraction: false, floorBoundaries: scenario.floorBoundaries ?? null }
  const hear = (from, to) => rssiFromAp(from, { x: to.pos.x, y: to.pos.y, zM: to.zM ?? 0 },
    scenario.walls, scenario.corners, opts).rssiDbm
  return Math.max(hear(a, b), hear(b, a))
}

// Returns (apA, apB) => boolean keyed by AP id (scenario entries looked up by
// id; unknown ids never hear each other). Pairs are cached.
export function makeApHearingFn(scenario) {
  const thr = scenario.rf?.minInterfDbm ?? DEFAULT_MIN_INTERFERING_RSSI_DBM
  const byId = new Map(scenario.aps.map((e) => [e.id, e]))
  const cache = new Map()
  return (apA, apB) => {
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
}
