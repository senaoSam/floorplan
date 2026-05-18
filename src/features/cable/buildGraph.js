// Cable graph builder — implements Steps 1, 3, 4, 5, 7 of cable-spec §5.
// (Steps 2 / 6 / 10 are for risers and land in Phase 12-3.)
//
// Input: { floor, aps, switches, trays } — single-floor data.
// Output: a graph (nodes + adjacency) ready for Dijkstra (Phase 12-2b).
//
// Key invariants from spec:
//   - Endpoints (AP / Switch / IDF / MDF / Router) snap to AT MOST ONE tray
//     (the nearest within tray.magnetDistance). Otherwise the endpoint would
//     become an invisible bridge between disjoint trays.
//   - Two trays share a node ONLY at proper geometric intersections. Coords
//     that happen to coincide aren't deduped (cable-spec §10).
//   - Edge weights along a tray use chainage difference, NOT euclidean — at
//     a tray-cross node + tray-vertex node sitting at the same (x,y) the
//     euclidean distance would be 0, but the chainage difference is the real
//     arc length between them.
//   - All weights are meters: `chainage_px / scale_pxPerM × (1 + slack)`.

import { cumulativeLengths, closestPointOnPolyline, segmentIntersection } from './geometry'

export const SLACK_TRAY            = 0.10  // along-tray edges
export const SLACK_DIRECT          = 0.20  // endpoint→foot drop, fallback Manhattan
export const SLACK_RISER_VERTICAL  = 0.00  // cross-floor riser hops (spec §7: 0–5%)

// Node kinds
//   'endpoint'      — AP / Switch / IDF / MDF / Router (Step 1)
//   'tray-vertex'   — original polyline vertex (Step 3)
//   'tray-cross'   — intersection of two trays (Step 4)
//   'endpoint-foot' — foot of perpendicular from an endpoint onto a tray (Step 5)
//   'riser@floor'   — riser node bound to a floor (Step 2 / 12-3a, not built here)
//   'riser-foot'    — riser snap foot on a tray (Step 6 / 12-3b, not built here)

function makeIdGen(prefix) {
  let n = 0
  return () => `${prefix}-${++n}`
}

