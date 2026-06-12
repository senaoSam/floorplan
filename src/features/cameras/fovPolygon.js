// Camera FOV visibility polygon (Phase 34-1).
//
// 2D ray casting against wall segments, all in CANVAS PX space. A camera sees
// from its position along its azimuth within fovDeg, up to rangePx, and walls
// cut the view (visibility polygon). Per design consensus (.claude/task.md
// Phase 34): GLASS is see-through — glass walls and glass openings (windows)
// don't block the rays; every other material blocks completely. No RF-style
// attenuation here — this is pure line-of-sight.

const ANGLE_STEP_DEG = 1       // uniform ray fan density
const ENDPOINT_EPS = 1e-4      // extra rays just past segment endpoints → crisp corners
const FULL_CIRCLE_DEG = 360

// Vertical FOV ≈ horizontal FOV × sensor aspect (16:9-ish) — one parameter
// fewer for the user, close enough for planning.
const VFOV_RATIO = 0.56
export const DEFAULT_TILT_DEG = 30
// Targets aren't points on the floor: a person 2 m from a level-mounted
// camera is below its lowest ray at FLOOR level but their torso/head are
// squarely in frame. The detection band therefore measures against a
// representative target height (covers a standing person's upper body and a
// car body), not the floor.
export const TARGET_HEIGHT_M = 1.4

// Detection-coverage radii from the physical pose: a camera at height h with
// downward tilt t and vertical FOV v detects a target of height ht between
//   near = (h − ht) / tan(t + v/2)  (blind ring under the lens — the lowest
//                                    ray passes above even the target's head)
//   far  = h / tan(t − v/2)         (the highest ray has already hit the
//                                    floor — nothing visible beyond, at any
//                                    height; capped by rangeM)
// Shallow tilt → far reach but a near blind ring; steep tilt → the opposite.
// Returns px radii for the FOV polygon / detection sweep.
export function cameraCoverageRadii(camera, pxPerM) {
  const h = Math.max(0.1, camera.z ?? 2.5)
  const tiltRad = (camera.tiltDeg ?? DEFAULT_TILT_DEG) * Math.PI / 180
  const vHalf = (Math.min(camera.fovDeg ?? 90, 120) * VFOV_RATIO / 2) * Math.PI / 180
  const rangeM = camera.rangeM ?? 12
  const steep = tiltRad + vHalf            // lowest-looking ray
  const shallow = tiltRad - vHalf          // highest-looking ray
  const hAboveTarget = Math.max(0, h - TARGET_HEIGHT_M)
  const nearM = steep >= Math.PI / 2 - 1e-3 ? 0 : hAboveTarget / Math.tan(steep)
  const farM = shallow <= 2 * Math.PI / 180
    ? rangeM                               // ray ≈ horizontal → only the range cap limits it
    : Math.min(rangeM, h / Math.tan(shallow))
  return {
    minRangePx: Math.max(0, nearM * pxPerM),
    rangePx: Math.max(1, farM * pxPerM),
  }
}

const isGlass = (material) => material?.id === 'glass'

// Expand one wall into blocking sub-segments in px space, honouring openings
// (stored as fractional ranges along the wall, same model as buildScenario).
// Glass sub-segments are dropped entirely — rays pass through them.
function expandWallPx(wall, out) {
  const ax = wall.startX, ay = wall.startY
  const bx = wall.endX,   by = wall.endY
  const wallBlocks = !isGlass(wall.material)
  const openings = (wall.openings ?? []).slice().sort((a, b) => a.startFrac - b.startFrac)

  if (openings.length === 0) {
    if (wallBlocks) out.push({ ax, ay, bx, by })
    return
  }

  const px = (f) => ax + (bx - ax) * f
  const py = (f) => ay + (by - ay) * f
  let cursor = 0
  for (const op of openings) {
    const s = Math.max(cursor, op.startFrac)
    const e = Math.min(1, op.endFrac)
    if (s > cursor + 1e-4 && wallBlocks) {
      out.push({ ax: px(cursor), ay: py(cursor), bx: px(s), by: py(s) })
    }
    // Opening blocks unless its material is glass (windows default to glass).
    if (!isGlass(op.material)) {
      out.push({ ax: px(s), ay: py(s), bx: px(e), by: py(e) })
    }
    cursor = e
  }
  if (cursor < 1 - 1e-4 && wallBlocks) {
    out.push({ ax: px(cursor), ay: py(cursor), bx: px(1), by: py(1) })
  }
}

