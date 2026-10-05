import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useTrackingStore } from '@/store/useTrackingStore'
import { useCameraStore } from '@/store/useCameraStore'
import { useWallStore } from '@/store/useWallStore'
import { useEditorStore } from '@/store/useEditorStore'
import { sampleTrackAt, trackHeadingAt } from '@/features/cameras/mockTracks'
import { trackTint } from '@/features/cameras/trackColor'
import { buildBlockingSegments, computeFovPolygon, cameraCoverageRadii } from '@/features/cameras/fovPolygon'
import { loadPeopleModels, createPerson, applyPersonState, disposePerson, personOutfit, addHalfHelmet, fitGrips, fitHeadroom, prepareLegIK, applyLegIK } from './peopleModels'
import { buildVehicleGeometries, disposeVehicleGeometries, makeVehicle, disposeVehicle, pickVehicleType, vehicleColors, applyVehicleState, updateVehicleLights } from './vehicleModels'

// Live tracking targets in 3D (Phase 34, CAMERA mode only — Viewer3D gates
// the mount). Mirrors tracksLayer's semantics: a target is solid-coloured
// while inside at least one camera's FOV (person amber / car blue), a grey
// ghost otherwise (hidden when showUndetected is off). Each target drags a
// fading trail ribbon (last TRAIL_SEC of path, same window as 2D), and while
// a camera is selected the targets inside ITS fov glow (emissive boost).
//
// People are Rocketbox avatars (peopleModels.js — one male, one female, picked
// per track) with a procedural walk cycle and their garments dyed the state
// colour; skin and hair stay real. Until the models have loaded (or if they
// fail to), people fall back to the low-poly primitive assembly below (two-
// tone clothed person with knees and shoes). Vehicles are nine generic
// procedural types (vehicleModels.js — cars, taxi, racer, truck, bus, scooter
// and bicycle with riders) picked per track, body paint in the state colour,
// wheels rolling with the distance travelled. Detected targets
// carry a per-track lightness jitter (trackColor.js, shared with 2D) so a
// crowd doesn't read as clones. The playback clock writes the tracking store
// every frame, so this layer updates IMPERATIVELY: fixed pools of THREE.Group
// figures repositioned in useFrame — no React re-render per tick.

const POOL_PERSON = 90
const POOL_CAR = 30
const PERSON_COLOR = '#f59e0b'
const CAR_COLOR = '#3b82f6'
const UNDETECTED_COLOR = '#64748b'
const GHOST_OPACITY = 0.4
const DARK_PART_COLOR = '#1e293b'

// Trail — mirrors the 2D tracksLayer semantics exactly: the last TRAIL_SEC of
// simulated path, faded linearly along the tail, at half the icon's alpha;
// ghosts drag a faint grey tail too. Rendered as a flat ribbon on the floor
// (a GL line would be 1px at any zoom).
const TRAIL_SEC = 12
const TRAIL_MAX_PTS = 64
const TRAIL_ALPHA = 0.5           // × state alpha, same 0.5 factor as 2D
const TRAIL_Y = 0.045             // above the FOV fill (0.03) + outline (0.035)
const TRAIL_HALF_W_PERSON = 0.07
const TRAIL_HALF_W_CAR = 0.16

// Emissive boost on targets currently inside the SELECTED camera's FOV, so
// picking a camera answers "who does this one see" at a glance.
const HIGHLIGHT_EMISSIVE = 0.45

// Scratch colours for the per-frame state/trail writes (no per-frame allocation).
const TRAIL_COLOR_GHOST = new THREE.Color(UNDETECTED_COLOR)
const BLACK = new THREE.Color('#000000')
const _trailColor = new THREE.Color()
const _stateColor = new THREE.Color()

