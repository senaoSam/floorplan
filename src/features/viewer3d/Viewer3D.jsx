import React, { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, extend, useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import WallLayer3D from './WallLayer3D'
import APLayer3D from './APLayer3D'
import ScopeLayer3D from './ScopeLayer3D'
import { computeFloorElevations } from './floorStacking'
import './Viewer3D.sass'

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
function FloorPlane({ floor, opacity = 1 }) {
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

  const transparent = opacity < 1
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[w / 2, 0, h / 2]}
      receiveShadow
    >
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial
        map={texture}
        side={THREE.DoubleSide}
        transparent={transparent}
        opacity={opacity}
        depthWrite={!transparent}
      />
    </mesh>
  )
}

// Single stacked floor: its image plane plus all vector layers living in a
// group lifted to the floor's elevation. Non-active floors render with a
// uniform `dimOpacity` < 1 so the active floor stays legible against the
// stacked reference floors.
function FloorStack({ floor, elevation, isActive }) {
  const pxToM = 1 / (floor.scale || 100)
  const dimOpacity = isActive ? 1 : 0.28

  return (
    <group position={[0, elevation, 0]}>
      <Suspense fallback={null}>
        {floor.imageUrl && <FloorPlane floor={floor} opacity={dimOpacity} />}
      </Suspense>
      <ScopeLayer3D floorId={floor.id} pxToM={pxToM} dimOpacity={dimOpacity} />
      <WallLayer3D  floorId={floor.id} pxToM={pxToM} dimOpacity={dimOpacity} />
      <APLayer3D    floorId={floor.id} pxToM={pxToM} dimOpacity={dimOpacity} />
    </group>
  )
}

// Wraps a three.js OrbitControls instance, driven each frame. Camera target is
// the active floor's center so zoom/pan feels anchored to the floor being
// edited in 2D. When `target` changes (e.g. user switches active floor in the
// sidebar) we tween target + camera position together for a short window so
// the view glides instead of snapping. Outside that window OrbitControls owns
// the camera fully — keeping it hijacked per-frame breaks orbit/pan/zoom.
function CameraRig({ target }) {
  const controlsRef = useRef()
  const { camera, gl } = useThree()

  // Tween endpoints + active flag. We only drive the camera during a lift;
  // as soon as target/camera are close enough we hand control back so the
  // user can orbit, pan, and zoom without the rig fighting them.
  const desiredTarget = useRef(new THREE.Vector3(...target))
  const desiredCam    = useRef(new THREE.Vector3())
  const tweening      = useRef(false)

  // On target prop change, set new goal and compute the matching camera goal
  // that preserves the user's current orbit pose (same offset to the target).
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    const nextTarget = new THREE.Vector3(...target)
    const camOffset = new THREE.Vector3().copy(camera.position).sub(controls.target)
    desiredTarget.current.copy(nextTarget)
    desiredCam.current.copy(nextTarget).add(camOffset)
    tweening.current = true
  }, [target, camera])

  // Initialise on mount so the first render doesn't try to tween from 0.
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    controls.target.set(target[0], target[1], target[2])
    controls.update()
    tweening.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((_, dt) => {
    const controls = controlsRef.current
    if (!controls) return
    if (!tweening.current) return   // idle → OrbitControls fully in charge
    // Frame-rate independent critically-damped-ish lerp.
    const k = 8
    const alpha = 1 - Math.exp(-k * Math.min(dt, 0.1))
    controls.target.lerp(desiredTarget.current, alpha)
    camera.position.lerp(desiredCam.current, alpha)
    controls.update()
    // Stop the tween once we're visually settled so user orbit input isn't
    // fought on subsequent frames.
    const done =
      controls.target.distanceToSquared(desiredTarget.current) < 1e-4 &&
      camera.position.distanceToSquared(desiredCam.current) < 1e-4
    if (done) {
      controls.target.copy(desiredTarget.current)
      camera.position.copy(desiredCam.current)
      controls.update()
      tweening.current = false
    }
  })

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
  const activeFloor = floors.find((f) => f.id === activeFloorId) ?? null
  const show3DAllFloors = useEditorStore((s) => s.show3DAllFloors)
  const toggleLayer     = useEditorStore((s) => s.toggleLayer)

  const visibleFloors = show3DAllFloors
    ? floors
    : floors.filter((f) => f.id === activeFloorId)

  // Per-floor stacking elevations computed from floorHeight; shared by the
  // scene graph and the camera target so they move together when the user
  // switches active floor or tweaks a floor height.
  const elevations = useMemo(() => computeFloorElevations(floors), [floors])

  const { w, h } = pxToMeters(activeFloor)
  const activeElev = elevations[activeFloorId] ?? 0
  // Anchor the camera to the active floor's mid-height so switching floors
  // visually lifts the viewpoint.
  const center = useMemo(
    () => [w / 2, activeElev + 1.0, h / 2],
    [w, h, activeElev],
  )

  // Pick an initial camera distance that fits the floor into view from an
  // elevated 3/4 angle. Bigger floors → step back proportionally.
  const diag = Math.max(Math.sqrt(w * w + h * h), 8)
  const camPos = [w / 2 + diag * 0.6, activeElev + diag * 0.7, h / 2 + diag * 0.9]

  return (
    <div className="viewer3d">
      <div className="viewer3d__overlay">
        <button
          type="button"
          className={`viewer3d__floors-btn${show3DAllFloors ? ' viewer3d__floors-btn--active' : ''}`}
          onClick={() => toggleLayer('show3DAllFloors')}
          title={show3DAllFloors ? '切換為只顯示當前樓層' : '切換為顯示全部樓層'}
        >
          {show3DAllFloors ? '🏢 全樓層' : '🏠 單樓層'}
        </button>
      </div>
      <Canvas
        camera={{ position: camPos, fov: 50, near: 0.1, far: 2000 }}
        style={{ width: '100%', height: '100%', background: '#0f172a' }}
      >
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} />
      <hemisphereLight args={['#e2e8f0', '#1e293b', 0.4]} />

      {floors.length === 0 && <EmptyScene />}

      {visibleFloors.map((f) => (
        <FloorStack
          key={f.id}
          floor={f}
          elevation={elevations[f.id] ?? 0}
          isActive={f.id === activeFloorId}
        />
      ))}

      {/* Ground grid anchored to the active floor size, placed just under the
          active floor's elevation so orientation is clear even when viewing
          upper stories. */}
      {activeFloor && (
        <gridHelper
          args={[Math.max(w, h) * 1.5, 20, '#334155', '#1e293b']}
          position={[w / 2, activeElev - 0.01, h / 2]}
        />
      )}

      <CameraRig target={center} />
      </Canvas>
    </div>
  )
}

export default Viewer3D
