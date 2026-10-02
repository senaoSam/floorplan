import * as THREE from 'three'

// Procedural vehicles for the CAMERA-mode track layer (TrackLayer3D).
//
// Nine generic types — sedan, SUV, electric fastback, taxi, open-wheel racer,
// box truck, city bus, scooter and bicycle (the two-wheelers carry a rider) —
// all built from code, no model files: side profiles extruded and then
// pinched in plan view, lathe-turned tyres, and boxes / rods for lights, trim
// and hardware. None of them copies a real make, model or operator; there
// are no brand marks, badges or liveries.
//
// Every type is described as data: a list of LAYERS (one merged geometry per
// material preset, so a vehicle is one draw call per material, never one per
// part) plus a list of WHEELS (separate meshes, so they can roll). makeVehicle
// turns that into a Group exposing the handles TrackLayer3D drives:
//   userData.tintMat   — the 'paint' layer (body colour)
//   userData.jacketMat — the 'jacket' layer (two-wheeler riders), if any
//   userData.extraMats — every other material
//   userData.wheels    — rolled by the distance travelled (each knows its r)
// applyVehicleState colours them: a DETECTED vehicle shows its own realistic
// colours (vehicleColors — picked per track from a per-type palette); an
// undetected one goes grey and translucent, the same ghost reading people and
// the 2D icons use. The trail ribbon keeps the detection colour.
//
// Vehicle frame: +X = front, Y = up, ±Z = the two sides; origin on the
// ground at the vehicle's centre.

const INITIAL_PAINT = '#3b82f6'
const CHROME_COLOR = '#94a3b8'

// Share of the vehicle tracks each type gets (picked per track, stable).
export const VEHICLE_WEIGHTS = {
  sedan: 0.22, suv: 0.22, ev: 0.14, taxi: 0.1, scooter: 0.1,
  truck: 0.07, racer: 0.05, bus: 0.05, bicycle: 0.05,
}
const TYPE_ORDER = Object.keys(VEHICLE_WEIGHTS)

// Stable type pick per track id — a vehicle keeps its body for its whole
// drive even when pool slots shift as other tracks start and end.
export function pickVehicleType(id) {
  const s = String(id)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  // Avalanche finaliser: track ids differ only in their trailing digits
  // ("trk-…-d0-17"), and plain FNV leaves that clustered — measured 39%
  // SUVs against a 30% weight on the demo. Mixing spreads them out.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  const u = (h >>> 0) / 4294967296
  let acc = 0
  for (const t of TYPE_ORDER) {
    acc += VEHICLE_WEIGHTS[t]
    if (u < acc) return t
  }
  return TYPE_ORDER[TYPE_ORDER.length - 1]
}

// Material presets every layer picks from ('paint' is the tinted body).
const MATERIALS = {
  carbon: { color: '#1b1e23', roughness: 0.42, metalness: 0.25 },
  chrome: { color: CHROME_COLOR, roughness: 0.22, metalness: 1 },
  glass: { color: '#16202b', roughness: 0.05, metalness: 0.9 },
  trim: { color: '#15181d', roughness: 0.7, metalness: 0.05 },
  plate: { color: '#e8ecef', roughness: 0.5, metalness: 0 },
  helmet: { color: '#eef1f4', roughness: 0.2, metalness: 0.1 },
  skin: { color: '#d3a07e', roughness: 0.6, metalness: 0 },
  head: { color: '#fff7e0', emissive: '#fff1cc', emissiveIntensity: 1.2, roughness: 0.2 },
  tail: { color: '#7a0d0d', emissive: '#ff2a2a', emissiveIntensity: 0.9, roughness: 0.3 },
  sign: { color: '#ffd54a', emissive: '#ffb300', emissiveIntensity: 0.8, roughness: 0.3 },
}
// Which layers cast shadows (small emissive/detail bits don't need to).
const NO_SHADOW = new Set(['chrome', 'plate', 'head', 'tail', 'sign', 'skin'])

// Realistic body colours per type, as [sRGB hex, weight]. Passenger cars
// follow the usual road mix — mostly white, black, grey and silver, a few
// blues and reds, the odd green or brown. Taxis are always taxi yellow.
const CAR_COLORS = [
  ['#e9ecef', 25], ['#15171a', 20], ['#5f6670', 16], ['#b8bec6', 14],
  ['#1f4e8c', 9], ['#9b1c1c', 9], ['#1f3d2b', 3], ['#b9a37e', 2], ['#5a3b26', 2],
]
const PALETTES = {
  sedan: CAR_COLORS,
  suv: CAR_COLORS,
  ev: CAR_COLORS,
  taxi: [['#f2c230', 1]],
  racer: [['#d32f2f', 3], ['#1565c0', 2], ['#ef6c00', 2], ['#2e7d32', 1], ['#f5f5f5', 1], ['#212121', 1], ['#00838f', 1]],
  truck: [['#eef0f2', 6], ['#b8bec6', 2], ['#1f4e8c', 1], ['#9b1c1c', 1], ['#2e5e3a', 1]],
  bus: [['#e9ecef', 3], ['#1d6f42', 2], ['#c62828', 1], ['#1e5aa8', 2], ['#f2a30f', 1]],
  scooter: [['#e9ecef', 3], ['#15171a', 3], ['#9b1c1c', 2], ['#5f6670', 2], ['#7fc8a9', 1], ['#efe3c8', 1], ['#1f4e8c', 1]],
  bicycle: [['#15171a', 3], ['#e9ecef', 2], ['#c62828', 2], ['#1565c0', 2], ['#2e7d32', 1], ['#ef6c00', 1]],
}
// Rider jackets (scooter, bicycle) — everyday outerwear colours.
const JACKETS = [['#1f2937', 3], ['#111827', 2], ['#1e3a8a', 2], ['#6b7280', 2], ['#7f1d1d', 1], ['#3f6212', 1], ['#a16207', 1], ['#f3f4f6', 1]]
const GHOST_COLOR = new THREE.Color('#64748b')

function hash32(str, salt) {
  let h = 2166136261 ^ salt
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}
function weightedPick(list, h) {
  const total = list.reduce((a, [, w]) => a + w, 0)
  let u = (h / 4294967296) * total
  for (const [c, w] of list) { if ((u -= w) < 0) return c }
  return list[list.length - 1][0]
}

// Stable colours per track: { paint, jacket } as THREE.Colors (cached).
const colorCache = new Map()
export function vehicleColors(kind, id) {
  const key = `${kind}|${id}`
  let c = colorCache.get(key)
  if (!c) {
    c = {
      paint: new THREE.Color(weightedPick(PALETTES[kind] ?? CAR_COLORS, hash32(String(id), 0x3c))),
      jacket: new THREE.Color(weightedPick(JACKETS, hash32(String(id), 0x91))),
    }
    colorCache.set(key, c)
  }
  return c
}