// Walk-cycle tuning (people only). Limbs swing about their LOCAL Z axis —
// the figure walks along its local +X (yaw faces the heading), so fore/aft
// stride lives in the XY plane. (Rotation about X would be a sideways
// scissor, which reads as no gait at all.)
const STRIDE_M = 0.75        // metres of travel per full leg-swing cycle
const LEG_SWING_MAX = 0.5    // rad — max hip swing at full walking speed
const WALK_FULL_SPEED = 1.4  // m/s — speed at which the stride is at full amp
const BODY_BOB_M = 0.05      // m — vertical torso bob amplitude
const KNEE_FACTOR = 1.4      // knee flexion vs hip amplitude (swing phase only)
// Cap per-frame phase advance: at 10x/60x playback a target crosses metres per
// frame and an uncapped phase strobes (legs freeze at random poses = gliding).
// 0.45 rad/frame ≈ a brisk 4 Hz stride at 60 fps — fast but still a walk.
const MAX_PHASE_STEP = 0.45
// Same idea for car wheels: ≈ 0.6 rad/frame keeps the hub cross readable as
// turning forward instead of strobing.
const MAX_WHEEL_STEP = 0.6
// Motion smoothing (seconds — time constants of an exponential approach).
// SPEED_TAU: how quickly the gait follows a speed change (start/stop eases
// over ~0.5 s instead of popping). YAW_TAU_*: how quickly a figure turns to a
// new leg's heading — a 170° waypoint reversal takes ~0.5 s for a person,
// ~0.9 s for a vehicle. MAX_RAW_SPEED (m/s) clamps the per-frame estimate so
// a timeline scrub can't fling the smoothed value.
const SPEED_TAU = 0.25
const YAW_TAU_PERSON = 0.18
const YAW_TAU_VEHICLE = 0.35
const MAX_RAW_SPEED = 12
// Two-wheelers lean into turns: lean = atan(speed × turn rate / g), eased
// with LEAN_TAU and capped at MAX_LEAN (≈ 29°, so fast playback can't lay
// them flat). The crank turns once per CRANK_RATIO wheel radians of travel
// (a simple fixed gear).
const LEAN_TAU = 0.25
const MAX_LEAN = 0.5
const GRAVITY = 9.81
const CRANK_RATIO = 2.2
// Vehicle lamps (vehicleModels updateVehicleLights):
//   night       — head/tail lamps on between NIGHT_FROM_H and NIGHT_TO_H of
//                 the playback clock (daytime running lamps always on)
//   brake       — decelerating harder than BRAKE_DECEL m/s², or held for
//                 BRAKE_HOLD_SEC after coming to a stop (not when parked)
//   turn signal — the heading TURN_LOOKAHEAD_SEC ahead on the track differs
//                 from the current one by more than TURN_SIGNAL_RAD, so the
//                 signal comes on BEFORE the turn; it stays on TURN_HOLD_SEC
//                 after, flashing at BLINK_HZ (wall-clock, so the flasher
//                 keeps a natural rate at fast playback)
const NIGHT_FROM_H = 18
const NIGHT_TO_H = 6
const BRAKE_DECEL = 0.6
const BRAKE_HOLD_SEC = 4
const ACCEL_TAU = 0.3
const TURN_LOOKAHEAD_SEC = 2.5
const TURN_SIGNAL_RAD = 0.35
const TURN_HOLD_SEC = 1
const BLINK_HZ = 1.5

// Stable male/female pick per track, so a person keeps the same body for the
// whole walk even when pool slots shift as other tracks start and end.
function trackSex(id) {
  const s = String(id)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h & 1) ? 'f' : 'm'
}

// Scooter helmet colours, picked per track.
const HELMET_COLORS = ['#f3f4f6', '#15171a', '#c62828', '#f2c230', '#1e5aa8', '#b8bec6']
function helmetColor(id) {
  const s = String(id)
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 131 + s.charCodeAt(i)) | 0
  return HELMET_COLORS[(h >>> 0) % HELMET_COLORS.length]
}

// A realistic seated rider on a two-wheeler slot (vehicleModels SEATS), one
// per sex, created on first use and kept on the vehicle group. Placed so the
// pelvis lands on the seat; helmeted if the seat says so.
const _seatOffset = new THREE.Vector3()
function seatedRider(fig, sex, models) {
  const riders = fig.userData.riders ?? (fig.userData.riders = {})
  let r = riders[sex]
  if (!r) {
    const seat = fig.userData.seat
    r = createPerson(models[sex])
    r.userData.setAngles(seat.angles)
    _seatOffset.fromArray(seat.pelvis).sub(models[sex].pelvisRest)
    r.position.copy(_seatOffset)
    // Still unparented, so the rider's world space IS the vehicle frame:
    // fit under the roof (car drivers), fit the wrists to the grips, and
    // measure the legs for pedalling.
    if (seat.headroom) fitHeadroom(r, seat.headroom)
    fitGrips(r, seat)
    // A driver's shadow would fall inside the closed car — skip the pass.
    if (seat.driver) r.traverse((o) => { if (o.isMesh) o.castShadow = false })
    if (seat.crank) r.userData.legIK = prepareLegIK(r)
    if (seat.helmet) addHalfHelmet(r, '#f3f4f6')
    fig.add(r)
    riders[sex] = r
  }
  return r
}

function pointInPoly(x, y, pts) {
  const n = pts.length / 2
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1]
    const xj = pts[j * 2], yj = pts[j * 2 + 1]
    if (((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside
  }
  return inside
}

// ── Shared geometries (one of each; meshes reference them) ────────────────
// People fallback: capsule assemblies (round shoulders / limbs) with swinging
// arms, shown while the realistic models load. Vehicles live in
// vehicleModels.js.
function buildGeometries() {
  return {
    head: new THREE.SphereGeometry(0.11, 16, 12),
    neck: new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8),
    // Shirt: wider than the body underneath, with a flared hem cylinder at
    // the waist — garments hang OVER the body, they don't paint it.
    torso: new THREE.CapsuleGeometry(0.15, 0.4, 4, 12),   // total ~0.70
    // Hem barely flares past the torso (0.15) — the earlier 0.175 bottom
    // radius read as a tool belt rather than a shirt hanging over the waist.
    hem: new THREE.CylinderGeometry(0.155, 0.162, 0.09, 12),
    pelvis: new THREE.CylinderGeometry(0.14, 0.125, 0.16, 10),
    sleeve: new THREE.CapsuleGeometry(0.062, 0.16, 4, 8), // total ~0.28
    forearm: new THREE.CapsuleGeometry(0.04, 0.26, 4, 8), // total ~0.34, skin
    thigh: new THREE.CapsuleGeometry(0.062, 0.3, 4, 8),   // total ~0.42
    shin: new THREE.CapsuleGeometry(0.052, 0.28, 4, 8),   // total ~0.38
    shoe: new THREE.BoxGeometry(0.24, 0.08, 0.11),        // long axis = forward
  }
}

