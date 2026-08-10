import React, { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useTrackingStore } from '@/store/useTrackingStore'
import { useCameraStore } from '@/store/useCameraStore'
import { useWallStore } from '@/store/useWallStore'
import { useEditorStore } from '@/store/useEditorStore'
import { sampleTrackAt, trackHeadingAt } from '@/features/cameras/mockTracks'
import { trackTint } from '@/features/cameras/trackColor'
import { buildBlockingSegments, computeFovPolygon, cameraCoverageRadii } from '@/features/cameras/fovPolygon'

// Live tracking targets in 3D (Phase 34, CAMERA mode only — Viewer3D gates
// the mount). Mirrors tracksLayer's semantics: a target is solid-coloured
// while inside at least one camera's FOV (person amber / car blue), a grey
// ghost otherwise (hidden when showUndetected is off). Each target drags a
// fading trail ribbon (last TRAIL_SEC of path, same window as 2D), and while
// a camera is selected the targets inside ITS fov glow (emissive boost).
//
// Figures are low-poly primitive assemblies (two-tone clothed person with
// knees and shoes; extruded car profile with glass/wheels/door seams) —
// recognisable at plan scale without shipping model assets. Detected targets
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
const HUB_COLOR = '#94a3b8'

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
// The car is an extruded SIDE PROFILE (bumper curves, hood, windshield rake,
// trunk, wheel arches) with a narrower dark greenhouse extrusion on top —
// same triangle-budget ballpark as the old stacked boxes, but it reads as a
// sedan instead of a brick. People are capsule assemblies (round shoulders /
// limbs) with swinging arms.
const CAR_GC = 0.26          // body underside before bevel (ground clearance)
const WHEEL_R = 0.33
const WHEEL_X = 1.38         // axle offset from car centre
const ARCH_R = 0.46          // wheel-arch cut radius (bevel shrinks it ~0.08)
const CAR_BODY_W = 1.5       // extrude depth; bevel adds 2×0.08 → ~1.66 total
const CAR_GLASS_W = 1.26     // narrower so the glass reads inset from the body

// Side silhouette in the XY plane: +X = front, Y = up. Drawn CCW from the
// front lower lip, over the roofline to the tail, then back along the
// underside where the two absarc calls carve the wheel arches upward.
function carBodyShape() {
  const s = new THREE.Shape()
  s.moveTo(2.18, CAR_GC)                          // front lower lip
  s.quadraticCurveTo(2.34, 0.32, 2.31, 0.52)      // front bumper
  s.quadraticCurveTo(2.28, 0.7, 2.02, 0.76)       // nose
  s.lineTo(0.98, 0.9)                             // hood
  s.lineTo(-1.7, 1.02)                            // belt line
  s.quadraticCurveTo(-2.26, 1.0, -2.3, 0.72)      // trunk lid
  s.quadraticCurveTo(-2.32, 0.4, -2.08, CAR_GC)   // rear bumper
  s.lineTo(-WHEEL_X - ARCH_R, CAR_GC)
  s.absarc(-WHEEL_X, CAR_GC, ARCH_R, Math.PI, 0, true)  // rear arch
  s.lineTo(WHEEL_X - ARCH_R, CAR_GC)
  s.absarc(WHEEL_X, CAR_GC, ARCH_R, Math.PI, 0, true)   // front arch
  return s
}

// Greenhouse (windshield → roof → rear window). Base overlaps the body's
// belt line slightly so no seam shows between the two extrusions.
function carGlassShape() {
  const s = new THREE.Shape()
  s.moveTo(0.92, 0.88)                            // windshield base
  s.lineTo(0.26, 1.38)                            // windshield rake
  s.quadraticCurveTo(0.06, 1.44, -0.3, 1.44)      // roof front
  s.lineTo(-0.86, 1.42)                           // roof
  s.quadraticCurveTo(-1.1, 1.38, -1.72, 0.92)     // rear window
  return s
}

