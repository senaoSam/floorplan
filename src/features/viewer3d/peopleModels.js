import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils'

// Realistic people for the CAMERA-mode track layer: Microsoft Rocketbox
// avatars (MIT — public/models/people/README.md has the source and what was
// changed). One male, one female; TrackLayer3D picks one per track.
//
// The library ships no walk cycle, so the gait is procedural — the same
// stride/swing/knee/bob parameters the primitive figures use, applied to the
// avatar's thigh / calf / upper-arm / forearm bones.
//
// The models' own axes and bone frames (3ds Max Biped: Z-up, bone-local axes
// that vary per bone) are never hard-coded. calibrate() measures them once per
// model from the rest pose: which way is up (pelvis → head), which way the
// figure faces (foot → toe), and, per driven bone, which bone-local axis
// corresponds to the figure's sideways axis. Every swing is then a rotation
// about that axis, so +angle always means "limb forward" whatever the rig's
// conventions are.

const MODEL_FILES = [
  { key: 'm', file: 'models/people/person-m.glb' },
  { key: 'f', file: 'models/people/person-f.glb' },
]

// Arms hang this far out from straight down (radians of outward lean), and
// the elbow keeps this much bend at rest — dead-straight arms read as a
// mannequin.
const ARM_OUTWARD = 0.12
const ELBOW_REST_BEND = 0.25
// Extra elbow bend while the arm swings forward, as a fraction of the swing.
const ELBOW_SWING_BEND = 0.4

// Per-track looks, so a crowd built from two base models doesn't read as
// clones: top, trousers, shoes, skin tone and hair colour are each picked per
// track and applied in the shader (no extra model or texture per variant).
// Where each one applies comes from masks baked into the textures' alpha:
//   body texture — 1 = garment, 0 = skin. Garments split by HEIGHT in the
//                  bind pose (calibrate() measures waist and shoe-top heights)
//                  into top / trousers / shoes.
//   head texture — 0 = other (eyes, mouth), 0.5 = skin, 1 = hair (scalp,
//                  brows). Skin sits in the middle so filtering at a border
//                  only ever blends two neighbouring classes.
//   hair cards   — all hair (their alpha is real transparency).
// Garments are dyed keeping each texel's luminance as shading (folds, seams,
// denim weave): dyed = tint × mix(SHADE_LO, SHADE_HI, smoothstep(0, SHADE_LUM,
// lum)); DYE_MIX < 1 lets a trace of the original garment through. Skin is
// scaled per channel by target / the model's own mean skin colour, and hair
// is target × lum / the model's mean hair luminance — both keep pores,
// shading and strands. Those reference means come from the GLB's material
// extras (computed when the models were converted).
// The shade range sits high on purpose: the source garments are dark (a red
// shirt, dark denim), and a wider, lower range dragged every chosen colour —
// white, yellow — down to a dull grey-ish tone.
const SHADE_LO = 0.8
const SHADE_HI = 1.12
const SHADE_LUM = 0.25
const DYE_MIX = 0.9
// Where trousers end and the top starts, above the pelvis bone; and the top
// of the shoes above the lowest vertex (metres).
const WAIST_ABOVE_PELVIS_M = 0.07
const SHOE_TOP_M = 0.11
// Half-shell helmet for scooter riders (radius, metres).
const HELMET_R = 0.135
// Ghost (undetected) figures: garments dyed grey and skin/hair desaturated,
// so the whole figure reads grey like the primitive ghost does.
const GHOST_DESAT = 0.85
const GHOST_CLOTH = new THREE.Color('#64748b')

