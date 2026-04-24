// Bridge: main-system state → heatmap_sample scenario format.
//
// Main system stores walls/APs in canvas pixels; sample physics works in meters.
// floor.scale is px/m. We convert here and flatten wall openings into their own
// sub-segments so each sub-segment carries its own dB loss.

import { channelCenterMHz } from './frequency'

// ITU-R P.2040-3 Table 3 coefficients. Reflection uses full complex Fresnel
// based on (eps_r, sigma) derived from these per-AP frequency. Fallback ~ concrete.
const ITU_FALLBACK = { a: 5.24, b: 0, c: 0.0462, d: 0.7822 }

function ituFor(material) {
  return material?.itu ?? ITU_FALLBACK
}

// Expand a wall with openings into N sub-segments, each with its own dbLoss.
// Openings are stored as fractional ranges [startFrac, endFrac] along the wall.
// Returns segments in meters: [{ a, b, lossDb, itu, roughnessM, kind }]
function expandWall(wall, pxToM) {
  const ax = wall.startX, ay = wall.startY
  const bx = wall.endX,   by = wall.endY
  const wallLoss = wall.material?.dbLoss ?? 8
  const wallItu = ituFor(wall.material)

  const openings = (wall.openings ?? []).slice().sort((a, b) => a.startFrac - b.startFrac)
  if (openings.length === 0) {
    return [{
      a: { x: ax * pxToM, y: ay * pxToM },
      b: { x: bx * pxToM, y: by * pxToM },
      lossDb: wallLoss,
      itu: wallItu,
      roughnessM: 0.01,
      kind: 'interior',
    }]
  }

  const pointAt = (frac) => ({
    x: (ax + (bx - ax) * frac) * pxToM,
    y: (ay + (by - ay) * frac) * pxToM,
  })

  const segs = []
  let cursor = 0
  for (const op of openings) {
    const s = Math.max(cursor, op.startFrac)
    const e = Math.min(1, op.endFrac)
    if (s > cursor + 1e-4) {
      segs.push({
        a: pointAt(cursor),
        b: pointAt(s),
        lossDb: wallLoss,
        itu: wallItu,
        roughnessM: 0.01,
        kind: 'interior',
      })
    }
    const opLoss = op.material?.dbLoss ?? wallLoss
    const opItu = ituFor(op.material)
    segs.push({
      a: pointAt(s),
      b: pointAt(e),
      lossDb: opLoss,
      itu: opItu,
      roughnessM: 0.01,
      kind: op.type === 'window' ? 'window' : 'door',
    })
    cursor = e
  }
  if (cursor < 1 - 1e-4) {
    segs.push({
      a: pointAt(cursor),
      b: pointAt(1),
      lossDb: wallLoss,
      itu: wallItu,
      roughnessM: 0.01,
      kind: 'interior',
    })
  }
  return segs
}

// Collect unique corner points (segment endpoints) for diffraction.
function collectCorners(segments) {
  const map = new Map()
  for (const s of segments) {
    for (const p of [s.a, s.b]) {
      const k = `${p.x.toFixed(3)},${p.y.toFixed(3)}`
      if (!map.has(k)) map.set(k, p)
    }
  }
  return Array.from(map.values())
}

