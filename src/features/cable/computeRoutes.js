// Stage 3 routing — pick the shortest cable path for each AP across the
// whole building. Spec: .claude/cable-spec.md §6 / §7.
//
// Priority for each AP:
//   1. Graph route via Cable Tray / Riser. Edge weights are meters; tray
//      slack 0.10, endpoint/riser drop 0.20, riser vertical 0.00–0.05.
//      Can cross floors via risers.
//   2. Fallback Manhattan to nearest SAME-FLOOR Switch (slackDirect=0.20).
//   3. No same-floor Switch at all → `unroutable` (red exclamation badge).
//
// `Z_drop(AP) = (floor.floorHeight - ap.z)` always added to the final cable
// length, never slacked. The graph route handles the in-plane horizontal
// cabling; Z drop is the straight vertical run from ceiling to the AP body.

import { buildBuildingGraph, SLACK_DIRECT } from './buildGraph'
import { unionFind, dijkstra, reconstructPath } from './routing'

// Returns Map<apId, route> across ALL floors. Route shape:
//   { apId, switchId|null, points: [{x,y,kind,floorId},...]|null,
//     cableM|null, zDropM|null, routeStatus, homeFloorId }
//   routeStatus ∈ 'tray' | 'fallback-manhattan' | 'unroutable'
//
// Building-wide because risers let an AP reach a switch on another floor
// (spec §6 "graph route 含跨樓層 riser"). Callers that only care about a
// single floor (CableLayer, SwitchPanel) can filter by route.homeFloorId
// or by point.floorId.
export function computeRoutes({ floors = [], apsByFloor = {}, switchesByFloor = {}, traysByFloor = {}, risers = [] }) {
  const out = new Map()
  if (floors.length === 0) return out

  const floorById = new Map(floors.map((f) => [f.id, f]))

  // Build the single building-wide graph.
  const g = buildBuildingGraph({ floors, apsByFloor, switchesByFloor, traysByFloor, risers })

  // Flatten all switches into one list with floor reference for fallback +
  // unroutable checks below.
  const allSwitches = []
  for (const [floorId, list] of Object.entries(switchesByFloor)) {
    for (const sw of list ?? []) allSwitches.push({ sw, floorId })
  }

  // Component map — lets us skip Dijkstra when AP and switches share no
  // graph component (e.g. no trays / risers at all — every node is alone).
  const uf = unionFind([...g.nodes.keys()], g.adj)

  for (const [floorId, list] of Object.entries(apsByFloor)) {
    const floor = floorById.get(floorId)
    if (!floor) continue
    const ceilingHeight = floor.floorHeight ?? 3.0
    const pxPerM        = floor.scale

    for (const ap of list ?? []) {
      const zDropM = Math.max(0, ceilingHeight - (ap.z ?? 0))

      // ── Path 1: building-wide graph route ───────────────────────────────
      const apNodeId = g.endpointNodeIds.aps.get(ap.id)?.nodeId
      if (apNodeId && allSwitches.length > 0) {
        const apRoot = uf.find(apNodeId)
        const reachable = []
        for (const { sw, floorId: swFloorId } of allSwitches) {
          const swNodeId = g.endpointNodeIds.switches.get(sw.id)?.nodeId
          if (swNodeId && uf.find(swNodeId) === apRoot) {
            reachable.push({ sw, swNodeId, swFloorId })
          }
        }
        if (reachable.length > 0) {
          const { dist, prev } = dijkstra(g.adj, apNodeId)
          let bestSw = null, bestSwNode = null, bestDist = Infinity
          for (const r of reachable) {
            const d = dist.get(r.swNodeId) ?? Infinity
            if (d < bestDist) { bestDist = d; bestSw = r.sw; bestSwNode = r.swNodeId }
          }
          if (bestSw && bestDist !== Infinity) {
            const nodePath = reconstructPath(prev, apNodeId, bestSwNode) ?? [apNodeId, bestSwNode]
            const points = nodePath.map((id) => {
              const n = g.nodes.get(id)
              return { x: n.xy.x, y: n.xy.y, kind: n.kind, floorId: n.floorId }
            })
            out.set(ap.id, {
              apId: ap.id,
              switchId: bestSw.id,
              points,
              cableM: bestDist + zDropM,
              zDropM,
              routeStatus: 'tray',
              homeFloorId: floorId,
            })
            continue
          }
        }
      }

      // ── Path 2 / 3: fallback Manhattan or unroutable ─────────────────────
      // Fallback is strictly same-floor (spec §6).
      const sameFloorSwitches = (switchesByFloor[floorId] ?? [])
      if (sameFloorSwitches.length === 0) {
        out.set(ap.id, {
          apId: ap.id, switchId: null, points: null,
          cableM: null, zDropM: null,
          routeStatus: 'unroutable',
          homeFloorId: floorId,
        })
        continue
      }

      let best = sameFloorSwitches[0]
      let bestD = Math.abs(ap.x - best.x) + Math.abs(ap.y - best.y)
      for (let i = 1; i < sameFloorSwitches.length; i++) {
        const d = Math.abs(ap.x - sameFloorSwitches[i].x) + Math.abs(ap.y - sameFloorSwitches[i].y)
        if (d < bestD) { bestD = d; best = sameFloorSwitches[i] }
      }
      const cableM = pxPerM && pxPerM > 0
        ? (bestD / pxPerM) * (1 + SLACK_DIRECT) + zDropM
        : null

      out.set(ap.id, {
        apId: ap.id,
        switchId: best.id,
        points: [
          { x: ap.x,    y: ap.y,    kind: 'endpoint', floorId },
          { x: best.x,  y: ap.y,    kind: 'corner',   floorId },
          { x: best.x,  y: best.y,  kind: 'endpoint', floorId },
        ],
        cableM,
        zDropM,
        routeStatus: 'fallback-manhattan',
        homeFloorId: floorId,
      })
    }
  }

  return out
}