// Pivot heights the limbs swing from. Limb meshes hang below their pivot
// Group so rotating the pivot swings the limb about the joint — not its
// midpoint — giving a real stride / arm swing.
const HIP_Y = 0.84
const SHOULDER_Y = 1.42

// Little person, ~1.7 m tall, actually CLOTHED — the garment reads from the
// SILHOUETTE, not from paint: the shirt is wider than the body with a flared
// hem overhanging the waist, the sleeves are thicker than the skin-coloured
// forearms sticking out of them, and a pants-coloured pelvis bridges the
// waist to the two-segment legs (hip → thigh → knee → shin + shoe). Skin
// shows only at head/neck/forearms. All shades derive from the state tint,
// so the hue still says "detected amber" / "ghost grey" (applyState
// recomputes them). Everything above the hips lives in a `body` group so the
// walk cycle can bob the whole upper body without disturbing the leg pivots.
function makePerson(geo) {
  const shirtMat = new THREE.MeshStandardMaterial({ color: PERSON_COLOR, roughness: 0.7 })
  const pantsMat = new THREE.MeshStandardMaterial({ color: PERSON_COLOR, roughness: 0.8 })
  const skinMat = new THREE.MeshStandardMaterial({ color: PERSON_COLOR, roughness: 0.6 })
  const shoeMat = new THREE.MeshStandardMaterial({ color: DARK_PART_COLOR, roughness: 0.5 })
  const g = new THREE.Group()

  const body = new THREE.Group()
  const head = new THREE.Mesh(geo.head, skinMat)
  head.position.y = 1.58
  head.castShadow = true
  const neck = new THREE.Mesh(geo.neck, skinMat)
  neck.position.y = 1.47
  const torso = new THREE.Mesh(geo.torso, shirtMat)
  torso.position.y = 1.16   // shirt spans ~0.81–1.51 (shoulders round off)
  torso.castShadow = true
  const hem = new THREE.Mesh(geo.hem, shirtMat)
  hem.position.y = 0.86     // flared shirt hem overhanging the waist
  const pelvis = new THREE.Mesh(geo.pelvis, pantsMat)
  pelvis.position.y = 0.78
  pelvis.castShadow = true
  body.add(head, neck, torso, hem, pelvis)

  // Arms hang from shoulder pivots on the body group (the bob carries them):
  // a thick shirt-coloured sleeve with a thinner skin forearm below it — the
  // sleeve/skin step is what sells "wearing clothes" at a glance.
  const makeArm = (z) => {
    const pivot = new THREE.Group()
    pivot.position.set(0, SHOULDER_Y, z)
    const sleeve = new THREE.Mesh(geo.sleeve, shirtMat)
    sleeve.position.y = -0.14
    sleeve.castShadow = true
    const forearm = new THREE.Mesh(geo.forearm, skinMat)
    forearm.position.y = -0.43
    forearm.castShadow = true
    pivot.add(sleeve, forearm)
    return pivot
  }
  const armL = makeArm(-0.2)
  const armR = makeArm(0.2)
  body.add(armL, armR)

  // Two-segment leg: hip pivot carries the thigh and a knee pivot; the knee
  // carries the shin and the shoe, so knee flexion bends the lower leg and
  // foot together.
  const makeLeg = (z) => {
    const hip = new THREE.Group()
    hip.position.set(0, HIP_Y, z)
    const thigh = new THREE.Mesh(geo.thigh, pantsMat)
    thigh.position.y = -0.21
    thigh.castShadow = true
    const knee = new THREE.Group()
    knee.position.set(0, -0.4, 0)     // knee joint ~0.44 above ground
    const shin = new THREE.Mesh(geo.shin, pantsMat)
    shin.position.y = -0.19
    shin.castShadow = true
    const shoe = new THREE.Mesh(geo.shoe, shoeMat)
    shoe.position.set(0.05, -0.37, 0) // toe forward, sole near the floor
    shoe.castShadow = true
    knee.add(shin, shoe)
    hip.add(thigh, knee)
    return { hip, knee }
  }
  const legL = makeLeg(-0.1)
  const legR = makeLeg(0.1)

  g.add(body, legL.hip, legR.hip)
  g.visible = false
  g.userData.tintMat = shirtMat
  g.userData.pantsMat = pantsMat
  g.userData.skinMat = skinMat
  g.userData.shoeMat = shoeMat
  g.userData.darkMat = null
  // Walk-cycle handles + per-figure phase so figures don't march in lockstep.
  g.userData.body = body
  g.userData.legL = legL.hip
  g.userData.legR = legR.hip
  g.userData.kneeL = legL.knee
  g.userData.kneeR = legR.knee
  g.userData.armL = armL
  g.userData.armR = armR
  g.userData.walkPhase = 0
  return g
}

