// Stage 3 routing — pick the shortest cable path for each AP.
// Spec: .claude/cable-spec.md §6 / §7.
//
// Priority for each AP:
//   1. Graph route via Cable Tray (Dijkstra on the §5 graph). Edge weights are
//      meters with slackTray=0.10 along trays and slackDirect=0.20 on drops.
//   2. Fallback Manhattan to nearest SAME-FLOOR Switch (slackDirect=0.20 too).
//   3. No same-floor Switch at all → `unroutable` (red exclamation badge).
//
// `Z_drop(AP) = (floor.floorHeight - ap.z)` always added to the final cable
// length, never slacked. Z drop is just a straight vertical run; the graph
// path or Manhattan path is the in-plane horizontal cabling.

import { buildFloorGraph, SLACK_DIRECT } from './buildGraph'
import { unionFind, dijkstra, reconstructPath } from './routing'

// Returns Map<apId, route> where route is:
//   { apId, switchId|null, points: [{x,y},...]|null,
//     cableM|null, zDropM|null, routeStatus }
//   routeStatus ∈ 'tray' | 'fallback-manhattan' | 'unroutable'
export function computeRoutes({ floor, aps, switches, trays = [] }) {
  const out = new Map()
  if (!floor || !aps || aps.length === 0) return out

  const pxPerM        = floor.scale
  const ceilingHeight = floor.floorHeight ?? 3.0

  // Build the per-floor graph (includes endpoint nodes even when no trays).
  const g = buildFloorGraph({ floor, aps, switches, trays })

  // Connected components — lets us skip the (expensive) Dijkstra entirely
  // when no switches share a component with this AP. With no trays, every
  // node is its own component, so this short-circuit always fires.
  const uf = unionFind([...g.nodes.keys()], g.adj)

  for (const ap of aps) {
    const zDropM = Math.max(0, ceilingHeight - (ap.z ?? 0))

    // ── Path 1: graph route ──────────────────────────────────────────────
    const apNodeId = g.endpointNodeIds.aps.get(ap.id)?.nodeId
    if (apNodeId && switches.length > 0) {
      const apRoot = uf.find(apNodeId)
      // Collect switches whose endpoint node is in the same component.
      const reachable = []
      for (const sw of switches) {
        const swNodeId = g.endpointNodeIds.switches.get(sw.id)?.nodeId
        if (swNodeId && uf.find(swNodeId) === apRoot) {
          reachable.push({ sw, swNodeId })
        }
      }
      if (reachable.length > 0) {
        const { dist, prev } = dijkstra(g.adj, apNodeId)
        let bestSwitch = null, bestSwNode = null, bestDist = Infinity
        for (const r of reachable) {
          const d = dist.get(r.swNodeId) ?? Infinity
          if (d < bestDist) { bestDist = d; bestSwitch = r.sw; bestSwNode = r.swNodeId }
        }
        if (bestSwitch && bestDist !== Infinity) {
          const nodePath = reconstructPath(prev, apNodeId, bestSwNode) ?? [apNodeId, bestSwNode]
          const points = nodePath.map((id) => {
            const n = g.nodes.get(id)
            return { x: n.xy.x, y: n.xy.y, kind: n.kind }
          })
          out.set(ap.id, {
            apId: ap.id,
            switchId: bestSwitch.id,
            points,
            cableM: bestDist + zDropM,
            zDropM,
            routeStatus: 'tray',
          })
          continue
        }
      }
    }

    // ── Path 2 / 3: fallback Manhattan or unroutable ─────────────────────
    if (switches.length === 0) {
      out.set(ap.id, {
        apId: ap.id, switchId: null, points: null,
        cableM: null, zDropM: null,
        routeStatus: 'unroutable',
      })
      continue
    }

    // Nearest same-floor switch by Manhattan distance.
    let best = switches[0]
    let bestD = Math.abs(ap.x - best.x) + Math.abs(ap.y - best.y)
    for (let i = 1; i < switches.length; i++) {
      const d = Math.abs(ap.x - switches[i].x) + Math.abs(ap.y - switches[i].y)
      if (d < bestD) { bestD = d; best = switches[i] }
    }
    const cableM = pxPerM && pxPerM > 0
      ? (bestD / pxPerM) * (1 + SLACK_DIRECT) + zDropM
      : null

    out.set(ap.id, {
      apId: ap.id,
      switchId: best.id,
      points: [
        { x: ap.x, y: ap.y },
        { x: best.x, y: ap.y },
        { x: best.x, y: best.y },
      ],
      cableM,
      zDropM,
      routeStatus: 'fallback-manhattan',
    })
  }

  return out
}