// Builds a graph for ONE floor. Riser vertical edges live above this layer
// (see buildBuildingGraph) because Step 10 by definition spans floors.
// Returns:
//   {
//     nodes: Map<id, { id, kind, floorId, xy, ref? }>,
//     adj:   Map<id, [{ to, weightM, kind }]>,
//     endpointNodeIds: {
//       aps:      Map<apId, { nodeId, snapInfo|null }>,
//       switches: Map<swId, { nodeId, snapInfo|null }>,
//       risers:   Map<riserId, { nodeId, snapInfos }>,
//     },
//     warnings: string[],
//   }
// snapInfo === null means the endpoint isn't connected to any tray and must
// rely on fallback Manhattan in Stage 3.
//
// `risers` here is the list visible on THIS floor (caller filters by
// floorIds.includes(floor.id)). Step 10 cross-floor edges are added by the
// building-level wrapper.
export function buildFloorGraph({ floor, aps, switches, trays, risers = [] }) {
  const floorId  = floor.id
  const pxPerM   = floor.scale          // null until the scale is calibrated
  const nextNode = makeIdGen(`n${floorId}`)
  const nodes    = new Map()
  const adj      = new Map()
  const warnings = []

  const addNode = (data) => {
    const id = nextNode()
    nodes.set(id, { id, ...data, floorId })
    adj.set(id, [])
    return id
  }
  const addEdge = (a, b, weightM, kind) => {
    adj.get(a).push({ to: b, weightM, kind })
    adj.get(b).push({ to: a, weightM, kind })
  }

  // ── Step 3: tray vertices → graph nodes + anchor list ────────────────────
  // Each anchor: { chain, nodeId, kind }. Sorted by chain at Step 7 to lay
  // tray-internal edges. Chainage is the cumulative distance from points[0].
  //
  // 12-2d: Reuse the same nodeId when two trays share a vertex at the EXACT
  // same xy. This handles "user drew separate trays that touch at endpoints"
  // (the canvas already provides a snap UI that produces exact-equal coords).
  // We only fold when xy is strictly `===` — spec §10 still rejects "almost
  // touching" cases to keep topology stable under small position changes.
  const vertexByXY = new Map()  // key: `${x}|${y}` → nodeId
  const trayMeta = trays.map((t) => {
    const cum = cumulativeLengths(t.points)
    const anchors = t.points.map((v, i) => {
      const key = `${v.x}|${v.y}`
      let nodeId = vertexByXY.get(key)
      if (!nodeId) {
        nodeId = addNode({ kind: 'tray-vertex', xy: { x: v.x, y: v.y } })
        vertexByXY.set(key, nodeId)
      }
      return { chain: cum[i], nodeId, kind: 'vertex' }
    })
    return { tray: t, cum, anchors }
  })

  // ── Step 4: tray-tray intersection → shared cross node ──────────────────
  // Only proper geometric crossings (not coincident endpoints, not collinear
  // overlap). Touching cases get a warning so the user can clean up.
  for (let i = 0; i < trayMeta.length; i++) {
    const A = trayMeta[i]
    for (let j = i + 1; j < trayMeta.length; j++) {
      const B = trayMeta[j]
      for (let a = 0; a < A.tray.points.length - 1; a++) {
        for (let b = 0; b < B.tray.points.length - 1; b++) {
          const hit = segmentIntersection(
            A.tray.points[a], A.tray.points[a + 1],
            B.tray.points[b], B.tray.points[b + 1],
          )
          if (!hit) continue
          if (hit.touching) {
            warnings.push(
              `Trays ${A.tray.id} and ${B.tray.id} touch at endpoint near (${hit.x.toFixed(1)}, ${hit.y.toFixed(1)}); not auto-merged.`,
            )
            continue
          }
          const crossId = addNode({ kind: 'tray-cross', xy: { x: hit.x, y: hit.y } })
          // chainage on A = cum[a] + t × segLen
          const segLenA = A.cum[a + 1] - A.cum[a]
          const segLenB = B.cum[b + 1] - B.cum[b]
          A.anchors.push({ chain: A.cum[a] + hit.t * segLenA, nodeId: crossId, kind: 'cross' })
          B.anchors.push({ chain: B.cum[b] + hit.u * segLenB, nodeId: crossId, kind: 'cross' })
        }
      }
    }
  }

  // ── Step 1: endpoint nodes (AP + Switch) ─────────────────────────────────
  const apEntries = new Map()
  for (const ap of aps) {
    const nodeId = addNode({
      kind: 'endpoint',
      xy: { x: ap.x, y: ap.y },
      ref: { type: 'ap', id: ap.id },
    })
    apEntries.set(ap.id, { nodeId, snapInfo: null })
  }
  const swEntries = new Map()
  for (const sw of switches) {
    const nodeId = addNode({
      kind: 'endpoint',
      xy: { x: sw.x, y: sw.y },
      ref: { type: 'switch', id: sw.id },
    })
    swEntries.set(sw.id, { nodeId, snapInfo: null })
  }

  // ── Step 2: riser@floor nodes for risers visible on this floor ───────────
  const riserEntries = new Map()
  for (const r of risers) {
    const nodeId = addNode({
      kind: 'riser@floor',
      xy: { x: r.x, y: r.y },
      ref: { type: 'riser', id: r.id },
    })
    riserEntries.set(r.id, { nodeId, snapInfos: [] })
  }

  // ── Step 5: endpoint snap — only the nearest tray within magnetDistance ──
  const snapEndpoint = (xy, entry) => {
    let best = null
    for (const meta of trayMeta) {
      const c = closestPointOnPolyline(xy, meta.tray.points, meta.cum)
      const magnet = meta.tray.magnetDistance ?? 100
      if (c.d > magnet) continue
      // best is shaped { meta, c }; compare against best.c.d, not best.d
      // (a long-hidden bug — only surfaced once multi-polyline trays were
      // common after 12-2d's vertex merge made them practical).
      if (!best || c.d < best.c.d) best = { meta, c }
    }
    if (!best) return
    const footId = addNode({ kind: 'endpoint-foot', xy: { x: best.c.foot.x, y: best.c.foot.y } })
    best.meta.anchors.push({ chain: best.c.chain, nodeId: footId, kind: 'endpoint-foot' })
    entry.snapInfo = { footNodeId: footId, dropPx: best.d ?? best.c.d, trayId: best.meta.tray.id }
    // Drop edge (endpoint → foot): straight perpendicular drop, slackDirect.
    if (pxPerM && pxPerM > 0) {
      const weightM = (best.c.d / pxPerM) * (1 + SLACK_DIRECT)
      addEdge(entry.nodeId, footId, weightM, 'drop')
    } else {
      addEdge(entry.nodeId, footId, 0, 'drop')  // unscaled — caller must check
    }
  }
  for (const ap of aps) snapEndpoint({ x: ap.x, y: ap.y }, apEntries.get(ap.id))
  for (const sw of switches) snapEndpoint({ x: sw.x, y: sw.y }, swEntries.get(sw.id))

  // ── Step 6 + 9: riser snap — attach to ALL trays whose magnet contains
  // the riser xy (unlike endpoints, risers are hubs). For each match, add a
  // foot anchor on the tray and a 'riser-drop' edge from riser@floor → foot.
  for (const r of risers) {
    const entry = riserEntries.get(r.id)
    if (!entry) continue
    const riserMagnet = r.magnetDistance ?? 100
    for (const meta of trayMeta) {
      const c = closestPointOnPolyline({ x: r.x, y: r.y }, meta.tray.points, meta.cum)
      const trayMagnet = meta.tray.magnetDistance ?? 100
      // Use the smaller of the two magnets so neither side overreaches its
      // intended pull range. Spec doesn't pin this; smaller side wins keeps
      // both authors' intent honoured.
      const magnet = Math.min(riserMagnet, trayMagnet)
      if (c.d > magnet) continue
      const footId = addNode({ kind: 'riser-foot', xy: { x: c.foot.x, y: c.foot.y } })
      meta.anchors.push({ chain: c.chain, nodeId: footId, kind: 'riser-foot' })
      entry.snapInfos.push({ footNodeId: footId, dropPx: c.d, trayId: meta.tray.id })
      if (pxPerM && pxPerM > 0) {
        const weightM = (c.d / pxPerM) * (1 + SLACK_DIRECT)
        addEdge(entry.nodeId, footId, weightM, 'riser-drop')
      } else {
        addEdge(entry.nodeId, footId, 0, 'riser-drop')
      }
    }
  }

  // ── Step 7: sort each tray's anchors and add adjacent edges (chainage-based)
  // Zero-length edges (two anchors at the same chainage — e.g. an endpoint-foot
  // landing exactly on a tray-vertex) MUST still be added with weight 0,
  // otherwise the coincident anchors are graph-disconnected and Dijkstra can't
  // reach the endpoint via the tray.
  for (const meta of trayMeta) {
    meta.anchors.sort((a, b) => a.chain - b.chain)
    for (let i = 0; i < meta.anchors.length - 1; i++) {
      const A = meta.anchors[i]
      const B = meta.anchors[i + 1]
      const chainPx = Math.abs(B.chain - A.chain)
      const weightM = pxPerM && pxPerM > 0
        ? (chainPx / pxPerM) * (1 + SLACK_TRAY)
        : 0
      addEdge(A.nodeId, B.nodeId, weightM, 'tray')
    }
  }

  return {
    nodes,
    adj,
    endpointNodeIds: { aps: apEntries, switches: swEntries, risers: riserEntries },
    warnings,
  }
}

