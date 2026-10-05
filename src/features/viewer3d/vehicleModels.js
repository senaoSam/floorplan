import * as THREE from 'three'
import { glassMaterialProps } from './glassMaterial'

// Procedural vehicles for the CAMERA-mode track layer (TrackLayer3D).
//
// Nine generic types — sedan, SUV, electric fastback, taxi, open-wheel racer,
// box truck, city bus, scooter and bicycle (the two-wheelers carry a rider) —
// all built from code, no model files: side profiles extruded and then
// pinched in plan view, lathe-turned tyres, and boxes / rods / ellipsoids for
// lights, trim, mirrors and the cabin. None of them copies a real make, model
// or operator; there are no brand marks, badges or liveries.
//
// Every builder returns a PARTS map — { materialKey: [[geometry, matrix], …] }
// — and assemble() turns it into a few meshes per vehicle:
//   body  — every opaque part merged into ONE geometry. Each vertex carries
//           its own material: a colour, aMat = (paint flag, light id,
//           roughness, metalness). One clearcoat physical material shades it
//           all; the shader takes the paint colour from a uniform where the
//           flag is set, keeps the clearcoat lobe to paint only, and lights
//           lamp lenses from a per-vehicle uLights[] array (so turn signals,
//           brake and head lights switch per frame with no material swaps).
//   glass — the glazing, Fresnel glass (glassMaterial.js — the same look as
//           the wall and window glass), see-through to the cabin.
//   glow  — one point sprite per lamp, additive, lit by the same uLights[]:
//           the "this lamp is on" halo (there is no bloom pass).
//   rider — two-wheelers' primitive fallback rider (separate, swappable).
//   wheels / crank — separate meshes so they can turn.
// makeVehicle exposes the handles TrackLayer3D drives; applyVehicleState sets
// the state colours and updateVehicleLights the lamps.
//
// A DETECTED vehicle shows its own realistic colours (vehicleColors — picked
// per track from a per-type palette); an undetected one goes grey and
// translucent, the same ghost reading people and the 2D icons use.
//
// Vehicle frame: +X = front, Y = up, +Z = right side, −Z = left (driver)
// side; origin on the ground at the vehicle's centre.

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

// ── Lamps ──────────────────────────────────────────────────────────────────
// Light ids carried per vertex (aMat.y) and per glow sprite. uLights[id] is
// the lamp's current intensity (0 = off), set by updateVehicleLights.
export const LIGHT = { NONE: 0, DRL: 1, HEAD: 2, TAIL: 3, BRAKE: 4, TURN_L: 5, TURN_R: 6, SIGN: 7 }
const LIGHT_COUNT = 8
// Emissive colour × gain per lamp (sRGB hex). The tail lamp shares its lens
// with the brake function — updateVehicleLights drives it brighter on brake.
// Reds are a deep red at a modest gain: pushed past the tone curve's shoulder
// a bright red reads orange.
const LIGHT_EMIT = {
  [LIGHT.DRL]: ['#eaf2ff', 1.6],
  [LIGHT.HEAD]: ['#fff3d6', 2.4],
  [LIGHT.TAIL]: ['#ff1208', 0.85],
  [LIGHT.BRAKE]: ['#ff1208', 0.85],
  [LIGHT.TURN_L]: ['#ffa21f', 2.6],
  [LIGHT.TURN_R]: ['#ffa21f', 2.6],
  [LIGHT.SIGN]: ['#ffd54a', 1.4],
}
// Per-type sign colour (taxi roof sign, bus destination board).
const SIGN_EMIT = { taxi: ['#ffd54a', 1.4], bus: ['#ffb300', 1.6] }
// Glow sprite diameter (m) per lamp, before the size-by-lens-extent scaling.
const GLOW_SIZE = { [LIGHT.DRL]: 0.22, [LIGHT.HEAD]: 0.5, [LIGHT.TAIL]: 0.32, [LIGHT.BRAKE]: 0.36, [LIGHT.TURN_L]: 0.32, [LIGHT.TURN_R]: 0.32, [LIGHT.SIGN]: 0.45 }
const GLOW_GAIN = 0.9

// ── Per-vertex body materials ──────────────────────────────────────────────
// key → { color, rough, metal, paint?, light? }. 'turn' resolves to TURN_L /
// TURN_R by which side of the vehicle the part sits on.
const BODY_MATS = {
  paint: { color: '#ffffff', rough: 0.36, metal: 0.42, paint: true },
  carbon: { color: '#1b1e23', rough: 0.42, metal: 0.25 },
  chrome: { color: CHROME_COLOR, rough: 0.22, metal: 1 },
  trim: { color: '#15181d', rough: 0.7, metal: 0.05 },
  plate: { color: '#e8ecef', rough: 0.5, metal: 0 },
  helmet: { color: '#eef1f4', rough: 0.2, metal: 0.1 },
  housing: { color: '#0d0f12', rough: 0.3, metal: 0.6 },        // lamp housings / bezels
  mirrorGlass: { color: '#d4dde5', rough: 0.03, metal: 1 },      // mirror faces
  interior: { color: '#2b2e35', rough: 0.9, metal: 0 },          // seats, headrests
  dash: { color: '#1c1e23', rough: 0.6, metal: 0.1 },
  cabin: { color: '#23262c', rough: 0.95, metal: 0 },            // cabin floor seen through the glass
  windowBack: { color: '#0b0d10', rough: 0.5, metal: 0 },        // behind bus / truck glazing
  head: { color: '#dfe6ec', rough: 0.08, metal: 0.25, light: LIGHT.HEAD },
  drl: { color: '#e6edf5', rough: 0.1, metal: 0.2, light: LIGHT.DRL },
  tail: { color: '#4a0a0a', rough: 0.2, metal: 0.1, light: LIGHT.TAIL },
  brake: { color: '#4a0a0a', rough: 0.2, metal: 0.1, light: LIGHT.BRAKE },
  turn: { color: '#6a3d0a', rough: 0.2, metal: 0.1, light: 'turn' },
  sign: { color: '#e8c547', rough: 0.3, metal: 0, light: LIGHT.SIGN },
}