// Detected → own colours; ghost → grey + `opacity`; highlight (seen by the
// selected camera) → the body and jacket glow `glowColor`.
const _black = new THREE.Color('#000000')
export function applyVehicleState(g, detected, colors, opacity, highlight, glowColor, emissiveIntensity) {
  const { tintMat, jacketMat, extraMats } = g.userData
  tintMat.color.copy(detected ? colors.paint : GHOST_COLOR)
  if (jacketMat) jacketMat.color.copy(detected ? colors.jacket : GHOST_COLOR)
  const tinted = jacketMat ? [tintMat, jacketMat] : [tintMat]
  for (const m of tinted) {
    m.emissive.copy(highlight ? glowColor : _black)
    m.emissiveIntensity = highlight ? emissiveIntensity : 0
  }
  const wantTransparent = opacity < 1
  for (const m of [...tinted, ...extraMats]) {
    m.opacity = opacity
    // Recompile on the flip: three bakes `transparent` into the program's
    // OPAQUE define. Both variants stay cached, so it is one compile per
    // variant per page, not per toggle.
    if (m.transparent !== wantTransparent) {
      m.transparent = wantTransparent
      m.needsUpdate = true
    }
    // depthWrite stays on for ghosts: a vehicle is several overlapping
    // meshes, and with it off three sorts whole meshes by distance, so a
    // part can vanish behind the body from some angles.
    m.depthWrite = true
  }
}

// ── Geometry helpers ───────────────────────────────────────────────────────

// Extrude runs 0→depth along Z; recentre so the profile sits on the long
// axis. A small bevel rounds every edge so the IBL catches a highlight along
// it the way it does on real bodywork.
function extrudeCentered(shape, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: 12,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
  })
  g.translate(0, 0, -depth / 2)
  return g
}

// Pinch an extruded part in plan view: every vertex's z is scaled by
// fn(x, y). A straight extrusion is a slab with parallel sides; this turns a
// side profile into a body that narrows to the nose and tail and leans in at
// the top. Normals are left as extruded — the shading error is far below what
// reads at plan distance, and recomputing them on this non-indexed geometry
// would facet the bevels.
function pinchZ(geom, fn) {
  const pos = geom.getAttribute('position')
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) * fn(pos.getX(i), pos.getY(i)))
  pos.needsUpdate = true
  geom.computeBoundingSphere()
  return geom
}

// Piecewise-linear lookup over [[x, value], …] sorted by descending x.
function lerpTable(table, x) {
  if (x >= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    const [x1, v1] = table[i]
    if (x >= x1) {
      const [x0, v0] = table[i - 1]
      return v1 + ((x - x1) / (x0 - x1)) * (v0 - v1)
    }
  }
  return table[table.length - 1][1]
}

const clamp01 = (v) => Math.min(1, Math.max(0, v))

// Merge part geometries (each with its own placement matrix, optionally a
// flat colour) into one non-indexed buffer. Parts: [geometry, matrix,
// colourHex?]; a colour attribute is written when any part carries one.
const _col = new THREE.Color()
function mergeParts(parts) {
  const geos = parts.map(([geo, matrix]) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    g.applyMatrix4(matrix)
    return g
  })
  const n = geos.reduce((s, g) => s + g.getAttribute('position').count, 0)
  const withColor = parts.some((p) => p[2])
  const pos = new Float32Array(n * 3)
  const nor = new Float32Array(n * 3)
  const col = withColor ? new Float32Array(n * 3) : null
  let o = 0
  geos.forEach((g, i) => {
    const count = g.getAttribute('position').count
    pos.set(g.getAttribute('position').array, o * 3)
    nor.set(g.getAttribute('normal').array, o * 3)
    if (col) {
      _col.set(parts[i][2] ?? '#ffffff')
      for (let k = 0; k < count; k++) col.set([_col.r, _col.g, _col.b], (o + k) * 3)
    }
    o += count
    g.dispose()
  })
  for (const [geo] of parts) geo.dispose()
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3))
  out.computeBoundingSphere()
  return out
}

const _eul = new THREE.Euler()
const _one = new THREE.Vector3(1, 1, 1)
const place = (x, y, z, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(_eul.set(rx, ry, rz)), _one)
const ORIGIN = place(0, 0, 0)
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d)
const ball = (r) => new THREE.SphereGeometry(r, 14, 10)

// A rod between two points (suspension arms, frames, limbs, trim strips).
function rod(a, b, r, sides = 6) {
  const va = new THREE.Vector3(...a)
  const vb = new THREE.Vector3(...b)
  const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), sides)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize())
  return [g, new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, _one)]
}
const mirrorZ = ([x, y, z]) => [x, y, -z]

// Turn { material: [parts…] } into the layer list makeVehicle consumes.
function toLayers(byMaterial) {
  return Object.entries(byMaterial)
    .filter(([, parts]) => parts.length)
    .map(([material, parts]) => ({ material, geometry: mergeParts(parts) }))
}

// ── Wheels ─────────────────────────────────────────────────────────────────

// Tyre cross-section revolved about the axle: bead → sidewall bulge →
// rounded shoulder → flat tread, mirrored. `rimR` is where the rim meets it.
function lathedTyre(radius, width, rimR) {
  const h = width / 2
  const mid = (rimR + radius) / 2
  const sh = Math.min(0.025, (radius - rimR) / 3)
  const pts = [
    [rimR, -h * 0.92], [mid, -h], [radius - sh, -h * 0.97], [radius, -h * 0.8],
    [radius, h * 0.8], [radius - sh, h * 0.97], [mid, h], [rimR, h * 0.92],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  return new THREE.LatheGeometry(pts, 28)
}

// One wheel = tyre + rim (+ face detail), in ONE geometry with vertex
// colours so it spins as a single mesh. Axle along Z; `outward` (±1) is the
// side the face looks out of. Styles:
//   cover  — flat aero disc + hub cross (racer)
//   spokes — five-spoke alloy (cars, scooter)
//   aero   — smooth near-flush turbine cover (EV)
//   steel  — plain steel disc with a hub (truck, bus)
//   bike   — thin rim, many wire spokes, small hub (bicycle)
function buildWheel({ radius, width, rimFrac, style }, outward) {
  const rimR = radius * rimFrac
  const toAxleZ = new THREE.Matrix4().makeRotationX(Math.PI / 2)
  const face = outward * (width / 2 - Math.min(0.02, width * 0.2))
  const onFace = (dz = 0) => place(0, 0, face + outward * dz).multiply(toAxleZ)
  const parts = [[lathedTyre(radius, width, rimR), toAxleZ, '#141518']]
  if (style === 'bike') {
    // Narrow rim ring, 16 wire spokes crossing to a small hub.
    parts.push([new THREE.TorusGeometry(rimR, 0.012, 6, 32), ORIGIN, '#9aa3ad'])
    parts.push([new THREE.CylinderGeometry(0.025, 0.025, 0.08, 10), toAxleZ, '#6b737d'])
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2
      parts.push([box(rimR, 0.004, 0.004), place(Math.cos(a) * rimR / 2, Math.sin(a) * rimR / 2, (k % 2 ? 1 : -1) * 0.015, 0, 0, a), '#b8c0c8'])
    }
    return mergeParts(parts)
  }
  parts.push([new THREE.CylinderGeometry(rimR, rimR, width * 0.86, 24), toAxleZ, style === 'spokes' ? '#2b2f35' : '#3a3f47'])
  if (style === 'cover') {
    parts.push(
      [new THREE.CylinderGeometry(rimR * 0.85, rimR * 0.85, 0.012, 24), onFace(), '#22262c'],
      [box(0.14, 0.035, 0.03), place(0, 0, face + outward * 0.01), '#c9cfd6'],
      [box(0.035, 0.14, 0.03), place(0, 0, face + outward * 0.01), '#c9cfd6'],
    )
  } else if (style === 'spokes') {
    // Five spokes radiating from a centre cap, a little proud of the barrel.
    parts.push([new THREE.CylinderGeometry(rimR * 0.22, rimR * 0.22, 0.03, 16), onFace(0.01), '#c9cfd6'])
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2
      const len = rimR * 0.82
      parts.push([
        box(len, rimR * 0.16, 0.028),
        place(Math.cos(a) * len / 2, Math.sin(a) * len / 2, face + outward * 0.008, 0, 0, a),
        '#c9cfd6',
      ])
    }
  } else if (style === 'steel') {
    // Painted steel disc with a raised hub and a ring of wheel nuts.
    parts.push(
      [new THREE.CylinderGeometry(rimR * 0.92, rimR * 0.92, 0.014, 24), onFace(0.002), '#8d949c'],
      [new THREE.CylinderGeometry(rimR * 0.3, rimR * 0.34, 0.06, 16), onFace(0.02), '#5d646c'],
    )
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      parts.push([new THREE.CylinderGeometry(0.018, 0.018, 0.03, 6), place(Math.cos(a) * rimR * 0.45, Math.sin(a) * rimR * 0.45, face + outward * 0.02).multiply(toAxleZ), '#c9cfd6'])
    }
  } else {
    // Aero: a smooth light disc with a darker ring and a small centre cap.
    parts.push(
      [new THREE.CylinderGeometry(rimR * 0.96, rimR * 0.96, 0.014, 28), onFace(0.002), '#aab2bb'],
      [new THREE.TorusGeometry(rimR * 0.6, 0.012, 6, 28), place(0, 0, face + outward * 0.012), '#3a3f47'],
      [new THREE.CylinderGeometry(rimR * 0.16, rimR * 0.16, 0.02, 16), onFace(0.012), '#2b2f35'],
    )
  }
  return mergeParts(parts)
}