// `baseColor` arrives already per-track jittered (trackColor.js). People
// derive their outfit from it every call: pants a darker shade, head a
// lighter desaturated (skin-ish) shade — derived rather than fixed so the
// ghost state greys the whole figure consistently.
function applyState(group, detected, baseColor, highlight = false) {
  const { tintMat, pantsMat, skinMat, shoeMat, darkMat, hubMat, extraMats } = group.userData
  _stateColor.set(detected ? baseColor : UNDETECTED_COLOR)
  const tinted = [tintMat]
  tintMat.color.copy(_stateColor)
  if (pantsMat) {
    // Strong offsets — subtler ones (−0.08) disappeared under the ±0.10
    // per-track jitter and normal viewing distance.
    pantsMat.color.copy(_stateColor).offsetHSL(0, 0, -0.16)
    tinted.push(pantsMat)
  }
  if (skinMat) {
    // Head/neck/forearms: desaturated + slightly lifted → skin against the
    // coloured garment (greys along with everything in the ghost state).
    // Lift trimmed from 0.18 to 0.10: the paler tone washed out to near-white
    // under the key light, so heads read as bald highlights from above.
    skinMat.color.copy(_stateColor).offsetHSL(0, -0.4, 0.1)
    tinted.push(skinMat)
  }
  for (const m of tinted) {
    m.opacity = detected ? 1 : GHOST_OPACITY
    m.transparent = !detected
    // Selected-camera highlight: the whole tinted outfit glows its own colour.
    m.emissive.copy(highlight ? m.color : BLACK)
    m.emissiveIntensity = highlight ? HIGHLIGHT_EMISSIVE : 0
    // Keep depthWrite ON even when ghosted. A figure is several overlapping
    // meshes (body + glass + wheels / torso + limbs); with depthWrite off,
    // three.js sorts whole transparent meshes by distance and a part can be
    // drawn behind the body from some angles and vanish. Writing depth makes
    // each fragment occlude correctly. (Minor cost: a ghost doesn't show its
    // own far side through itself — acceptable.)
    m.depthWrite = true
  }
  for (const m of extraMats ?? [darkMat, hubMat, shoeMat]) {
    if (!m) continue
    m.opacity = detected ? 1 : GHOST_OPACITY
    m.transparent = !detected
    m.depthWrite = true
  }
}

