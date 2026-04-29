import React, { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, extend, useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore, VIEW_MODE } from '@/store/useEditorStore'
import WallLayer3D from './WallLayer3D'
import APLayer3D from './APLayer3D'
import ScopeLayer3D from './ScopeLayer3D'
import HeatmapPlane3D from './HeatmapPlane3D'
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
      <WallLayer3D  floorId={floor.id} pxToM={pxToM} dimOpacity={dimOpacity} isActiveFloor={isActive} />
      <APLayer3D    floorId={floor.id} pxToM={pxToM} dimOpacity={dimOpacity} isActiveFloor={isActive} />
      {/* 10-5e MVP: heatmap on the active floor only. Mounted inside this
          group so the plane inherits the floor's elevation translate; the
          `elevation` prop is forwarded for future modes that may mount the
          plane outside the group. */}
      {isActive && (
        <HeatmapPlane3D floorId={floor.id} elevation={elevation} />
      )}
    </group>
  )
}

// Wraps a three.js OrbitControls instance, driven each frame. Camera target is
// the active floor's center so zoom/pan feels anchored to the floor being
// edited in 2D. When `target` changes (e.g. user switches active floor in the
// sidebar) we tween target + camera position together for a short window so
// the view glides instead of snapping. Outside that window OrbitControls owns
// the camera fully — keeping it hijacked per-frame breaks orbit/pan/zoom.
function CameraRig({ target, cameraStateRef, entryPose }) {
  const controlsRef = useRef()
  const { camera, gl } = useThree()

  // Expose live camera + controls + a tween command so the parent can read
  // the current pose on demand AND drive an animated pose change without us
  // hijacking every frame.
  useEffect(() => {
    if (!cameraStateRef) return
    cameraStateRef.current = {
      camera,
      controls: controlsRef.current,
      tweenTo: ({ camPos, target: tgt, duration }) => {
        if (camPos) desiredCam.current.set(camPos[0], camPos[1], camPos[2])
        else desiredCam.current.copy(camera.position)
        if (tgt) desiredTarget.current.set(tgt[0], tgt[1], tgt[2])
        else if (controlsRef.current) desiredTarget.current.copy(controlsRef.current.target)
        // Snapshot starting pose for fixed-duration interpolation.
        startCam.current.copy(camera.position)
        startTarget.current.copy(controlsRef.current?.target ?? desiredTarget.current)
        tweenStartMs.current = performance.now()
        tweenDurMs.current = duration > 0 ? duration : 0
        tweening.current = true
      },
    }
    return () => {
      if (cameraStateRef.current?.camera === camera) cameraStateRef.current = null
    }
  }, [cameraStateRef, camera])

  // Tween endpoints + active flag. We only drive the camera during a lift;
  // as soon as target/camera are close enough we hand control back so the
  // user can orbit, pan, and zoom without the rig fighting them.
  const desiredTarget = useRef(new THREE.Vector3(...target))
  const desiredCam    = useRef(new THREE.Vector3())
  const tweening      = useRef(false)
  const mounted       = useRef(false)
  // Optional fixed-duration tween (used by the parent's tweenTo({duration})).
  // When set, useFrame interpolates start→desired over `durationMs` ignoring
  // the default critically-damped lerp so the user sees a slow, linear-ish
  // glide rather than a snap.
  const startTarget   = useRef(new THREE.Vector3())
  const startCam      = useRef(new THREE.Vector3())
  const tweenStartMs  = useRef(0)
  const tweenDurMs    = useRef(0)

  // On target prop change, set new goal and compute the matching camera goal
  // that preserves the user's current orbit pose (same offset to the target).
  // First mount is special: controls.target is still the default (0,0,0) so
  // the offset would be wrong — instead snap controls.target to the prop and
  // leave camera.position alone (already set via Canvas `camera` prop). If an
  // entryPose is provided we kick off the 2D→3D entry animation right after
  // the snap, since CameraRig owns the moment controls become ready.
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    if (!mounted.current) {
      controls.target.set(target[0], target[1], target[2])
      controls.update()
      tweening.current = false
      mounted.current = true
      if (entryPose) {
        const tgt = entryPose.target ?? target
        desiredCam.current.set(entryPose.camPos[0], entryPose.camPos[1], entryPose.camPos[2])
        desiredTarget.current.set(tgt[0], tgt[1], tgt[2])
        startCam.current.copy(camera.position)
        startTarget.current.copy(controls.target)
        tweenStartMs.current = performance.now()
        tweenDurMs.current = entryPose.duration > 0 ? entryPose.duration : 0
        tweening.current = true
      }
      return
    }
    const nextTarget = new THREE.Vector3(...target)
    const camOffset = new THREE.Vector3().copy(camera.position).sub(controls.target)
    desiredTarget.current.copy(nextTarget)
    desiredCam.current.copy(nextTarget).add(camOffset)
    tweening.current = true
  }, [target, camera, entryPose])

  useFrame((_, dt) => {
    const controls = controlsRef.current
    if (!controls) return
    if (!tweening.current) return   // idle → OrbitControls fully in charge

    if (tweenDurMs.current > 0) {
      // Fixed-duration tween: interpolate the camera offset in *spherical*
      // space (radius, azimuth, polar) around the moving target so the orbit
      // angles change linearly. Cartesian lerp of camera.position would also
      // glide visually but azimuth (atan2 of offset.xz) jumps fast near the
      // top-down singularity where offset.xz ≈ (0,0).
      const elapsed = performance.now() - tweenStartMs.current
      const t = Math.min(1, elapsed / tweenDurMs.current)
      const e = t * t * (3 - 2 * t)  // smoothstep

      // Lerp target in cartesian (target moves slowly or not at all).
      controls.target.lerpVectors(startTarget.current, desiredTarget.current, e)

      // Compute start/end offsets relative to their respective targets, take
      // their spherical decompositions, lerp the three scalars, rebuild a
      // cartesian offset, and add it to the *current* (interpolated) target.
      const offStart = new THREE.Vector3().subVectors(startCam.current, startTarget.current)
      const offEnd   = new THREE.Vector3().subVectors(desiredCam.current, desiredTarget.current)
      const sStart = new THREE.Spherical().setFromVector3(offStart)
      const sEnd   = new THREE.Spherical().setFromVector3(offEnd)
      // Wrap theta to the shorter arc so we don't take the long way round.
      let dTheta = sEnd.theta - sStart.theta
      if (dTheta >  Math.PI) dTheta -= 2 * Math.PI
      if (dTheta < -Math.PI) dTheta += 2 * Math.PI
      const s = new THREE.Spherical(
        sStart.radius + (sEnd.radius - sStart.radius) * e,
        sStart.phi    + (sEnd.phi    - sStart.phi)    * e,
        sStart.theta  + dTheta * e,
      )
      const off = new THREE.Vector3().setFromSpherical(s)
      camera.position.copy(controls.target).add(off)
      controls.update()
      if (t >= 1) {
        controls.target.copy(desiredTarget.current)
        camera.position.copy(desiredCam.current)
        controls.update()
        tweening.current = false
        tweenDurMs.current = 0
      }
      return
    }

    // Default: frame-rate independent critically-damped-ish lerp (used when
    // active floor changes — quick snap into place).
    const k = 8
    const alpha = 1 - Math.exp(-k * Math.min(dt, 0.1))
    controls.target.lerp(desiredTarget.current, alpha)
    camera.position.lerp(desiredCam.current, alpha)
    controls.update()
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
  const clearSelected   = useEditorStore((s) => s.clearSelected)
  // CanvasArea now keeps Viewer3D mounted but hidden when viewMode === 2D, so
  // we'd otherwise burn GPU rendering an invisible scene. Drop the r3f loop
  // to demand-only when hidden; OrbitControls re-invalidates on user input,
  // so this is safe.
  const viewMode        = useEditorStore((s) => s.viewMode)
  const isVisible       = viewMode === VIEW_MODE.THREE_D

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

  // Initial pose: near-top-down birds-eye so the user enters 3D looking down
  // at the active floor — easy to map back to the 2D editor. We can't sit at
  // exactly (target.x, *, target.z) because that's an OrbitControls gimbal
  // singularity (offset = (0, *, 0) → atan2 collapses, internal spherical
  // decomposition picks an arbitrary azimuth, typically 45°). Nudge offset.z
  // a hair so azimuth resolves to 0°. Distance scales with floor diagonal.
  const diag = Math.max(Math.sqrt(w * w + h * h), 8)
  const camPos = [w / 2, activeElev + 1.0 + diag * 1.3, h / 2 + 0.001]

  const cameraStateRef = useRef(null)

  // 進 3D 立刻啟動「2D → 3D 落地」的 5 秒鏡頭過渡：俯瞰起手 → 3/4
  // perspective。Pose 是當下測試樓層手動 tune 出來的世界座標，後續可改成
  // 相對 target 的 offset 讓多樓層通用。
  const entryPose = useMemo(
    () => ({ camPos: [41.617, 31.053, 56.264], target: center, duration: 1500 }),
    [center],
  )
  const handleLogCamera = () => {
    const state = cameraStateRef.current
    if (!state) {
      console.warn('[Viewer3D] camera not ready')
      return
    }
    const { camera, controls } = state
    const fmt = (v) => Number(v.toFixed(3))
    const pos = camera.position
    const tgt = controls?.target
    // Azimuth (yaw around world Y) + polar (tilt from world Y) describe the
    // orbit angles OrbitControls itself uses internally. Compute from the
    // camera→target offset so the numbers stay in sync with what the user
    // sees, regardless of camera.rotation order.
    let azimuthDeg = null
    let polarDeg = null
    if (tgt) {
      const off = pos.clone().sub(tgt)
      const r = off.length()
      azimuthDeg = fmt(THREE.MathUtils.radToDeg(Math.atan2(off.x, off.z)))
      polarDeg   = fmt(THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(-1, off.y / r)))))
    }
    console.log('[Viewer3D] camera pose', {
      camera: { x: fmt(pos.x), y: fmt(pos.y), z: fmt(pos.z) },
      target: tgt ? { x: fmt(tgt.x), y: fmt(tgt.y), z: fmt(tgt.z) } : null,
      distance: tgt ? fmt(pos.distanceTo(tgt)) : null,
      azimuthDeg,   // 0° = 從 +Z 方向看；繞 Y 軸水平旋轉
      polarDeg,     // 0° = 正上往下俯瞰；90° = 水平視角
    })
  }

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
        <button
          type="button"
          className="viewer3d__floors-btn"
          onClick={handleLogCamera}
          title="把目前相機位置與 target 印到 console"
        >
          📷 Log Camera
        </button>
      </div>
      <Canvas
        camera={{ position: camPos, fov: 50, near: 0.1, far: 2000 }}
        style={{ width: '100%', height: '100%', background: '#0f172a' }}
        frameloop={isVisible ? 'always' : 'demand'}
        onPointerMissed={() => clearSelected()}
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

      <CameraRig target={center} cameraStateRef={cameraStateRef} entryPose={entryPose} />
      </Canvas>
    </div>
  )
}

export default Viewer3D