// Per-track palettes (sRGB hex, [colour, weight] where weighted).
// Mostly bright, everyday colours, with a few dark staples kept so the crowd
// still looks natural.
const TOPS = [
  ['#f3f4f6', 4], ['#fde047', 2], ['#fb923c', 2], ['#ef4444', 2], ['#f472b6', 2],
  ['#60a5fa', 3], ['#34d399', 2], ['#a78bfa', 2], ['#fcd9b6', 2], ['#22d3ee', 1],
  ['#fef3c7', 2], ['#86efac', 1],
  ['#1e3a8a', 1], ['#374151', 1], ['#111827', 1],
]
const PANTS = [
  ['#6b8fb8', 4], ['#c2b280', 3], ['#d6c7a1', 3], ['#e5e7eb', 2], ['#9ca3af', 2],
  ['#8fa36a', 1], ['#7aa2d6', 2],
  ['#2b4a6f', 1], ['#111827', 1],
]
const SHOES = [['#141414', 4], ['#e6e6e6', 3], ['#6b6f75', 2], ['#4f3424', 2], ['#1f2a44', 1], ['#a57e55', 1]]
// Skin tones from fair to wheat (小麥色) at the deepest.
const SKINS = [['#f3dcc8', 2], ['#ecc9ae', 4], ['#e2b896', 4], ['#d6a682', 3], ['#c99a74', 2]]
// Natural hair colours; dark shades are most common, grey for older people.
const HAIRS = [['#141210', 4], ['#2e2119', 4], ['#4a3324', 3], ['#7a5a40', 2], ['#5e2c1c', 1], ['#b89260', 1], ['#8f8a84', 1]]
const SKIN_MIX = 1.0
const HAIR_MIX = 0.95

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

// Stable look per track id: { top, pants, shoes, skin, hair } as THREE.Colors
// (cached). Each pick uses its own hash salt so they vary independently.
const outfitCache = new Map()
export function personOutfit(id) {
  const key = String(id)
  let o = outfitCache.get(key)
  if (!o) {
    o = {
      top: new THREE.Color(weightedPick(TOPS, hash32(key, 0x51))),
      pants: new THREE.Color(weightedPick(PANTS, hash32(key, 0xa7))),
      shoes: new THREE.Color(weightedPick(SHOES, hash32(key, 0x2d))),
      skin: new THREE.Color(weightedPick(SKINS, hash32(key, 0x6f))),
      hair: new THREE.Color(weightedPick(HAIRS, hash32(key, 0xc3))),
    }
    outfitCache.set(key, o)
  }
  return o
}

const norm = (name) => name.replace(/[^a-z0-9]/gi, '').toLowerCase()

// Driven bones, by normalised Biped name.
const BONES = {
  spine: 'bip01spine',
  thighL: 'bip01lthigh', thighR: 'bip01rthigh',
  calfL: 'bip01lcalf', calfR: 'bip01rcalf',
  upperArmL: 'bip01lupperarm', upperArmR: 'bip01rupperarm',
  forearmL: 'bip01lforearm', forearmR: 'bip01rforearm',
}

function boneMap(root) {
  const m = new Map()
  root.traverse((o) => { if (o.isBone) m.set(norm(o.name), o) })
  return m
}

const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _q1 = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _m = new THREE.Matrix4()
const SIDE = new THREE.Vector3(0, 0, 1)   // figure-space swing axis
const FWD = new THREE.Vector3(1, 0, 0)    // figure-space forward axis (arm abduction)
const worldPos = (o, v) => o.getWorldPosition(v)