// ── Trail ribbons ──────────────────────────────────────────────────────────
// One shared unlit shader for every trail: per-vertex colour + fade carry all
// the per-target state, so 120 ribbons cost one material. (meshBasicMaterial
// has no per-vertex alpha — vertexColors only tint RGB — and darkening toward
// the tail like the FOV cone does would read wrong over a WHITE floor plan.)
function makeTrailMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      attribute vec3 aColor;
      attribute float aFade;
      varying vec3 vColor;
      varying float vFade;
      void main() {
        vColor = aColor;
        vFade = aFade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vFade;
      void main() {
        gl_FragColor = vec4(vColor, vFade);
      }
    `,
  })
}

// Preallocated ribbon: TRAIL_MAX_PTS cross-sections of 2 verts, indexed as a
// strip; setDrawRange trims to the points actually written each frame.
function makeTrail(material, halfW) {
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX_PTS * 2 * 3), 3))
  geom.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX_PTS * 2 * 3), 3))
  geom.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX_PTS * 2), 1))
  const index = []
  for (let i = 0; i + 1 < TRAIL_MAX_PTS; i++) {
    const a = i * 2
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  geom.setIndex(index)
  geom.setDrawRange(0, 0)
  const mesh = new THREE.Mesh(geom, material)
  // Bounds move every frame — skip culling rather than recompute spheres.
  mesh.frustumCulled = false
  mesh.raycast = () => null
  mesh.visible = false
  mesh.userData.halfW = halfW
  return mesh
}

// Rebuild one trail's ribbon for the window [t − TRAIL_SEC, t]. Points mirror
// the 2D walk: current pos, then waypoints backwards inside the window, then
// the interpolated window-start point. pts[0] is the NEWEST point (fade 1).
function updateTrail(mesh, track, t, pos, color, alphaBase, pxToM) {
  const tTrail = Math.max(track.t0, t - TRAIL_SEC)
  const pts = [pos]
  for (let i = track.samples.length - 1; i >= 0; i--) {
    const sm = track.samples[i]
    if (sm.t >= t) continue
    if (sm.t < tTrail) break
    pts.push(sm)
    if (pts.length >= TRAIL_MAX_PTS - 1) break
  }
  const start = sampleTrackAt(track, tTrail)
  if (start && pts.length < TRAIL_MAX_PTS) pts.push(start)
  const n = pts.length
  if (n < 2) { mesh.visible = false; return }

  const posAttr = mesh.geometry.getAttribute('position')
  const colAttr = mesh.geometry.getAttribute('aColor')
  const fadeAttr = mesh.geometry.getAttribute('aFade')
  const halfW = mesh.userData.halfW
  for (let i = 0; i < n; i++) {
    const px = pts[i].x * pxToM
    const pz = pts[i].y * pxToM
    // Ribbon direction from the neighbouring points (newer − older).
    const newer = pts[Math.max(i - 1, 0)]
    const older = pts[Math.min(i + 1, n - 1)]
    let dx = (newer.x - older.x) * pxToM
    let dz = (newer.y - older.y) * pxToM
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) { dx = 1; dz = 0 } else { dx /= len; dz /= len }
    const nx = -dz * halfW
    const nz = dx * halfW
    posAttr.setXYZ(i * 2,     px + nx, TRAIL_Y, pz + nz)
    posAttr.setXYZ(i * 2 + 1, px - nx, TRAIL_Y, pz - nz)
    const fade = alphaBase * TRAIL_ALPHA * (1 - i / (n - 1))
    fadeAttr.setX(i * 2, fade)
    fadeAttr.setX(i * 2 + 1, fade)
    colAttr.setXYZ(i * 2, color.r, color.g, color.b)
    colAttr.setXYZ(i * 2 + 1, color.r, color.g, color.b)
  }
  posAttr.needsUpdate = true
  colAttr.needsUpdate = true
  fadeAttr.needsUpdate = true
  mesh.geometry.setDrawRange(0, (n - 1) * 6)
  mesh.visible = true
}

export default function TrackLayer3D({ floorId, pxToM }) {
  const geo = useMemo(buildGeometries, [])
  const personPool = useMemo(() => Array.from({ length: POOL_PERSON }, () => makePerson(geo)), [geo])
  // Vehicles: nine types (vehicleModels.js), picked per track. Shared
  // geometry is built once; cars are created lazily into per-type pools
  // (POOL_CAR each at most) and parented under carGroup.
  const vehicleGeo = useMemo(buildVehicleGeometries, [])
  const carGroup = useMemo(() => new THREE.Group(), [])
  const carPools = useRef({})
  const getCar = (kind, idx) => {
    if (idx >= POOL_CAR) return null
    const pool = carPools.current[kind] ?? (carPools.current[kind] = [])
    while (pool.length <= idx) {
      const g = makeVehicle(vehicleGeo[kind], kind)
      pool.push(g)
      carGroup.add(g)
    }
    return pool[idx]
  }
  const trailMat = useMemo(makeTrailMaterial, [])
  // Trail slot i belongs to figure slot i of the matching pool.
  const personTrails = useMemo(() => Array.from({ length: POOL_PERSON }, () => makeTrail(trailMat, TRAIL_HALF_W_PERSON)), [trailMat])
  const carTrails = useMemo(() => Array.from({ length: POOL_CAR }, () => makeTrail(trailMat, TRAIL_HALF_W_CAR)), [trailMat])

  // Realistic people. `models` stays null until both GLBs are loaded and
  // calibrated; the primitive pool covers people until then. Figures are
  // cloned lazily into per-sex pools (a SkeletonUtils clone costs a few ms
  // and most scenes never show 90 of either) and parented under rbxGroup.
  const [models, setModels] = useState(null)
  useEffect(() => {
    let alive = true
    loadPeopleModels()
      .then((m) => { if (alive) setModels(m) })
      .catch((err) => console.warn('[TrackLayer3D] people models failed to load; using primitive figures', err))
    return () => { alive = false }
  }, [])
  const rbxGroup = useMemo(() => new THREE.Group(), [])
  const rbxPools = useRef({ m: [], f: [] })
  useEffect(() => () => {
    for (const pool of Object.values(rbxPools.current)) for (const g of pool) disposePerson(g)
    rbxPools.current = { m: [], f: [] }
  }, [])
  const getRbx = (sex, idx) => {
    const pool = rbxPools.current[sex]
    if (idx >= POOL_PERSON) return null
    while (pool.length <= idx) {
      const g = createPerson(models[sex])
      pool.push(g)
      rbxGroup.add(g)
    }
    return pool[idx]
  }

  useEffect(() => () => {
    Object.values(geo).forEach((g) => g.dispose())
    disposeVehicleGeometries(vehicleGeo)
    for (const pool of Object.values(carPools.current)) {
      for (const v of pool) {
        disposeVehicle(v)
        for (const r of Object.values(v.userData.riders ?? {})) disposePerson(r)
      }
    }
    carPools.current = {}
    for (const g of personPool) {
      g.userData.tintMat?.dispose()
      g.userData.pantsMat?.dispose()
      g.userData.skinMat?.dispose()
      g.userData.shoeMat?.dispose()
      g.userData.darkMat?.dispose()
      g.userData.hubMat?.dispose()
      g.userData.extraMats?.forEach((m) => m.dispose())
    }
    for (const m of [...personTrails, ...carTrails]) m.geometry.dispose()
    trailMat.dispose()
  }, [geo, vehicleGeo, personPool, personTrails, carTrails, trailMat])

  // FOV polygons in CANVAS PX space for detection — cached on refs.
  const fovCache = useRef({ cams: null, walls: null, polys: [] })
  const lastFrameMs = useRef(0)

  useFrame(() => {
    const tr = useTrackingStore.getState()
    const cams = useCameraStore.getState().camerasByFloor[floorId] ?? []
    const walls = useWallStore.getState().wallsByFloor[floorId] ?? []
    const tracks = tr.tracksByFloor[floorId] ?? []
    const t = tr.clockSec
    // Wall-clock frame delta, tracked ourselves — r3f 7's useFrame delta arg
    // arrived unusable here (NaN → walk amplitude stuck at 0, figures glided
    // with frozen legs). Clamped so a tab-switch hiccup doesn't fling the
    // walk phase.
    const nowMs = performance.now()
    const dtSec = Math.min(lastFrameMs.current > 0 ? (nowMs - lastFrameMs.current) / 1000 : 0.016, 0.05)
    lastFrameMs.current = nowMs

    if (fovCache.current.cams !== cams || fovCache.current.walls !== walls) {
      const segs = buildBlockingSegments(walls)
      fovCache.current = {
        cams,
        walls,
        polys: cams
          .map((cam) => {
            const { minRangePx, rangePx } = cameraCoverageRadii(cam, 1 / pxToM)
            const pts = computeFovPolygon({
              cx: cam.x,
              cy: cam.y,
              azimuthDeg: cam.azimuth ?? 0,
              fovDeg: cam.fovDeg ?? 90,
              rangePx,
              minRangePx,
              segments: segs,
            })
            return pts ? { camId: cam.id, pts } : null
          })
          .filter(Boolean),
      }
    }
    const polys = fovCache.current.polys

    // Selected camera (if any) → its targets get the emissive highlight.
    const ed = useEditorStore.getState()
    const selCamId = ed.selectedType === 'camera' ? ed.selectedId : null

    let pi = 0
    let ci = 0
    const hourOfDay = (t / 3600) % 24
    const night = hourOfDay >= NIGHT_FROM_H || hourOfDay < NIGHT_TO_H
    // Per-sex slot counters for the realistic people (pi still counts every
    // person — it indexes the trail ribbons).
    const used = { m: 0, f: 0 }
    // Per-type slot counters for vehicles (ci still counts every car — it
    // indexes the trail ribbons).
    const carUsed = {}
    for (const track of tracks) {
      if (t < track.t0 || t > track.t1) continue
      const pos = sampleTrackAt(track, t)
      if (!pos) continue
      let detected = false
      let seenBySelected = false
      for (const poly of polys) {
        if (!pointInPoly(pos.x, pos.y, poly.pts)) continue
        detected = true
        if (!selCamId) break
        if (poly.camId === selCamId) { seenBySelected = true; break }
      }
      if (!detected && !tr.showUndetected) continue

      const isCar = track.type === 'car'
      const idx = isCar ? ci++ : pi++
      let fig
      if (isCar) {
        // Baseline relay cars carry their type (mockTracks guarantees the mix
        // on screen); other cars get one from the weighted pick.
        const kind = track.vehicleKind ?? pickVehicleType(track.id)
        const slot = carUsed[kind] ?? 0
        carUsed[kind] = slot + 1
        fig = getCar(kind, slot)
      }
      else if (models) {
        const sex = trackSex(track.id)
        fig = getRbx(sex, used[sex]++)
      } else fig = personPool[idx]
      if (!fig) continue   // pool exhausted — extremely unlikely
      fig.visible = true
      const ud = fig.userData
      const wx = pos.x * pxToM, wz = pos.y * pxToM
      fig.position.set(wx, 0, wz)

      // Motion state is smoothed, because the mock tracks are piecewise-
      // linear: constant speed per leg, ~45% of legs are dwells, and the
      // waypoints turn sharply (median 126°). Driving the gait straight from
      // each frame's raw movement made the stride jitter with every uneven
      // frame and snapped the body round in one frame at every waypoint.
      // A pool slot that just switched to another track resets, so it
      // doesn't glide over from the previous figure's pose.
      const targetYaw = -trackHeadingAt(track, t)   // yaw = −heading per the wall convention
      if (ud.trackId !== track.id) {
        ud.trackId = track.id
        ud.yaw = targetYaw
        ud.speed = 0
        ud.lean = 0
        ud.hasLast = false
        ud.prevSpeed = 0
        ud.accel = 0
        ud.sinceMoving = Infinity
        ud.turnSide = 0
        ud.turnHold = 0
      }
      let stepDist = 0
      if (ud.hasLast) stepDist = Math.hypot(wx - ud.lastX, wz - ud.lastZ)
      ud.lastX = wx; ud.lastZ = wz; ud.hasLast = true
      // Speed: exponential smoothing of distance / frame time (clamped so a
      // timeline scrub doesn't fling it).
      const rawSpeed = dtSec > 0 ? Math.min(stepDist / dtSec, MAX_RAW_SPEED) : 0
      ud.speed += (rawSpeed - ud.speed) * (1 - Math.exp(-dtSec / SPEED_TAU))
      // Heading: turn toward the leg's direction along the shortest way — a
      // person pivots over a few hundred ms, a vehicle a little slower.
      let dYaw = targetYaw - ud.yaw
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw))
      const yawStep = dYaw * (1 - Math.exp(-dtSec / (isCar ? YAW_TAU_VEHICLE : YAW_TAU_PERSON)))
      ud.yaw += yawStep
      fig.rotation.y = ud.yaw
      // Vehicle lamps for this frame (see the constants above).
      if (isCar) {
        const accelRaw = dtSec > 0 ? (ud.speed - ud.prevSpeed) / dtSec : 0
        ud.prevSpeed = ud.speed
        ud.accel += (accelRaw - ud.accel) * (1 - Math.exp(-dtSec / ACCEL_TAU))
        ud.sinceMoving = ud.speed > 0.5 ? 0 : ud.sinceMoving + dtSec
        const brake = ud.accel < -BRAKE_DECEL || (ud.speed < 0.3 && ud.sinceMoving < BRAKE_HOLD_SEC)
        let dAhead = -trackHeadingAt(track, Math.min(track.t1, t + TURN_LOOKAHEAD_SEC)) - ud.yaw
        dAhead = Math.atan2(Math.sin(dAhead), Math.cos(dAhead))
        // +yaw turns toward −Z, the left side.
        if (Math.abs(dAhead) > TURN_SIGNAL_RAD) {
          ud.turnSide = dAhead > 0 ? -1 : 1
          ud.turnHold = TURN_HOLD_SEC
        } else if ((ud.turnHold -= dtSec) <= 0) {
          ud.turnSide = 0
        }
        if (ud.blinkPhase === undefined) ud.blinkPhase = Math.random()
        const blink = ((nowMs / 1000) * BLINK_HZ + ud.blinkPhase) % 1 < 0.55
        updateVehicleLights(fig, { night, brake, turn: ud.turnSide, blink })
      }
      // Two-wheelers: lean into the turn the smoothed heading is making.
      // +yaw turns toward −Z, and leaning that way is a −roll about +X.
      if (ud.seat?.lean) {
        const yawRate = dtSec > 0 ? yawStep / dtSec : 0
        const target = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, -Math.atan((ud.speed * yawRate) / GRAVITY)))
        ud.lean += (target - ud.lean) * (1 - Math.exp(-dtSec / LEAN_TAU))
        fig.rotation.x = ud.lean
      }
      // Per-track lightness-jittered base colour (memoised in trackColor.js).
      const tint = trackTint(isCar ? CAR_COLOR : PERSON_COLOR, track.id)
      // Realistic people and vehicles show their own colours when detected
      // and grey out as ghosts; the state colour stays on the trail (and as
      // the glow when the selected camera sees them).
      if (fig.userData.rbx) {
        _stateColor.set(tint)
        applyPersonState(fig, detected, personOutfit(track.id), detected ? 1 : GHOST_OPACITY, seenBySelected, _stateColor, HIGHLIGHT_EMISSIVE)
      } else if (fig.userData.vehicleKind) {
        _stateColor.set(tint)
        applyVehicleState(fig, detected, vehicleColors(fig.userData.vehicleKind, track.id), detected ? 1 : GHOST_OPACITY, seenBySelected, _stateColor, HIGHLIGHT_EMISSIVE)
        // Two-wheelers: a realistic seated rider once the people models are
        // in (the primitive rider stays as the fallback until then). Sex and
        // look are per track, like pedestrians'.
        if (ud.seat && models) {
          const sex = trackSex(track.id)
          const rider = seatedRider(fig, sex, models)
          rider.visible = true
          const other = ud.riders[sex === 'm' ? 'f' : 'm']
          if (other) other.visible = false
          if (ud.primitiveRider) ud.primitiveRider.visible = false
          rider.userData.helmet?.material.color.set(helmetColor(track.id))
          applyPersonState(rider, detected, personOutfit(`${track.id}#rider`), detected ? 1 : GHOST_OPACITY, seenBySelected, _stateColor, HIGHLIGHT_EMISSIVE)
        }
      } else {
        applyState(fig, detected, tint, seenBySelected)
      }

      // Trail ribbon — same colour/alpha state as the figure, at half alpha.
      const trailColor = detected ? _trailColor.set(tint) : TRAIL_COLOR_GHOST
      updateTrail(
        isCar ? carTrails[idx] : personTrails[idx],
        track, t, pos, trailColor, detected ? 1 : GHOST_OPACITY, pxToM,
      )

      // Wheels roll by the distance actually covered this frame, so they stop
      // when the car stops and turn faster when it speeds up. Capped per
      // frame: at 10x/60x playback an uncapped roll aliases into the
      // wagon-wheel effect (spokes appear to stand still or run backwards).
      if (isCar) {
        // Rolling toward +X spins a wheel about −Z (its top moves forward) by
        // distance / its own radius — a truck's wheels and a bike's differ.
        // The cap applies to the smallest wheel, so none of them strobes.
        ud.rollDist += Math.min(stepDist, MAX_WHEEL_STEP * ud.minWheelRadius)
        for (const w of ud.wheels) w.rotation.z = -ud.rollDist / w.userData.radius
        // Bicycle: turn the crank with the wheels and keep both ankles on the
        // pedals (right arm at angle a on +Z, left arm opposite).
        if (ud.crank) {
          const a = -ud.rollDist / (ud.minWheelRadius * CRANK_RATIO)
          ud.crank.rotation.z = a
          const rider = ud.riders && Object.values(ud.riders).find((r) => r.visible)
          const ik = rider?.userData.legIK
          if (ik) {
            const c = ud.seat.crank
            for (const [side, ang] of [['R', a], ['L', a + Math.PI]]) {
              applyLegIK(rider, ik, side, c.x + c.r * Math.cos(ang) + c.ankle[0], c.y + c.r * Math.sin(ang) + c.ankle[1])
            }
          }
        }
      }

      // Walk cycle for people, driven by the SMOOTHED ground speed, so it
      // stays correct at any playback speed, when scrubbing, or paused — a
      // still person eases to a stand, a fast one steps faster — without
      // inheriting frame-to-frame jitter. Legs swing about the hips in
      // anti-phase; the torso bobs twice per stride.
      if (!isCar) {
        // Advance phase by metres walked / stride length (× 2π per stride),
        // capped per frame so fast playback stays a readable brisk walk
        // instead of strobing.
        ud.walkPhase += Math.min(((ud.speed * dtSec) / STRIDE_M) * Math.PI * 2, MAX_PHASE_STEP)
        // Amplitude grows with speed, capped so a near-still person barely moves.
        const amp = Math.min(1, ud.speed / WALK_FULL_SPEED) * LEG_SWING_MAX
        const sw = Math.sin(ud.walkPhase)
        const cw = Math.cos(ud.walkPhase)
        if (ud.rbx) {
          // Same gait on the avatar's bones (peopleModels.js pose()).
          ud.pose(sw, cw, amp, -Math.abs(sw) * amp * BODY_BOB_M)
          continue
        }
        ud.legL.rotation.z = sw * amp
        ud.legR.rotation.z = -sw * amp
        // Knees flex while their leg swings forward (cos gates the swing
        // phase), stay straight in stance — the shin+shoe trail the thigh.
        ud.kneeL.rotation.z = -KNEE_FACTOR * amp * Math.max(0, cw)
        ud.kneeR.rotation.z = -KNEE_FACTOR * amp * Math.max(0, -cw)
        // Arms swing opposite their same-side leg, at reduced amplitude.
        ud.armL.rotation.z = -sw * amp * 0.7
        ud.armR.rotation.z = sw * amp * 0.7
        // Vertical bob: lowest at mid-stride (legs splayed), twice per cycle.
        ud.body.position.y = -Math.abs(sw) * amp * BODY_BOB_M
      }
    }
    // Realistic people take over the primitive pool entirely once loaded.
    for (let i = models ? 0 : pi; i < POOL_PERSON; i++) personPool[i].visible = false
    for (let i = pi; i < POOL_PERSON; i++) personTrails[i].visible = false
    for (const sex of ['m', 'f']) {
      const pool = rbxPools.current[sex]
      for (let i = used[sex]; i < pool.length; i++) pool[i].visible = false
    }
    for (let i = ci; i < POOL_CAR; i++) carTrails[i].visible = false
    for (const [kind, pool] of Object.entries(carPools.current)) {
      for (let i = carUsed[kind] ?? 0; i < pool.length; i++) pool[i].visible = false
    }
  })

  if (!pxToM) return null
  return (
    <group>
      {personPool.map((g, i) => <primitive key={`p-${i}`} object={g} />)}
      <primitive object={rbxGroup} />
      <primitive object={carGroup} />
      {personTrails.map((m, i) => <primitive key={`pt-${i}`} object={m} />)}
      {carTrails.map((m, i) => <primitive key={`ct-${i}`} object={m} />)}
    </group>
  )
}
