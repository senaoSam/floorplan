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

// 14-3: Cat 6 spec — beyond ~90 m copper is impractical and the run jumps
// to fiber. Duplicated from useCableStore.COPPER_MAX_LENGTH_M to keep this
// module store-free for ease of testing.
const COPPER_MAX_LENGTH_M = 90

// Returns { routes, switchLinks, warnings }:
//   routes:   Map<apId, route> across ALL floors (see route shape below).
//   switchLinks: Map<srcSwId, link> for switch→switch uplinks (14-2).
//   warnings: string[] from buildBuildingGraph (tray-tray touching, etc.)
//
// AP route shape:
//   { apId, switchId|null, points: [{x,y,kind,floorId},...]|null,
//     cableM|null, zDropM|null, routeStatus, homeFloorId }
//   routeStatus ∈ 'tray' | 'fallback-manhattan' | 'unroutable'
//
// Switch link shape:
//   { srcId, targetId, points, cableM, routeStatus, cableType,
//     srcFloorId, targetFloorId }
//   cableType ∈ 'copper' | 'fiber' — auto-resolved from sw.cableType + length
//
// Building-wide because risers let an AP reach a switch on another floor
// (spec §6 "graph route 含跨樓層 riser"). Callers that only care about a
// single floor (CableLayer, SwitchPanel) can filter by route.homeFloorId
// or by point.floorId.
export function computeRoutes({ floors = [], apsByFloor = {}, switchesByFloor = {}, traysByFloor = {}, risers = [] }) {
  const out = new Map()
  const switchLinks = new Map()
  if (floors.length === 0) return { routes: out, switchLinks, warnings: [] }

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

  // ── Switch-to-switch links (14-2) ──────────────────────────────────────
  // Same graph + Dijkstra recipe as AP→switch; only the source/target node
  // pair changes. No Z drop (both endpoints already at mount height).
  const swByFloor = new Map()  // swId → floorId
  for (const [floorId, list] of Object.entries(switchesByFloor)) {
    for (const sw of list ?? []) swByFloor.set(sw.id, floorId)
  }
  const swById = new Map()
  for (const list of Object.values(switchesByFloor)) {
    for (const sw of list ?? []) swById.set(sw.id, sw)
  }

  for (const [srcId, sw] of swById) {
    const targetId = sw.uplinkTo
    if (!targetId) continue
    const target = swById.get(targetId)
    if (!target) continue                  // dangling reference

    const srcFloorId    = swByFloor.get(srcId)
    const targetFloorId = swByFloor.get(targetId)
    const srcNodeId     = g.endpointNodeIds.switches.get(srcId)?.nodeId
    const tgtNodeId     = g.endpointNodeIds.switches.get(targetId)?.nodeId

    let link = null
    if (srcNodeId && tgtNodeId && uf.find(srcNodeId) === uf.find(tgtNodeId)) {
      const { dist, prev } = dijkstra(g.adj, srcNodeId)
      const d = dist.get(tgtNodeId)
      if (d !== undefined && d !== Infinity) {
        const nodePath = reconstructPath(prev, srcNodeId, tgtNodeId) ?? [srcNodeId, tgtNodeId]
        const points = nodePath.map((id) => {
          const n = g.nodes.get(id)
          return { x: n.xy.x, y: n.xy.y, kind: n.kind, floorId: n.floorId }
        })
        link = {
          srcId, targetId, points,
          cableM: d, routeStatus: 'tray',
          srcFloorId, targetFloorId,
        }
      }
    }

    // Fallback Manhattan — same floor only (spec §6 applies to S2S too).
    if (!link && srcFloorId === targetFloorId) {
      const floor = floorById.get(srcFloorId)
      const pxPerM = floor?.scale
      const dPx = Math.abs(sw.x - target.x) + Math.abs(sw.y - target.y)
      const cableM = pxPerM && pxPerM > 0
        ? (dPx / pxPerM) * (1 + SLACK_DIRECT)
        : null
      link = {
        srcId, targetId,
        points: [
          { x: sw.x,     y: sw.y,     kind: 'endpoint', floorId: srcFloorId },
          { x: target.x, y: sw.y,     kind: 'corner',   floorId: srcFloorId },
          { x: target.x, y: target.y, kind: 'endpoint', floorId: srcFloorId },
        ],
        cableM, routeStatus: 'fallback-manhattan',
        srcFloorId, targetFloorId,
      }
    }

    if (!link) {
      link = {
        srcId, targetId, points: null, cableM: null,
        routeStatus: 'unroutable',
        srcFloorId, targetFloorId,
      }
    }

    // Resolve copper/fiber per spec — auto picks copper unless length pushes
    // beyond Cat 6's 90 m limit. User override always wins.
    const pref = sw.cableType ?? 'auto'
    link.cableType = pref === 'auto'
      ? (link.cableM != null && link.cableM >= COPPER_MAX_LENGTH_M ? 'fiber' : 'copper')
      : pref

    switchLinks.set(srcId, link)
  }

  return { routes: out, switchLinks, warnings: g.warnings ?? [] }
}
