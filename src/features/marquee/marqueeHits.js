// Ported 1:1 from oldSrc Editor2D.jsx `collectMarqueeHits` — Phase 25
// Bundle 19. Pure geometry — given a world-space rect + per-floor
// stores, returns the list of {id, type} hit by the marquee.
//
// Hit criteria per object type (matches oldSrc):
//   AP / Switch / Riser  — centre point inside rect
//   Wall                 — segment intersects rect (endpoints inside or
//                          edge crosses)
//   Scope / FloorHole    — polygon intersects rect (vertex inside, edge
//                          crosses, or rect fully inside polygon)
//   Cable tray           — any segment crosses rect OR any vertex inside

export function collectMarqueeHits(rect, sources) {
  const minX = Math.min(rect.minX, rect.maxX)
  const minY = Math.min(rect.minY, rect.maxY)
  const maxX = Math.max(rect.minX, rect.maxX)
  const maxY = Math.max(rect.minY, rect.maxY)

  const segmentsIntersect = (ax, ay, bx, by, cx, cy, dx, dy) => {
    const cross = (ux, uy, vx, vy) => ux * vy - uy * vx
    const dAB = { x: bx - ax, y: by - ay }
    const dCD = { x: dx - cx, y: dy - cy }
    const denom = cross(dAB.x, dAB.y, dCD.x, dCD.y)
    if (Math.abs(denom) < 1e-10) return false
    const t = cross(cx - ax, cy - ay, dCD.x, dCD.y) / denom
    const u = cross(cx - ax, cy - ay, dAB.x, dAB.y) / denom
    return t >= 0 && t <= 1 && u >= 0 && u <= 1
  }

  const segIntersectsRect = (x1, y1, x2, y2) => {
    if ((x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY) ||
        (x2 >= minX && x2 <= maxX && y2 >= minY && y2 <= maxY)) return true
    const edges = [
      [minX, minY, maxX, minY], [maxX, minY, maxX, maxY],
      [maxX, maxY, minX, maxY], [minX, maxY, minX, minY],
    ]
    for (const [ex1, ey1, ex2, ey2] of edges) {
      if (segmentsIntersect(x1, y1, x2, y2, ex1, ey1, ex2, ey2)) return true
    }
    return false
  }

  const pointInPolygon = (px, py, flat) => {
    const n = flat.length / 2
    let inside = false
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = flat[i * 2], yi = flat[i * 2 + 1]
      const xj = flat[j * 2], yj = flat[j * 2 + 1]
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi)) {
        inside = !inside
      }
    }
    return inside
  }

  const polyIntersectsRect = (flat) => {
    const n = flat.length / 2
    for (let i = 0; i < n; i++) {
      const px = flat[i * 2], py = flat[i * 2 + 1]
      if (px >= minX && px <= maxX && py >= minY && py <= maxY) return true
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      if (segIntersectsRect(flat[i * 2], flat[i * 2 + 1], flat[j * 2], flat[j * 2 + 1])) return true
    }
    return pointInPolygon(minX, minY, flat)
  }

  const hits = []
  const {
    walls = [], aps = [], scopes = [], floorHoles = [],
    switches = [], trays = [], risers = [], floorId,
    visibility = {},
  } = sources

  // visibility flags default to true (matching oldSrc — marquee respects
  // layer visibility so hidden objects don't get pulled into selection).
  if (visibility.showWalls !== false) {
    for (const w of walls) {
      if (segIntersectsRect(w.startX, w.startY, w.endX, w.endY)) {
        hits.push({ id: w.id, type: 'wall' })
      }
    }
  }
  if (visibility.showAPs !== false) {
    for (const ap of aps) {
      if (ap.x >= minX && ap.x <= maxX && ap.y >= minY && ap.y <= maxY) {
        hits.push({ id: ap.id, type: 'ap' })
      }
    }
  }
  if (visibility.showScopes !== false) {
    for (const z of scopes) {
      if (polyIntersectsRect(z.points)) hits.push({ id: z.id, type: 'scope' })
    }
  }
  if (visibility.showFloorHoles !== false) {
    for (const h of floorHoles) {
      if (polyIntersectsRect(h.points)) hits.push({ id: h.id, type: 'floor_hole' })
    }
  }
  if (visibility.showSwitches !== false) {
    for (const sw of switches) {
      if (sw.x >= minX && sw.x <= maxX && sw.y >= minY && sw.y <= maxY) {
        hits.push({ id: sw.id, type: 'switch' })
      }
    }
  }
  if (visibility.showCableTrays !== false) {
    for (const t of trays) {
      let hit = false
      for (let i = 0; i < t.points.length - 1 && !hit; i++) {
        const a = t.points[i], b = t.points[i + 1]
        if (segIntersectsRect(a.x, a.y, b.x, b.y)) hit = true
      }
      if (!hit) {
        for (const p of t.points) {
          if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) { hit = true; break }
        }
      }
      if (hit) hits.push({ id: t.id, type: 'cable_tray' })
    }
  }
  if (visibility.showRisers !== false) {
    for (const r of risers) {
      if (!(r.floorIds ?? []).includes(floorId)) continue
      if (r.x >= minX && r.x <= maxX && r.y >= minY && r.y <= maxY) {
        hits.push({ id: r.id, type: 'cable_riser' })
      }
    }
  }
  return hits
}