// Measure a freshly loaded model. Returns { orient, rest, axes } where orient
// rotates the model so it stands Y-up facing +X (TrackLayer's walking
// direction) — and is ALREADY APPLIED to `scene`, so clones of it come out
// oriented. rest[bone] is the bone-local rest quaternion with the arms
// lowered out of the T-pose, and axes[bone] is the bone-local axis that maps
// to the figure's sideways axis.
function calibrate(scene) {
  const holder = new THREE.Group()
  holder.add(scene)
  holder.updateMatrixWorld(true)
  const bones = boneMap(scene)
  const get = (n) => {
    const b = bones.get(n)
    if (!b) throw new Error(`people model: missing bone ${n}`)
    return b
  }

  // Orientation: up = pelvis → head; right = left hip → right hip; forward =
  // up × right (right = forward × up for a Y-up figure facing forward).
  // NOT foot → toe: the Biped rest pose's feet point well off the body's
  // heading (measured ~60° on both models), which turned every figure to
  // face sideways while walking straight. The hip line is the body's own
  // left-right axis and doesn't depend on how the feet are splayed.
  const up = worldPos(get('bip01head'), new THREE.Vector3())
    .sub(worldPos(get('bip01pelvis'), _v1)).normalize()
  const right = worldPos(get('bip01rthigh'), new THREE.Vector3())
    .sub(worldPos(get('bip01lthigh'), _v1))
  right.addScaledVector(up, -right.dot(up)).normalize()
  const fwd = new THREE.Vector3().crossVectors(up, right).normalize()
  // makeBasis puts fwd/up/right in the COLUMNS (maps X→fwd …); we want the
  // inverse, fwd→X / up→Y / right→Z, which for a rotation is the transpose.
  _m.makeBasis(fwd, up, right).transpose()
  const orient = new THREE.Quaternion().setFromRotationMatrix(_m)
  scene.quaternion.premultiply(orient)
  holder.updateMatrixWorld(true)

  // Lower each upper arm from the T-pose to hanging, leaning slightly out.
  for (const side of ['L', 'R']) {
    const upper = get(BONES[`upperArm${side}`])
    const fore = get(BONES[`forearm${side}`])
    const shoulder = worldPos(upper, new THREE.Vector3())
    const dir = worldPos(fore, new THREE.Vector3()).sub(shoulder).normalize()
    const out = Math.sign(dir.z) || 1
    const target = _v2.set(0, -1, ARM_OUTWARD * out).normalize()
    const qWorld = _q1.setFromUnitVectors(dir, target)
    // new world = qWorld × old world; local = parentWorld⁻¹ × new world
    const boneWorld = upper.getWorldQuaternion(new THREE.Quaternion())
    const parentWorld = upper.parent.getWorldQuaternion(_q2)
    upper.quaternion.copy(parentWorld.invert().multiply(qWorld.multiply(boneWorld)))
    holder.updateMatrixWorld(true)
  }

  const rest = {}
  const axes = {}
  const axesFwd = {}
  for (const [key, name] of Object.entries(BONES)) {
    const b = get(name)
    rest[key] = b.quaternion.clone()
    const inv = b.getWorldQuaternion(new THREE.Quaternion()).invert()
    axes[key] = SIDE.clone().applyQuaternion(inv).normalize()
    axesFwd[key] = FWD.clone().applyQuaternion(inv).normalize()
  }

  // Dye split heights, in the skinned meshes' OWN local space (the shader
  // dots bind-pose `position` with dyeUp). That space is QUANTIZED, and for a
  // skinned mesh the dequantization lives in the inverse bind matrices, not
  // on the mesh node — so a bone's world position cannot simply be mapped
  // into it (doing so put the waist above the head and dyed whole figures the
  // trousers colour). Work in FRACTIONS of body height instead: measure the
  // waist and shoe-top as fractions in world space (skinned bounding box, in
  // metres), then place them at the same fractions of the local height range.
  const meshes = []
  scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o) })
  const dyeUp = new THREE.Vector3(0, 1, 0).transformDirection(meshes[0].matrixWorld.clone().invert())
  let lo = Infinity, hi = -Infinity
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const h = _v1.fromBufferAttribute(pos, i).dot(dyeUp)
      if (h < lo) lo = h
      if (h > hi) hi = h
    }
  }
  const world = new THREE.Box3()
  // precise: applies the skinning — which reads skeleton.boneMatrices, only
  // filled by an update (no render has happened yet at calibration time).
  for (const m of meshes) { m.skeleton.update(); world.expandByObject(m, true) }
  const worldH = world.max.y - world.min.y
  const toLocal = (metresAboveFeet) => lo + (metresAboveFeet / worldH) * (hi - lo)
  const pelvisAboveFeet = worldPos(get('bip01pelvis'), _v1).y - world.min.y
  const dye = {
    up: dyeUp,
    waistH: toLocal(pelvisAboveFeet + WAIST_ABOVE_PELVIS_M),
    shoeH: toLocal(SHOE_TOP_M),
    band: (0.03 / worldH) * (hi - lo),   // soft edge either side of each split
  }
  // Seated riders are placed by their pelvis (figure space, at rest).
  const pelvisRest = worldPos(get('bip01pelvis'), new THREE.Vector3())
  // Half-shell helmet, as a transform relative to the head bone so it follows
  // the spine lean: centred over the skull just under the top of the head
  // (world.max.y — the hair included), stretched a little front-to-back.
  const head = get('bip01head')
  const headPos = worldPos(head, new THREE.Vector3())
  const helmetWorld = new THREE.Matrix4().compose(
    new THREE.Vector3(headPos.x + 0.012, world.max.y - HELMET_R * 0.8, headPos.z),
    new THREE.Quaternion(),
    new THREE.Vector3(1.12, 1, 1),
  )
  const helmetLocal = head.matrixWorld.clone().invert().multiply(helmetWorld)
  holder.remove(scene)
  return { orient, rest, axes, axesFwd, dye, pelvisRest, helmetLocal }
}

