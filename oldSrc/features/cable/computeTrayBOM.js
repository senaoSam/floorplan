// 20-1 Tray Planning BOM — total length, L-fittings, T-joints, crosses,
// with a user-controlled waste factor applied to the total length.
//
// Explicitly a Planning BOM, NOT a施工 final BOM:
//   - fitting counts are derived from the drawn polyline geometry, not from
//     selected fittings (no part numbers, no SKUs).
//   - waste factor is a flat multiplier on length; real installations choose
//     it by tray kind / brand / site cutting practice.
//   - on-site cuts, overlap, support hangers, fasteners are not included.
//
// Site team uses this as an order estimate, then refines during install.
//
// Junction classification (single-pass, no double counting):
//   - Every tray vertex AND every proper mid-segment crossing is a CANDIDATE
//     junction site.
//   - At each site, every tray contributes "arms" (outgoing unit vectors):
//       * tray endpoint at site               → 1 arm
//       * tray interior vertex at site        → 2 arms (toward prev + next)
//       * tray segment passes through site
//         (xy on segment interior, no vertex) → 2 arms (toward both ends)
//   - Total arms drives the fitting type:
//       1 arm   → free end, no fitting
//       2 arms  → L-fitting (when angle change ≥ STRAIGHT_TOL_DEG)
//       3 arms  → T 接
//       4+ arms → 跨接 / X-joint
//
// Each physical site is classified exactly once, so the old worry about
// "same xy counted as T joint AND L-fitting simultaneously" doesn't apply.
//
// Tolerance — endpoints / crossings within VERTEX_TOL_PX of each other are
// treated as the same junction. The user's drawing precision is the
// constraint; with Konva snap-to-vertex producing exact coords and free
// drawing producing ±1–3 px drift, ~5 px is the sweet spot. Bumping higher
// would risk binning genuinely separate junctions together; bumping lower
// misses hand-drawn near-misses.

import { footOnSegment, segmentIntersection } from './geometry'

const STRAIGHT_TOL_DEG = 5      // < 5° turn from straight: not a real bend
const VERTEX_TOL_PX    = 5.0    // shared tolerance for vertex / segment / crossing
                                // coincidence AND for clustering candidate sites

function polylineLengthPx(points) {
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
  }
  return total
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// Build the candidate junction xy list:
//   - every tray vertex (endpoint + interior)
//   - every proper mid-segment crossing (no shared vertex)
//
// Uses proximity-based clustering (first-come-first-serve): a new point that
// lands within VERTEX_TOL_PX of an existing site is folded into that site,
// not added separately. This is critical — rounding-to-bin (the old approach)
// can split two points 3 px apart across a bin boundary (e.g. y=320 → bin
// 320, y=323 → bin 325) and double-count the same physical junction.
function collectCandidates(trays) {
  const sites = []
  const addUnique = (p) => {
    for (const s of sites) {
      if (dist(p, s) <= VERTEX_TOL_PX) return
    }
    sites.push({ x: p.x, y: p.y })
  }
  for (const t of trays) {
    for (const p of t.points ?? []) addUnique(p)
  }
  for (let i = 0; i < trays.length; i++) {
    const A = trays[i]
    if (!A.points || A.points.length < 2) continue
    for (let j = i + 1; j < trays.length; j++) {
      const B = trays[j]
      if (!B.points || B.points.length < 2) continue
      for (let a = 0; a < A.points.length - 1; a++) {
        for (let b = 0; b < B.points.length - 1; b++) {
          const hit = segmentIntersection(
            A.points[a], A.points[a + 1],
            B.points[b], B.points[b + 1],
          )
          if (hit && !hit.touching) addUnique({ x: hit.x, y: hit.y })
        }
      }
    }
  }
  return sites
}