// Extrude runs 0→depth along Z; recentre so the profile sits on the car's
// long axis. Bevel rounds every edge (incl. the roofline) so highlights from
// the IBL catch on the car the way they do on real paintwork.
function extrudeCentered(shape, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: 12,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
  })
  g.translate(0, 0, -depth / 2)
  return g
}

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
    carBody: extrudeCentered(carBodyShape(), CAR_BODY_W, 0.08),
    carGlass: extrudeCentered(carGlassShape(), CAR_GLASS_W, 0.05),
    wheel: new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.24, 18),
    hub: new THREE.CylinderGeometry(0.14, 0.14, 0.25, 12),
    // Handle is deliberately oversized vs a real one (~11 cm long): at the
    // mid-range distance a planner actually orbits from, true scale shrank
    // below a pixel and the car lost its only side-surface detail.
    doorHandle: new THREE.BoxGeometry(0.26, 0.075, 0.075),
    exhaust: new THREE.CylinderGeometry(0.045, 0.045, 0.18, 10),
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

// Little sedan: extruded body profile (long hood = front) + narrower dark
// greenhouse + four wheels tucked into the arches with lighter hubs. Body
// takes the state tint; glass/tires stay dark, hubs stay grey, and all of
// them fade with the ghost opacity.
function makeCar(geo) {
  const tintMat = new THREE.MeshStandardMaterial({ color: CAR_COLOR, roughness: 0.35, metalness: 0.35 })
  const darkMat = new THREE.MeshStandardMaterial({ color: DARK_PART_COLOR, roughness: 0.25, metalness: 0.4 })
  const hubMat = new THREE.MeshStandardMaterial({ color: HUB_COLOR, roughness: 0.4, metalness: 0.6 })
  const g = new THREE.Group()
  const body = new THREE.Mesh(geo.carBody, tintMat)
  body.castShadow = true
  const glass = new THREE.Mesh(geo.carGlass, darkMat)
  glass.castShadow = true
  g.add(body, glass)
  for (const [wx, wz] of [[WHEEL_X, 0.69], [WHEEL_X, -0.69], [-WHEEL_X, 0.69], [-WHEEL_X, -0.69]]) {
    const tire = new THREE.Mesh(geo.wheel, darkMat)
    tire.rotation.x = Math.PI / 2
    tire.position.set(wx, WHEEL_R, wz)
    tire.castShadow = true
    const hub = new THREE.Mesh(geo.hub, hubMat)
    hub.rotation.x = Math.PI / 2
    hub.position.set(wx, WHEEL_R, wz)
    g.add(tire, hub)
  }
  // Door handles (front/rear door) on the flat body side. NOTE the extrude's
  // flat side CAP sits at |z| = depth/2 + bevelThickness = 0.83 (the bevel
  // expands outward from z ∈ [0, depth]; the cap fills the original contour
  // at the outer end) — anything placed at |z| < 0.83 is buried inside the
  // body. Proud ~3 cm so they stay readable as dark hardware.
  for (const sz of [0.835, -0.835]) {
    for (const hx of [0.34, -0.56]) {
      const handle = new THREE.Mesh(geo.doorHandle, darkMat)
      handle.position.set(hx, 0.93, sz)
      g.add(handle)
    }
  }
  // Exhaust tip poking out under the rear bumper, driver side.
  const exhaust = new THREE.Mesh(geo.exhaust, hubMat)
  exhaust.rotation.z = Math.PI / 2
  exhaust.position.set(-2.28, 0.24, 0.48)
  g.add(exhaust)
  g.visible = false
  g.userData.tintMat = tintMat
  g.userData.darkMat = darkMat
  g.userData.hubMat = hubMat
  return g
}

