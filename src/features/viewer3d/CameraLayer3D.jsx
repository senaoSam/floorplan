import React, { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useCameraStore } from '@/store/useCameraStore'
import { useWallStore } from '@/store/useWallStore'
import { useEditorStore } from '@/store/useEditorStore'
import { buildBlockingSegments, computeFovPolygon, cameraCoverageRadii, DEFAULT_TILT_DEG } from '@/features/cameras/fovPolygon'
import Label3D from './Label3D'

// Surveillance cameras in 3D (Phase 34): a small CCTV body at mount height
// aimed along its azimuth, plus the wall-clipped FOV visibility polygon laid
// flat on the floor (same fovPolygon engine as 2D, so glass/window
// transparency and 360° panoramas behave identically). Rendered only while
// the editor is in CAMERA mode (Viewer3D gates the mount).

const CAMERA_COLOR = '#10b981'
const BODY_COLOR = '#e2e8f0'
const FOV_ALPHA = 0.16
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
function CameraBody({ camera, pxToM, dimOpacity, isActiveFloor }) {
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
  }
  const onPointerOut = () => setHovered(false)

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
        <mesh castShadow>
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
function FovVolume({ poly, camera, pxToM, dimOpacity, selected }) {
  const geometry = useMemo(() => {
    if (!poly || poly.length < 6) return null
    const apex = [camera.x * pxToM, Math.max(0.3, camera.z ?? 2.5), camera.y * pxToM]
    const n = poly.length / 2
    const positions = new Float32Array((n + 1) * 3)
    positions[0] = apex[0]; positions[1] = apex[1]; positions[2] = apex[2]
    for (let i = 0; i < n; i++) {
      positions[(i + 1) * 3]     = poly[i * 2] * pxToM
      positions[(i + 1) * 3 + 1] = 0.02
      positions[(i + 1) * 3 + 2] = poly[i * 2 + 1] * pxToM
    }
    const index = []
    for (let i = 1; i <= n; i++) {
      const next = i === n ? 1 : i + 1
      index.push(0, i, next)
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setIndex(index)
    return geom
  }, [poly, camera.x, camera.y, camera.z, pxToM])

  useEffect(() => () => { if (geometry) geometry.dispose() }, [geometry])
  if (!geometry) return null

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        color={CAMERA_COLOR}
        transparent
        opacity={(selected ? 0.16 : 0.09) * dimOpacity}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

// Flat translucent visibility polygon on the floor. Shape is authored in
// canvas-metric XY and rotated +90° about X so shape-Y lands on world +Z.
function FovGround({ poly, pxToM, dimOpacity, selected = false }) {
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

  useEffect(() => () => { if (geometry) geometry.dispose() }, [geometry])
  if (!geometry) return null

  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <primitive object={geometry} attach="geometry" />
      <meshBasicMaterial
        color={CAMERA_COLOR}
        transparent
        opacity={(selected ? FOV_ALPHA + 0.12 : FOV_ALPHA) * dimOpacity}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

export default function CameraLayer3D({ floorId, pxToM, dimOpacity = 1, isActiveFloor = true }) {
  const cameras = useCameraStore((s) => s.camerasByFloor[floorId] ?? [])
  const walls = useWallStore((s) => s.wallsByFloor[floorId] ?? [])
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
  return (
    <group>
      {cameras.map((cam, i) => {
        const isSelected = isActiveFloor && selectedType === 'camera' && selectedId === cam.id
        return (
          <group key={cam.id}>
            <CameraBody camera={cam} pxToM={pxToM} dimOpacity={dimOpacity} isActiveFloor={isActiveFloor} />
            {polys[i] && (
              <>
                <FovVolume
                  poly={polys[i]}
                  camera={cam}
                  pxToM={pxToM}
                  dimOpacity={dimOpacity}
                  selected={isSelected}
                />
                <FovGround
                  poly={polys[i]}
                  pxToM={pxToM}
                  dimOpacity={dimOpacity}
                  selected={isSelected}
                />
              </>
            )}
          </group>
        )
      })}
    </group>
  )
}