// Wheel list from [{ x, z }] positions sharing one wheel spec. Two-wheelers
// sit on the centreline (z = 0) and face +Z.
function wheelsAt(positions, spec) {
  return positions.map(({ x, z }) => ({
    x, z, radius: spec.radius,
    geometry: buildWheel(spec, Math.sign(z) || 1),
  }))
}

// ── Riders (scooter, bicycle) ──────────────────────────────────────────────
// A seated rider from rods and balls, posed per vehicle: jacket/jersey on the
// 'riderJacket' layer (its own per-track colour, so the rider doesn't wear
// the vehicle's paint), trousers and shoes 'riderTrim', hands 'riderSkin',
// helmet 'riderHelmet'. The rider* layers go into their own group so
// TrackLayer3D can swap in a realistic seated person (see SEATS) and hide
// this one; it stays as the fallback while the people models load.
// Joint positions are given for the +Z side; the other side mirrors them.
function rider({ hip, shoulder, head, elbow, hand, knee, foot }) {
  const parts = { riderJacket: [], riderTrim: [], riderSkin: [], riderHelmet: [] }
  parts.riderJacket.push(rod([hip[0], hip[1], 0], [shoulder[0], shoulder[1], 0], 0.16, 10))  // torso
  parts.riderJacket.push([ball(0.16), place(shoulder[0], shoulder[1], 0)])                   // shoulders
  parts.riderHelmet.push([ball(0.135), place(...head)])
  for (const side of [(p) => p, mirrorZ]) {
    const [s, e, h] = [shoulder, elbow, hand].map(side)
    parts.riderJacket.push(rod(s, e, 0.055), rod(e, h, 0.048))                         // sleeves
    parts.riderSkin.push([ball(0.045), place(...h)])                                   // hands
    const [hp, k, f] = [hip, knee, foot].map(side)
    parts.riderTrim.push(rod(hp, k, 0.07), rod(k, f, 0.055))                           // legs
    parts.riderTrim.push([box(0.22, 0.07, 0.1), place(f[0] + 0.06, f[1] - 0.02, f[2])]) // shoes
  }
  return parts
}
// How a realistic person sits on each two-wheeler (TrackLayer3D poses one
// with peopleModels' setAngles and places it so its pelvis lands on `pelvis`,
// in vehicle space). Angles are radians about the sideways axis: limbs + =
// forward, spine − = lean forward; the arms are then refitted so the wrists
// land on `grip` (right hand; the left mirrors z). Scooter: upright, knees up,
// feet on the floorboard, half-shell helmet. Bicycle: leaning to the bar, feet
// following the pedals around `crank` (centre + arm length), no helmet.
const SEATS = {
  scooter: {
    // Forward on the saddle and leaning in: from further back the 0.5–0.56 m
    // arms fell ~30 cm short of the grips.
    pelvis: [-0.13, 0.86, 0],
    angles: { spine: -0.3, thighL: 1.4, thighR: 1.4, calfL: -1.35, calfR: -1.35, upperArmL: 0.95, upperArmR: 0.95, forearmL: 0.45, forearmR: 0.45 },
    grip: [0.49, 1.12, 0.29],
    helmet: true,
  },
  bicycle: {
    pelvis: [-0.2, 1.0, 0],
    angles: { spine: -0.55, thighL: 1.15, thighR: 0.75, calfL: -1.1, calfR: -0.6, upperArmL: 1.1, upperArmR: 1.1, forearmL: 0.25, forearmR: 0.25 },
    grip: [0.31, 1.0, 0.2],
    // Bottom bracket and crank-arm length; the ankle sits this far above and
    // behind the pedal axle.
    crank: { x: 0, y: 0.3, r: 0.17, ankle: [-0.03, 0.09] },
    helmet: false,
  },
}

// Merge several { material: parts[] } maps into one.
function combine(...maps) {
  const out = {}
  for (const m of maps) for (const [k, v] of Object.entries(m)) (out[k] ??= []).push(...v)
  return out
}

// ── Open-wheel racer ───────────────────────────────────────────────────────
// A generic single-seater: monocoque with a needle nose, sidepods, aerofoil
// wings with endplates, halo, helmet, carbon floor and wishbone suspension,
// exposed tyres. ~4.8 m long × 1.9 m across the tyres.

const RACER_WHEEL_R = 0.36

// Thin wing section: leading edge at x = 0, trailing edge at x = −chord,
// rounded nose and a flatter underside — reads as an aerofoil, not a plank.
function airfoilShape(chord, thick) {
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.quadraticCurveTo(0.02 * chord, thick, -0.3 * chord, thick)
  s.quadraticCurveTo(-0.75 * chord, thick * 0.8, -chord, thick * 0.15)
  s.lineTo(-chord, 0)
  s.quadraticCurveTo(-0.5 * chord, -thick * 0.25, 0, 0)
  return s
}

