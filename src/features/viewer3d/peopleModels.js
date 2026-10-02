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

// Cloth dye. The body texture's alpha is a cloth mask (1 = garment, 0 = skin).
// Garment texels are recoloured per track — a top colour above the waist, a
// trousers colour below it, shoes left as modelled — so a crowd of two base
// models doesn't read as clones. The split is by HEIGHT in the mesh's bind
// pose (calibrate() measures the waist and shoe-top heights), so no second
// mask texture is needed. The dye keeps each texel's own luminance as shading
// (folds, seams, denim weave): dyed = tint × mix(SHADE_LO, SHADE_HI,
// smoothstep(0, SHADE_LUM, lum)). Skin, face and hair keep their real colours.
// DYE_MIX < 1 lets a trace of the original garment through.
const SHADE_LO = 0.55
const SHADE_HI = 1.2
const SHADE_LUM = 0.35
const DYE_MIX = 0.9
// Where trousers end and the top starts, above the pelvis bone; and the top
// of the shoes above the lowest vertex (metres).
const WAIST_ABOVE_PELVIS_M = 0.07
const SHOE_TOP_M = 0.11
// Ghost (undetected) figures: garments dyed grey and skin/hair desaturated,
// so the whole figure reads grey like the primitive ghost does.
const GHOST_DESAT = 0.85
const GHOST_CLOTH = new THREE.Color('#64748b')

// Per-track outfit palettes — everyday clothing colours (sRGB hex).
const TOPS = ['#1f2937', '#f3f4f6', '#1e3a8a', '#7f1d1d', '#6b7280', '#a16207', '#3f6212', '#be185d', '#0e7490', '#d6c7a1', '#111827', '#9a3412']
const PANTS = ['#1e3a5f', '#111827', '#374151', '#c2b280', '#4b5563', '#1f2a44', '#2b4a6f']

function hash32(str, salt) {
  let h = 2166136261 ^ salt
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

// Stable outfit per track id: { top, pants } as THREE.Colors (cached).
const outfitCache = new Map()
export function personOutfit(id) {
  const key = String(id)
  let o = outfitCache.get(key)
  if (!o) {
    o = {
      top: new THREE.Color(TOPS[hash32(key, 0x51) % TOPS.length]),
      pants: new THREE.Color(PANTS[hash32(key, 0xa7) % PANTS.length]),
    }
    outfitCache.set(key, o)
  }
  return o
}

const norm = (name) => name.replace(/[^a-z0-9]/gi, '').toLowerCase()

// Driven bones, by normalised Biped name.
const BONES = {
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
  for (const [key, name] of Object.entries(BONES)) {
    const b = get(name)
    rest[key] = b.quaternion.clone()
    const inv = b.getWorldQuaternion(new THREE.Quaternion()).invert()
    axes[key] = SIDE.clone().applyQuaternion(inv).normalize()
  }

  // Dye split heights, in the skinned mesh's OWN local space (the shader sees
  // bind-pose `position` there — quantized, so not metres). up = figure +Y
  // brought into mesh space; heights are positions dotted with it.
  let mesh = null
  scene.traverse((o) => { if (!mesh && o.isSkinnedMesh) mesh = o })
  const toMesh = mesh.matrixWorld.clone().invert()
  const dyeUp = new THREE.Vector3(0, 1, 0).transformDirection(toMesh)
  const metre = new THREE.Vector3(0, 1, 0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(toMesh)).length()
  const pos = mesh.geometry.getAttribute('position')
  let feet = Infinity
  for (let i = 0; i < pos.count; i++) feet = Math.min(feet, _v1.fromBufferAttribute(pos, i).dot(dyeUp))
  const pelvisH = worldPos(get('bip01pelvis'), _v1).applyMatrix4(toMesh).dot(dyeUp)
  const dye = {
    up: dyeUp,
    waistH: pelvisH + WAIST_ABOVE_PELVIS_M * metre,
    shoeH: feet + SHOE_TOP_M * metre,
    band: 0.03 * metre,   // soft edge either side of each split
  }
  holder.remove(scene)
  return { orient, rest, axes, dye }
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

// Material patch: cloth dye + ghost desaturation. `u` is per-material; the
// function source is shared, so every figure reuses one compiled program.
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
        uniform float uWaistH;
        uniform float uShoeH;
        uniform float uDyeBand;
        uniform float uDyeMix;
        uniform float uMaskInAlpha;
        uniform float uDesat;
        varying float vDyeH;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          // Body texture: alpha is the cloth mask, not transparency — read
          // it, then restore alpha to the material opacity (ghost fade).
          float clothMask = 0.0;
          #ifdef USE_MAP
            if (uMaskInAlpha > 0.5) {
              clothMask = sampledDiffuseColor.a;
              diffuseColor.a = opacity;
            }
          #endif
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          float pants = 1.0 - smoothstep(uWaistH - uDyeBand, uWaistH + uDyeBand, vDyeH);
          float shoes = 1.0 - smoothstep(uShoeH - uDyeBand, uShoeH + uDyeBand, vDyeH);
          vec3 tint = mix(uTopTint, uPantsTint, pants);
          vec3 dyed = tint * mix(${SHADE_LO.toFixed(3)}, ${SHADE_HI.toFixed(3)}, smoothstep(0.0, ${SHADE_LUM.toFixed(3)}, lum));
          diffuseColor.rgb = mix(diffuseColor.rgb, dyed, clothMask * uDyeMix * (1.0 - shoes));
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
    const isBody = o.material.name === 'body'
    const m = o.material.clone()
    const u = {
      uTopTint: { value: new THREE.Color() },
      uPantsTint: { value: new THREE.Color() },
      uDyeUp: { value: template.dye.up },
      uWaistH: { value: template.dye.waistH },
      uShoeH: { value: template.dye.shoeH },
      uDyeBand: { value: template.dye.band },
      uDyeMix: { value: isBody ? DYE_MIX : 0 },
      uMaskInAlpha: { value: isBody ? 1 : 0 },
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
  g.userData.pose = (sw, cw, amp, bob) => {
    const set = (key, angle) => {
      driven[key].quaternion.copy(template.rest[key])
        .multiply(_q1.setFromAxisAngle(template.axes[key], angle))
    }
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

// State colouring: detected → the track's own outfit (personOutfit), real
// skin and hair; ghost → grey garments, desaturated skin/hair, faded;
// highlight (seen by the selected camera) → emissive glow in `glowColor`.
const _black = new THREE.Color('#000000')
export function applyPersonState(g, detected, outfit, opacity, highlight, glowColor, emissiveIntensity) {
  for (const m of g.userData.mats) {
    const u = m.userData.personUniforms
    u.uTopTint.value.copy(detected ? outfit.top : GHOST_CLOTH)
    u.uPantsTint.value.copy(detected ? outfit.pants : GHOST_CLOTH)
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
}

export function disposePerson(g) {
  for (const m of g.userData.mats ?? []) m.dispose()
}