// Main entry. Takes main-system data in canvas-pixel space and returns the
// scenario object the heatmap_sample engine consumes.
//
// Args:
//   floor:    { imageWidth, imageHeight, scale }  — scale is px/m
//   walls:    Wall[]  (startX/startY/endX/endY in px + optional openings)
//   aps:      AP[]    (x/y in px, frequency/channel/channelWidth/txPower)
//   scopes:   Scope[] (points flat [x,y,…] in px, type 'in'|'out')  — optional
//   crossFloor: {                        — optional cross-floor data (HM-F3a/F2b)
//     activeElevationM: number,          active floor's ground-level Y (m)
//     rxHeightM:        number,          receiver height above active floor (m)
//     floorStack: [                      all floors sorted by elevation ascending
//       { id, elevationM, slabDb, scale, holes, holePxToM, width, height }
//     ],
//     apsByFloor: [                      APs from every floor with their
//       { id, name, posPx:{x,y}, z, elevationM, floorScale,
//         txPower, frequency, channel, channelWidth,
//         antennaMode, azimuth, beamwidth, patternId }
//     ]
//   }
//
// Returns: { size:{w,h}, walls, corners, aps, scopeMaskFn, floorStack?, rxElevationM? }
//          When crossFloor is provided, aps includes all floors' APs with
//          absoluteZ baked in, and floorStack lets propagation compute how
//          many slabs a given ray crosses.
export function buildScenario(floor, walls, aps, scopes = [], crossFloor = null) {
  if (!floor || !floor.scale || !floor.imageWidth || !floor.imageHeight) return null
  const pxToM = 1 / floor.scale

  const w = floor.imageWidth * pxToM
  const h = floor.imageHeight * pxToM

  const wallSegs = []
  for (const wall of walls ?? []) {
    for (const seg of expandWall(wall, pxToM)) wallSegs.push(seg)
  }
  const corners = collectCorners(wallSegs)

  // Build per-AP entries. By default these come from the active floor's AP
  // list (planar heatmap), converted from px to meters via pxToM. When
  // crossFloor is supplied, the caller hands us pre-computed AP entries that
  // already carry per-AP elevation — we use those instead so upstairs /
  // downstairs APs are modelled with their correct absolute Z.
  const buildApEntry = (ap, posMeters, elevationM) => ({
    id: ap.id,
    name: ap.name ?? ap.id,
    pos: posMeters,
    // Absolute Z of the AP = its floor's elevation + its install height.
    // 0 when no cross-floor data is in play (single-floor planar mode).
    zM: (elevationM ?? 0) + (ap.z ?? 0),
    txDbm: ap.txPower ?? 20,
    frequency: ap.frequency ?? 5,
    channel: ap.channel ?? 36,
    channelWidth: ap.channelWidth ?? 20,
    centerMHz: channelCenterMHz(ap.frequency ?? 5, ap.channel ?? 36),
    antennaMode: ap.antennaMode ?? 'omni',
    azimuthDeg: ap.azimuth ?? 0,
    beamwidthDeg: ap.beamwidth ?? 60,
    patternId: ap.patternId ?? null,
  })

  let apList
  if (crossFloor && crossFloor.apsByFloor) {
    // Cross-floor path: each entry already has {posPx, floorScale, elevationM}.
    apList = crossFloor.apsByFloor.map((ap) => {
      const apPxToM = ap.floorScale ? 1 / ap.floorScale : pxToM
      return buildApEntry(
        ap,
        { x: ap.posPx.x * apPxToM, y: ap.posPx.y * apPxToM },
        ap.elevationM,
      )
    })
  } else {
    // Planar path: every AP lives on the supplied `floor`.
    apList = (aps ?? []).map((ap) =>
      buildApEntry(ap, { x: ap.x * pxToM, y: ap.y * pxToM }, 0),
    )
  }

  // Build scope mask. If there are any in-scopes, a point must lie inside at
  // least one; out-scopes always exclude their interior. No scopes → all pass.
  const inScopes  = (scopes ?? []).filter((s) => s.type === 'in')
  const outScopes = (scopes ?? []).filter((s) => s.type === 'out')
  const toMeterPoly = (flatPts) => {
    const out = new Array(flatPts.length)
    for (let i = 0; i < flatPts.length; i++) out[i] = flatPts[i] * pxToM
    return out
  }
  const inPolys  = inScopes.map((s) => toMeterPoly(s.points))
  const outPolys = outScopes.map((s) => toMeterPoly(s.points))

  const pointInPoly = (x, y, pts) => {
    const n = pts.length / 2
    let inside = false
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = pts[i * 2],     yi = pts[i * 2 + 1]
      const xj = pts[j * 2],     yj = pts[j * 2 + 1]
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi)
      if (intersect) inside = !inside
    }
    return inside
  }

  const scopeMaskFn = (x, y) => {
    if (inPolys.length > 0) {
      let anyIn = false
      for (const p of inPolys) { if (pointInPoly(x, y, p)) { anyIn = true; break } }
      if (!anyIn) return false
    }
    for (const p of outPolys) { if (pointInPoly(x, y, p)) return false }
    return true
  }

  // Slab-crossing metadata for HM-F3a / F2a. `floorBoundaries` is a sorted
  // list of the *upper* boundary Y of each floor; slabDb is the attenuation
  // applied when a ray crosses that boundary. Each boundary also carries a
  // list of "bypass holes" — FloorHole polygons (in meters, active-floor
  // canvas frame) that, when a ray crosses the boundary inside the hole's
  // XY footprint, zero out this slab's attenuation. Active floor's rx lives
  // at activeElevationM + rxHeightM (default: standing-height ≈ 1.0 m).
  let floorBoundaries = null
  let rxElevationM = null
  if (crossFloor && crossFloor.floorStack && crossFloor.floorStack.length) {
    const stack = crossFloor.floorStack
    floorBoundaries = []
    for (let i = 0; i < stack.length - 1; i++) {
      // Boundary i sits at stack[i+1].elevationM and belongs to floor[i]
      // (that floor's ceiling / the next floor's floor slab).
      // A hole with floor-index range [fromIdx, toIdx] bypasses boundaries
      // i such that fromIdx <= i <= toIdx − 1. The hole's points are stored
      // in its own floor's canvas px; convert to meters using that floor's
      // scale so the XY footprint is correct regardless of which floor
      // authored the hole.
      const bypassHoles = []
      for (let k = 0; k < stack.length; k++) {
        const f = stack[k]
        for (const hole of (f.holes ?? [])) {
          if (hole.fromIdx == null || hole.toIdx == null) continue
          if (hole.fromIdx <= i && i <= hole.toIdx - 1) {
            const holePxToM = f.scale ? 1 / f.scale : pxToM
            const pts = new Array(hole.points.length)
            for (let p = 0; p < hole.points.length; p++) pts[p] = hole.points[p] * holePxToM
            bypassHoles.push(pts)
          }
        }
      }
      floorBoundaries.push({
        yM: stack[i + 1].elevationM,
        slabDb: stack[i].slabDb ?? 0,
        bypassHoles,
      })
    }
    rxElevationM = (crossFloor.activeElevationM ?? 0) + (crossFloor.rxHeightM ?? 1.0)
  }

  return {
    size: { w, h },
    walls: wallSegs,
    corners,
    aps: apList,
    scopeMaskFn,
    floorBoundaries,   // null when single-floor
    rxElevationM,      // null when single-floor
  }
}