// Gather all arms contributed by `trays` at the given junction xy.
// Each arm is { x, y } as a normalized outgoing direction.
function armsAtSite(trays, xy) {
  const arms = []
  const push = (dx, dy) => {
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) return
    arms.push({ x: dx / len, y: dy / len })
  }
  for (const t of trays) {
    const pts = t.points
    if (!pts || pts.length < 2) continue

    // 1) Vertex contributions: any vertex within tolerance of xy adds arms
    //    toward its adjacent vertices.
    const vertexHitIdx = new Set()
    for (let i = 0; i < pts.length; i++) {
      if (dist(pts[i], xy) <= VERTEX_TOL_PX) {
        vertexHitIdx.add(i)
        const cur = pts[i]
        if (i > 0)               push(pts[i - 1].x - cur.x, pts[i - 1].y - cur.y)
        if (i < pts.length - 1)  push(pts[i + 1].x - cur.x, pts[i + 1].y - cur.y)
      }
    }

    // 2) Segment pass-through contributions: xy lies on a segment's interior
    //    AND neither of that segment's endpoints was already counted above.
    //    (If an endpoint was counted, this segment is already represented by
    //    the vertex arms — adding the same direction again would double count.)
    for (let s = 0; s < pts.length - 1; s++) {
      if (vertexHitIdx.has(s) || vertexHitIdx.has(s + 1)) continue
      const a = pts[s], b = pts[s + 1]
      const foot = footOnSegment(xy, a, b)
      if (foot.d <= VERTEX_TOL_PX && foot.t > 1e-3 && foot.t < 1 - 1e-3) {
        push(a.x - xy.x, a.y - xy.y)
        push(b.x - xy.x, b.y - xy.y)
      }
    }
  }
  return arms
}

// Classify every candidate junction once. Returns { lfit, tjoint, cross }.
function classifyAllJunctions(trays) {
  const out = { lfit: 0, tjoint: 0, cross: 0 }
  const candidates = collectCandidates(trays)
  for (const xy of candidates) {
    const arms = armsAtSite(trays, xy)
    const armCount = arms.length
    if (armCount === 2) {
      const dot = arms[0].x * arms[1].x + arms[0].y * arms[1].y
      const cos = Math.max(-1, Math.min(1, dot))
      const angBetween = Math.acos(cos) * 180 / Math.PI
      const turnDeg = 180 - angBetween
      if (turnDeg >= STRAIGHT_TOL_DEG) out.lfit++
      // else: straight pass-through, no fitting
    } else if (armCount === 3) {
      out.tjoint++
    } else if (armCount >= 4) {
      out.cross++
    }
  }
  return out
}

// Top-level BOM computation. Returns:
//   {
//     totalLengthM,
//     totalLengthWithWasteM,
//     wasteFactor,
//     lfits,     // 90° / L 接
//     tjoints,   // T 接
//     crosses,   // 跨接 (X / 4+ way)
//     perFloor: [{ floorId, name, trayCount, lengthM, lfits, tjoints, crosses }],
//   }
// Lengths are 0 when the floor's scale isn't calibrated yet.
export function computeTrayBOM({ floors = [], traysByFloor = {}, wasteFactor = 1.10 }) {
  let totalLengthM = 0
  let lfitsTotal   = 0
  let tjointsTotal = 0
  let crossesTotal = 0
  const perFloor = []

  for (const f of floors) {
    const trays = traysByFloor[f.id] ?? []
    if (trays.length === 0) continue
    const px = trays.reduce((acc, t) => acc + polylineLengthPx(t.points ?? []), 0)
    const lengthM = f.scale && f.scale > 0 ? px / f.scale : 0

    const jc = classifyAllJunctions(trays)

    totalLengthM += lengthM
    lfitsTotal   += jc.lfit
    tjointsTotal += jc.tjoint
    crossesTotal += jc.cross

    perFloor.push({
      floorId: f.id,
      name:    f.name ?? f.id,
      trayCount: trays.length,
      lengthM,
      lfits:   jc.lfit,
      tjoints: jc.tjoint,
      crosses: jc.cross,
    })
  }

  return {
    totalLengthM,
    totalLengthWithWasteM: totalLengthM * wasteFactor,
    wasteFactor,
    lfits:   lfitsTotal,
    tjoints: tjointsTotal,
    crosses: crossesTotal,
    perFloor,
  }
}