// Monocoque + engine cover as one side profile: nose tip → rising nose →
// cockpit → airbox hump → engine cover sloping to the gearbox → flat floor.
function racerChassisShape() {
  const s = new THREE.Shape()
  s.moveTo(2.28, 0.13)
  s.quadraticCurveTo(2.4, 0.15, 2.36, 0.22)        // nose tip
  s.lineTo(1.4, 0.42)                              // nose rising to the bulkhead
  s.quadraticCurveTo(0.95, 0.56, 0.72, 0.6)        // dash
  s.lineTo(0.05, 0.6)                              // cockpit rim
  s.quadraticCurveTo(-0.05, 0.98, -0.2, 0.98)      // airbox over the driver
  s.lineTo(-1.0, 0.74)                             // engine cover
  s.quadraticCurveTo(-1.75, 0.52, -1.95, 0.42)     // tapering to the gearbox
  s.lineTo(-1.98, 0.18)
  s.lineTo(-1.9, 0.1)
  s.lineTo(2.0, 0.1)
  return s
}
// Half-width (m) along the length: needle nose, widest at the cockpit, a
// narrow "coke-bottle" tail.
const RACER_HALF_W = [[2.4, 0.09], [1.6, 0.14], [0.9, 0.27], [0.5, 0.36], [-0.4, 0.36], [-1.2, 0.24], [-2.0, 0.13]]
const RACER_DEPTH = 0.72

// Sidepod: radiator intake at the front, sweeping down and in to the floor.
function racerSidepodShape() {
  const s = new THREE.Shape()
  s.moveTo(0.55, 0.14)
  s.lineTo(0.58, 0.46)
  s.quadraticCurveTo(0.56, 0.56, 0.4, 0.56)        // rounded intake lip
  s.lineTo(-0.5, 0.5)
  s.quadraticCurveTo(-1.05, 0.42, -1.3, 0.2)
  s.lineTo(-1.3, 0.12)
  return s
}

function buildRacer() {
  const R = RACER_WHEEL_R
  const wheelPos = [{ x: 1.55, z: 0.78 }, { x: 1.55, z: -0.78 }, { x: -1.45, z: 0.75 }, { x: -1.45, z: -0.75 }]
  const chassis = pinchZ(extrudeCentered(racerChassisShape(), RACER_DEPTH, 0.04), (x, y) =>
    (lerpTable(RACER_HALF_W, x) / (RACER_DEPTH / 2)) * (1 - 0.25 * clamp01((y - 0.55) / 0.43)))
  const sidepod = (side) => {
    const g = pinchZ(extrudeCentered(racerSidepodShape(), 0.36, 0.03), (x) => lerpTable([[0.2, 1], [-1.3, 0.45]], x))
    // Pinched about its own centre, then pushed out against the chassis.
    return [g, place(0, 0, side * 0.44)]
  }
  const finShape = new THREE.Shape()
  finShape.moveTo(-0.35, 0.95)
  finShape.lineTo(-1.95, 0.9)
  finShape.lineTo(-1.95, 0.62)
  finShape.lineTo(-0.9, 0.72)
  const wing = (chord, thick, span) => extrudeCentered(airfoilShape(chord, thick), span, 0)

  // Suspension: upper + lower wishbone legs from the chassis to each hub.
  const arms = wheelPos.flatMap(({ x, z }) => {
    const s = Math.sign(z)
    const hz = z - s * 0.12
    return [
      rod([x + 0.25, 0.42, s * 0.22], [x, R + 0.08, hz], 0.018),
      rod([x - 0.25, 0.4, s * 0.22], [x, R + 0.08, hz], 0.018),
      rod([x + 0.25, 0.2, s * 0.22], [x, R - 0.1, hz], 0.018),
      rod([x - 0.25, 0.2, s * 0.22], [x, R - 0.1, hz], 0.018),
    ]
  })

  // Halo: a half hoop around the front of the cockpit (open to the rear),
  // turned flat and swung so its arc runs side → front → side.
  const halo = new THREE.TorusGeometry(0.3, 0.03, 8, 28, Math.PI)
  halo.rotateX(-Math.PI / 2)
  halo.rotateY(-Math.PI / 2)

  const front = { radius: R, width: 0.3, rimFrac: 0.65, style: 'cover' }
  const rear = { radius: R, width: 0.4, rimFrac: 0.65, style: 'cover' }
  return {
    layers: toLayers({
      paint: [
        [chassis, ORIGIN],
        sidepod(1),
        sidepod(-1),
        [extrudeCentered(finShape, 0.02, 0), ORIGIN],             // engine-cover fin
        [box(0.5, 0.22, 0.02), place(2.25, 0.18, 0.95)],           // front wing endplates
        [box(0.5, 0.22, 0.02), place(2.25, 0.18, -0.95)],
        [box(0.52, 0.56, 0.02), place(-2.12, 0.74, 0.51)],         // rear wing endplates
        [box(0.52, 0.56, 0.02), place(-2.12, 0.74, -0.51)],
        [box(0.09, 0.06, 0.16), place(0.52, 0.66, 0.5)],           // mirrors
        [box(0.09, 0.06, 0.16), place(0.52, 0.66, -0.5)],
      ],
      carbon: [
        [box(3.3, 0.025, 1.36), place(-0.15, 0.07, 0)],            // floor
        [wing(0.42, 0.035, 1.88), place(2.48, 0.09, 0)],           // front wing main plane
        [wing(0.26, 0.03, 1.7), place(2.2, 0.15, 0, 0, 0, 0.26)],  // front flap
        [wing(0.38, 0.05, 1.0), place(-1.93, 0.8, 0, 0, 0, 0.08)], // rear wing main plane
        [wing(0.22, 0.035, 1.0), place(-2.02, 0.95, 0, 0, 0, 0.32)], // rear flap
        [box(0.26, 0.42, 0.04), place(-2.0, 0.56, 0)],             // rear wing pylon
        [box(0.04, 0.13, 0.17), place(-0.07, 0.86, 0)],            // airbox intake
        [box(0.05, 0.05, 0.17), place(0.27, 0.72, 0)],             // helmet visor
        [halo, place(0.22, 0.8, 0)],
        rod([0.52, 0.8, 0], [0.7, 0.6, 0], 0.025),                 // halo centre pillar
        rod([0.22, 0.8, 0.3], [0.05, 0.6, 0.3], 0.025),            // halo rear legs
        rod([0.22, 0.8, -0.3], [0.05, 0.6, -0.3], 0.025),
        rod([0.46, 0.6, 0.31], [0.52, 0.66, 0.5], 0.012),          // mirror stalks
        rod([0.46, 0.6, -0.31], [0.52, 0.66, -0.5], 0.012),
        ...arms,
      ],
      chrome: [[new THREE.CylinderGeometry(0.045, 0.05, 0.16, 12), place(-2.0, 0.48, 0, 0, 0, Math.PI / 2)]], // exhaust
      helmet: [[new THREE.SphereGeometry(0.125, 18, 12), place(0.16, 0.72, 0)]],
      tail: [[box(0.04, 0.07, 0.13), place(-1.99, 0.32, 0)]],      // rain light
    }),
    wheels: [
      ...wheelsAt(wheelPos.slice(0, 2), front),
      ...wheelsAt(wheelPos.slice(2), rear),
    ],
  }
}

// ── Road cars (sedan, SUV, electric fastback, taxi) ────────────────────────
// Body = side profile with the wheel arches carved out of its underside,
// extruded across the car and pinched: rounded in plan view toward the nose
// and tail, leaning in above the belt line. The greenhouse (all glass, dark
// mirror) is a second, narrower extrusion that leans in harder. Hardware —
// lights, plates, mirrors, handles, grille, trim — is placed per type.

