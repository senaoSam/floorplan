// Basic 2D geometry helpers for ray/wall interactions.

export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y } }
export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y } }
export function mul(a, s) { return { x: a.x * s, y: a.y * s } }
export function dot(a, b) { return a.x * b.x + a.y * b.y }
export function len(a) { return Math.hypot(a.x, a.y) }
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }
export function norm(a) { const l = len(a) || 1; return { x: a.x / l, y: a.y / l } }

// Endpoint hysteresis (HM-F5c-fix). Shader fp32 segSegIntersect carries ~1e-7
// ULP noise on both t (ray-side) and u (wall-side). When a ray:
//   (a) ends exactly on a wall (rx sits on a wall endpoint, e.g. metal-box
//       corner that aligns with a grid sample) — fp32 t ≈ 1 ± ULP, strict
//       t > 1 rejects what JS fp64 admits.
//   (b) grazes a shared wall vertex (two walls meet at the same point) —
//       u ≈ 0 ± ULP on one and u ≈ 1 ± ULP on the other; strict u ∈ [0, 1]
//       admits/rejects them inconsistently.
// Both engines pad t and u by SEG_HIT_EPS (1e-6, comfortably above fp32 ULP
// and far below any meaningful boundary). The pad is one-sided on t's lower
// bound — t < 0 (ray going backwards from AP) stays strict so we don't
// admit walls behind the AP; t > 1 + EPS (wall past rx) is admitted to
// rescue the rx-on-wall case. JS pads symmetrically because its fp64 noise
// is tiny (~1e-15) and the matching pad keeps the two engines aligned in
// edge cases. A previous fix attempt was symmetric and failed because the
// EPS test was inverted (≥ EPS → reject), which threw away every t≈0 hit
// the reflection legs depended on. The current direction (≤ 1+EPS → admit)
// is safe.
export const SEG_HIT_EPS = 1e-6

// Segment AB defined by {a:{x,y}, b:{x,y}}.
// Ray/segment intersection: parametric t along ray (from p0, direction d), u along wall.
// Returns { t, u, point } or null.
export function raySegmentIntersect(p0, d, wa, wb) {
  const rx = d.x, ry = d.y
  const sx = wb.x - wa.x, sy = wb.y - wa.y
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-12) return null // parallel
  const dx = wa.x - p0.x, dy = wa.y - p0.y
  const t = (dx * sy - dy * sx) / denom
  const u = (dx * ry - dy * rx) / denom
  if (t <= 1e-6 || u < -SEG_HIT_EPS || u > 1 + SEG_HIT_EPS) return null
  return { t, u, point: { x: p0.x + rx * t, y: p0.y + ry * t } }
}

// Segment-segment intersect (for LOS test from A to B through walls).
export function segSegIntersect(a1, a2, b1, b2) {
  const d1 = sub(a2, a1)
  const d2 = sub(b2, b1)
  const denom = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(denom) < 1e-12) return null
  const dx = b1.x - a1.x, dy = b1.y - a1.y
  const t = (dx * d2.y - dy * d2.x) / denom
  const u = (dx * d1.y - dy * d1.x) / denom
  if (t < 0 || t > 1 + SEG_HIT_EPS) return null
  if (u < -SEG_HIT_EPS || u > 1 + SEG_HIT_EPS) return null
  return { t, u, point: { x: a1.x + d1.x * t, y: a1.y + d1.y * t } }
}

// Distance from point P to segment AB.
export function pointSegDistance(p, a, b) {
  const ab = sub(b, a)
  const ap = sub(p, a)
  const l2 = dot(ab, ab)
  if (l2 === 0) return { d: dist(p, a), closest: a, t: 0 }
  let t = dot(ap, ab) / l2
  t = Math.max(0, Math.min(1, t))
  const closest = { x: a.x + ab.x * t, y: a.y + ab.y * t }
  return { d: dist(p, closest), closest, t }
}

// Reflect direction v across a wall's normal n.
export function reflect(v, n) {
  const vdotn = dot(v, n)
  return { x: v.x - 2 * vdotn * n.x, y: v.y - 2 * vdotn * n.y }
}

// Outward normal (either side) of a segment (a→b). Returns unit normal.
export function segmentNormal(a, b) {
  const d = sub(b, a)
  return norm({ x: -d.y, y: d.x })
}

// Mirror point P across an infinite line defined by segment a→b.
// Used for image-source reflection.
export function mirrorPoint(p, a, b) {
  const n = segmentNormal(a, b)
  const v = sub(p, a)
  const k = dot(v, n)
  return { x: p.x - 2 * k * n.x, y: p.y - 2 * k * n.y }
}
