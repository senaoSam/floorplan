import React, { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useTrackingStore } from '@/store/useTrackingStore'
import { useCameraStore } from '@/store/useCameraStore'
import { useWallStore } from '@/store/useWallStore'
import { sampleTrackAt, trackHeadingAt } from '@/features/cameras/mockTracks'
import { buildBlockingSegments, computeFovPolygon, cameraCoverageRadii } from '@/features/cameras/fovPolygon'

// Live tracking targets in 3D (Phase 34, CAMERA mode only — Viewer3D gates
// the mount). Mirrors tracksLayer's semantics: a target is solid-coloured
// while inside at least one camera's FOV (person amber / car blue), a grey
// ghost otherwise (hidden when showUndetected is off).
//
// Figures are low-poly primitive assemblies (head/torso/legs; body/cabin/
// wheels) — recognisable at plan scale without shipping model assets. The
// playback clock writes the tracking store every frame, so this layer updates
// IMPERATIVELY: fixed pools of THREE.Group figures repositioned in useFrame —
// no React re-render per tick.

const POOL_PERSON = 90
const POOL_CAR = 30
const PERSON_COLOR = '#f59e0b'
const CAR_COLOR = '#3b82f6'
const UNDETECTED_COLOR = '#64748b'
const GHOST_OPACITY = 0.4
const DARK_PART_COLOR = '#1e293b'

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
function buildGeometries() {
  return {
    head: new THREE.SphereGeometry(0.12, 12, 10),
    torso: new THREE.CylinderGeometry(0.16, 0.13, 0.68, 10),
    leg: new THREE.CylinderGeometry(0.06, 0.05, 0.82, 8),
    carBody: new THREE.BoxGeometry(4.2, 0.6, 1.8),
    carCabin: new THREE.BoxGeometry(2.1, 0.52, 1.6),
    wheel: new THREE.CylinderGeometry(0.32, 0.32, 0.24, 14),
  }
}

// Little person: head + tapered torso + two legs, ~1.7 m tall, single
// state-tinted material (matches the single-colour 2D icon).
function makePerson(geo) {
  const mat = new THREE.MeshStandardMaterial({ color: PERSON_COLOR, roughness: 0.8 })
  const g = new THREE.Group()
  const head = new THREE.Mesh(geo.head, mat)
  head.position.y = 1.56
  head.castShadow = true
  const torso = new THREE.Mesh(geo.torso, mat)
  torso.position.y = 1.08
  torso.castShadow = true
  const legL = new THREE.Mesh(geo.leg, mat)
  legL.position.set(0, 0.41, -0.09)
  legL.castShadow = true
  const legR = new THREE.Mesh(geo.leg, mat)
  legR.position.set(0, 0.41, 0.09)
  legR.castShadow = true
  g.add(head, torso, legL, legR)
  g.visible = false
  g.userData.tintMat = mat
  g.userData.darkMat = null
  return g
}

// Little sedan: body + rear-biased dark cabin (long hood = front) + four
// wheels. Body takes the state tint; cabin/wheels stay dark but fade with
// the ghost opacity.
function makeCar(geo) {
  // DoubleSide so the dark cabin/roof never culls away at grazing angles
  // (a thin box seen edge-on can drop its front face under back-face culling).
  const tintMat = new THREE.MeshStandardMaterial({ color: CAR_COLOR, roughness: 0.5, metalness: 0.25, side: THREE.DoubleSide })
  const darkMat = new THREE.MeshStandardMaterial({ color: DARK_PART_COLOR, roughness: 0.7, side: THREE.DoubleSide })
  const g = new THREE.Group()
  const body = new THREE.Mesh(geo.carBody, tintMat)
  body.position.y = 0.75
  body.castShadow = true
  const cabin = new THREE.Mesh(geo.carCabin, darkMat)
  cabin.position.set(-0.35, 1.25, 0)
  cabin.castShadow = true
  g.add(body, cabin)
  for (const [wx, wz] of [[1.35, 0.78], [1.35, -0.78], [-1.35, 0.78], [-1.35, -0.78]]) {
    const wheel = new THREE.Mesh(geo.wheel, darkMat)
    wheel.rotation.x = Math.PI / 2
    wheel.position.set(wx, 0.32, wz)
    wheel.castShadow = true
    g.add(wheel)
  }
  g.visible = false
  g.userData.tintMat = tintMat
  g.userData.darkMat = darkMat
  return g
}