// Carve two wheel arches into the underside. Call after reaching the rear
// bottom corner, heading forward; the shape then closes back to its start.
function arches(s, gc, axleF, axleR, archR) {
  s.lineTo(axleR - archR, gc)
  s.absarc(axleR, gc, archR, Math.PI, 0, true)
  s.lineTo(axleF - archR, gc)
  s.absarc(axleF, gc, archR, Math.PI, 0, true)
}

const ROAD = {
  // Three-box saloon: long hood, upright windshield base, separate trunk,
  // a grille and chrome window trim.
  sedan: {
    len: 4.65, gc: 0.26, axleF: 1.38, axleR: -1.38, archR: 0.46, trackZ: 0.69,
    bodyDepth: 1.5, glassDepth: 1.26,
    belt: 0.9, tumble: 0.06, glassLean: 0.18,
    wheel: { radius: 0.33, width: 0.24, rimFrac: 0.6, style: 'spokes' },
    body(s) {
      s.moveTo(2.18, this.gc)                          // front lower lip
      s.quadraticCurveTo(2.34, 0.32, 2.31, 0.52)      // front bumper
      s.quadraticCurveTo(2.28, 0.7, 2.02, 0.76)       // nose
      s.lineTo(0.98, 0.9)                             // hood
      s.lineTo(-1.7, 1.02)                            // belt line
      s.quadraticCurveTo(-2.26, 1.0, -2.3, 0.72)      // trunk lid
      s.quadraticCurveTo(-2.32, 0.4, -2.08, this.gc)  // rear bumper
      arches(s, this.gc, this.axleF, this.axleR, this.archR)
    },
    glass(s) {
      s.moveTo(0.92, 0.88)                            // windshield base
      s.lineTo(0.26, 1.38)                            // windshield rake
      s.quadraticCurveTo(0.06, 1.44, -0.3, 1.44)      // roof front
      s.lineTo(-0.86, 1.42)                           // roof
      s.quadraticCurveTo(-1.1, 1.38, -1.72, 0.92)     // rear window
    },
    sideZ: 0.81,   // body flat side after pinch, at handle height
    hardware(z) {
      return {
        head: [[box(0.08, 0.1, 0.36), place(2.26, 0.64, 0.5)], [box(0.08, 0.1, 0.36), place(2.26, 0.64, -0.5)]],
        tail: [[box(0.08, 0.12, 0.32), place(-2.28, 0.8, 0.56)], [box(0.08, 0.12, 0.32), place(-2.28, 0.8, -0.56)]],
        plate: [[box(0.02, 0.11, 0.34), place(2.33, 0.36, 0)], [box(0.02, 0.11, 0.34), place(-2.33, 0.5, 0)]],
        trim: [
          [box(0.06, 0.12, 0.72), place(2.29, 0.46, 0)],   // grille
          [box(0.06, 0.07, 1.0), place(2.26, 0.3, 0)],     // lower intake
          ...[0.34, -0.56].flatMap((hx) => [1, -1].map((s) => [box(0.24, 0.07, 0.06), place(hx, 0.9, s * z)])),
        ],
        // Chrome strip along the bottom of the side windows.
        chrome: [1, -1].map((s) => rod([0.9, 0.93, s * (z - 0.06)], [-1.66, 1.03, s * (z - 0.06)], 0.014)),
        mirrors: [1, -1].map((s) => [box(0.2, 0.1, 0.14), place(0.8, 0.98, s * (z + 0.05))]),
      }
    },
  },
  // SUV: tall body, high ground clearance, near-vertical tailgate, bigger
  // wheels, roof rails.
  suv: {
    len: 4.75, gc: 0.34, axleF: 1.42, axleR: -1.42, archR: 0.5, trackZ: 0.78,
    bodyDepth: 1.66, glassDepth: 1.42,
    belt: 1.1, tumble: 0.05, glassLean: 0.14,
    wheel: { radius: 0.37, width: 0.27, rimFrac: 0.6, style: 'spokes' },
    body(s) {
      s.moveTo(2.26, this.gc)
      s.quadraticCurveTo(2.4, 0.42, 2.38, 0.62)       // bumper
      s.quadraticCurveTo(2.36, 0.92, 2.2, 0.98)       // blunt nose
      s.lineTo(1.25, 1.08)                            // hood
      s.lineTo(-2.1, 1.12)                            // belt line
      s.quadraticCurveTo(-2.36, 1.12, -2.37, 0.95)    // tailgate top
      s.lineTo(-2.37, 0.5)                            // tailgate
      s.quadraticCurveTo(-2.36, 0.36, -2.2, this.gc)  // rear bumper
      arches(s, this.gc, this.axleF, this.axleR, this.archR)
    },
    glass(s) {
      s.moveTo(1.2, 1.05)
      s.lineTo(0.48, 1.68)                            // windshield
      s.quadraticCurveTo(0.36, 1.74, 0.1, 1.74)
      s.lineTo(-1.95, 1.74)                           // long flat roof
      s.quadraticCurveTo(-2.2, 1.73, -2.28, 1.5)
      s.lineTo(-2.32, 1.08)                           // upright rear glass
    },
    sideZ: 0.9,
    hardware(z) {
      return {
        head: [[box(0.08, 0.12, 0.4), place(2.33, 0.86, 0.56)], [box(0.08, 0.12, 0.4), place(2.33, 0.86, -0.56)]],
        tail: [[box(0.06, 0.26, 0.14), place(-2.36, 0.98, 0.72)], [box(0.06, 0.26, 0.14), place(-2.36, 0.98, -0.72)]],
        plate: [[box(0.02, 0.11, 0.34), place(2.4, 0.5, 0)], [box(0.02, 0.11, 0.34), place(-2.38, 0.7, 0)]],
        trim: [
          [box(0.06, 0.2, 0.9), place(2.37, 0.72, 0)],     // tall grille
          [box(0.08, 0.1, 1.5), place(2.36, 0.38, 0)],     // black lower bumper
          [box(0.08, 0.12, 1.5), place(-2.38, 0.4, 0)],    // rear bumper cladding
          ...[0.45, -0.6].flatMap((hx) => [1, -1].map((s) => [box(0.24, 0.07, 0.06), place(hx, 1.06, s * z)])),
          // Roof rails: two bars on short posts.
          ...[1, -1].flatMap((s) => [
            rod([0.15, 1.8, s * 0.56], [-1.9, 1.8, s * 0.56], 0.022, 8),
            [box(0.06, 0.07, 0.05), place(0.1, 1.77, s * 0.56)],
            [box(0.06, 0.07, 0.05), place(-1.85, 1.77, s * 0.56)],
          ]),
        ],
        chrome: [1, -1].map((s) => rod([1.15, 1.09, s * (z - 0.06)], [-2.2, 1.13, s * (z - 0.06)], 0.012)),
        mirrors: [1, -1].map((s) => [box(0.22, 0.13, 0.16), place(1.0, 1.18, s * (z + 0.06))]),
      }
    },
  },
  // Electric fastback: smooth closed nose (no grille), short hood, one long
  // roof line sweeping into a short ducktail, a dark glass roof, slim light
  // strips front and rear, flush handles (none drawn), aero wheel covers.
  ev: {
    len: 4.72, gc: 0.25, axleF: 1.45, axleR: -1.45, archR: 0.47, trackZ: 0.72,
    bodyDepth: 1.56, glassDepth: 1.3,
    belt: 0.95, tumble: 0.07, glassLean: 0.2,
    wheel: { radius: 0.34, width: 0.25, rimFrac: 0.62, style: 'aero' },
    body(s) {
      s.moveTo(2.2, this.gc)
      s.quadraticCurveTo(2.4, 0.3, 2.38, 0.5)         // smooth lower nose
      s.quadraticCurveTo(2.34, 0.7, 2.0, 0.78)        // closed nose, no grille
      s.lineTo(1.05, 0.9)                             // short hood
      s.lineTo(-1.95, 0.98)                           // belt line
      s.quadraticCurveTo(-2.32, 0.98, -2.34, 0.74)    // ducktail lip
      s.quadraticCurveTo(-2.36, 0.42, -2.12, this.gc) // rear bumper
      arches(s, this.gc, this.axleF, this.axleR, this.archR)
    },
    glass(s) {
      s.moveTo(1.0, 0.86)
      s.lineTo(0.2, 1.38)                             // long raked windshield
      s.quadraticCurveTo(-0.1, 1.46, -0.5, 1.45)      // glass roof crest
      s.quadraticCurveTo(-1.4, 1.38, -2.05, 0.96)     // fastback sweep
    },
    sideZ: 0.84,
    hardware() {
      return {
        head: [[box(0.06, 0.04, 0.44), place(2.3, 0.68, 0.5)], [box(0.06, 0.04, 0.44), place(2.3, 0.68, -0.5)]],
        // Full-width tail light bar.
        tail: [[box(0.05, 0.05, 1.46), place(-2.31, 0.84, 0)]],
        plate: [[box(0.02, 0.11, 0.34), place(2.38, 0.38, 0)], [box(0.02, 0.11, 0.34), place(-2.33, 0.52, 0)]],
        trim: [[box(0.06, 0.06, 1.1), place(2.32, 0.3, 0)]],   // slim lower intake only
        chrome: [],
        mirrors: [1, -1].map((s) => [box(0.18, 0.09, 0.13), place(0.86, 0.96, s * 0.88)]),
      }
    },
  },
}

