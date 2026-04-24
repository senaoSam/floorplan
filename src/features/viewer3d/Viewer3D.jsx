import React, { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, extend, useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { useFloorStore } from '@/store/useFloorStore'
import WallLayer3D from './WallLayer3D'
import APLayer3D from './APLayer3D'

// r3f v7 doesn't include drei by default. Make OrbitControls available as a
// JSX element by registering it with the reconciler.
extend({ OrbitControls })

// Map canvas pixels to meters using the floor's calibrated scale. If scale is
// missing we fall back to a pseudo-scale (100 px/m) just so 3D isn't blank
// before calibration.
function pxToMeters(floor) {
  const scale = floor?.scale || 100
  return {
    w: (floor?.imageWidth  ?? 0) / scale,
    h: (floor?.imageHeight ?? 0) / scale,
  }
}

// Textured floor plane. Plane geometry is XY by default; rotate -90° around X
// so it lies on XZ (Three.js Y-up convention) and the image's "up" (−y canvas)
// faces camera-forward (+z world-negative after flip).
function FloorPlane({ floor }) {
  const { w, h } = pxToMeters(floor)
  // useLoader suspends until the texture is ready; wrap caller in Suspense.
  const texture = useLoader(THREE.TextureLoader, floor.imageUrl)

  // Avoid color-space washout on recent Three.js (r150+): mark the texture as
  // sRGB so the renderer does the linear→display conversion correctly.
  useEffect(() => {
    if (!texture) return
    if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace
    else texture.encoding = THREE.sRGBEncoding
    texture.needsUpdate = true
  }, [texture])

  if (!w || !h) return null

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[w / 2, 0, h / 2]}
      receiveShadow
    >
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial map={texture} side={THREE.DoubleSide} />
    </mesh>
  )
}

// Wraps a three.js OrbitControls instance, driven each frame. Camera target is
// the floor center so zoom/pan feels anchored to the floorplate.
function CameraRig({ target }) {
  const controlsRef = useRef()
  const { camera, gl } = useThree()

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    controls.target.set(target[0], target[1], target[2])
    controls.update()
  }, [target])

  useFrame(() => controlsRef.current?.update())

  return (
    <orbitControls
      ref={controlsRef}
      args={[camera, gl.domElement]}
      enableDamping
      dampingFactor={0.1}
      minDistance={1}
      maxDistance={500}
    />
  )
}

// Placeholder when no floor has imageUrl yet — keeps the canvas alive so the
// user can still orbit empty space without thinking 3D is broken.
function EmptyScene() {
  return (
    <>
      <gridHelper args={[20, 20, '#475569', '#334155']} />
      <axesHelper args={[3]} />
    </>
  )
}

function Viewer3D() {
  const floors = useFloorStore((s) => s.floors)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floor = floors.find((f) => f.id === activeFloorId) ?? null

  const { w, h } = pxToMeters(floor)
  // Center the camera on the floor plate; fall back to origin when empty.
  const center = useMemo(() => [w / 2, 0, h / 2], [w, h])

  // Pick an initial camera distance that fits the floor into view from an
  // elevated 3/4 angle. Bigger floors → step back proportionally.
  const diag = Math.max(Math.sqrt(w * w + h * h), 8)
  const camPos = [w / 2 + diag * 0.6, diag * 0.7, h / 2 + diag * 0.9]

  return (
    <Canvas
      camera={{ position: camPos, fov: 50, near: 0.1, far: 2000 }}
      style={{ width: '100%', height: '100%', background: '#0f172a' }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} />
      <hemisphereLight args={['#e2e8f0', '#1e293b', 0.4]} />

      <Suspense fallback={null}>
        {floor?.imageUrl ? <FloorPlane floor={floor} /> : <EmptyScene />}
      </Suspense>

      {floor && (
        <>
          <WallLayer3D floorId={floor.id} pxToM={1 / (floor.scale || 100)} />
          <APLayer3D   floorId={floor.id} pxToM={1 / (floor.scale || 100)} />
        </>
      )}

      {/* Subtle ground grid for spatial reference (aligned to the floor). */}
      {floor && (
        <gridHelper
          args={[Math.max(w, h) * 1.5, 20, '#334155', '#1e293b']}
          position={[w / 2, -0.01, h / 2]}
        />
      )}

      <CameraRig target={center} />
    </Canvas>
  )
}

export default Viewer3D