// Primitive fallback rider materials (two-wheelers; the 'rider*' parts).
const RIDER_MATS = {
  trim: { color: '#15181d', roughness: 0.7, metalness: 0.05 },
  skin: { color: '#d3a07e', roughness: 0.6, metalness: 0 },
  helmet: { color: '#eef1f4', roughness: 0.2, metalness: 0.1 },
}

// Car glazing: a light grey-blue tint, a bit more opaque than building glass
// (the multiplier scales glassMaterial's Fresnel alpha) so the cabin reads
// through it without the car looking hollow.
const CAR_GLASS_TINT = '#5f7282'
const CAR_GLASS_OPACITY = 1.45

// ── Colours ────────────────────────────────────────────────────────────────

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
// Used for wheels, the crank, glass and the fallback rider.
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
function ellip(rx, ry, rz) {
  const g = new THREE.SphereGeometry(1, 16, 10)
  g.scale(rx, ry, rz)
  return g
}

// A rod between two points (suspension arms, frames, limbs, trim strips).
function rod(a, b, r, sides = 6) {
  const va = new THREE.Vector3(...a)
  const vb = new THREE.Vector3(...b)
  const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), sides)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize())
  return [g, new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, _one)]
}
const mirrorZ = ([x, y, z]) => [x, y, -z]

// Merge several { material: parts[] } maps into one.
function combine(...maps) {
  const out = {}
  for (const m of maps) for (const [k, v] of Object.entries(m)) (out[k] ??= []).push(...v)
  return out
}
// Both sides of a symmetric part: fn(+1) and fn(−1).
const both = (fn) => [fn(1), fn(-1)]

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

// ── Shared hardware ────────────────────────────────────────────────────────

// Door mirror on the +Z (side = 1) or −Z (side = −1) flank: a short arm out of
// the door, a painted ellipsoid shell, a mirror face looking back and a side
// repeater (turn signal) on the shell's lower front edge. (x, y, z) is where
// the arm leaves the body.
const MIRROR_SCALE = 1.6
function sideMirror(x, y, z, side, scale = 1) {
  const s = scale * MIRROR_SCALE
  const cz = z + side * 0.12 * s
  return {
    trim: [rod([x + 0.02, y - 0.04 * s, z], [x, y - 0.015 * s, cz - side * 0.03 * s], 0.018 * s)],
    paint: [[ellip(0.07 * s, 0.055 * s, 0.1 * s), place(x, y, cz)]],
    mirrorGlass: [[box(0.01, 0.08 * s, 0.15 * s), place(x - 0.066 * s, y, cz)]],
    turn: [[box(0.03 * s, 0.014 * s, 0.08 * s), place(x + 0.05 * s, y - 0.038 * s, cz + side * 0.01)]],
  }
}

// Steering wheel centre height relative to the cabin floor (the window
// sill). Just BELOW it: the driver sits low to clear the roof, so the
// shoulders end up about at sill height — any higher and the hands sat above
// the shoulders (0.17 put them at chin height). The rim still shows above the
// sill through the side glass.
const WHEEL_UP = -0.05
// Steering wheel ring, axis along X (facing the driver), raked back.
function steeringWheel() {
  const t = new THREE.TorusGeometry(0.17, 0.02, 6, 20)
  t.rotateY(Math.PI / 2)
  return t
}

// Car cabin seen through the glass: a dark floor at the window sill, the
// dashboard, two reclined front seats with headrests, a rear bench, the
// steering wheel on the driver (left, −Z) side and the interior mirror.
function carInterior({ dashX, seatX, rearX, floorY, halfW, steerX, mirrorX, mirrorY, backH }) {
  const lean = 0.22   // seat-back recline
  return {
    cabin: [[box(dashX - rearX + 0.25, 0.02, halfW * 2), place((dashX + rearX) / 2 - 0.08, floorY, 0)]],
    dash: [[box(0.32, 0.13, halfW * 2), place(dashX, floorY + 0.05, 0)]],
    interior: [
      ...both((s) => [box(0.12, backH, 0.44), place(seatX, floorY + backH / 2, s * 0.32, 0, 0, lean)]),
      ...both((s) => [box(0.09, 0.13, 0.24), place(seatX - backH * Math.sin(lean), floorY + backH + 0.05, s * 0.32, 0, 0, lean)]),
      [box(0.13, backH * 0.9, halfW * 1.8), place(rearX, floorY + backH * 0.45, 0, 0, 0, lean)],
      ...both((s) => [box(0.09, 0.12, 0.22), place(rearX - backH * 0.9 * Math.sin(lean), floorY + backH * 0.9 + 0.05, s * 0.35, 0, 0, lean)]),
    ],
    trim: [
      [steeringWheel(), place(steerX, floorY + WHEEL_UP, -0.32, 0, 0, 0.4)],
      rod([steerX + 0.15, floorY - 0.05, -0.32], [steerX, floorY + WHEEL_UP, -0.32], 0.02),   // column
    ],
    mirrorGlass: [[box(0.02, 0.055, 0.2), place(mirrorX, mirrorY, 0)]],
  }
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
    lean: true,
  },
  bicycle: {
    pelvis: [-0.2, 1.0, 0],
    angles: { spine: -0.55, thighL: 1.15, thighR: 0.75, calfL: -1.1, calfR: -0.6, upperArmL: 1.1, upperArmR: 1.1, forearmL: 0.25, forearmR: 0.25 },
    grip: [0.31, 1.0, 0.2],
    // Bottom bracket and crank-arm length; the ankle sits this far above and
    // behind the pedal axle.
    crank: { x: 0, y: 0.3, r: 0.17, ankle: [-0.03, 0.09] },
    helmet: false,
    lean: true,
  },
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
    parts: {
      paint: [
        [chassis, ORIGIN],
        sidepod(1),
        sidepod(-1),
        [extrudeCentered(finShape, 0.02, 0), ORIGIN],             // engine-cover fin
        [box(0.5, 0.22, 0.02), place(2.25, 0.18, 0.95)],           // front wing endplates
        [box(0.5, 0.22, 0.02), place(2.25, 0.18, -0.95)],
        [box(0.52, 0.56, 0.02), place(-2.12, 0.74, 0.51)],         // rear wing endplates
        [box(0.52, 0.56, 0.02), place(-2.12, 0.74, -0.51)],
        [box(0.09, 0.06, 0.16), place(0.52, 0.66, 0.5)],           // mirror shells
        [box(0.09, 0.06, 0.16), place(0.52, 0.66, -0.5)],
      ],
      mirrorGlass: both((s) => [box(0.01, 0.045, 0.13), place(0.473, 0.66, s * 0.5)]),
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
    },
    wheels: [
      ...wheelsAt(wheelPos.slice(0, 2), front),
      ...wheelsAt(wheelPos.slice(2), rear),
    ],
  }
}