// `extra` adds parts per material on top of the type's own hardware (the
// taxi is a sedan plus a roof sign).
function buildRoadCar(spec, extra = {}) {
  const half = spec.len / 2
  // Plan-view rounding over the last 0.85 m of each end, tumblehome above the
  // belt line — the same pinch for body and glass, the glass leaning harder.
  const plan = (x) => {
    const t = clamp01((Math.abs(x) - (half - 0.85)) / 0.85)
    return 1 - 0.12 * t * t
  }
  const bodyShape = new THREE.Shape()
  spec.body(bodyShape)
  const glassShape = new THREE.Shape()
  spec.glass(glassShape)
  const body = pinchZ(extrudeCentered(bodyShape, spec.bodyDepth, 0.08), (x, y) =>
    plan(x) * (1 - spec.tumble * clamp01((y - (spec.belt - 0.2)) / 0.35)))
  const glass = pinchZ(extrudeCentered(glassShape, spec.glassDepth, 0.05), (x, y) =>
    plan(x) * (1 - spec.glassLean * clamp01((y - spec.belt) / 0.55)))
  const hw = spec.hardware(spec.sideZ)
  return {
    layers: toLayers(combine({
      paint: [[body, ORIGIN], ...hw.mirrors],
      glass: [[glass, ORIGIN]],
      trim: hw.trim,
      chrome: hw.chrome,
      plate: hw.plate,
      head: hw.head,
      tail: hw.tail,
    }, extra)),
    wheels: wheelsAt([
      { x: spec.axleF, z: spec.trackZ }, { x: spec.axleF, z: -spec.trackZ },
      { x: spec.axleR, z: spec.trackZ }, { x: spec.axleR, z: -spec.trackZ },
    ], spec.wheel),
  }
}

// Taxi: the sedan body with a lit roof sign on a slim base. The body paint
// stays the state colour like every other vehicle — the sign is what reads as
// "taxi" (no operator name or text on it).
function buildTaxi() {
  return buildRoadCar(ROAD.sedan, {
    trim: [[box(0.66, 0.04, 0.4), place(-0.56, 1.47, 0)]],
    sign: [[box(0.6, 0.18, 0.34), place(-0.56, 1.58, 0)]],
  })
}

// ── Box truck ──────────────────────────────────────────────────────────────
// Cab-over-chassis delivery truck, ~6.4 m × 2.2 m × 3.3 m: rounded cab with
// a raked windshield and side windows, a tall cargo box behind it (painted —
// it is the largest surface, so it carries the state colour), ladder frame,
// fuel tanks, bumpers, single front and dual rear wheels.
function buildTruck() {
  const wheel = { radius: 0.48, width: 0.28, rimFrac: 0.55, style: 'steel' }
  const cab = new THREE.Shape()
  cab.moveTo(3.2, 0.5)
  cab.lineTo(3.24, 1.25)
  cab.lineTo(3.1, 2.45)                                  // raked windshield
  cab.quadraticCurveTo(3.05, 2.62, 2.85, 2.62)
  cab.lineTo(1.45, 2.62)                                 // cab roof
  cab.lineTo(1.45, 0.5)
  cab.lineTo(2.35 - 0.58, 0.5)
  cab.absarc(2.35, 0.5, 0.58, Math.PI, 0, true)          // front wheel arch
  const cabGeo = extrudeCentered(cab, 2.1, 0.06)
  const side = 1.12                                      // cab side face z
  return {
    layers: toLayers({
      paint: [
        [cabGeo, ORIGIN],
        [box(4.5, 2.3, 2.3), place(-0.95, 2.15, 0)],     // cargo box
      ],
      glass: [
        [box(0.04, 1.1, 1.9), place(3.19, 1.85, 0, 0, 0, 0.116)],          // windshield
        [box(0.9, 0.72, 0.02), place(2.4, 2.0, side + 0.01)],               // side windows
        [box(0.9, 0.72, 0.02), place(2.4, 2.0, -side - 0.01)],
      ],
      trim: [
        [box(6.1, 0.22, 0.9), place(-0.05, 0.72, 0)],    // ladder frame
        [box(0.15, 0.3, 2.2), place(3.25, 0.62, 0)],     // front bumper
        [box(0.05, 0.6, 1.3), place(3.24, 1.05, 0)],     // grille
        [box(0.12, 0.2, 2.1), place(-3.2, 0.62, 0)],     // rear bumper
        [box(0.04, 2.1, 0.02), place(-3.22, 2.15, 0)],   // rear door seam
        ...[1, -1].flatMap((s) => [
          rod([3.0, 1.75, s * side], [3.05, 1.95, s * 1.38], 0.02),       // mirror arms
          [box(0.06, 0.32, 0.14), place(3.05, 2.05, s * 1.4)],             // mirrors
        ]),
      ],
      chrome: [1, -1].map((s) => [new THREE.CylinderGeometry(0.22, 0.22, 0.9, 16), place(0.85, 0.75, s * 0.8, 0, 0, Math.PI / 2)]), // fuel tanks
      head: [1, -1].map((s) => [box(0.06, 0.18, 0.3), place(3.26, 0.95, s * 0.8)]),
      tail: [1, -1].map((s) => [box(0.05, 0.15, 0.2), place(-3.27, 0.75, s * 0.85)]),
      plate: [[box(0.02, 0.12, 0.36), place(3.335, 0.62, 0)], [box(0.02, 0.12, 0.36), place(-3.27, 0.95, 0)]],
    }),
    wheels: wheelsAt([
      { x: 2.35, z: 0.95 }, { x: 2.35, z: -0.95 },
      { x: -1.9, z: 0.82 }, { x: -1.9, z: -0.82 },       // dual rears: inner…
      { x: -1.9, z: 1.11 }, { x: -1.9, z: -1.11 },       // …and outer
    ], wheel),
  }
}

