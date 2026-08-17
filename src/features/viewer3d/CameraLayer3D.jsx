import React, { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial'
import { useCameraStore } from '@/store/useCameraStore'
import { useWallStore } from '@/store/useWallStore'
import { useEditorStore } from '@/store/useEditorStore'
import { buildBlockingSegments, computeFovPolygon, cameraCoverageRadii, DEFAULT_TILT_DEG } from '@/features/cameras/fovPolygon'
import Label3D from './Label3D'

// 53-G9: one frozen empty array for the `?? EMPTY` selectors below. A bare
// `?? []` returns a new reference whenever the floor's key is absent, so
// zustand saw a changed slice on EVERY store write and re-rendered.
const EMPTY = Object.freeze([])

// Surveillance cameras in 3D (Phase 34): a small CCTV body at mount height
// aimed along its azimuth, plus the wall-clipped FOV visibility polygon laid
// flat on the floor (same fovPolygon engine as 2D, so glass/window
// transparency and 360° panoramas behave identically). Rendered only while
// the editor is in CAMERA mode (Viewer3D gates the mount).

const CAMERA_COLOR = '#10b981'
const BODY_COLOR = '#e2e8f0'
const FOV_ALPHA = 0.16
// 51-10: how far the cone dims toward its outer rim. 0.25 keeps the far edge
// visible while making the near field unmistakably the stronger end.
const FOV_RIM_FALLOFF = 0.25
// Footprint outline thickness, world units. Thinner than the floor-opening
// ring (0.12) — this marks a coverage boundary, not a structural one.
const FOOTPRINT_WIDTH_M = 0.07
const SELECT_EMISSIVE = '#e74c3c'
const HOVER_EMISSIVE = '#ffffff'

// Downward tilt — straight from the camera's editable tiltDeg (the same
// parameter that drives the near/far coverage band in cameraCoverageRadii).
function cameraTiltRad(camera) {
  return (camera.tiltDeg ?? DEFAULT_TILT_DEG) * Math.PI / 180
}

// Canvas px → world: (x, y) ↦ (x·pxToM, h, y·pxToM); yaw = −atan2 (wall conv).
// The only editable object in CAMERA-mode 3D: click selects (CameraPanel
// opens for azimuth/FOV/range/height edits, mirrored live), hover lights up.
// Same 3D-read-only principle as walls/APs — no 3D dragging.
function CameraBody({ camera, pxToM, dimOpacity, isActiveFloor, onHover }) {
  const x = camera.x * pxToM
  const z = camera.y * pxToM
  const y = Math.max(0.3, camera.z ?? 2.5)
  const yaw = -((camera.azimuth ?? 0) * Math.PI / 180)
  const tilt = cameraTiltRad(camera)
  const transparent = dimOpacity < 1

  const selectedId = useEditorStore((s) => s.selectedId)
  const selectedType = useEditorStore((s) => s.selectedType)
  const setSelected = useEditorStore((s) => s.setSelected)
  const [hovered, setHovered] = useState(false)

  const isSelected = isActiveFloor && selectedType === 'camera' && selectedId === camera.id
  const isHovered = isActiveFloor && hovered
  const emissive = isSelected ? SELECT_EMISSIVE : (isHovered ? HOVER_EMISSIVE : '#000000')
  const emissiveIntensity = isSelected ? 0.55 : (isHovered ? 0.3 : 0)

  const onClick = (e) => {
    if (!isActiveFloor) return
    e.stopPropagation()
    setSelected(camera.id, 'camera')
  }
  const onPointerOver = (e) => {
    if (!isActiveFloor) return
    e.stopPropagation()
    setHovered(true)
    if (onHover) onHover(camera)
  }
  const onPointerOut = () => {
    setHovered(false)
    if (onHover) onHover(null)
  }

  return (
    <group
      position={[x, y, z]}
      rotation={[0, yaw, 0]}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      {/* pitched sub-group: the housing + lens tilt down toward the floor
          like a real wall/ceiling-mounted unit; stem + label stay level */}
      <group rotation={[0, 0, -tilt]}>
        {/* body — small housing box, long axis = view axis */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.42, 0.16, 0.16]} />
          <meshStandardMaterial
            color={BODY_COLOR} roughness={0.6} metalness={0.2}
            transparent={transparent} opacity={dimOpacity} depthWrite={!transparent}
            emissive={emissive} emissiveIntensity={emissiveIntensity}
          />
        </mesh>
        {/* lens ring at the front */}
        <mesh position={[0.24, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args={[0.07, 0.09, 0.08, 16]} />
          <meshStandardMaterial
            color={CAMERA_COLOR} roughness={0.4} metalness={0.3}
            transparent={transparent} opacity={dimOpacity} depthWrite={!transparent}
            emissive={emissive} emissiveIntensity={emissiveIntensity}
          />
        </mesh>
      </group>
      {/* wall/ceiling stem so the body doesn't float unexplained */}
      <mesh position={[-0.18, 0.12, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.24, 8]} />
        <meshStandardMaterial
          color="#64748b"
          transparent={transparent} opacity={dimOpacity} depthWrite={!transparent}
        />
      </mesh>
      {/* floating name pill — billboard, like the AP labels */}
      {camera.name && (
        <Label3D text={camera.name} position={[0, 0.55, 0]} opacity={dimOpacity} />
      )}
    </group>
  )
}

// Translucent view volume from the LENS down to the wall-clipped floor
// footprint — apex at mount height, sides following the clipped silhouette,
// so the "light" visibly shoots out of the camera instead of lying on the
// ground. Built as an indexed fan: apex + the footprint ring.
function FovVolume({ poly, camera, pxToM, dimOpacity, selected, dimmed }) {
  const geometry = useMemo(() => {
    if (!poly || poly.length < 6) return null
    const apex = [camera.x * pxToM, Math.max(0.3, camera.z ?? 2.5), camera.y * pxToM]
    const n = poly.length / 2
    const positions = new Float32Array((n + 1) * 3)
    // 51-10: per-vertex alpha, carried in a colour attribute. The cone used a
    // single flat opacity, so a camera's coverage looked equally strong at the
    // lens and at the far edge of its range — the one thing the shape should
    // communicate is that detection falls off with distance. Bright at the
    // apex, fading toward the floor ring.
    //
    // Encoded as vertex COLOUR rather than a real alpha attribute because
    // meshBasicMaterial multiplies vertexColors into the base colour but has
    // no per-vertex alpha channel; darkening toward the rim against the dark
    // backdrop reads as the same falloff and needs no custom shader.
    const colors = new Float32Array((n + 1) * 3)
    const c = new THREE.Color(CAMERA_COLOR)
    positions[0] = apex[0]; positions[1] = apex[1]; positions[2] = apex[2]
    colors[0] = c.r; colors[1] = c.g; colors[2] = c.b
    for (let i = 0; i < n; i++) {
      positions[(i + 1) * 3]     = poly[i * 2] * pxToM
      positions[(i + 1) * 3 + 1] = 0.02
      positions[(i + 1) * 3 + 2] = poly[i * 2 + 1] * pxToM
      colors[(i + 1) * 3]     = c.r * FOV_RIM_FALLOFF
      colors[(i + 1) * 3 + 1] = c.g * FOV_RIM_FALLOFF
      colors[(i + 1) * 3 + 2] = c.b * FOV_RIM_FALLOFF
    }
    const index = []
    for (let i = 1; i <= n; i++) {
      const next = i === n ? 1 : i + 1
      index.push(0, i, next)
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geom.setIndex(index)
    return geom
  }, [poly, camera.x, camera.y, camera.z, pxToM])

  useEffect(() => () => { if (geometry) geometry.dispose() }, [geometry])
  if (!geometry) return null

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        vertexColors
        transparent
        // Lifted from 0.09/0.16: the falloff darkens the outer two-thirds of
        // the cone, so the old flat value left it barely visible. `dimmed`
        // (another camera is selected) pushes the cone well back so the
        // selected one owns the scene.
        opacity={(selected ? 0.22 : dimmed ? 0.05 : 0.14) * dimOpacity}
        side={THREE.DoubleSide}
        depthWrite={false}
        // 51-3: opt out of scene fog. At this alpha any tint reads as a
        // density change, so a far camera's cone would look like weaker
        // coverage than an identical near one.
        fog={false}
      />
    </mesh>
  )
}

// 51-10: coverage-footprint outline, drawn with real width (same Line2
// approach 51-7 used for cables and 51-8 for opening rings).
function FovFootprintOutline({ positions, opacity }) {
  const size = useThree((s) => s.size)

  const geom = useMemo(() => {
    const g = new LineGeometry()
    g.setPositions(positions)
    return g
  }, [positions])
  useEffect(() => () => geom.dispose(), [geom])

  const material = useMemo(() => new LineMaterial({
    color: new THREE.Color(CAMERA_COLOR),
    worldUnits: true,
    linewidth: FOOTPRINT_WIDTH_M,
    transparent: true,
    opacity,
    // Same reasoning as the fill: green identifies camera coverage.
    fog: false,
  }), [opacity])
  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    material.resolution.set(size.width, size.height)
  }, [material, size.width, size.height])

  const line = useMemo(() => {
    const l = new Line2(geom, material)
    l.computeLineDistances()
    l.raycast = () => null
    // Just above the fill (0.03) so it isn't z-fought by it.
    l.position.y = 0.035
    return l
  }, [geom, material])

  return <primitive object={line} />
}