// ── Road cars (sedan, SUV, electric fastback, taxi) ────────────────────────
// Body = side profile with the wheel arches carved out of its underside,
// extruded across the car and pinched: rounded in plan view toward the nose
// and tail, leaning in above the belt line. The greenhouse glass is a second,
// narrower extrusion that leans in harder; a painted roof panel and dark
// pillars sit on it (except the EV's glass roof), and the cabin shows through.
// Lamps are lens + housing clusters: headlight, daytime running strip, front
// and rear turn signals, a tail lamp that wraps onto the flank, a high-mount
// brake lamp. Mirrors are proper door mirrors (sideMirror).

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
    // Painted roof panel over the flat of the roof, and the dark B-pillar.
    roof: { x0: 0.12, x1: -0.92, y: 1.448, w: 1.14 },
    pillars: [{ x: -0.3, y0: 0.98, y1: 1.4, z: 0.62 }],
    cabin: { dashX: 0.7, seatX: -0.05, rearX: -0.95, floorY: 0.97, halfW: 0.58, steerX: 0.45, mirrorX: 0.3, mirrorY: 1.33, backH: 0.32 },
    driver: { pelvisY: 0.55, roofY: 1.4 },
    sideZ: 0.81,   // body flat side after pinch, at handle height
    hardware(z) {
      return combine({
        head: both((s) => [box(0.1, 0.11, 0.38), place(2.25, 0.64, s * 0.5)]),
        housing: both((s) => [box(0.08, 0.15, 0.44), place(2.21, 0.64, s * 0.5)]),
        drl: both((s) => [box(0.05, 0.022, 0.34), place(2.28, 0.575, s * 0.5)]),
        turn: [
          ...both((s) => [box(0.07, 0.05, 0.08), place(2.23, 0.64, s * 0.69)]),
          ...both((s) => [box(0.06, 0.06, 0.12), place(-2.28, 0.71, s * 0.6)]),
        ],
        tail: [
          ...both((s) => [box(0.06, 0.13, 0.34), place(-2.28, 0.82, s * 0.55)]),
          ...both((s) => [box(0.2, 0.13, 0.03), place(-2.17, 0.82, s * 0.72)]),    // wrap onto the flank
        ],
        brake: [[box(0.04, 0.03, 0.3), place(-2.2, 1.0, 0)]],                    // high-mount stop lamp
        plate: [[box(0.02, 0.11, 0.34), place(2.33, 0.36, 0)], [box(0.02, 0.11, 0.34), place(-2.33, 0.5, 0)]],
        trim: [
          [box(0.06, 0.12, 0.72), place(2.29, 0.46, 0)],   // grille
          [box(0.06, 0.07, 1.0), place(2.26, 0.3, 0)],     // lower intake
          ...[0.34, -0.56].flatMap((hx) => both((s) => [box(0.24, 0.07, 0.06), place(hx, 0.9, s * z)])),
        ],
        // Chrome strip along the bottom of the side windows.
        chrome: both((s) => rod([0.9, 0.93, s * (z - 0.06)], [-1.66, 1.03, s * (z - 0.06)], 0.014)),
      }, sideMirror(0.8, 0.98, z, 1), sideMirror(0.8, 0.98, -z, -1))
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
    roof: { x0: 0.2, x1: -2.0, y: 1.752, w: 1.32 },
    pillars: [{ x: -0.35, y0: 1.18, y1: 1.7, z: 0.73 }, { x: -1.45, y0: 1.18, y1: 1.7, z: 0.73 }],
    cabin: { dashX: 0.92, seatX: -0.1, rearX: -1.05, floorY: 1.14, halfW: 0.64, steerX: 0.5, mirrorX: 0.42, mirrorY: 1.63, backH: 0.38 },
    driver: { pelvisY: 0.72, roofY: 1.7 },
    sideZ: 0.9,
    hardware(z) {
      return combine({
        head: both((s) => [box(0.1, 0.13, 0.42), place(2.32, 0.86, s * 0.56)]),
        housing: both((s) => [box(0.08, 0.17, 0.48), place(2.28, 0.86, s * 0.56)]),
        drl: both((s) => [box(0.05, 0.022, 0.4), place(2.36, 0.785, s * 0.56)]),
        turn: [
          ...both((s) => [box(0.07, 0.06, 0.08), place(2.3, 0.86, s * 0.76)]),
          ...both((s) => [box(0.06, 0.08, 0.14), place(-2.36, 0.8, s * 0.72)]),
        ],
        tail: [
          ...both((s) => [box(0.07, 0.28, 0.14), place(-2.36, 0.99, s * 0.72)]),
          ...both((s) => [box(0.16, 0.28, 0.03), place(-2.29, 0.99, s * 0.785)]),  // wrap onto the flank
        ],
        brake: [[box(0.05, 0.04, 0.4), place(-2.27, 1.7, 0)]],                    // high-mount stop lamp
        plate: [[box(0.02, 0.11, 0.34), place(2.4, 0.5, 0)], [box(0.02, 0.11, 0.34), place(-2.38, 0.7, 0)]],
        trim: [
          [box(0.06, 0.2, 0.9), place(2.37, 0.72, 0)],     // tall grille
          [box(0.08, 0.1, 1.5), place(2.36, 0.38, 0)],     // black lower bumper
          [box(0.08, 0.12, 1.5), place(-2.38, 0.4, 0)],    // rear bumper cladding
          ...[0.45, -0.6].flatMap((hx) => both((s) => [box(0.24, 0.07, 0.06), place(hx, 1.06, s * z)])),
          // Roof rails: two bars on short posts.
          ...[1, -1].flatMap((s) => [
            rod([0.15, 1.8, s * 0.56], [-1.9, 1.8, s * 0.56], 0.022, 8),
            [box(0.06, 0.07, 0.05), place(0.1, 1.77, s * 0.56)],
            [box(0.06, 0.07, 0.05), place(-1.85, 1.77, s * 0.56)],
          ]),
        ],
        chrome: both((s) => rod([1.15, 1.09, s * (z - 0.06)], [-2.2, 1.13, s * (z - 0.06)], 0.012)),
      }, sideMirror(1.0, 1.18, z, 1, 1.15), sideMirror(1.0, 1.18, -z, -1, 1.15))
    },
  },
  // Electric fastback: smooth closed nose (no grille), short hood, one long
  // roof line sweeping into a short ducktail, a glass roof (left as glass),
  // a slim light bar across the nose, a full-width tail bar, flush handles
  // (none drawn), aero wheel covers.
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
    roof: null,
    pillars: [{ x: -0.15, y0: 1.0, y1: 1.42, z: 0.63 }],
    cabin: { dashX: 0.78, seatX: -0.05, rearX: -0.95, floorY: 0.99, halfW: 0.58, steerX: 0.52, mirrorX: 0.24, mirrorY: 1.36, backH: 0.3 },
    driver: { pelvisY: 0.55, roofY: 1.41 },
    sideZ: 0.84,
    hardware(z) {
      return combine({
        head: both((s) => [box(0.07, 0.045, 0.46), place(2.3, 0.68, s * 0.5)]),
        housing: both((s) => [box(0.06, 0.07, 0.5), place(2.27, 0.68, s * 0.5)]),
        drl: [[box(0.04, 0.02, 1.2), place(2.33, 0.74, 0)]],                      // light bar across the nose
        turn: [
          ...both((s) => [box(0.06, 0.045, 0.08), place(2.29, 0.68, s * 0.72)]),
          ...both((s) => [box(0.05, 0.05, 0.08), place(-2.31, 0.84, s * 0.72)]),
        ],
        tail: [[box(0.05, 0.05, 1.36), place(-2.31, 0.84, 0)]],                  // full-width tail bar
        brake: [[box(0.04, 0.025, 0.5), place(-2.2, 0.975, 0)]],                  // high-mount stop lamp
        plate: [[box(0.02, 0.11, 0.34), place(2.38, 0.38, 0)], [box(0.02, 0.11, 0.34), place(-2.33, 0.52, 0)]],
        trim: [[box(0.06, 0.06, 1.1), place(2.32, 0.3, 0)]],   // slim lower intake only
      }, sideMirror(0.86, 0.96, z, 1), sideMirror(0.86, 0.96, -z, -1))
    },
  },
}

