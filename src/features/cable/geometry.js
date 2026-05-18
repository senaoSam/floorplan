// Geometry helpers for cable-tray graph construction.
// All inputs in canvas (image-pixel) coords; chainages also in canvas px.

// Cumulative distance along a polyline. Returns array length N with
// cumLen[0] = 0 and cumLen[i] = sum of segment lengths up to vertex i.
export function cumulativeLengths(points) {
  const cum = new Array(points.length)
  cum[0] = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    cum[i] = cum[i - 1] + Math.hypot(dx, dy)
  }
  return cum
}

// Foot of perpendicular from P onto segment AB, clamped to [A,B].
// Returns { foot:{x,y}, d, t } where t∈[0,1] is the parametric position.
export function footOnSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-9) {
    const dd = Math.hypot(p.x - a.x, p.y - a.y)
    return { foot: { x: a.x, y: a.y }, d: dd, t: 0 }
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const fx = a.x + t * dx
  const fy = a.y + t * dy
  return { foot: { x: fx, y: fy }, d: Math.hypot(p.x - fx, p.y - fy), t }
}

// Closest point on polyline T to point P. Walks every segment, picks the foot
// with smallest distance, and reports its chainage (cumulative arclength from
// points[0] along T).
//
// Returns { foot, d, chain, segmentIndex } — segmentIndex is the index `i`
// such that the foot lies on segment (points[i], points[i+1]).
export function closestPointOnPolyline(p, points, cumLen) {
  let best = { foot: { x: points[0].x, y: points[0].y }, d: Infinity, chain: 0, segmentIndex: 0 }
  for (let i = 0; i < points.length - 1; i++) {
    const f = footOnSegment(p, points[i], points[i + 1])
    if (f.d < best.d) {
      const segLen = cumLen[i + 1] - cumLen[i]
      best = {
        foot: f.foot,
        d: f.d,
        chain: cumLen[i] + f.t * segLen,
        segmentIndex: i,
      }
    }
  }
  return best
}

// Proper segment-segment intersection in 2D. Returns the intersection point
// only when the two open segments truly cross (parameters strictly in (0,1)
// on both). Endpoints touching count as `touching = true` instead — collinear
// overlap returns null and the caller should issue a warning (cable-spec §10).
//
// Output:
//   null  — no intersection (or collinear)
//   { x, y, t, u, touching } — where t∈[0,1] on (p1,p2), u∈[0,1] on (p3,p4)
//
// `touching: true` means the intersection is on an endpoint of one or both
// segments (tangential touch). Caller decides if those count as a cross.
export function segmentIntersection(p1, p2, p3, p4) {
  const r = { x: p2.x - p1.x, y: p2.y - p1.y }
  const s = { x: p4.x - p3.x, y: p4.y - p3.y }
  const rxs = r.x * s.y - r.y * s.x
  if (Math.abs(rxs) < 1e-9) return null  // parallel or collinear → caller handles overlap
  const qp = { x: p3.x - p1.x, y: p3.y - p1.y }
  const t = (qp.x * s.y - qp.y * s.x) / rxs
  const u = (qp.x * r.y - qp.y * r.x) / rxs
  const eps = 1e-9
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null
  const touching = t < eps || t > 1 - eps || u < eps || u > 1 - eps
  return {
    x: p1.x + t * r.x,
    y: p1.y + t * r.y,
    t,
    u,
    touching,
  }
}