function applyState(group, detected, baseColor) {
  const { tintMat, darkMat } = group.userData
  tintMat.color.set(detected ? baseColor : UNDETECTED_COLOR)
  tintMat.opacity = detected ? 1 : GHOST_OPACITY
  tintMat.transparent = !detected
  // Keep depthWrite ON even when ghosted. A car is several overlapping meshes
  // (body + cabin + wheels); with depthWrite off, three.js sorts the whole
  // transparent meshes by distance and the cabin (roof) can be drawn behind
  // the body from some angles and vanish. Writing depth makes each fragment
  // occlude correctly, so the roof never drops out. (Minor cost: a ghost car
  // doesn't show its own far side through itself — acceptable for a solid car.)
  tintMat.depthWrite = true
  if (darkMat) {
    darkMat.opacity = detected ? 1 : GHOST_OPACITY
    darkMat.transparent = !detected
    darkMat.depthWrite = true
  }
}

export default function TrackLayer3D({ floorId, pxToM }) {
  const geo = useMemo(buildGeometries, [])
  const personPool = useMemo(() => Array.from({ length: POOL_PERSON }, () => makePerson(geo)), [geo])
  const carPool = useMemo(() => Array.from({ length: POOL_CAR }, () => makeCar(geo)), [geo])

  useEffect(() => () => {
    Object.values(geo).forEach((g) => g.dispose())
    for (const g of [...personPool, ...carPool]) {
      g.userData.tintMat?.dispose()
      g.userData.darkMat?.dispose()
    }
  }, [geo, personPool, carPool])

  // FOV polygons in CANVAS PX space for detection — cached on refs.
  const fovCache = useRef({ cams: null, walls: null, polys: [] })

  useFrame(() => {
    const tr = useTrackingStore.getState()
    const cams = useCameraStore.getState().camerasByFloor[floorId] ?? []
    const walls = useWallStore.getState().wallsByFloor[floorId] ?? []
    const tracks = tr.tracksByFloor[floorId] ?? []
    const t = tr.clockSec

    if (fovCache.current.cams !== cams || fovCache.current.walls !== walls) {
      const segs = buildBlockingSegments(walls)
      fovCache.current = {
        cams,
        walls,
        polys: cams
          .map((cam) => {
            const { minRangePx, rangePx } = cameraCoverageRadii(cam, 1 / pxToM)
            return computeFovPolygon({
              cx: cam.x,
              cy: cam.y,
              azimuthDeg: cam.azimuth ?? 0,
              fovDeg: cam.fovDeg ?? 90,
              rangePx,
              minRangePx,
              segments: segs,
            })
          })
          .filter(Boolean),
      }
    }
    const polys = fovCache.current.polys

    let pi = 0
    let ci = 0
    for (const track of tracks) {
      if (t < track.t0 || t > track.t1) continue
      const pos = sampleTrackAt(track, t)
      if (!pos) continue
      let detected = false
      for (const poly of polys) {
        if (pointInPoly(pos.x, pos.y, poly)) { detected = true; break }
      }
      if (!detected && !tr.showUndetected) continue

      const isCar = track.type === 'car'
      const fig = isCar ? carPool[ci++] : personPool[pi++]
      if (!fig) continue   // pool exhausted — extremely unlikely
      fig.visible = true
      fig.position.set(pos.x * pxToM, 0, pos.y * pxToM)
      // Cars and people both face their walking/driving direction
      // (yaw = −heading per the wall convention).
      fig.rotation.y = -trackHeadingAt(track, t)
      applyState(fig, detected, isCar ? CAR_COLOR : PERSON_COLOR)
    }
    for (let i = pi; i < POOL_PERSON; i++) personPool[i].visible = false
    for (let i = ci; i < POOL_CAR; i++) carPool[i].visible = false
  })

  if (!pxToM) return null
  return (
    <group>
      {personPool.map((g, i) => <primitive key={`p-${i}`} object={g} />)}
      {carPool.map((g, i) => <primitive key={`c-${i}`} object={g} />)}
    </group>
  )
}