// Seat the nose and tail hardware ON the body. The hardware is laid out
// against the side profile, but the extrusion's bevel grows the body ~8 cm
// past that outline — lamps, plates and the grille ended up buried inside
// the nose and tail (the "no lights" look). For every part in either end
// zone, cast a ray in from outside along ∓X at the part's height and side
// offset, and move the part so its outer face sits `proud` beyond the hit.
// Parts on the top surface (the high-mount brake lamp) are left alone.
const SNAP_KEYS = { head: 0.012, drl: 0.012, turn: 0.01, tail: 0.012, housing: 0.003, plate: 0.006, trim: 0.004 }
const SNAP_END_ZONE = 0.45
const _ray = new THREE.Raycaster()
const _o = new THREE.Vector3()
const _d = new THREE.Vector3()
function snapEndsToSurface(hardware, bodyGeo, half) {
  const probe = new THREE.Mesh(bodyGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  probe.updateMatrixWorld(true)
  for (const [key, proud] of Object.entries(SNAP_KEYS)) {
    for (const part of hardware[key] ?? []) {
      const [geo, matrix] = part
      geo.computeBoundingBox()
      const bb = geo.boundingBox.clone().applyMatrix4(matrix)
      bb.getCenter(_c)
      if (Math.abs(_c.x) < half - SNAP_END_ZONE) continue
      const sign = Math.sign(_c.x)
      _ray.set(_o.set(sign * (half + 1), _c.y, _c.z), _d.set(-sign, 0, 0))
      const hit = _ray.intersectObject(probe, false)[0]
      if (!hit) continue
      const outer = sign > 0 ? bb.max.x : bb.min.x
      const shift = hit.point.x + sign * proud - outer
      part[1] = new THREE.Matrix4().makeTranslation(shift, 0, 0).multiply(matrix)
    }
  }
  probe.material.dispose()
}

// Where a realistic driver sits (TrackLayer3D, same machinery as the
// two-wheeler riders): on the left (−Z) front seat, sitting back, knees up,
// hands on the steering wheel at ten and two. The grips are on the wheel
// ring (radius 0.17, raked back 0.4 rad — see carInterior), nudged toward the
// driver because the target is the wrist; the arms are refitted to them.
// `headroom` keeps the head under the roof lining (fitHeadroom lowers a tall
// model); the body below the window line is hidden inside the solid shell.
// No lean in turns — that's for two-wheelers.
const WHEEL_R = 0.17
const WHEEL_RAKE = 0.4
const DRIVER_Z = -0.32
function driverSeat(spec) {
  const c = spec.cabin
  const up = WHEEL_R * Math.sin(Math.PI / 6)          // ten and two: 30° above the axle line
  const across = WHEEL_R * Math.cos(Math.PI / 6)
  const gx = c.steerX - up * Math.sin(WHEEL_RAKE) - 0.03
  const gy = c.floorY + WHEEL_UP + up * Math.cos(WHEEL_RAKE)
  return {
    pelvis: [c.seatX + 0.1, spec.driver.pelvisY, DRIVER_Z],
    angles: { spine: 0.12, thighL: 1.45, thighR: 1.45, calfL: -1.35, calfR: -1.35, upperArmL: 0.7, upperArmR: 0.7, forearmL: 0.6, forearmR: 0.6 },
    grips: [[gx, gy, DRIVER_Z + across], [gx, gy, DRIVER_Z - across]],
    headroom: spec.driver.roofY,
    helmet: false,
    driver: true,
    lean: false,
  }
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
  const hardware = spec.hardware(spec.sideZ)
  snapEndsToSurface(hardware, body, half)
  const shell = {
    paint: [[body, ORIGIN]],
    glass: [[glass, ORIGIN]],
    trim: spec.pillars.flatMap((p) => both((s) => [box(0.1, p.y1 - p.y0, 0.02), place(p.x, (p.y0 + p.y1) / 2, s * p.z)])),
  }
  if (spec.roof) {
    const r = spec.roof
    shell.paint.push([box(r.x0 - r.x1, 0.035, r.w), place((r.x0 + r.x1) / 2, r.y, 0)])
  }
  return {
    parts: combine(shell, carInterior(spec.cabin), hardware, extra),
    seat: driverSeat(spec),
    wheels: wheelsAt([
      { x: spec.axleF, z: spec.trackZ }, { x: spec.axleF, z: -spec.trackZ },
      { x: spec.axleR, z: spec.trackZ }, { x: spec.axleR, z: -spec.trackZ },
    ], spec.wheel),
  }
}

// Taxi: the sedan body with a lit roof sign on a slim base (no operator name
// or text on it). Taxi yellow comes from its palette.
function buildTaxi() {
  return buildRoadCar(ROAD.sedan, {
    trim: [[box(0.66, 0.04, 0.4), place(-0.56, 1.485, 0)]],
    sign: [[box(0.6, 0.18, 0.34), place(-0.56, 1.595, 0)]],
  })
}

// ── Box truck ──────────────────────────────────────────────────────────────
// Cab-over-chassis delivery truck, ~6.4 m × 2.2 m × 3.3 m: rounded cab with
// a raked windshield and side windows, a tall cargo box behind it (painted —
// the largest surface), ladder frame, fuel tanks, bumpers, single front and
// dual rear wheels. The cab is a solid body, so its glazing sits over a dark
// backing (a see-through window would show paint).
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
  const windshield = (dx, thick) => [box(thick, 1.1, 1.9), place(3.19 - dx, 1.85, 0, 0, 0, 0.116)]
  const sideWin = (s, dz, thick) => [box(0.9, 0.72, thick), place(2.4, 2.0, s * (side + 0.01 - dz))]
  return {
    parts: {
      paint: [
        [cabGeo, ORIGIN],
        [box(4.5, 2.3, 2.3), place(-0.95, 2.15, 0)],     // cargo box
        ...both((s) => [ellip(0.05, 0.17, 0.08), place(3.05, 2.05, s * 1.4)]),   // mirror shells
      ],
      glass: [windshield(0, 0.04), ...both((s) => sideWin(s, 0, 0.02))],
      windowBack: [windshield(0.03, 0.02), ...both((s) => sideWin(s, 0.015, 0.01))],
      mirrorGlass: both((s) => [box(0.012, 0.3, 0.13), place(3.0, 2.05, s * 1.4)]),
      trim: [
        [box(6.1, 0.22, 0.9), place(-0.05, 0.72, 0)],    // ladder frame
        [box(0.15, 0.3, 2.2), place(3.25, 0.62, 0)],     // front bumper
        [box(0.05, 0.6, 1.3), place(3.24, 1.05, 0)],     // grille
        [box(0.12, 0.2, 2.1), place(-3.2, 0.62, 0)],     // rear bumper
        [box(0.04, 2.1, 0.02), place(-3.22, 2.15, 0)],   // rear door seam
        ...both((s) => rod([3.0, 1.75, s * side], [3.05, 1.95, s * 1.36], 0.02)),   // mirror arms
      ],
      chrome: both((s) => [new THREE.CylinderGeometry(0.22, 0.22, 0.9, 16), place(0.85, 0.75, s * 0.8, 0, 0, Math.PI / 2)]), // fuel tanks
      head: both((s) => [box(0.06, 0.16, 0.28), place(3.265, 0.95, s * 0.8)]),
      housing: both((s) => [box(0.05, 0.2, 0.34), place(3.24, 0.95, s * 0.8)]),
      turn: [
        ...both((s) => [box(0.05, 0.08, 0.14), place(3.26, 1.12, s * 0.95)]),
        ...both((s) => [box(0.05, 0.1, 0.18), place(-3.27, 0.95, s * 0.85)]),
      ],
      tail: both((s) => [box(0.05, 0.15, 0.2), place(-3.27, 0.75, s * 0.85)]),
      plate: [[box(0.02, 0.12, 0.36), place(3.335, 0.62, 0)], [box(0.02, 0.12, 0.36), place(-3.27, 1.15, 0)]],
    },
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
// (blank — no route or operator text), roof air-con pod, bumpers. Solid body:
// the glazing sits over a dark backing.
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
  const panes = (inset, t) => [
    ...both((z) => [box(7.0, 1.0, t), place(-0.45, 2.15, z * (side - inset))]),   // side window band
    [box(t, 1.55, 2.1), place(front - inset, 1.95, 0)],                          // windshield
    [box(t, 0.8, 1.9), place(-front + inset, 2.4, 0)],                           // rear window
    [box(0.8, 2.2, t), place(4.0, 1.55, side + 0.005 - inset)],                  // front door
    [box(1.1, 2.2, t), place(0.2, 1.55, side + 0.005 - inset)],                  // middle door
  ]
  return {
    parts: {
      paint: [
        [body, ORIGIN],
        ...both((z) => [ellip(0.05, 0.19, 0.08), place(4.78, 2.4, z * 1.42)]),   // mirror shells
      ],
      glass: panes(0, 0.03),
      windowBack: panes(0.025, 0.015),
      mirrorGlass: both((z) => [box(0.012, 0.33, 0.13), place(4.73, 2.4, z * 1.42)]),
      trim: [
        [box(0.12, 0.28, 2.4), place(4.6, 0.45, 0)],     // front bumper
        [box(0.12, 0.28, 2.4), place(-4.6, 0.45, 0)],    // rear bumper
        ...both((z) => rod([4.5, 2.6, z * 1.1], [4.75, 2.55, z * 1.36], 0.025)),   // mirror arms
      ],
      plate: [
        [box(2.2, 0.25, 1.4), place(-0.6, 3.2, 0)],      // roof air-con pod
        [box(0.02, 0.12, 0.36), place(4.675, 0.45, 0)],
        [box(0.02, 0.12, 0.36), place(-4.675, 0.7, 0)],
      ],
      sign: [[box(0.04, 0.3, 1.6), place(front + 0.005, 2.85, 0)]],   // destination sign
      head: both((z) => [box(0.05, 0.15, 0.35), place(front, 0.75, z * 0.85)]),
      housing: both((z) => [box(0.04, 0.19, 0.41), place(front - 0.012, 0.75, z * 0.85)]),
      turn: [
        ...both((z) => [box(0.05, 0.08, 0.16), place(front, 0.95, z * 0.95)]),
        ...both((z) => [box(0.05, 0.12, 0.15), place(-front, 1.15, z * 0.9)]),
      ],
      tail: both((z) => [box(0.05, 0.3, 0.15), place(-front, 0.85, z * 0.9)]),
      brake: [[box(0.04, 0.05, 0.6), place(-front, 2.75, 0)]],        // high-mount stop lamp
    },
    wheels: wheelsAt([
      { x: 3.0, z: 1.0 }, { x: 3.0, z: -1.0 },
      { x: -2.5, z: 1.0 }, { x: -2.5, z: -1.0 },
    ], wheel),
  }
}

// ── Scooter ────────────────────────────────────────────────────────────────
// Step-through scooter, ~1.85 m long, small wheels: leg shield, floorboard,
// a rear body under the seat, handlebar with headlight, turn signals and
// mirrors, rider seated upright with feet on the floorboard.
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
    parts: combine({
      paint: [[body, ORIGIN]],
      trim: [
        [box(0.62, 0.1, 0.3), place(-0.42, 0.79, 0)],                       // seat
        rod([0.62, 0.21, 0.07], [0.74, 0.95, 0.07], 0.022),                 // fork legs
        rod([0.62, 0.21, -0.07], [0.74, 0.95, -0.07], 0.022),
        rod([0.74, 0.95, 0], [0.56, 1.12, 0], 0.03),                        // steering column
        rod([0.54, 1.12, -0.36], [0.54, 1.12, 0.36], 0.018),                // handlebar
        ...both((z) => rod([0.52, 1.12, z * 0.26], [0.5, 1.3, z * 0.29], 0.008)),   // mirror stalks
      ],
      housing: both((z) => [ellip(0.025, 0.035, 0.06), place(0.5, 1.32, z * 0.3)]),   // mirror backs
      mirrorGlass: both((z) => [box(0.008, 0.05, 0.1), place(0.476, 1.32, z * 0.3)]),
      head: [[box(0.06, 0.08, 0.16), place(0.73, 1.08, 0)]],
      turn: [
        ...both((z) => [box(0.05, 0.035, 0.05), place(0.74, 0.97, z * 0.17)]),
        ...both((z) => [box(0.04, 0.035, 0.05), place(-0.9, 0.6, z * 0.13)]),
      ],
      tail: [[box(0.04, 0.06, 0.12), place(-0.93, 0.62, 0)]],
      plate: [[box(0.02, 0.1, 0.16), place(-0.9, 0.42, 0)]],
    }, r),
    wheels: wheelsAt([{ x: 0.62, z: 0 }, { x: -0.6, z: 0 }], wheel),
    seat: SEATS.scooter,
  }
}