// `baseColor` arrives already per-track jittered (trackColor.js). People
// derive their outfit from it every call: pants a darker shade, head a
// lighter desaturated (skin-ish) shade — derived rather than fixed so the
// ghost state greys the whole figure consistently.
function applyState(group, detected, baseColor, highlight = false) {
  const { tintMat, pantsMat, skinMat, shoeMat, darkMat, hubMat } = group.userData
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
  for (const m of [darkMat, hubMat, shoeMat]) {
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
  const carPool = useMemo(() => Array.from({ length: POOL_CAR }, () => makeCar(geo)), [geo])
  const trailMat = useMemo(makeTrailMaterial, [])
  // Trail slot i belongs to figure slot i of the matching pool.
  const personTrails = useMemo(() => Array.from({ length: POOL_PERSON }, () => makeTrail(trailMat, TRAIL_HALF_W_PERSON)), [trailMat])
  const carTrails = useMemo(() => Array.from({ length: POOL_CAR }, () => makeTrail(trailMat, TRAIL_HALF_W_CAR)), [trailMat])

  useEffect(() => () => {
    Object.values(geo).forEach((g) => g.dispose())
    for (const g of [...personPool, ...carPool]) {
      g.userData.tintMat?.dispose()
      g.userData.pantsMat?.dispose()
      g.userData.skinMat?.dispose()
      g.userData.shoeMat?.dispose()
      g.userData.darkMat?.dispose()
      g.userData.hubMat?.dispose()
    }
    for (const m of [...personTrails, ...carTrails]) m.geometry.dispose()
    trailMat.dispose()
  }, [geo, personPool, carPool, personTrails, carTrails, trailMat])

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
      const fig = isCar ? carPool[idx] : personPool[idx]
      if (!fig) continue   // pool exhausted — extremely unlikely
      fig.visible = true
      fig.position.set(pos.x * pxToM, 0, pos.y * pxToM)
      // Cars and people both face their walking/driving direction
      // (yaw = −heading per the wall convention).
      fig.rotation.y = -trackHeadingAt(track, t)
      // Per-track lightness-jittered base colour (memoised in trackColor.js).
      const tint = trackTint(isCar ? CAR_COLOR : PERSON_COLOR, track.id)
      applyState(fig, detected, tint, seenBySelected)

      // Trail ribbon — same colour/alpha state as the figure, at half alpha.
      const trailColor = detected ? _trailColor.set(tint) : TRAIL_COLOR_GHOST
      updateTrail(
        isCar ? carTrails[idx] : personTrails[idx],
        track, t, pos, trailColor, detected ? 1 : GHOST_OPACITY, pxToM,
      )

      // Walk cycle for people. Drive the stride from the figure's ACTUAL
      // ground movement this frame (distance between last frame's world
      // position and this one), so it stays correct at any playback speed,
      // when scrubbing, or paused — a still person stops stepping, a fast one
      // steps faster. Legs swing about the hips in anti-phase; the torso bobs
      // twice per stride. Per-frame wall-clock delta gives a speed estimate
      // for the swing amplitude.
      if (!isCar) {
        const ud = fig.userData
        const wx = pos.x * pxToM, wz = pos.y * pxToM
        let stepDist = 0
        if (ud.hasLast) stepDist = Math.hypot(wx - ud.lastX, wz - ud.lastZ)
        ud.lastX = wx; ud.lastZ = wz; ud.hasLast = true
        // Advance phase by metres walked / stride length (× 2π per stride),
        // capped per frame so fast playback stays a readable brisk walk
        // instead of strobing.
        ud.walkPhase += Math.min((stepDist / STRIDE_M) * Math.PI * 2, MAX_PHASE_STEP)
        // Amplitude from instantaneous speed (distance this frame / dt), eased
        // in and capped so a near-still person barely moves.
        const speedMps = dtSec > 0 ? stepDist / dtSec : 0
        const amp = Math.min(1, speedMps / WALK_FULL_SPEED) * LEG_SWING_MAX
        const sw = Math.sin(ud.walkPhase)
        const cw = Math.cos(ud.walkPhase)
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
    for (let i = pi; i < POOL_PERSON; i++) { personPool[i].visible = false; personTrails[i].visible = false }
    for (let i = ci; i < POOL_CAR; i++) { carPool[i].visible = false; carTrails[i].visible = false }
  })

  if (!pxToM) return null
  return (
    <group>
      {personPool.map((g, i) => <primitive key={`p-${i}`} object={g} />)}
      {carPool.map((g, i) => <primitive key={`c-${i}`} object={g} />)}
      {personTrails.map((m, i) => <primitive key={`pt-${i}`} object={m} />)}
      {carTrails.map((m, i) => <primitive key={`ct-${i}`} object={m} />)}
    </group>
  )
}