export function buildBlockingSegments(walls) {
  const segs = []
  for (const wall of walls ?? []) expandWallPx(wall, segs)
  return segs
}

// Ray (ox,oy)+(dx,dy)·t vs segment a→b. Returns t in (0, ∞) or Infinity.
function raySegmentT(ox, oy, dx, dy, seg) {
  const ex = seg.bx - seg.ax
  const ey = seg.by - seg.ay
  const denom = dx * ey - dy * ex
  if (Math.abs(denom) < 1e-12) return Infinity
  const wx = seg.ax - ox
  const wy = seg.ay - oy
  const t = (wx * ey - wy * ex) / denom   // distance along the ray
  const u = (wx * dy - wy * dx) / denom   // position along the segment [0,1]
  if (t <= 1e-9 || u < -1e-9 || u > 1 + 1e-9) return Infinity
  return t
}

// Visibility polygon as a flat [x0, y0, x1, y1, …] array in canvas px.
//
// minRangePx > 0 models the tilt-induced blind ring under the lens: the
// polygon becomes an ANNULAR band (outer boundary walked forward, inner
// boundary walked back). Rays whose wall hit lands inside the blind ring
// collapse to zero width and contribute no area. minRangePx === 0 keeps the
// classic fan anchored at the camera (full circle omits the centre point).
export function computeFovPolygon({ cx, cy, azimuthDeg, fovDeg, rangePx, segments, minRangePx = 0 }) {
  const fov = Math.max(1, Math.min(FULL_CIRCLE_DEG, fovDeg ?? 90))
  const isFull = fov >= FULL_CIRCLE_DEG - 1e-6
  const fovRad = fov * Math.PI / 180
  const startRad = (azimuthDeg ?? 0) * Math.PI / 180 - fovRad / 2
  if (minRangePx >= rangePx - 1e-6) return null   // coverage band is empty

  // Angle offsets within [0, fovRad], relative to the window start — keeps the
  // sort monotonic even when the window crosses the ±π wrap.
  const offsets = []
  const stepRad = ANGLE_STEP_DEG * Math.PI / 180
  for (let o = 0; o <= fovRad + 1e-9; o += stepRad) offsets.push(Math.min(o, fovRad))

  // Endpoint rays (± epsilon) so corners land exactly on wall ends.
  const TWO_PI = Math.PI * 2
  for (const seg of segments) {
    for (const [px, py] of [[seg.ax, seg.ay], [seg.bx, seg.by]]) {
      const a = Math.atan2(py - cy, px - cx)
      let off = a - startRad
      off = ((off % TWO_PI) + TWO_PI) % TWO_PI
      if (off <= fovRad + 1e-9) {
        offsets.push(off, Math.max(0, off - ENDPOINT_EPS), Math.min(fovRad, off + ENDPOINT_EPS))
      }
    }
  }

  offsets.sort((a, b) => a - b)

  const hits = []   // [{ ang, t }] — wall-clamped reach per ray
  let lastOff = -1
  for (const off of offsets) {
    if (off - lastOff < 1e-7) continue   // dedupe near-identical rays
    lastOff = off
    const ang = startRad + off
    const dx = Math.cos(ang)
    const dy = Math.sin(ang)
    let best = rangePx
    for (const seg of segments) {
      const t = raySegmentT(cx, cy, dx, dy, seg)
      if (t < best) best = t
    }
    hits.push({ ang, t: best })
  }
  if (hits.length < 2) return null

  if (minRangePx <= 0) {
    const pts = []
    for (const h of hits) pts.push(cx + Math.cos(h.ang) * h.t, cy + Math.sin(h.ang) * h.t)
    if (pts.length < 4) return null
    return isFull ? pts : [cx, cy, ...pts]
  }

  // Annular band: any area at all?
  if (!hits.some((h) => h.t > minRangePx + 1e-6)) return null
  const pts = []
  for (const h of hits) {
    pts.push(cx + Math.cos(h.ang) * h.t, cy + Math.sin(h.ang) * h.t)
  }
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]
    const r = Math.min(minRangePx, h.t)
    pts.push(cx + Math.cos(h.ang) * r, cy + Math.sin(h.ang) * r)
  }
  return pts
}