// ── Bicycle ────────────────────────────────────────────────────────────────
// Diamond-frame bike, ~1.75 m long, 0.68 m wire wheels, rider leaning
// forward to the bar, small front and rear lamps.
function buildBicycle() {
  const wheel = { radius: 0.34, width: 0.035, rimFrac: 0.9, style: 'bike' }
  const bb = [0, 0.3, 0]
  const seatTop = [-0.16, 0.86, 0]
  const headTop = [0.38, 0.86, 0]
  const headBot = [0.42, 0.66, 0]
  const r = rider({
    hip: [-0.2, 1.0, 0.1], shoulder: [0.14, 1.4, 0.18], head: [0.24, 1.58, 0],
    elbow: [0.26, 1.18, 0.2], hand: [0.38, 1.0, 0.22],
    knee: [0.16, 0.72, 0.12], foot: [0.03, 0.31, 0.11],
  })
  return {
    parts: combine({
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
    }, r),
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

// ── Assembly ───────────────────────────────────────────────────────────────

const _bb = new THREE.Box3()
const _c = new THREE.Vector3()
const _sz = new THREE.Vector3()

// Body: every opaque, non-rider part merged into one geometry with per-vertex
// colour + aMat, and one glow sprite (or a row of them along a long lens) per
// lamp part. Glow normals point out of the nearest end or flank — a lamp near
// either end faces ±X, one on the flank ±Z; signs are omnidirectional.
function assembleBody(map) {
  const list = []
  for (const [key, parts] of Object.entries(map)) {
    if (key === 'glass' || key.startsWith('rider')) continue
    const mat = BODY_MATS[key]
    if (!mat) throw new Error(`vehicle: unknown material ${key}`)
    for (const [geo, matrix] of parts) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone()
      g.applyMatrix4(matrix)
      geo.dispose()
      list.push({ g, mat })
    }
  }
  _bb.makeEmpty()
  for (const { g } of list) { g.computeBoundingBox(); _bb.union(g.boundingBox) }
  const halfLen = Math.max(Math.abs(_bb.min.x), Math.abs(_bb.max.x))

  const n = list.reduce((s, { g }) => s + g.getAttribute('position').count, 0)
  const pos = new Float32Array(n * 3)
  const nor = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  const mat4 = new Float32Array(n * 4)
  const glowPos = [], glowNor = [], glowLight = [], glowSize = []
  let o = 0
  for (const { g, mat } of list) {
    const count = g.getAttribute('position').count
    pos.set(g.getAttribute('position').array, o * 3)
    nor.set(g.getAttribute('normal').array, o * 3)
    g.boundingBox.getCenter(_c)
    g.boundingBox.getSize(_sz)
    let light = mat.light ?? 0
    if (light === 'turn') light = _c.z < 0 ? LIGHT.TURN_L : LIGHT.TURN_R
    _col.set(mat.color)
    for (let k = 0; k < count; k++) {
      col.set([_col.r, _col.g, _col.b], (o + k) * 3)
      mat4.set([mat.paint ? 1 : 0, light, mat.rough, mat.metal], (o + k) * 4)
    }
    if (light) {
      const omni = light === LIGHT.SIGN
      const atEnd = Math.abs(_c.x) > halfLen * 0.6
      const nrm = omni ? [0, 0, 0] : atEnd ? [Math.sign(_c.x), 0, 0] : [0, 0, Math.sign(_c.z) || 1]
      // Long lenses (light bars) get a row of sprites along their length.
      const along = _sz.z >= _sz.x ? 'z' : 'x'
      const len = along === 'z' ? _sz.z : _sz.x
      const k = Math.max(1, Math.ceil(len / 0.4))
      const size = GLOW_SIZE[light] * Math.min(1.2, Math.max(0.35, Math.max(_sz.y, Math.min(len, 0.4)) / 0.3))
      for (let i = 0; i < k; i++) {
        const t = k === 1 ? 0 : (i / (k - 1) - 0.5) * (len - len / k)
        glowPos.push(
          _c.x + nrm[0] * 0.03 + (along === 'x' ? t : 0),
          _c.y,
          _c.z + nrm[2] * 0.03 + (along === 'z' ? t : 0),
        )
        glowNor.push(...nrm)
        glowLight.push(light)
        glowSize.push(size)
      }
    }
    o += count
    g.dispose()
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geometry.setAttribute('aMat', new THREE.BufferAttribute(mat4, 4))
  geometry.computeBoundingSphere()

  let glow = null
  if (glowLight.length) {
    glow = new THREE.BufferGeometry()
    glow.setAttribute('position', new THREE.BufferAttribute(new Float32Array(glowPos), 3))
    glow.setAttribute('aNormal', new THREE.BufferAttribute(new Float32Array(glowNor), 3))
    glow.setAttribute('aLight', new THREE.BufferAttribute(new Float32Array(glowLight), 1))
    glow.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(glowSize), 1))
    glow.computeBoundingSphere()
  }
  return { geometry, glow }
}