// Flat translucent visibility polygon on the floor. Shape is authored in
// canvas-metric XY and rotated +90° about X so shape-Y lands on world +Z.
function FovGround({ poly, pxToM, dimOpacity, selected = false, dimmed = false }) {
  const geometry = useMemo(() => {
    if (!poly || poly.length < 6) return null
    const shape = new THREE.Shape()
    shape.moveTo(poly[0] * pxToM, poly[1] * pxToM)
    for (let i = 2; i < poly.length; i += 2) {
      shape.lineTo(poly[i] * pxToM, poly[i + 1] * pxToM)
    }
    shape.closePath()
    return new THREE.ShapeGeometry(shape)
  }, [poly, pxToM])

  // 51-10: outline of the coverage footprint. The fill alone has soft edges
  // against the floor image, so where coverage actually STOPS was hard to
  // read — which is the question a blind-spot check is asking. A closed ring
  // through the same polygon points answers it directly.
  const outlinePositions = useMemo(() => {
    if (!poly || poly.length < 6) return null
    const n = poly.length / 2
    const arr = new Float32Array((n + 1) * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3]     = poly[i * 2] * pxToM
      arr[i * 3 + 1] = 0
      arr[i * 3 + 2] = poly[i * 2 + 1] * pxToM
    }
    // Close the loop.
    arr[n * 3]     = poly[0] * pxToM
    arr[n * 3 + 1] = 0
    arr[n * 3 + 2] = poly[1] * pxToM
    return arr
  }, [poly, pxToM])

  useEffect(() => () => { if (geometry) geometry.dispose() }, [geometry])
  if (!geometry) return null

  return (
    <>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <primitive object={geometry} attach="geometry" />
        <meshBasicMaterial
          color={CAMERA_COLOR}
          transparent
          opacity={(selected ? FOV_ALPHA + 0.12 : dimmed ? FOV_ALPHA * 0.3 : FOV_ALPHA) * dimOpacity}
          side={THREE.DoubleSide}
          depthWrite={false}
          // 51-3: coverage footprint — same reasoning as the FOV volume.
          fog={false}
        />
      </mesh>
      {outlinePositions && (
        <FovFootprintOutline
          positions={outlinePositions}
          opacity={(selected ? 0.95 : dimmed ? 0.25 : 0.7) * dimOpacity}
        />
      )}
    </>
  )
}