// ── City bus ───────────────────────────────────────────────────────────────
// A midi city bus, ~9.1 m × 2.45 m × 3.2 m: rounded box body, a continuous
// side window band, glass doors, big windshield, an amber destination sign
// (blank — no route or operator text), roof air-con pod, bumpers.
function buildBus() {
  const wheel = { radius: 0.5, width: 0.32, rimFrac: 0.55, style: 'steel' }
  const s = new THREE.Shape()
  const gc = 0.32
  s.moveTo(4.45, gc)
  s.quadraticCurveTo(4.56, 0.35, 4.55, 0.6)
  s.lineTo(4.52, 2.75)
  s.quadraticCurveTo(4.5, 3.05, 4.2, 3.08)               // front roof corner
  s.lineTo(-4.2, 3.08)
  s.quadraticCurveTo(-4.5, 3.05, -4.52, 2.75)
  s.lineTo(-4.55, 0.6)
  s.quadraticCurveTo(-4.56, 0.35, -4.45, gc)
  arches(s, gc, 3.0, -2.5, 0.6)
  const body = extrudeCentered(s, 2.25, 0.1)
  const side = 1.235                                     // body side face z (+ bevel)
  const front = 4.63
  return {
    layers: toLayers({
      paint: [[body, ORIGIN]],
      glass: [
        ...[1, -1].map((z) => [box(7.0, 1.0, 0.03), place(-0.45, 2.15, z * side)]),   // side window band
        [box(0.04, 1.55, 2.1), place(front, 1.95, 0)],                              // windshield
        [box(0.04, 0.8, 1.9), place(-front, 2.4, 0)],                               // rear window
        [box(0.8, 2.2, 0.03), place(4.0, 1.55, side + 0.005)],                      // front door
        [box(1.1, 2.2, 0.03), place(0.2, 1.55, side + 0.005)],                      // middle door
      ],
      trim: [
        [box(0.12, 0.28, 2.4), place(4.6, 0.45, 0)],     // front bumper
        [box(0.12, 0.28, 2.4), place(-4.6, 0.45, 0)],    // rear bumper
        ...[1, -1].flatMap((z) => [
          rod([4.5, 2.6, z * 1.1], [4.75, 2.55, z * 1.38], 0.025),          // mirror arms
          [box(0.08, 0.36, 0.14), place(4.78, 2.4, z * 1.42)],               // mirrors
        ]),
      ],
      plate: [
        [box(2.2, 0.25, 1.4), place(-0.6, 3.2, 0)],      // roof air-con pod
        [box(0.02, 0.12, 0.36), place(4.675, 0.45, 0)],
        [box(0.02, 0.12, 0.36), place(-4.675, 0.7, 0)],
      ],
      sign: [[box(0.04, 0.3, 1.6), place(front + 0.005, 2.85, 0)]],   // destination sign
      head: [1, -1].map((z) => [box(0.05, 0.15, 0.35), place(front, 0.75, z * 0.85)]),
      tail: [1, -1].map((z) => [box(0.05, 0.3, 0.15), place(-front, 0.9, z * 0.9)]),
    }),
    wheels: wheelsAt([
      { x: 3.0, z: 1.0 }, { x: 3.0, z: -1.0 },
      { x: -2.5, z: 1.0 }, { x: -2.5, z: -1.0 },
    ], wheel),
  }
}

// ── Scooter ────────────────────────────────────────────────────────────────
// Step-through scooter, ~1.85 m long, small wheels: leg shield, floorboard,
// a rear body under the seat, handlebar with headlight and mirrors, rider
// seated upright with feet on the floorboard.
function buildScooter() {
  const wheel = { radius: 0.21, width: 0.1, rimFrac: 0.6, style: 'spokes' }
  const s = new THREE.Shape()
  s.moveTo(0.78, 0.3)
  s.lineTo(0.8, 0.95)                                    // leg shield front
  s.quadraticCurveTo(0.78, 1.05, 0.68, 1.05)
  s.lineTo(0.55, 1.0)
  s.lineTo(0.42, 0.42)                                   // inner shield down to the floor
  s.lineTo(-0.05, 0.38)                                  // floorboard
  s.lineTo(-0.15, 0.62)                                  // rise to the seat body
  s.lineTo(-0.75, 0.72)                                  // under-seat body
  s.quadraticCurveTo(-0.94, 0.7, -0.92, 0.5)             // tail
  s.lineTo(-0.6, 0.3)
  const body = pinchZ(extrudeCentered(s, 0.34, 0.03), (x) => 1 - 0.3 * clamp01((x - 0.45) / 0.35) - 0.25 * clamp01((-x - 0.6) / 0.32))
  const r = rider({
    hip: [-0.32, 0.88, 0.12], shoulder: [-0.2, 1.38, 0.2], head: [-0.16, 1.62, 0],
    elbow: [0.12, 1.16, 0.26], hand: [0.5, 1.13, 0.3],
    knee: [0.12, 0.86, 0.17], foot: [0.18, 0.46, 0.14],
  })
  return {
    layers: toLayers(combine({
      paint: [[body, ORIGIN]],
      trim: [
        [box(0.62, 0.1, 0.3), place(-0.42, 0.79, 0)],                       // seat
        rod([0.62, 0.21, 0.07], [0.74, 0.95, 0.07], 0.022),                 // fork legs
        rod([0.62, 0.21, -0.07], [0.74, 0.95, -0.07], 0.022),
        rod([0.74, 0.95, 0], [0.56, 1.12, 0], 0.03),                        // steering column
        rod([0.54, 1.12, -0.36], [0.54, 1.12, 0.36], 0.018),                // handlebar
        ...[1, -1].flatMap((z) => [
          rod([0.52, 1.12, z * 0.26], [0.5, 1.3, z * 0.29], 0.008),          // mirror stalks
          [box(0.04, 0.06, 0.12), place(0.5, 1.32, z * 0.3)],                // mirrors
        ]),
      ],
      head: [[box(0.06, 0.08, 0.16), place(0.73, 1.08, 0)]],
      tail: [[box(0.04, 0.06, 0.16), place(-0.93, 0.6, 0)]],
      plate: [[box(0.02, 0.1, 0.16), place(-0.9, 0.42, 0)]],
    }, r)),
    wheels: wheelsAt([{ x: 0.62, z: 0 }, { x: -0.6, z: 0 }], wheel),
    seat: SEATS.scooter,
  }
}