function assemble(built) {
  const { parts } = built
  const body = assembleBody(parts)
  const riderLayers = Object.entries(parts)
    .filter(([k, v]) => k.startsWith('rider') && v.length)
    .map(([k, v]) => ({ material: k.slice(5).toLowerCase(), geometry: mergeParts(v) }))
  return {
    body: body.geometry,
    glow: body.glow,
    glass: parts.glass?.length ? mergeParts(parts.glass) : null,
    rider: riderLayers,
    wheels: built.wheels,
    crank: built.crank ?? null,
    seat: built.seat ?? null,
  }
}

// ── Materials ──────────────────────────────────────────────────────────────

// Body shader patch. `u` holds this vehicle's uniforms (the same objects the
// glow sprites read for the lamps). The function source is shared, so every
// vehicle reuses one compiled program.
function makeBodyPatch(u) {
  return (shader) => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMat;\nvarying vec4 vMat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uPaint;
        uniform vec3 uHighlight;
        uniform float uLights[${LIGHT_COUNT}];
        uniform vec3 uLightColor[${LIGHT_COUNT}];
        varying vec4 vMat;`,
      )
      // Paint: the vertex colour is white there; tint it with the paint.
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(1.0), uPaint, step(0.5, vMat.x));')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vMat.z;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMat.w;')
      // Clearcoat is lacquer: paint only, not tyres, glass trim or seats.
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.clearcoat *= step(0.5, vMat.x);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          int lid = int(vMat.y + 0.5);
          if (lid > 0) totalEmissiveRadiance += uLightColor[lid] * uLights[lid];
          totalEmissiveRadiance += uHighlight * step(0.5, vMat.x);
        }`,
      )
  }
}