export default function CameraLayer3D({ floorId, pxToM, dimOpacity = 1, isActiveFloor = true, onCameraHover }) {
  const cameras = useCameraStore((s) => s.camerasByFloor[floorId] ?? EMPTY)
  const walls = useWallStore((s) => s.wallsByFloor[floorId] ?? EMPTY)
  const selectedId = useEditorStore((s) => s.selectedId)
  const selectedType = useEditorStore((s) => s.selectedType)

  const segments = useMemo(() => buildBlockingSegments(walls), [walls])
  const polys = useMemo(() => cameras.map((cam) => {
    const { minRangePx, rangePx } = cameraCoverageRadii(cam, 1 / pxToM)
    return computeFovPolygon({
      cx: cam.x,
      cy: cam.y,
      azimuthDeg: cam.azimuth ?? 0,
      fovDeg: cam.fovDeg ?? 90,
      rangePx,
      minRangePx,
      segments,
    })
  }), [cameras, segments, pxToM])

  if (!cameras.length || !pxToM) return null
  // While one of THIS floor's cameras is selected, every other camera's cone
  // steps back (dimmed) so the selected coverage owns the scene.
  const anySelected = isActiveFloor && selectedType === 'camera' && cameras.some((c) => c.id === selectedId)
  return (
    <group>
      {cameras.map((cam, i) => {
        const isSelected = isActiveFloor && selectedType === 'camera' && selectedId === cam.id
        const dimmed = anySelected && !isSelected
        return (
          <group key={cam.id}>
            <CameraBody camera={cam} pxToM={pxToM} dimOpacity={dimOpacity} isActiveFloor={isActiveFloor} onHover={isActiveFloor ? onCameraHover : undefined} />
            {polys[i] && (
              <>
                <FovVolume
                  poly={polys[i]}
                  camera={cam}
                  pxToM={pxToM}
                  dimOpacity={dimOpacity}
                  selected={isSelected}
                  dimmed={dimmed}
                />
                <FovGround
                  poly={polys[i]}
                  pxToM={pxToM}
                  dimOpacity={dimOpacity}
                  selected={isSelected}
                  dimmed={dimmed}
                />
              </>
            )}
          </group>
        )
      })}
    </group>
  )
}
