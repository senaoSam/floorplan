// Ported 1:1 from oldSrc Editor2D.jsx snap helpers (lines 844-1003) —
// Phase 25 Bundle 20. Snap priority chain for the DRAW_CABLE_TRAY mode:
//   1. shift + anchor → angle lock to 0/45/90° from anchor
//   2. tray vertex   → exact merge to existing tray vertex (24 screen-px)
//   3. wall point    → endpoint (14) OR perpendicular foot on segment (10)
//   4. parallel-wall → direction lock parallel/perp to nearby wall (anchor required)
//
// Returns { pos, kind, ref?, lockedAngle? } where kind ∈
//   'angleLock' | 'trayVertex' | 'wallEndpoint' | 'wallSegment' | 'parallelWall' | null
// `null` kind means no snap fired — caller uses rawPos as-is. Visual
// rendering branches on kind in draftOverlayLayer.

export function angleLockToAnchor(pos, anchor) {
  const dx = pos.x - anchor.x
  const dy = pos.y - anchor.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return pos
  const step = Math.PI / 4
  const snappedAngle = Math.round(Math.atan2(dy, dx) / step) * step
  return {
    x: anchor.x + Math.cos(snappedAngle) * len,
    y: anchor.y + Math.sin(snappedAngle) * len,
  }
}

export function snapToTrayVertex(pos, trays, draftPoints, scale) {
  const snapDist = 24 / (scale || 1)
  let best = pos, bestD = snapDist
  for (const t of trays) {
    for (const v of t.points) {
      const d = Math.hypot(pos.x - v.x, pos.y - v.y)
      if (d < bestD) { bestD = d; best = { x: v.x, y: v.y } }
    }
  }
  // Skip the very last draft point — otherwise the user can't click again
  // adjacent to where they just placed.
  for (let i = 0; i < draftPoints.length - 1; i++) {
    const v = draftPoints[i]
    const d = Math.hypot(pos.x - v.x, pos.y - v.y)
    if (d < bestD) { bestD = d; best = { x: v.x, y: v.y } }
  }
  return best
}

export function snapToWallForTray(pos, walls, scale) {
  if (!walls.length) return null
  const epDist  = 14 / (scale || 1)
  const segDist = 10 / (scale || 1)
  let best = null
  let bestD = Infinity
  // Endpoints first (stricter — wins over segment foot).
  for (const w of walls) {
    const eps = [{ x: w.startX, y: w.startY }, { x: w.endX, y: w.endY }]
    for (const ep of eps) {
      const d = Math.hypot(pos.x - ep.x, pos.y - ep.y)
      if (d < epDist && d < bestD) {
        bestD = d
        best = { pos: { x: ep.x, y: ep.y }, kind: 'wallEndpoint', wall: w }
      }
    }
  }
  if (best) return best
  for (const w of walls) {
    const ax = w.startX, ay = w.startY
    const bx = w.endX,   by = w.endY
    const dx = bx - ax,  dy = by - ay
    const lenSq = dx * dx + dy * dy
    if (lenSq < 1e-6) continue
    const t = ((pos.x - ax) * dx + (pos.y - ay) * dy) / lenSq
    if (t < 0 || t > 1) continue
    const fx = ax + t * dx, fy = ay + t * dy
    const d  = Math.hypot(pos.x - fx, pos.y - fy)
    if (d < segDist && d < bestD) {
      bestD = d
      best = { pos: { x: fx, y: fy }, kind: 'wallSegment', wall: w }
    }
  }
  return best
}

// `angleToleranceRad`: max delta between cursor angle (from anchor) and a
// wall candidate angle (parallel / perpendicular / anti / anti-perp) for
// the snap to engage. Tray uses 6° (tight) — wall draw uses null to mean
// "no threshold" (always pick the closest candidate as long as we found
// a wall within proximityPx).
export function parallelWallLock(cursor, anchor, walls, scale, { angleToleranceRad = (6 * Math.PI) / 180, proximityPx = 180 } = {}) {
  if (!walls.length) return null
  const dx0 = cursor.x - anchor.x
  const dy0 = cursor.y - anchor.y
  const len = Math.hypot(dx0, dy0)
  if (len < 4 / (scale || 1)) return null
  const cursorAngle = Math.atan2(dy0, dx0)
  const proximityWorldPx = proximityPx / (scale || 1)
  let ref = null
  let refD = proximityWorldPx
  for (const w of walls) {
    const ax = w.startX, ay = w.startY
    const bx = w.endX,   by = w.endY
    const sx = bx - ax, sy = by - ay
    const lenSq = sx * sx + sy * sy
    if (lenSq < 1e-6) continue
    const t = ((cursor.x - ax) * sx + (cursor.y - ay) * sy) / lenSq
    const tc = Math.max(0, Math.min(1, t))
    const fx = ax + tc * sx, fy = ay + tc * sy
    const d  = Math.hypot(cursor.x - fx, cursor.y - fy)
    if (d < refD) { refD = d; ref = w }
  }
  if (!ref) return null
  const wallAngle = Math.atan2(ref.endY - ref.startY, ref.endX - ref.startX)
  const candidates = [wallAngle, wallAngle + Math.PI / 2, wallAngle + Math.PI, wallAngle + 3 * Math.PI / 2]
  const normAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a))
  // When angleToleranceRad is null → always pick the closest candidate
  // (no threshold). Otherwise require delta < tolerance.
  let bestAngle = null
  let bestDelta = angleToleranceRad == null ? Infinity : angleToleranceRad
  for (const a of candidates) {
    const delta = Math.abs(normAngle(a - cursorAngle))
    if (delta < bestDelta) { bestDelta = delta; bestAngle = normAngle(a) }
  }
  if (bestAngle === null) return null
  return {
    pos: { x: anchor.x + Math.cos(bestAngle) * len, y: anchor.y + Math.sin(bestAngle) * len },
    lockedAngle: bestAngle,
    refWall: ref,
  }
}

export function snapTrayPoint(rawPos, ctx) {
  const { walls = [], trays = [], draftPoints = [], scale = 1, shiftHeld = false } = ctx
  const anchor = draftPoints.length > 0 ? draftPoints[draftPoints.length - 1] : null
  if (shiftHeld && anchor) {
    return { pos: angleLockToAnchor(rawPos, anchor), kind: 'angleLock' }
  }
  const trayHit = snapToTrayVertex(rawPos, trays, draftPoints, scale)
  if (trayHit !== rawPos) {
    return { pos: trayHit, kind: 'trayVertex' }
  }
  const wallHit = snapToWallForTray(rawPos, walls, scale)
  if (wallHit) return { pos: wallHit.pos, kind: wallHit.kind, ref: wallHit.wall }
  if (anchor) {
    const par = parallelWallLock(rawPos, anchor, walls, scale)
    if (par) return { pos: par.pos, kind: 'parallelWall', ref: par.refWall, lockedAngle: par.lockedAngle }
  }
  return { pos: rawPos, kind: null }
}