let loadPromise = null

// Loads (once per page) and calibrates both models. Resolves to
// { m: template, f: template } — templates are never added to a scene; each
// figure is a SkeletonUtils clone. Geometry and textures stay cached for the
// life of the page, like the wall textures.
export function loadPeopleModels() {
  if (!loadPromise) {
    const loader = new GLTFLoader()
    const base = import.meta.env.BASE_URL
    loadPromise = Promise.all(MODEL_FILES.map(({ key, file }) =>
      loader.loadAsync(base + file).then((gltf) => {
        const scene = gltf.scene
        const cal = calibrate(scene)
        return [key, { scene, ...cal }]
      }),
    )).then((entries) => Object.fromEntries(entries))
    // A failed load must not stay cached as a rejection forever — let a later
    // mount retry. TrackLayer3D keeps the primitive figures meanwhile.
    loadPromise.catch(() => { loadPromise = null })
  }
  return loadPromise
}

// Material patch: garment dye, skin tone, hair colour, ghost desaturation.
// `u` is per-material; the function source is shared, so every figure
// reuses one compiled program. uMaskMode: 0 body, 1 head, 2 hair cards.
function makePersonPatch(u) {
  return (shader) => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uDyeUp;\nvarying float vDyeH;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDyeH = dot(position, uDyeUp);')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uTopTint;
        uniform vec3 uPantsTint;
        uniform vec3 uShoeTint;
        uniform float uWaistH;
        uniform float uShoeH;
        uniform float uDyeBand;
        uniform float uDyeMix;
        uniform float uMaskMode;
        uniform vec3 uSkinTint;
        uniform vec3 uSkinRef;
        uniform vec3 uHairTint;
        uniform float uHairRefLum;
        uniform float uDesat;
        varying float vDyeH;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          // Body / head textures: alpha is a mask, not transparency — read
          // it, then restore alpha to the material opacity (ghost fade). The
          // hair cards' alpha IS transparency (alpha test), left untouched.
          float clothMask = 0.0;
          float skinW = 0.0;
          float hairW = 0.0;
          #ifdef USE_MAP
            if (uMaskMode < 0.5) {
              clothMask = sampledDiffuseColor.a;
              skinW = 1.0 - clothMask;
              diffuseColor.a = opacity;
            } else if (uMaskMode < 1.5) {
              float a = sampledDiffuseColor.a;
              skinW = clamp(1.0 - abs(a - 0.5) * 2.0, 0.0, 1.0);
              hairW = clamp((a - 0.5) * 2.0, 0.0, 1.0);
              diffuseColor.a = opacity;
            } else {
              hairW = 1.0;
            }
          #endif
          vec3 c = diffuseColor.rgb;
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          // Garments: top above the waist, trousers below it, shoes at the feet.
          float pants = 1.0 - smoothstep(uWaistH - uDyeBand, uWaistH + uDyeBand, vDyeH);
          float shoes = 1.0 - smoothstep(uShoeH - uDyeBand, uShoeH + uDyeBand, vDyeH);
          vec3 garment = mix(mix(uTopTint, uPantsTint, pants), uShoeTint, shoes);
          vec3 dyed = garment * mix(${SHADE_LO.toFixed(3)}, ${SHADE_HI.toFixed(3)}, smoothstep(0.0, ${SHADE_LUM.toFixed(3)}, lum));
          c = mix(c, dyed, clothMask * uDyeMix);
          // Skin: per-channel rescale from the model's own mean skin colour.
          c = mix(c, c * (uSkinTint / max(uSkinRef, vec3(1e-3))), skinW * ${SKIN_MIX.toFixed(3)});
          // Hair: target colour carrying the strands' relative brightness.
          vec3 hairC = uHairTint * clamp(lum / max(uHairRefLum, 1e-4), 0.0, 2.5);
          c = mix(c, hairC, hairW * ${HAIR_MIX.toFixed(3)});
          diffuseColor.rgb = c;
          float lum2 = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum2), uDesat);
        }`,
      )
  }
}

// One figure: Group (positioned / yawed by TrackLayer3D) → body (walk bob)
// → oriented clone. userData exposes the same handles the primitive figure
// path uses (materials for applyState, a pose() for the walk cycle).
export function createPerson(template) {
  // calibrate() already applied `orient` to the template scene itself, and
  // the clone copies that quaternion — applying it again here double-rotated
  // every figure (it was a fixed 90° off its walking direction).
  const clone = SkeletonUtils.clone(template.scene)

  // The body, head and hair are three SkinnedMeshes on ONE skin, but
  // SkeletonUtils.clone gives each its own Skeleton — over the same bone
  // objects. three updates every Skeleton once per frame (bone matrices +
  // bone texture upload), so each figure paid for its pose three times.
  // Share the first one wherever the bone lists are identical.
  const skinned = []
  clone.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o) })
  const shared = skinned[0]?.skeleton
  for (const m of skinned.slice(1)) {
    const s = m.skeleton
    if (s === shared || s.bones.length !== shared.bones.length) continue
    if (!s.bones.every((b, i) => b === shared.bones[i])) continue
    m.bind(shared, m.bindMatrix)
    s.dispose()
  }

  const bones = boneMap(clone)
  const driven = {}
  for (const [key, name] of Object.entries(BONES)) {
    const b = bones.get(name)
    b.quaternion.copy(template.rest[key])
    driven[key] = b
  }

  const mats = []
  clone.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = true
    o.receiveShadow = true
    const name = o.material.name
    const isBody = name === 'body'
    const m = o.material.clone()
    // Reference means from the GLB's material extras (see the top comment).
    const ref = m.userData ?? {}
    const u = {
      uTopTint: { value: new THREE.Color() },
      uPantsTint: { value: new THREE.Color() },
      uShoeTint: { value: new THREE.Color() },
      uSkinTint: { value: new THREE.Color() },
      uSkinRef: { value: new THREE.Vector3(...(ref.skinRef ?? [1, 1, 1])) },
      uHairTint: { value: new THREE.Color() },
      uHairRefLum: { value: ref.hairRefLum ?? 1 },
      uDyeUp: { value: template.dye.up },
      uWaistH: { value: template.dye.waistH },
      uShoeH: { value: template.dye.shoeH },
      uDyeBand: { value: template.dye.band },
      uDyeMix: { value: isBody ? DYE_MIX : 0 },
      uMaskMode: { value: isBody ? 0 : name === 'head' ? 1 : 2 },
      uDesat: { value: 0 },
    }
    m.onBeforeCompile = makePersonPatch(u)
    m.userData.personUniforms = u
    o.material = m
    mats.push(m)
  })

  const body = new THREE.Group()
  body.add(clone)
  const g = new THREE.Group()
  g.add(body)
  g.visible = false
  g.userData.rbx = true
  g.userData.mats = mats
  g.userData.body = body
  g.userData.walkPhase = 0
  // pitch about the sideways axis (+ = limb forward), then an optional
  // abduction about the forward axis (arms reaching out to wide grips).
  const set = (key, angle, abd = 0) => {
    const q = driven[key].quaternion.copy(template.rest[key])
      .multiply(_q1.setFromAxisAngle(template.axes[key], angle))
    if (abd) q.multiply(_q2.setFromAxisAngle(template.axesFwd[key], abd))
  }
  g.userData.template = template
  g.userData.bones = bones
  // Joint angles by driven-bone key (radians about the figure's sideways
  // axis: + swings a limb forward; for the upward-pointing spine, − leans the
  // torso forward). A value may be [pitch, abduction]. Unlisted joints keep
  // their current pose.
  g.userData.setAngles = (angles) => {
    for (const [key, a] of Object.entries(angles)) {
      if (Array.isArray(a)) set(key, a[0], a[1])
      else set(key, a)
    }
  }
  g.userData.pose = (sw, cw, amp, bob) => {
    // Same gait as the primitive figure (TrackLayer3D): legs in anti-phase,
    // knees flexing only while their leg swings forward, arms opposite their
    // same-side leg at reduced amplitude.
    set('thighL', sw * amp)
    set('thighR', -sw * amp)
    set('calfL', -1.4 * amp * Math.max(0, cw))
    set('calfR', -1.4 * amp * Math.max(0, -cw))
    const armL = -sw * amp * 0.7
    const armR = sw * amp * 0.7
    set('upperArmL', armL)
    set('upperArmR', armR)
    set('forearmL', ELBOW_REST_BEND + Math.max(0, armL) * ELBOW_SWING_BEND)
    set('forearmR', ELBOW_REST_BEND + Math.max(0, armR) * ELBOW_SWING_BEND)
    body.position.y = bob
  }
  g.userData.pose(0, 0, 0, 0)
  return g
}

// ── Riding: hands on the grips, feet on the pedals ─────────────────────────
// Both work in the rider's PARENT space (the vehicle frame) while the rider is
// not yet parented, so rider.matrixWorld === its pose in that frame.

const _vh = new THREE.Vector3()
// Fit each arm so the wrist lands on its grip: coordinate descent over
// upper-arm pitch, upper-arm abduction and elbow bend, starting from the seat
// pose. The grips never move relative to the seat, so it is solved ONCE per
// model × seat and cached on the template; every rider then just applies it.
// `grip` is the +Z (right-hand) wrist target; the left mirrors it in z.
//
// Shorter-armed models can't reach from the seat's nominal pelvis spot (the
// female model fell ~10 cm short on the scooter), so the rider may also slide
// forward on the saddle, up to GRIP_SLIDE_MAX in GRIP_SLIDE_STEP steps; the
// smallest slide that brings both wrists within GRIP_OK wins (else the best).
const GRIP_SLIDE_MAX = 0.09
const GRIP_SLIDE_STEP = 0.03
const GRIP_OK = 0.03
export function fitGrips(g, seat) {
  const t = g.userData.template
  const cache = t.gripCache ?? (t.gripCache = new Map())
  let sol = cache.get(seat)
  if (!sol) {
    const baseX = g.position.x
    let best = null
    for (let slide = 0; slide <= GRIP_SLIDE_MAX + 1e-9; slide += GRIP_SLIDE_STEP) {
      g.position.x = baseX + slide
      const s = solveArms(g, seat)
      if (!best || s.err < best.err) best = { ...s, slide }
      if (s.err < GRIP_OK) break
    }
    g.position.x = baseX
    sol = best
    cache.set(seat, sol)
  }
  g.position.x += sol.slide
  g.userData.setAngles(sol.angles)
}

// Coordinate descent for both arms at the rider's current position; err is
// the worse wrist's distance to its grip.
function solveArms(g, seat) {
  const angles = {}
  let worst = 0
  for (const [side, sz] of [['R', 1], ['L', -1]]) {
    const target = new THREE.Vector3(seat.grip[0], seat.grip[1], sz * seat.grip[2])
    const hand = g.userData.bones.get(`bip01${side.toLowerCase()}hand`)
    const err = (q) => {
      g.userData.setAngles({ [`upperArm${side}`]: [q[0], q[1]], [`forearm${side}`]: q[2] })
      g.updateMatrixWorld(true)
      return hand.getWorldPosition(_vh).distanceTo(target)
    }
    let p = [seat.angles[`upperArm${side}`] ?? 0.9, 0, seat.angles[`forearm${side}`] ?? 0.3]
    let best = err(p)
    let step = 0.25
    for (let it = 0; it < 80 && step > 0.002; it++) {
      let improved = false
      for (let k = 0; k < 3; k++) {
        for (const d of [step, -step]) {
          const q = [...p]
          q[k] += d
          if (k === 2) q[2] = Math.max(0, q[2])   // elbows don't hyperextend
          const e = err(q)
          if (e < best) { best = e; p = q; improved = true }
        }
      }
      if (!improved) step *= 0.5
    }
    angles[`upperArm${side}`] = [p[0], p[1]]
    angles[`forearm${side}`] = p[2]
    worst = Math.max(worst, best)
  }
  return { angles, err: worst }
}

// Two-bone leg IK in the sagittal (x-y) plane. prepareLegIK measures, with
// the spine lean already applied, each hip's position, the thigh and shin
// lengths, and the angle offsets between a joint's local 0 and its absolute
// direction (the thighs hang off the spine in this rig, so the lean tilts
// them). applyLegIK then puts the ankle on a target point.
const absDown = (a, b) => Math.atan2(b.x - a.x, -(b.y - a.y))   // from straight down, + = forward
export function prepareLegIK(g) {
  const b = g.userData.bones
  const ik = {}
  for (const side of ['L', 'R']) {
    const s = side.toLowerCase()
    g.userData.setAngles({ [`thigh${side}`]: 0, [`calf${side}`]: 0 })
    g.updateMatrixWorld(true)
    const H = b.get(`bip01${s}thigh`).getWorldPosition(new THREE.Vector3())
    const K = b.get(`bip01${s}calf`).getWorldPosition(new THREE.Vector3())
    const F = b.get(`bip01${s}foot`).getWorldPosition(new THREE.Vector3())
    const a1 = absDown(H, K)
    ik[side] = {
      hip: H,
      L1: Math.hypot(K.x - H.x, K.y - H.y),
      L2: Math.hypot(F.x - K.x, F.y - K.y),
      off1: a1,
      off2: absDown(K, F) - a1,
    }
  }
  return ik
}
export function applyLegIK(g, ik, side, tx, ty) {
  const { hip, L1, L2, off1, off2 } = ik[side]
  const dx = tx - hip.x
  const dy = ty - hip.y
  const d = Math.min(Math.hypot(dx, dy), (L1 + L2) * 0.999)
  const base = Math.atan2(dx, -dy)
  const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)
  // Knee in front of the hip→ankle line (+ = forward).
  const thighAbs = base + Math.acos(Math.min(1, Math.max(-1, cosA)))
  const kx = hip.x + L1 * Math.sin(thighAbs)
  const ky = hip.y - L1 * Math.cos(thighAbs)
  const shinAbs = Math.atan2(tx - kx, -(ty - ky))
  g.userData.setAngles({ [`thigh${side}`]: thighAbs - off1, [`calf${side}`]: shinAbs - thighAbs - off2 })
}

// Half-shell helmet (open below the brow line) on the head bone. `color` is
// an sRGB hex. The material is the figure's own, so it fades as a ghost.
export function addHalfHelmet(g, color) {
  const head = g.userData.bones.get('bip01head')
  const geo = new THREE.SphereGeometry(HELMET_R, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.52)
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.1 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.matrixAutoUpdate = false
  mesh.matrix.copy(g.userData.template.helmetLocal)
  mesh.castShadow = true
  head.add(mesh)
  g.userData.helmet = mesh
  return mesh
}

// State colouring: detected → the track's own look (personOutfit); ghost →
// grey garments, the same skin/hair but desaturated, faded;
// highlight (seen by the selected camera) → emissive glow in `glowColor`.
const _black = new THREE.Color('#000000')
export function applyPersonState(g, detected, outfit, opacity, highlight, glowColor, emissiveIntensity) {
  for (const m of g.userData.mats) {
    const u = m.userData.personUniforms
    u.uTopTint.value.copy(detected ? outfit.top : GHOST_CLOTH)
    u.uPantsTint.value.copy(detected ? outfit.pants : GHOST_CLOTH)
    u.uShoeTint.value.copy(detected ? outfit.shoes : GHOST_CLOTH)
    u.uSkinTint.value.copy(outfit.skin)
    u.uHairTint.value.copy(outfit.hair)
    u.uDesat.value = detected ? 0 : GHOST_DESAT
    m.opacity = opacity
    // Recompile on the flip: three bakes `transparent` into the program's
    // OPAQUE define (which forces alpha to 1). Both variants stay cached, so
    // this costs one compile per variant per page, not per toggle.
    const wantTransparent = opacity < 1
    if (m.transparent !== wantTransparent) {
      m.transparent = wantTransparent
      m.needsUpdate = true
    }
    // depthWrite stays on for ghosts — see applyState in TrackLayer3D.
    m.depthWrite = true
    m.emissive.copy(highlight ? glowColor : _black)
    m.emissiveIntensity = highlight ? emissiveIntensity : 0
  }
  const hm = g.userData.helmet?.material
  if (hm) {
    hm.opacity = opacity
    if (hm.transparent !== opacity < 1) { hm.transparent = opacity < 1; hm.needsUpdate = true }
    hm.depthWrite = true
  }
}

export function disposePerson(g) {
  for (const m of g.userData.mats ?? []) m.dispose()
  if (g.userData.helmet) {
    g.userData.helmet.geometry.dispose()
    g.userData.helmet.material.dispose()
  }
}
