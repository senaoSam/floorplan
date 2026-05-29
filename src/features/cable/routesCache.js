import { computeRoutes, buildRoutingContext, routeOneAP } from './computeRoutes'
import { probeCache } from './perfProbe'

// 32-E shared routes cache. computeRoutes is a building-wide Dijkstra pass —
// at 300 AP + a spanning tray it costs ~150–800 ms. Several consumers call it
// on the SAME inputs:
//   - apsLayer.recomputeFocus / switchesLayer.recomputeFocus (focus halo set)
//   - APPanel / SwitchPanel / CableSummaryPanel / CableTrayPanel (readouts)
// Selecting one AP used to trigger TWO full computeRoutes (aps + switches
// focus), ~1.6–3.8 s of jank — even though selection changes no route geometry.
//
// Two-level reuse:
//  1. Reference memo — when every routing-relevant store slice is identity-
//     equal to last time (selection / hover / viewport changed nothing routing-
//     relevant), return the cached result with zero work.
//  2. Incremental — when ONLY a few APs changed objects (a drag-commit / single
//     AP edit) and the tray / switch / riser / floor graph is identity-equal,
//     reroute just those APs (~1 ms each) instead of a full building Dijkstra
//     (~400–600 ms at 300 AP + a spanning tray — the "放下卡一下" on software
//     renderers). Falls back to full when topology or the AP set changed.

let last = null  // { building, result }

const MAX_INCREMENTAL_APS = 4

function topologyUnchanged(a, b) {
  return a.floors === b.floors &&
    a.switchesByFloor === b.switchesByFloor &&
    a.traysByFloor === b.traysByFloor &&
    a.risers === b.risers
}

// Returns the changed AP descriptors [{ ap, floorId }] when an incremental
// update is safe, or null to force a full recompute.
function changedAPs(prev, cur) {
  const prevByFloor = prev.apsByFloor
  const curByFloor = cur.apsByFloor
  const prevFloors = Object.keys(prevByFloor)
  const curFloors = Object.keys(curByFloor)
  if (prevFloors.length !== curFloors.length) return null
  const changed = []
  for (const floorId of curFloors) {
    const prevList = prevByFloor[floorId]
    const curList = curByFloor[floorId]
    if (!prevList || prevList.length !== curList.length) return null  // add/remove → full
    if (prevList === curList) continue                                // floor untouched
    const prevById = new Map(prevList.map((a) => [a.id, a]))
    for (const ap of curList) {
      const p = prevById.get(ap.id)
      if (p === undefined) return null   // id set changed → full
      if (p !== ap) changed.push({ ap, floorId })
      if (changed.length > MAX_INCREMENTAL_APS) return null
    }
  }
  return changed
}

// Returns { routes, switchLinks, warnings } for `building`, reusing / patching
// the last result when possible. `building` must carry the same slice refs the
// stores hold (don't spread/clone the inner maps, or every call misses).
export function getCachedRoutes(building) {
  if (last) {
    const b = last.building
    if (
      b.floors === building.floors &&
      b.apsByFloor === building.apsByFloor &&
      topologyUnchanged(b, building)
    ) {
      probeCache(true)
      return last.result
    }
    // Incremental: same graph, only a few APs changed → reroute those.
    if (topologyUnchanged(b, building) && b.floors === building.floors) {
      const changed = changedAPs(b, building)
      if (changed && changed.length <= MAX_INCREMENTAL_APS) {
        probeCache(true)
        const ctx = buildRoutingContext(building)
        const routes = new Map(last.result.routes)
        for (const { ap, floorId } of changed) {
          routes.set(ap.id, routeOneAP(ctx, ap, floorId))
        }
        const result = { ...last.result, routes }
        last = { building, result }
        return result
      }
    }
  }
  probeCache(false)
  const result = computeRoutes(building)
  last = { building, result }
  return result
}

// Drop the memo (e.g. on teardown) so a stale result can't be served to a
// freshly-mounted scene.
export function clearRoutesCache() {
  last = null
}