// Lamp glow sprites: additive, sized in metres (perspective-scaled), faded by
// how squarely the lamp faces the camera (a headlight's halo isn't seen from
// behind), and by the vehicle's ghost opacity.
const GLOW_VERT = `
  attribute vec3 aNormal;
  attribute float aLight;
  attribute float aSize;
  uniform float uLights[${LIGHT_COUNT}];
  uniform vec3 uLightColor[${LIGHT_COUNT}];
  uniform float uViewH;
  varying vec3 vGlow;
  void main() {
    int lid = int(aLight + 0.5);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float facing = 1.0;
    if (dot(aNormal, aNormal) > 0.5) {
      vec3 n = normalize(mat3(modelMatrix) * aNormal);
      facing = smoothstep(-0.05, 0.35, dot(normalize(cameraPosition - wp.xyz), n));
    }
    float I = uLights[lid] * facing;
    vGlow = uLightColor[lid] * I;
    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = I > 0.001 ? aSize * projectionMatrix[1][1] * uViewH * 0.5 / -mv.z : 0.0;
  }
`
const GLOW_FRAG = `
  uniform float uOpacity;
  varying vec3 vGlow;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - r), 2.2) * ${GLOW_GAIN.toFixed(2)} * uOpacity;
    gl_FragColor = vec4(vGlow, a);
    #include <colorspace_fragment>
  }
`

function lightColors(kind) {
  const arr = Array.from({ length: LIGHT_COUNT }, () => new THREE.Color(0, 0, 0))
  for (const [id, [hex, gain]] of Object.entries(LIGHT_EMIT)) arr[id].set(hex).multiplyScalar(gain)
  const sign = SIGN_EMIT[kind]
  if (sign) arr[LIGHT.SIGN].set(sign[0]).multiplyScalar(sign[1])
  return arr
}

// ── Public API ─────────────────────────────────────────────────────────────

// Every type's shared geometry, built once per layer mount.
export function buildVehicleGeometries() {
  return {
    sedan: assemble(buildRoadCar(ROAD.sedan)),
    suv: assemble(buildRoadCar(ROAD.suv)),
    ev: assemble(buildRoadCar(ROAD.ev)),
    taxi: assemble(buildTaxi()),
    racer: assemble(buildRacer()),
    truck: assemble(buildTruck()),
    bus: assemble(buildBus()),
    scooter: assemble(buildScooter()),
    bicycle: assemble(buildBicycle()),
  }
}