// ── Bicycle ────────────────────────────────────────────────────────────────
// Diamond-frame bike, ~1.75 m long, 0.68 m wire wheels, rider leaning
// forward to the bar.
function buildBicycle() {
  const wheel = { radius: 0.34, width: 0.035, rimFrac: 0.9, style: 'bike' }
  const bb = [0, 0.3, 0]
  const seatTop = [-0.16, 0.86, 0]
  const headTop = [0.38, 0.86, 0]
  const headBot = [0.42, 0.66, 0]
  const both = (fn) => [1, -1].map(fn)
  const r = rider({
    hip: [-0.2, 1.0, 0.1], shoulder: [0.14, 1.4, 0.18], head: [0.24, 1.58, 0],
    elbow: [0.26, 1.18, 0.2], hand: [0.38, 1.0, 0.22],
    knee: [0.16, 0.72, 0.12], foot: [0.03, 0.31, 0.11],
  })
  return {
    layers: toLayers(combine({
      paint: [
        rod(bb, seatTop, 0.022),                         // seat tube
        rod(seatTop, headTop, 0.022),                    // top tube
        rod(bb, headBot, 0.026),                         // down tube
        rod(headBot, headTop, 0.028),                    // head tube
        ...both((z) => rod([0, 0.3, z * 0.05], [-0.52, 0.34, z * 0.05], 0.014)),   // chainstays
        ...both((z) => rod([-0.16, 0.84, z * 0.03], [-0.52, 0.34, z * 0.05], 0.013)), // seatstays
        ...both((z) => rod([0.42, 0.66, z * 0.03], [0.52, 0.34, z * 0.05], 0.015)),  // fork
      ],
      trim: [
        [box(0.22, 0.05, 0.12), place(-0.2, 0.93, 0)],   // saddle
        rod([-0.17, 0.86, 0], [-0.19, 0.91, 0], 0.012),  // seat post
        rod(headTop, [0.36, 1.0, 0], 0.015),             // stem
        rod([0.36, 1.0, -0.24], [0.36, 1.0, 0.24], 0.012), // handlebar
      ],
      head: [[box(0.04, 0.04, 0.05), place(0.42, 0.98, 0)]],
      tail: [[box(0.03, 0.04, 0.05), place(-0.26, 0.86, 0)]],
    }, r)),
    wheels: wheelsAt([{ x: 0.52, z: 0 }, { x: -0.52, z: 0 }], wheel),
    crank: { x: SEATS.bicycle.crank.x, y: SEATS.bicycle.crank.y, geometry: buildCrank(SEATS.bicycle.crank.r) },
    seat: SEATS.bicycle,
  }
}

// Crank set, about the bottom bracket (local origin), axle along Z: two arms
// 180° apart, pedals on their ends, chainring on the right. One vertex-
// coloured geometry so it turns as one mesh.
function buildCrank(r) {
  const toAxleZ = new THREE.Matrix4().makeRotationX(Math.PI / 2)
  return mergeParts([
    rod([0, 0, 0.08], [r, 0, 0.08], 0.012), rod([0, 0, -0.08], [-r, 0, -0.08], 0.012),
    [box(0.09, 0.02, 0.07), place(r, 0, 0.12), '#2b2f35'],
    [box(0.09, 0.02, 0.07), place(-r, 0, -0.12), '#2b2f35'],
    [new THREE.CylinderGeometry(0.1, 0.1, 0.008, 24), place(0, 0, 0.07).multiply(toAxleZ), '#b8c0c8'],
    [new THREE.CylinderGeometry(0.02, 0.02, 0.18, 8), toAxleZ, '#6b737d'],   // axle
  ].map((p) => (p.length === 2 ? [...p, '#15181d'] : p)))
}

// ── Public API ─────────────────────────────────────────────────────────────

// Every type's shared geometry, built once per layer mount.
export function buildVehicleGeometries() {
  return {
    sedan: buildRoadCar(ROAD.sedan),
    suv: buildRoadCar(ROAD.suv),
    ev: buildRoadCar(ROAD.ev),
    taxi: buildTaxi(),
    racer: buildRacer(),
    truck: buildTruck(),
    bus: buildBus(),
    scooter: buildScooter(),
    bicycle: buildBicycle(),
  }
}

export function disposeVehicleGeometries(all) {
  for (const set of Object.values(all)) {
    for (const l of set.layers) l.geometry.dispose()
    for (const w of set.wheels) w.geometry.dispose()
    set.crank?.geometry.dispose()
  }
}

// One vehicle from a type's geometry set. The body paint is a clearcoat
// physical material (a glossy lacquer lobe over a metallic base, reflecting
// the sky environment; clearcoat is an extra shading lobe, not an extra
// render pass like transmission). The other layers use the MATERIALS presets.
export function makeVehicle(set, kind) {
  const tintMat = new THREE.MeshPhysicalMaterial({
    color: INITIAL_PAINT, roughness: 0.36, metalness: 0.42, clearcoat: 1, clearcoatRoughness: 0.05,
  })
  const extra = []
  let jacketMat = null
  const g = new THREE.Group()
  // The primitive rider (two-wheelers), grouped so a realistic one can
  // replace it.
  const riderGroup = new THREE.Group()
  for (const { material, geometry } of set.layers) {
    const isRider = material.startsWith('rider')
    const preset = isRider ? material.slice(5).toLowerCase() : material
    let m = tintMat
    if (preset === 'jacket') {
      m = jacketMat = new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.8, metalness: 0 })
    } else if (preset !== 'paint') {
      m = new THREE.MeshStandardMaterial(MATERIALS[preset])
      extra.push(m)
    }
    const mesh = new THREE.Mesh(geometry, m)
    mesh.castShadow = !NO_SHADOW.has(preset)
    ;(isRider ? riderGroup : g).add(mesh)
  }
  if (riderGroup.children.length) g.add(riderGroup)
  // Wheels: each its own mesh at the hub so it can roll (rotation about the
  // axle, local Z). Each carries its own radius — trucks and bikes differ.
  const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15 })
  extra.push(wheelMat)
  const wheels = set.wheels.map(({ x, z, radius, geometry }) => {
    const w = new THREE.Mesh(geometry, wheelMat)
    w.position.set(x, radius, z)
    w.castShadow = true
    w.userData.radius = radius
    g.add(w)
    return w
  })
  if (set.crank) {
    const c = new THREE.Mesh(set.crank.geometry, wheelMat)
    c.position.set(set.crank.x, set.crank.y, 0)
    c.castShadow = true
    g.add(c)
    g.userData.crank = c
  }
  // Two-wheelers lean into turns: yaw first, then roll about their own
  // forward axis.
  if (set.seat) g.rotation.order = 'YXZ'
  g.visible = false
  g.userData.vehicleKind = kind
  g.userData.tintMat = tintMat
  g.userData.jacketMat = jacketMat
  g.userData.seat = set.seat ?? null
  g.userData.primitiveRider = riderGroup.children.length ? riderGroup : null
  g.userData.extraMats = extra
  g.userData.wheels = wheels
  g.userData.minWheelRadius = Math.min(...wheels.map((w) => w.userData.radius))
  g.userData.rollDist = 0
  return g
}

export function disposeVehicle(g) {
  g.userData.tintMat?.dispose()
  g.userData.jacketMat?.dispose()
  g.userData.extraMats?.forEach((m) => m.dispose())
}