// ── Step 10 wrapper: per-floor graphs stitched by vertical riser edges ───
// Caller passes building-wide data; we delegate per-floor build to
// buildFloorGraph and then add cross-floor edges between each riser's
// adjacent (by elevation) floor nodes. Output shape mirrors the per-floor
// graph but spans the whole building.
export function buildBuildingGraph({ floors, apsByFloor = {}, switchesByFloor = {}, traysByFloor = {}, risers = [] }) {
  const nodes = new Map()
  const adj   = new Map()
  const apEndpoints     = new Map()
  const switchEndpoints = new Map()
  const warnings = []
  // riserId → ordered list of { floorId, nodeId, elevation }
  const riserFloorNodes = new Map()

  for (const floor of floors) {
    const floorRisers = risers.filter((r) => (r.floorIds ?? []).includes(floor.id))
    const g = buildFloorGraph({
      floor,
      aps:      apsByFloor[floor.id]      ?? [],
      switches: switchesByFloor[floor.id] ?? [],
      trays:    traysByFloor[floor.id]    ?? [],
      risers:   floorRisers,
    })
    for (const [id, node] of g.nodes) nodes.set(id, node)
    for (const [id, edges] of g.adj)   adj.set(id, edges)
    for (const [apId, info]    of g.endpointNodeIds.aps)      apEndpoints.set(apId, { ...info, floorId: floor.id })
    for (const [swId, info]    of g.endpointNodeIds.switches) switchEndpoints.set(swId, { ...info, floorId: floor.id })
    for (const [riserId, info] of g.endpointNodeIds.risers) {
      if (!riserFloorNodes.has(riserId)) riserFloorNodes.set(riserId, [])
      riserFloorNodes.get(riserId).push({
        floorId: floor.id,
        nodeId: info.nodeId,
        elevation: floor.elevation ?? 0,
      })
    }
    warnings.push(...g.warnings)
  }

  // Step 10 — connect each riser's adjacent floors. We sort by elevation so
  // a 3-floor riser yields edges (F1↔F2) + (F2↔F3) only (not F1↔F3 — that
  // would bypass the intermediate floor). dz is already meters.
  for (const entries of riserFloorNodes.values()) {
    entries.sort((a, b) => a.elevation - b.elevation)
    for (let i = 0; i < entries.length - 1; i++) {
      const A = entries[i], B = entries[i + 1]
      const dz = Math.abs(B.elevation - A.elevation)
      const weightM = dz * (1 + SLACK_RISER_VERTICAL)
      adj.get(A.nodeId).push({ to: B.nodeId, weightM, kind: 'riser-vertical' })
      adj.get(B.nodeId).push({ to: A.nodeId, weightM, kind: 'riser-vertical' })
    }
  }

  return {
    nodes,
    adj,
    endpointNodeIds: { aps: apEndpoints, switches: switchEndpoints },
    riserFloorNodes,
    warnings,
  }
}