export function disposeVehicleGeometries(all) {
  for (const set of Object.values(all)) {
    set.body.dispose()
    set.glow?.dispose()
    set.glass?.dispose()
    for (const l of set.rider) l.geometry.dispose()
    for (const w of set.wheels) w.geometry.dispose()
    set.crank?.geometry.dispose()
  }
}

const _vh = new THREE.Vector2()

// One vehicle from a type's geometry set.
export function makeVehicle(set, kind) {
  const lights = new Float32Array(LIGHT_COUNT)
  const shared = {
    uLights: { value: lights },
    uLightColor: { value: lightColors(kind) },
  }
  const bodyU = {
    uPaint: { value: new THREE.Color(INITIAL_PAINT) },
    uHighlight: { value: new THREE.Color(0, 0, 0) },
    ...shared,
  }
  // The body: a clearcoat physical material whose roughness, metalness,
  // clearcoat and lamp emission all come per vertex (makeBodyPatch).
  const bodyMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.05,
  })
  bodyMat.onBeforeCompile = makeBodyPatch(bodyU)
  const g = new THREE.Group()
  const body = new THREE.Mesh(set.body, bodyMat)
  body.castShadow = true
  body.receiveShadow = true
  g.add(body)

  let glassMat = null
  if (set.glass) {
    glassMat = new THREE.MeshStandardMaterial(glassMaterialProps(CAR_GLASS_TINT, CAR_GLASS_OPACITY))
    g.add(new THREE.Mesh(set.glass, glassMat))
  }

  let glowMat = null
  if (set.glow) {
    glowMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uViewH: { value: 1000 }, uOpacity: { value: 1 } },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const glow = new THREE.Points(set.glow, glowMat)
    glow.raycast = () => null
    glow.onBeforeRender = (renderer) => { glowMat.uniforms.uViewH.value = renderer.getDrawingBufferSize(_vh).y }
    g.add(glow)
  }

  // The primitive rider (two-wheelers), grouped so a realistic one can
  // replace it.
  const extra = []
  let jacketMat = null
  const riderGroup = new THREE.Group()
  for (const { material, geometry } of set.rider) {
    const m = material === 'jacket'
      ? (jacketMat = new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.8, metalness: 0 }))
      : new THREE.MeshStandardMaterial(RIDER_MATS[material])
    if (m !== jacketMat) extra.push(m)
    const mesh = new THREE.Mesh(geometry, m)
    mesh.castShadow = material !== 'skin'
    riderGroup.add(mesh)
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
  if (set.seat?.lean) g.rotation.order = 'YXZ'
  g.visible = false
  g.userData.vehicleKind = kind
  g.userData.bodyMat = bodyMat
  g.userData.bodyU = bodyU
  g.userData.glassMat = glassMat
  g.userData.glowMat = glowMat
  g.userData.lights = lights
  g.userData.jacketMat = jacketMat
  g.userData.seat = set.seat
  g.userData.primitiveRider = riderGroup.children.length ? riderGroup : null
  g.userData.extraMats = extra
  g.userData.wheels = wheels
  g.userData.minWheelRadius = Math.min(...wheels.map((w) => w.userData.radius))
  g.userData.rollDist = 0
  return g
}

// Detected → own colours; ghost → grey + `opacity`; highlight (seen by the
// selected camera) → the paint and the rider's jacket glow `glowColor`.
const _black = new THREE.Color('#000000')
function setOpacity(m, opacity) {
  m.opacity = opacity
  // Recompile on the flip: three bakes `transparent` into the program's
  // OPAQUE define. Both variants stay cached, so it is one compile per
  // variant per page, not per toggle.
  const want = opacity < 1
  if (m.transparent !== want) {
    m.transparent = want
    m.needsUpdate = true
  }
  // depthWrite stays on for ghosts: a vehicle is several overlapping meshes,
  // and with it off three sorts whole meshes by distance, so a part can
  // vanish behind the body from some angles.
  m.depthWrite = true
}
export function applyVehicleState(g, detected, colors, opacity, highlight, glowColor, emissiveIntensity) {
  const ud = g.userData
  ud.bodyU.uPaint.value.copy(detected ? colors.paint : GHOST_COLOR)
  ud.bodyU.uHighlight.value.copy(highlight ? glowColor : _black).multiplyScalar(highlight ? emissiveIntensity : 0)
  setOpacity(ud.bodyMat, opacity)
  if (ud.glassMat) ud.glassMat.opacity = CAR_GLASS_OPACITY * opacity
  if (ud.glowMat) ud.glowMat.uniforms.uOpacity.value = opacity
  if (ud.jacketMat) {
    ud.jacketMat.color.copy(detected ? colors.jacket : GHOST_COLOR)
    ud.jacketMat.emissive.copy(highlight ? glowColor : _black)
    ud.jacketMat.emissiveIntensity = highlight ? emissiveIntensity : 0
    setOpacity(ud.jacketMat, opacity)
  }
  for (const m of ud.extraMats) setOpacity(m, opacity)
}

// Lamp state for this frame. night: head/tail/position lamps on; brake: stop
// lamps (and the tail lamps brighter); turn: −1 left, +1 right, 0 none;
// blink: the flasher's current on/off phase.
export function updateVehicleLights(g, { night, brake, turn, blink }) {
  const L = g.userData.lights
  L[LIGHT.DRL] = 1
  L[LIGHT.HEAD] = night ? 1 : 0
  L[LIGHT.TAIL] = Math.max(night ? 0.55 : 0, brake ? 1.8 : 0)
  L[LIGHT.BRAKE] = brake ? 1.8 : 0
  L[LIGHT.TURN_L] = turn < 0 && blink ? 1 : 0
  L[LIGHT.TURN_R] = turn > 0 && blink ? 1 : 0
  L[LIGHT.SIGN] = night ? 1 : 0.55
}

export function disposeVehicle(g) {
  const ud = g.userData
  ud.bodyMat?.dispose()
  ud.glassMat?.dispose()
  ud.glowMat?.dispose()
  ud.jacketMat?.dispose()
  ud.extraMats?.forEach((m) => m.dispose())
}
