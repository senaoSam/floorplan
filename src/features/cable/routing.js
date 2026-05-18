// Stage 3 routing primitives — Union-Find + Dijkstra.
// Used by computeRoutes.js to pick the shortest path for each AP through the
// cable graph built in 12-2a.

// Union-Find with path compression + union by rank.
// Built from a node-id list + adjacency map.
export function unionFind(nodeIds, adj) {
  const parent = new Map()
  const rank   = new Map()
  for (const id of nodeIds) { parent.set(id, id); rank.set(id, 0) }

  const find = (x) => {
    // Walk up the chain, compressing as we go.
    while (parent.get(x) !== x) {
      const p = parent.get(x)
      parent.set(x, parent.get(p))
      x = parent.get(x)
    }
    return x
  }
  const union = (a, b) => {
    const ra = find(a), rb = find(b)
    if (ra === rb) return
    const da = rank.get(ra), db = rank.get(rb)
    if (da < db) parent.set(ra, rb)
    else if (da > db) parent.set(rb, ra)
    else { parent.set(rb, ra); rank.set(ra, da + 1) }
  }

  for (const [u, edges] of adj) {
    for (const e of edges) union(u, e.to)
  }
  return { find }
}

// Single-source shortest path. Array-based priority queue (sort each pop) —
// adequate for the graph sizes we deal with (< 1000 nodes). Returns:
//   { dist: Map<id, m>, prev: Map<id, parentId> }
export function dijkstra(adj, source) {
  const dist = new Map()
  const prev = new Map()
  dist.set(source, 0)
  const pq = [[0, source]]
  while (pq.length > 0) {
    // pop the smallest — push/sort gives us a min-heap in O(n log n) per op,
    // which is fine for sub-thousand-node graphs and keeps the code trivial.
    pq.sort((a, b) => b[0] - a[0])
    const [d, u] = pq.pop()
    if (d > (dist.get(u) ?? Infinity)) continue
    for (const e of adj.get(u) ?? []) {
      const nd = d + e.weightM
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd)
        prev.set(e.to, u)
        pq.push([nd, e.to])
      }
    }
  }
  return { dist, prev }
}

// Reconstruct node-id path from `prev` map. Returns null if `end` was not
// reached from `start`.
export function reconstructPath(prev, start, end) {
  if (start === end) return [start]
  const path = [end]
  let cur = end
  while (cur !== start) {
    const p = prev.get(cur)
    if (p === undefined) return null
    path.push(p)
    cur = p
  }
  return path.reverse()
}
