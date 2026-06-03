// Boundary extraction + Chaikin smoothing: turns the association-area grid mask
// into smooth closed polygons (canvas px). Hamina's association area has a
// clean curved boundary rather than blocky cells, so we trace the mask boundary
// and round it.
//
// Robust ORIENTED-edge tracing: every boundary edge between an inside cell and
// an outside cell is emitted as a DIRECTED segment, wound so the inside region
// is on the edge's left. With consistent orientation each lattice vertex has a
// unique outgoing edge, so loop-walking is unambiguous (no half-edge guessing).
//
// Grid mask is row-major mask[r*cols + c] (1 = inside). Cell (c,r) occupies the
// unit square with corners (c,r)–(c+1,r+1) on the integer lattice.

// ── Morphological cleanup ────────────────────────────────────────────────
// Remove穿牆-induced speckle (isolated 1–2 cell islands) and fill pinholes so
// the association region reads as clean blobs (Hamina-like) rather than a
// crumbly edge. open = erode→dilate (kills islands); close = dilate→erode
// (fills holes/notches). 3×3 (8-neighbour) structuring element.
function morph(mask, cols, rows, dilate) {
  const out = new Uint8Array(cols * rows)
  const at = (c, r) => (c >= 0 && c < cols && r >= 0 && r < rows ? mask[r * cols + c] : 0)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // dilate: 1 if ANY neighbour is 1. erode: 1 only if ALL neighbours are 1.
      let any = 0, all = 1
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const v = at(c + dc, r + dr)
          if (v) any = 1; else all = 0
        }
      }
      out[r * cols + c] = dilate ? any : all
    }
  }
  return out
}

// open ONLY: erode then dilate. Removes isolated speckle cells without ever
// growing the region beyond its original extent (dilate only restores what the
// erode kept). We deliberately DROP the close (dilate→erode) step — close
// dilates first, which pushes the outer boundary out by a cell and leaves a
// visible "padding" ring around the coverage blob that doesn't hug the real
// RSSI threshold. With the coverage-threshold model the field is already smooth
// so pinhole-filling isn't needed.
export function cleanMask(mask, cols, rows) {
  let m = morph(mask, cols, rows, false)   // erode
  m = morph(m, cols, rows, true)           // dilate  → open done
  return m
}

// Emit directed boundary edges (inside-on-left winding). For an inside cell,
// each side facing outside contributes one directed edge:
//   top    facing out → go RIGHT  (c,r)→(c+1,r)
//   right  facing out → go DOWN   (c+1,r)→(c+1,r+1)
//   bottom facing out → go LEFT   (c+1,r+1)→(c,r+1)
//   left   facing out → go UP     (c,r+1)→(c,r)
// This winds each region clockwise in screen coords (y-down), inside on the left.
function directedEdges(mask, cols, rows) {
  const at = (c, r) => (c >= 0 && c < cols && r >= 0 && r < rows ? mask[r * cols + c] : 0)
  const edges = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!at(c, r)) continue
      if (!at(c, r - 1)) edges.push([c, r, c + 1, r])             // top → right
      if (!at(c + 1, r)) edges.push([c + 1, r, c + 1, r + 1])     // right → down
      if (!at(c, r + 1)) edges.push([c + 1, r + 1, c, r + 1])     // bottom → left
      if (!at(c - 1, r)) edges.push([c, r + 1, c, r])             // left → up
    }
  }
  return edges
}

// Walk directed edges into closed loops by following from each segment's end
// to the segment that starts there.
function walkLoops(edges) {
  const key = (x, y) => `${x},${y}`
  // start-vertex → queue of end-vertices (a vertex can have >1 outgoing edge at
  // pinch points; consume them in order).
  const out = new Map()
  for (const [ax, ay, bx, by] of edges) {
    const k = key(ax, ay)
    if (!out.has(k)) out.set(k, [])
    out.get(k).push([bx, by])
  }
  const loops = []
  for (const [startKey, ends] of out) {
    while (ends.length > 0) {
      const loop = []
      let curKey = startKey
      let cur = startKey.split(',').map(Number)
      loop.push(cur)
      let guard = 0
      while (guard++ < 200000) {
        const q = out.get(curKey)
        if (!q || q.length === 0) break
        const next = q.shift()
        loop.push(next)
        curKey = key(next[0], next[1])
        if (curKey === startKey) break
        cur = next
      }
      if (loop.length >= 4) loops.push(loop)
    }
  }
  return loops
}

// Chaikin corner-cutting: each iteration replaces every segment with points at
// 1/4 and 3/4, rounding the polygon. 3 iterations gives a soft, Hamina-like
// curve over the (finer) grid without ballooning the point count too much.
function chaikin(points, iterations = 3) {
  let pts = points
  for (let it = 0; it < iterations; it++) {
    const out = []
    const n = pts.length
    for (let i = 0; i < n; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % n]
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    pts = out
  }
  return pts
}

// Build smooth boundary polygons (flat [x,y,x,y,…] in canvas px) around the
// region where mask === 1.
// Args:
//   mask       — Uint8Array, row-major, length cols*rows
//   cols, rows — grid dimensions
//   stepPx     — cell size in canvas px
//   originX/Y  — canvas-px position of cell (0,0)'s top-left corner
export function maskToSmoothPolygons(mask, cols, rows, stepPx, originX, originY) {
  const edges = directedEdges(mask, cols, rows)
  if (edges.length === 0) return []
  const loops = walkLoops(edges)
  const polys = []
  for (const loop of loops) {
    // Loop ends where it started (closing vertex duplicated) → drop it.
    const ring = loop[loop.length - 1][0] === loop[0][0] && loop[loop.length - 1][1] === loop[0][1]
      ? loop.slice(0, -1)
      : loop
    if (ring.length < 3) continue
    const smooth = chaikin(ring, 3)
    const flat = new Array(smooth.length * 2)
    for (let i = 0; i < smooth.length; i++) {
      flat[i * 2] = originX + smooth[i][0] * stepPx
      flat[i * 2 + 1] = originY + smooth[i][1] * stepPx
    }
    polys.push(flat)
  }
  return polys
}
