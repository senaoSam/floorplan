import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, extend, useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment'
import { useFloorStore, getPxPerM, getFloorHeight } from '@/store/useFloorStore'
import { useEditorStore, VIEW_MODE, EDITOR_MODE } from '@/store/useEditorStore'
import { useViewportStore } from '@/store/useViewportStore'
import { getSceneRefs } from '@/render/sceneRegistry'
import { SWITCH_KINDS, getSwitchKindColor } from '@/store/useCableStore'
import { cameraModelById } from '@/constants/cameraModels'
import { deviceStatus, STATUS_COLOR, STATUS_LABEL } from '@/features/cameras/deviceStatus'
import WallLayer3D from './WallLayer3D'
import CameraLayer3D from './CameraLayer3D'
import TrackLayer3D from './TrackLayer3D'
import APLayer3D from './APLayer3D'
import ScopeLayer3D from './ScopeLayer3D'
import HeatmapPlane3D from './HeatmapPlane3D'
import HeatmapStackPlane3D from './HeatmapStackPlane3D'
import { attachHeatmapStackDriver } from './heatmapStack'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import CameraOverlay3D from './CameraOverlay3D'
import FloorHoleVolume3D from './FloorHoleVolume3D'
import RiserLayer3D from './RiserLayer3D'
import TrayLayer3D from './TrayLayer3D'
import SwitchLayer3D from './SwitchLayer3D'
import CableLayer3D from './CableLayer3D'
import GroundGrid3D from './GroundGrid3D'
import { computeFloorElevations } from '@/utils/floorStacking'
import Icon from '@/components/Icon/Icon'
import './Viewer3D.sass'

// r3f v7 doesn't include drei by default. Make OrbitControls available as a
// JSX element by registering it with the reconciler.
extend({ OrbitControls })

// Map canvas pixels to meters using the floor's calibrated scale. If scale is
// missing we fall back to the shared pre-calibration placeholder just so 3D
// isn't blank.
//
// 53-G8: this used to be its own `|| 100` while every 2D layer fell back to 40,
// so on an uncalibrated floor the same camera's coverage came out 2.5x larger
// relative to the floor slab in 3D than in 2D. Both now read the one value.
function pxToMeters(floor) {
  const scale = getPxPerM(floor)
  return {
    w: (floor?.imageWidth  ?? 0) / scale,
    h: (floor?.imageHeight ?? 0) / scale,
  }
}

// 51-5 Structural slab under each floor's image plane. Without it the plan
// reads as a sheet of paper floating in space, and a stack of them as several
// sheets — there is nothing to say the building has substance. A slab this
// thin doesn't obscure anything; it just gives the floor an edge you can see.
//
// Hangs BELOW y=0 because y=0 is the walkable surface inside a floor group:
// walls sit at bottomHeight (default 0) and the image plane is at 0. Putting
// the slab above would bury the floor plan under it.
//
// SLAB_GAP_M matters more than it looks. The slab's top face must sit strictly
// below the image plane, not level with it — coplanar at y=0 the two z-fight,
// which showed up as banding across the plate and, from straight above, the
// slab winning most pixels and hiding the floor plan almost entirely.
const SLAB_THICKNESS_M = 0.14
const SLAB_GAP_M = 0.004
const SLAB_COLOR = '#8d99ae'
const SLAB_EDGE_COLOR = '#5c6879'

function FloorSlab({ w, h, opacity = 1 }) {
  const transparent = opacity < 1
  return (
    <mesh
      position={[w / 2, -SLAB_GAP_M - SLAB_THICKNESS_M / 2, h / 2]}
      receiveShadow
      castShadow
      // The image plane sits right on top of this; nothing here should
      // intercept a click meant for the floor or the objects on it.
      raycast={() => null}
    >
      <boxGeometry args={[w, SLAB_THICKNESS_M, h]} />
      <meshStandardMaterial
        color={SLAB_COLOR}
        roughness={0.9}
        metalness={0.02}
        transparent={transparent}
        opacity={opacity}
        depthWrite={!transparent}
      />
    </mesh>
  )
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

  // Slab edge outline. Reads as a drawn floor plate rather than a shaded box,
  // and keeps the floor's extent legible where the slab face catches little
  // light (the underside of a stacked floor, for instance).
  const edges = useMemo(() => {
    if (!w || !h) return null
    const box = new THREE.BoxGeometry(w, SLAB_THICKNESS_M, h)
    const eg = new THREE.EdgesGeometry(box)
    box.dispose()
    return eg
  }, [w, h])
  useEffect(() => () => { if (edges) edges.dispose() }, [edges])

  if (!w || !h) return null

  const transparent = opacity < 1
  return (
    <>
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
      <FloorSlab w={w} h={h} opacity={opacity} />
      {edges && (
        <lineSegments
          position={[w / 2, -SLAB_GAP_M - SLAB_THICKNESS_M / 2, h / 2]}
          raycast={() => null}
        >
          <primitive object={edges} attach="geometry" />
          <lineBasicMaterial
            color={SLAB_EDGE_COLOR}
            transparent
            opacity={0.75 * opacity}
          />
        </lineSegments>
      )}
    </>
  )
}

// 51-3: fog tint. Matches the bottom stop of the CSS sky gradient in
// Viewer3D.sass — the band the floor plate meets — so fogged geometry fades
// into the backdrop instead of toward some unrelated grey. Keep the two in
// sync if either changes.
const FOG_COLOR = '#16203a'

// Direction the KEY light shines from, as an offset from the scene centre.
// Scaled by the content radius (below) so the light stays outside the geometry
// on any floor size instead of sitting at a fixed 60/90/40 that a large plan
// would swallow.
const KEY_LIGHT_DIR = [0.52, 0.78, 0.35]

// Single shadow-casting directional KEY light. Anchored relative to the active
// floor centre and aimed at it so the orthographic shadow frustum stays
// registered on the floor regardless of floor size/position. The light's
// `target` is an Object3D that must be attached to the scene and pointed at by
// the light; we wire it imperatively after mount (a ref's `.current` change
// does not re-render in R3F, so a JSX `target={ref.current}` would be stale on
// first paint).
//
// 51-2: the frustum half-extent used to be a fixed ±80 m, chosen to cover any
// plausible plan. That wastes almost the entire shadow map on empty space, so
// the building got only a small corner of it and shadow edges were chunky. We
// now size the frustum to `radius`, the bounding radius of the content the
// caller wants shadowed. Measured on the demo floor (30 × 22.4 m) by
// projecting its bounding box through the live light matrices:
//   fixed ±80 m   452 × 397 texels of 2048²,  4.3% of the map used
//   fitted        1780 × 1563 texels,        66.3% used  → 15.4x by area
// Two knock-on effects worth knowing: the light POSITION now scales with
// radius too (it used to be a fixed 60/90/40 offset, which a large plan would
// swallow), and shadow bias had to come down — see below.
//
// Why the bounding RADIUS and not the floor's width/height: the frustum is
// axis-aligned in light space, not world space, so the extent needed depends
// on the light direction. A radius is rotation-invariant, so it can never clip
// regardless of where the light sits or how the plan is proportioned. It costs
// a little resolution versus a tightly fitted box, but it cannot produce the
// failure mode that matters here (shadows chopped off at the frustum edge).
function KeyLight({ center, radius }) {
  const lightRef = useRef()
  const targetRef = useRef()
  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current
      lightRef.current.target.updateMatrixWorld()
    }
  })

  // Keep the light well outside the content, and the far plane beyond it, so
  // nothing is clipped by near/far as the floor grows.
  const dist = Math.max(radius * 2.2, 40)
  const pos = [
    center[0] + KEY_LIGHT_DIR[0] * dist,
    center[1] + KEY_LIGHT_DIR[1] * dist,
    center[2] + KEY_LIGHT_DIR[2] * dist,
  ]
  const far = dist + radius * 2 + 10

  return (
    <>
      <object3D ref={targetRef} position={center} />
      <directionalLight
        ref={lightRef}
        position={pos}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={far}
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={radius}
        shadow-camera-bottom={-radius}
        // Bias fights acne, and the amount needed scales with world units per
        // texel — which just dropped ~4x per axis, so the old -0.0005 would be
        // heavy-handed now and detach shadows from their casters. normalBias
        // is the better tool for slope-dependent acne (world units, offsets
        // along the surface normal rather than in depth).
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
      />
    </>
  )
}

// Single stacked floor: its image plane plus all vector layers living in a
// group lifted to the floor's elevation. Non-active floors render with a
// uniform `dimOpacity` < 1 so the active floor stays legible against the
// stacked reference floors.
//
// CAMERA mode (Phase 34) mirrors the 2D rule "walls + floor image only":
// every RF/cable layer is unmounted and the surveillance layers (camera
// bodies + FOV ground polygons + live tracking targets) mount instead.
function FloorStack({ floor, elevation, isActive, onAPHover, onSwitchHover, onCameraHover, inCameraMode }) {
  const pxToM = 1 / getPxPerM(floor)   // 53-G8: was `|| 100`; see pxToMeters
  const dimOpacity = isActive ? 1 : 0.28

  // Floor-align transform (mirrors the 2D ALIGN_FLOOR rule). The 2D editor
  // stores per-floor offset/scale/rotation in canvas pixels, applied as
  //   world = (cx+ox, cy+oy) + R·s·(p − (cx,cy))
  // i.e. rotate+scale about the image center, then translate by the offset
  // (see refOverlayLayer.applyAlignTransform). We reproduce the same map in
  // 3D so a floor aligned in 2D stacks correctly here too. The vector layers
  // below already render in meters (pixel × pxToM), so we work in meters and
  // drive a single <group>: canvas X → world X, canvas Y → world Z, rotation
  // about the world Y axis. r3f group applies world = R·s·p + position, so we
  // bake the pivot in: position = (C + O) − R·s·C.
  const align = useMemo(() => {
    const sc = floor.alignScale ?? 1
    const theta = ((floor.alignRotation ?? 0) * Math.PI) / 180
    const cx = ((floor.imageWidth ?? 0) / 2) * pxToM
    const cz = ((floor.imageHeight ?? 0) / 2) * pxToM
    const ox = (floor.alignOffsetX ?? 0) * pxToM
    const oz = (floor.alignOffsetY ?? 0) * pxToM
    // R·s·C, rotating (cx, cz) about world Y. Canvas +Y maps to world +Z; the
    // floor's −90° X tilt makes a positive canvas rotation read as +theta about
    // world Y, matching the 2D ALIGN_FLOOR direction.
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    const rsx = sc * (cos * cx - sin * cz)
    const rsz = sc * (sin * cx + cos * cz)
    return {
      position: [cx + ox - rsx, elevation, cz + oz - rsz],
      rotationY: theta,
      scale: sc,
    }
  }, [floor.alignScale, floor.alignRotation, floor.imageWidth, floor.imageHeight, floor.alignOffsetX, floor.alignOffsetY, pxToM, elevation])

  return (
    <group position={align.position} rotation={[0, align.rotationY, 0]} scale={[align.scale, 1, align.scale]}>
      <Suspense fallback={null}>
        {floor.imageUrl && <FloorPlane floor={floor} opacity={dimOpacity} />}
      </Suspense>
      {!inCameraMode && (
        <ScopeLayer3D floorId={floor.id} pxToM={pxToM} dimOpacity={dimOpacity} />
      )}
      {/* CAMERA mode: walls are reference-only (not selectable) — the only
          editable 3D object there is the camera body. */}
      <WallLayer3D  floorId={floor.id} pxToM={pxToM} dimOpacity={dimOpacity} isActiveFloor={isActive} selectable={!inCameraMode} />
      {!inCameraMode && (
        <>
          <APLayer3D    floorId={floor.id} pxToM={pxToM} dimOpacity={dimOpacity} isActiveFloor={isActive} onAPHover={onAPHover} />
          {/* 15-1 / 19-2: cable tray rendered as thin boxes at each tray's
              per-tray mountHeight (TrayLayer3D reads the floor from the store
              so the ceiling preset can resolve against floor.floorHeight). */}
          <TrayLayer3D  floorId={floor.id} pxToM={pxToM} dimOpacity={dimOpacity} />
          {/* Switch / IDF / MDF / Router chassis at their mountHeight. */}
          <SwitchLayer3D floorId={floor.id} pxToM={pxToM} dimOpacity={dimOpacity} isActiveFloor={isActive} onSwitchHover={onSwitchHover} />
          {/* Cable routes (AP↔switch + S2S) lifted to 3D so the user sees the
              full plenum-routed path, not just the tray geometry. */}
          <CableLayer3D  floorId={floor.id} pxToM={pxToM} dimOpacity={dimOpacity} />
          {/* 10-5e MVP: heatmap on the active floor only. Mounted inside this
              group so the plane inherits the floor's elevation translate; the
              `elevation` prop is forwarded for future modes that may mount the
              plane outside the group. */}
          {isActive && (
            <HeatmapPlane3D floorId={floor.id} elevation={elevation} />
          )}
          {/* Phase 48+ 全樓層熱圖: non-active floors get their own plane fed
              by the on-demand heatmapStack computes (gates itself on the
              toggle + heatmap enabled internally). */}
          {!isActive && <HeatmapStackPlane3D floorId={floor.id} />}
        </>
      )}
      {inCameraMode && (
        <>
          <CameraLayer3D floorId={floor.id} pxToM={pxToM} dimOpacity={dimOpacity} isActiveFloor={isActive} onCameraHover={onCameraHover} />
          {isActive && <TrackLayer3D floorId={floor.id} pxToM={pxToM} />}
          {/* Planning overlays (blind-spot / overlap / occupancy) projected
              from the 2D PIXI layers onto the floor. Active floor only (like the
              2D layers, which clear unless active + CAMERA mode); each plane
              gates itself on its own 2D store flag so 3D mirrors 2D on/off. */}
          {isActive && <CameraOverlay3D floorId={floor.id} pxToM={pxToM} />}
        </>
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
function CameraRig({ target, cameraStateRef, onAutoRotateStop, onAutoRotateStart, initialTargetRef }) {
  const controlsRef = useRef()
  const { camera, gl } = useThree()
  // Keep the latest stop/start callbacks in refs so the listeners and useFrame
  // (registered with stable deps) always call the current handler.
  const onAutoRotateStopRef = useRef(onAutoRotateStop)
  onAutoRotateStopRef.current = onAutoRotateStop
  const onAutoRotateStartRef = useRef(onAutoRotateStart)
  onAutoRotateStartRef.current = onAutoRotateStart

  // Configure the idle turntable spin + stop it the instant the user grabs the
  // controls. autoRotateSpeed is intentionally low for a gentle showcase turn
  // (default is 2.0). The `start` event fires on the first pointerdown / wheel,
  // so any user interaction immediately ends the spin and hands the camera back.
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    controls.autoRotate = false
    controls.autoRotateSpeed = 0.6
    const stopSpin = () => {
      autoRotating.current = false
      wantAutoRotateAfterTween.current = false
      controls.autoRotate = false
      // Let the parent's toggle button reflect that the user interaction
      // ended the spin (so it doesn't keep showing "on").
      onAutoRotateStopRef.current?.()
    }
    controls.addEventListener('start', stopSpin)
    return () => controls.removeEventListener('start', stopSpin)
  }, [])

  // Expose live camera + controls + a tween command so the parent can read
  // the current pose on demand AND drive an animated pose change without us
  // hijacking every frame.
  useEffect(() => {
    if (!cameraStateRef) return
    cameraStateRef.current = {
      camera,
      controls: controlsRef.current,
      tweenTo: ({ camPos, target: tgt, duration, fromCam, fromTarget, autoRotateAfter }) => {
        // Any new programmatic move cancels an in-progress idle spin; opt back
        // in only if this tween asked for it (the entry animation does).
        autoRotating.current = false
        wantAutoRotateAfterTween.current = !!autoRotateAfter
        if (camPos) desiredCam.current.set(camPos[0], camPos[1], camPos[2])
        else desiredCam.current.copy(camera.position)
        if (tgt) desiredTarget.current.set(tgt[0], tgt[1], tgt[2])
        else if (controlsRef.current) desiredTarget.current.copy(controlsRef.current.target)
        // Starting pose. Normally snapshot the live camera, but the caller can
        // pass an explicit fromCam/fromTarget to make the tween begin from a
        // known pose regardless of where the camera currently sits — used by
        // the 2D→3D entry so the animation always starts top-down even if the
        // stale initial camera (set by the <Canvas camera> prop before any
        // floor existed) is somewhere else. Because useFrame snaps the camera
        // to the interpolated start on the very first tween frame, this also
        // overwrites that stale pose before it can be painted.
        if (fromCam) {
          startCam.current.set(fromCam[0], fromCam[1], fromCam[2])
          camera.position.copy(startCam.current)
        } else {
          startCam.current.copy(camera.position)
        }
        if (fromTarget) {
          startTarget.current.set(fromTarget[0], fromTarget[1], fromTarget[2])
          if (controlsRef.current) {
            controlsRef.current.target.copy(startTarget.current)
            controlsRef.current.update()
          }
        } else {
          startTarget.current.copy(controlsRef.current?.target ?? desiredTarget.current)
        }
        tweenStartMs.current = performance.now()
        tweenDurMs.current = duration > 0 ? duration : 0
        tweening.current = true
      },
      // Manual turntable toggle (same idle spin the 2D→3D entry kicks off).
      // Turning it on starts the gentle orbit immediately; the OrbitControls
      // `start` listener still stops it the instant the user grabs the camera.
      setAutoRotate: (on) => {
        autoRotating.current = !!on
        if (controlsRef.current) controlsRef.current.autoRotate = !!on
      },
      // Hard-park the camera at a pose and CANCEL any in-flight tween/spin.
      // The 2D→3D entry uses this so a leftover tween (e.g. a target-change
      // lift fired while the demo was loading) can't keep sliding the camera
      // after we've set the seamless top-down pose — that was the "first time
      // looks farther/zoomed-out, then drifts" bug.
      park: (camPos, tgt) => {
        autoRotating.current = false
        wantAutoRotateAfterTween.current = false
        tweening.current = false
        tweenDurMs.current = 0
        camera.position.set(camPos[0], camPos[1], camPos[2])
        if (controlsRef.current) {
          controlsRef.current.autoRotate = false
          controlsRef.current.target.set(tgt[0], tgt[1], tgt[2])
          controlsRef.current.update()
        }
        // Keep the lerp endpoints at the parked pose so the damped fallback in
        // useFrame (if it ever runs) holds here instead of drifting back.
        desiredCam.current.set(camPos[0], camPos[1], camPos[2])
        desiredTarget.current.set(tgt[0], tgt[1], tgt[2])
        lastTarget.current = [tgt[0], tgt[1], tgt[2]]
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
  // Idle auto-rotate: after the 2D→3D entry tween lands, the camera keeps
  // slowly orbiting the floor (showcase turntable) until the user touches the
  // controls. `wantAutoRotateAfterTween` is set by tweenTo when the caller
  // opts in (the entry animation does; floor-switch lifts don't); the actual
  // spin is OrbitControls' own autoRotate, driven by per-frame update() while
  // `autoRotating` is true.
  const wantAutoRotateAfterTween = useRef(false)
  const autoRotating = useRef(false)

  // Track the target values we last reacted to so we only kick off a tween
  // when the *numeric* target actually changes. The `target` prop is a fresh
  // array on every Viewer3D render (e.g. new floor added → useMemo recomputes
  // with same numbers but fresh array), and previously that triggered the
  // "else" branch each render → tween toward current pose, which fights any
  // ongoing user orbit input.
  const lastTarget = useRef([NaN, NaN, NaN])

  // On target prop change, set new goal and compute the matching camera goal
  // that preserves the user's current orbit pose (same offset to the target).
  // First mount is special: controls.target is still the default (0,0,0) so
  // the offset would be wrong — instead snap controls.target to the prop and
  // leave camera.position alone (already set via Canvas `camera` prop). The
  // 2D→3D entry animation is driven by Viewer3D's isVisible effect (Viewer3D
  // is now always-mounted, so it can't ride CameraRig's first mount).
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    if (!mounted.current) {
      // First mount: prefer the live entry target (the floor point the 2D view
      // is centred on) so the first 3D frame is positioned like 2D, not always
      // the floor's geometric centre. Falls back to the prop target.
      const init = initialTargetRef?.current ?? target
      controls.target.set(init[0], init[1], init[2])
      controls.update()
      tweening.current = false
      mounted.current = true
      lastTarget.current = [target[0], target[1], target[2]]
      return
    }
    // Skip if the numeric target didn't actually change — `target` is often a
    // fresh array each render (Viewer3D recomputes it on any state change).
    const [lx, ly, lz] = lastTarget.current
    if (lx === target[0] && ly === target[1] && lz === target[2]) return
    lastTarget.current = [target[0], target[1], target[2]]
    const nextTarget = new THREE.Vector3(...target)
    const camOffset = new THREE.Vector3().copy(camera.position).sub(controls.target)
    desiredTarget.current.copy(nextTarget)
    desiredCam.current.copy(nextTarget).add(camOffset)
    tweening.current = true
  }, [target, camera])

  useFrame((_, dt) => {
    const controls = controlsRef.current
    if (!controls) return
    if (!tweening.current) {
      // Not tweening. If an idle spin is active, keep ticking OrbitControls so
      // its autoRotate advances the azimuth each frame. Otherwise OrbitControls
      // owns the camera fully (user orbit/pan/zoom).
      if (autoRotating.current) {
        controls.autoRotate = true
        controls.update()
      }
      return
    }

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
        // Entry tween done → start the idle turntable spin if requested.
        if (wantAutoRotateAfterTween.current) {
          wantAutoRotateAfterTween.current = false
          autoRotating.current = true
          // Light up the parent's 自動旋轉 button — the 2D→3D entry starts the
          // spin internally (ref only), so without this the button stays dark
          // while the camera is clearly orbiting.
          onAutoRotateStartRef.current?.()
        }
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

  // Damping 在 OrbitControls 內部會在 sphericalDelta 累積之後 frame 慢慢套用
  // 殘留。使用者拖曳旋轉之後鬆手，殘留 ~200-350ms 才會衰減完；這期間如果滾
  // 滑鼠 zoom，controls.update() 同一個 call 會同時套用「殘留 rotate」與
  // 「zoom」，視覺上像「滾輪帶旋轉」。
  //
  // 試過幾種修法都有副作用：
  //   (a) wheel 時排乾殘留 → 滾輪當下鏡頭突然旋幾度 snap
  //   (b) pointerup 時排乾 → 鬆手當下鏡頭突然繼續旋幾度 snap
  //   (c) 提高 dampingFactor → 殘響變短但仍存在
  // 真正符合使用者預期的是「拖曳結束就停下」，等於 damping 關閉。
  // OrbitControls 的 enableDamping=false 路徑會在 update() 內直接歸零
  // sphericalDelta（line 297），完全沒有殘留。代價是旋轉手感略微生硬，
  // 但對 planner 工具來說「精確」比「滑順」更重要。

  return (
    <orbitControls
      ref={controlsRef}
      args={[camera, gl.domElement]}
      enableDamping={false}
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
      <GroundGrid3D center={[0, 0, 0]} radius={40} cell={1} major={10} />
      <axesHelper args={[3]} />
    </>
  )
}

// 28-2 Compact floor selector dropdown. Stays out of the way (single trigger
// button) until clicked, then expands into a list anchored to the trigger.
// Outside-click and Esc close it, matching the SidebarLeft floor menu UX.
function FloorSelector({ floors, activeFloorId, onSelect }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const activeFloor = floors.find((f) => f.id === activeFloorId)
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDocClick)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="viewer3d__floor-selector" ref={wrapRef}>
      <button
        type="button"
        className={`viewer3d__floor-trigger${open ? ' viewer3d__floor-trigger--open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={activeFloor?.name ?? '選擇樓層'}
      >
        <span className="viewer3d__floor-trigger-label">{activeFloor?.name ?? '—'}</span>
        <span className="viewer3d__floor-trigger-caret"><Icon name="chevronDown" size={10} /></span>
      </button>
      {open && (
        <ul className="viewer3d__floor-list" role="listbox" aria-label="樓層選擇">
          {/* Top-down = highest floor first, matching the SidebarLeft list and
              the 3D stack (floors[0] on the ground). Reverse render only;
              onSelect uses floor.id so no index bookkeeping is needed. */}
          {floors.slice().reverse().map((floor) => {
            const isActive = floor.id === activeFloorId
            return (
              <li
                key={floor.id}
                role="option"
                aria-selected={isActive}
                className={`viewer3d__floor-option${isActive ? ' viewer3d__floor-option--active' : ''}`}
                onClick={() => { onSelect(floor.id); setOpen(false) }}
                title={floor.name}
              >
                {floor.name}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// Per-device tooltip while hovering in 3D (APs, switches, cameras). Lives
// outside the r3f tree as plain HTML so we don't need drei <Html> (would
// force a React 18 / drei upgrade the rest of the project hasn't taken).
// Position is pure container-local pixels, computed from the parent's
// pointer state.
//
// Tooltip flips to the cursor's opposite side when it would overflow the
// viewer container — keeps it on screen at every corner.
const FREQ_LABEL_3D = { 2.4: '2.4 GHz', 5: '5 GHz', 6: '6 GHz' }
const TOOLTIP_OFFSET_PX = 14

// Type-specific tooltip body: { title, pill: {text, color}, rows: [...] }.
// Rows render left→right in the primary line, meta rows in the dimmer line.
function buildReadoutContent(type, d) {
  if (type === 'ap') {
    const freqLabel = FREQ_LABEL_3D[d.frequency] ?? `${d.frequency} GHz`
    const channelLabel = d.channel != null
      ? `Ch ${d.channel}${d.channelWidth ? `/${d.channelWidth}MHz` : ''}`
      : null
    const txLabel = d.txPower != null ? `${d.txPower} dBm` : null
    const mountLabel = d.z != null ? `掛 ${Number(d.z).toFixed(1)} m` : null
    const mode = d.antennaMode ?? 'omni'
    const antennaLabel = mode === 'omni' ? '全向'
      : mode === 'directional' ? `定向 ${d.azimuth ?? 0}° / ${d.beamwidth ?? 60}°`
      : mode === 'custom' ? '自訂'
      : mode
    return {
      title: d.name ?? d.id,
      pill: { text: freqLabel, color: FREQ_COLOR_3D[d.frequency] ?? '#4fc3f7' },
      main: [channelLabel, txLabel],
      meta: [mountLabel, antennaLabel],
    }
  }
  if (type === 'switch') {
    const kind = SWITCH_KINDS.find((k) => k.value === (d.kind ?? 'switch'))
    const poeLabel = d.poeBudget > 0 ? `PoE ${d.poeBudget} W` : null
    return {
      title: d.name ?? d.id,
      pill: { text: kind?.label ?? 'Switch', color: getSwitchKindColor(d.kind ?? 'switch') },
      main: [d.portCount != null ? `${d.portCount} 埠` : null, poeLabel],
      meta: [
        `掛 ${Number(d.mountHeight ?? 0.5).toFixed(1)} m`,
        d.model || null,
      ],
    }
  }
  if (type === 'camera') {
    const model = cameraModelById(d.modelId)
    const status = deviceStatus(d)
    return {
      title: d.name ?? d.id,
      // Long catalog labels carry a（use-case）suffix — keep the short name.
      pill: { text: (model?.label ?? '相機').split('（')[0], color: '#10b981' },
      status: { text: STATUS_LABEL[status], color: STATUS_COLOR[status] },
      main: [
        (d.fovDeg ?? 90) >= 360 ? 'FOV 360°' : `FOV ${d.fovDeg ?? 90}°`,
        `範圍 ${d.rangeM ?? 0} m`,
      ],
      meta: [
        `掛 ${Number(d.z ?? 2.5).toFixed(1)} m`,
        `方位 ${Math.round(d.azimuth ?? 0)}°`,
        d.tiltDeg != null ? `俯角 ${d.tiltDeg}°` : null,
      ],
    }
  }
  return null
}

function DeviceHoverReadout({ hovered, pointer, container }) {
  const elRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  // Re-measure when the tooltip content changes (different device hovered).
  useEffect(() => {
    if (!elRef.current) return
    const rect = elRef.current.getBoundingClientRect()
    setSize({ w: rect.width, h: rect.height })
  }, [hovered.type, hovered.data])

  const containerRect = container?.getBoundingClientRect()
  const maxX = containerRect?.width  ?? 99999
  const maxY = containerRect?.height ?? 99999

  // Prefer right-down of cursor; flip if we'd overflow.
  let x = pointer.x + TOOLTIP_OFFSET_PX
  let y = pointer.y + TOOLTIP_OFFSET_PX
  if (x + size.w > maxX) x = pointer.x - size.w - TOOLTIP_OFFSET_PX
  if (y + size.h > maxY) y = pointer.y - size.h - TOOLTIP_OFFSET_PX
  if (x < 0) x = 0
  if (y < 0) y = 0

  const content = buildReadoutContent(hovered.type, hovered.data)
  if (!content) return null

  return (
    <div
      ref={elRef}
      className="viewer3d__hover-readout"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <div className="viewer3d__hover-readout-title">{content.title}</div>
      <div className="viewer3d__hover-readout-row">
        <span className="viewer3d__hover-readout-pill" style={{ background: content.pill.color }}>{content.pill.text}</span>
        {content.status && (
          <span style={{ color: content.status.color }}>● {content.status.text}</span>
        )}
        {content.main.filter(Boolean).map((t) => <span key={t}>{t}</span>)}
      </div>
      <div className="viewer3d__hover-readout-row viewer3d__hover-readout-row--meta">
        {content.meta.filter(Boolean).map((t) => <span key={t}>{t}</span>)}
      </div>
    </div>
  )
}

// Keep in sync with APLayer3D's FREQ_COLOR so the tooltip pill matches the
// 3D marker color. Duplicated here to avoid a circular import from a layer
// file that owns scene-graph concerns.
const FREQ_COLOR_3D = { 2.4: '#f39c12', 5: '#4fc3f7', 6: '#a855f7' }

// Overall scene brightness. Lowering EXPOSURE darkens everything uniformly —
// the floor heatmap included, since tone mapping runs after all shading.
// Lowering SceneEnvironment's `intensity` instead darkens only the lit
// surfaces and lets KeyLight's modelling dominate. Both are set low here on
// purpose; see the sweep table at environmentIntensity below.
const EXPOSURE = 0.8

// 51-1 Image-based lighting. Without an environment map every
// meshStandardMaterial falls back to the three analytic lights alone, so
// roughness/metalness have nothing to reflect and every surface reads as flat
// plastic. RoomEnvironment is three's built-in procedural studio box (a few
// emissive planes in a room); PMREMGenerator pre-filters it into the roughness
// mip chain that standard/physical materials sample. Assigning the result to
// scene.environment applies it to every PBR material in the scene at once —
// no per-material change anywhere else in viewer3d/.
//
// Also repairs the renderer colour pipeline: r3f 7.0.29 sets
// `gl.outputEncoding = THREE.sRGBEncoding`, but three 0.167 removed that
// constant (it evaluates to undefined), leaving the renderer on its default.
// We set outputColorSpace explicitly — with IBL added, an unmanaged output
// would wash the whole scene out.
//
// The generator + the baked cube target are disposed on unmount; the
// RoomEnvironment scene itself is disposed right after baking since PMREM only
// needs it for the one render.
function SceneEnvironment({ intensity = 1 }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const invalidate = useThree((s) => s.invalidate)

  useEffect(() => {
    if (!gl || !scene) return undefined
    if ('outputColorSpace' in gl) gl.outputColorSpace = THREE.SRGBColorSpace
    gl.toneMapping = THREE.ACESFilmicToneMapping
    gl.toneMappingExposure = EXPOSURE

    const pmrem = new THREE.PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()
    const room = new RoomEnvironment()
    const envRT = pmrem.fromScene(room, 0.04)
    scene.environment = envRT.texture
    room.dispose?.()
    // Repaint: the frameloop may already be idle when the bake lands.
    invalidate()

    return () => {
      if (scene.environment === envRT.texture) scene.environment = null
      envRT.dispose()
      pmrem.dispose()
    }
  }, [gl, scene, invalidate])

  // scene.environmentIntensity (three r163+) scales the IBL contribution
  // without re-baking, so the knob stays cheap to turn.
  //
  // Kept well below 1: RoomEnvironment is a fairly uniform studio box, so
  // cranking it drowns out KeyLight and the walls go bright but FLAT. Swept on
  // the demo floor (mean / p05-p95 spread of wall-grey pixels, exposure 1.0
  // unless noted):
  //   pre-51-1  112.7 / 46.7    env .85  205.4 / 26.9
  //   env .60   191.2 / 29.4    env .45  178.8 / 32.2
  //   env .35   167.6 / 33.0    env .30 @ exp .80  145.1 / 35.2
  // Note the trend: less environment = more contrast, because KeyLight's
  // share of the lighting goes up. Settled on the darkest pairing (0.30 with
  // EXPOSURE 0.80) — still brighter than the flat pre-51-1 look, but with the
  // material depth IBL buys and the strongest face-to-face separation.
  useEffect(() => {
    if (!scene) return
    if ('environmentIntensity' in scene) scene.environmentIntensity = intensity
    invalidate()
  }, [scene, intensity, invalidate])

  return null
}

// r3f's setFrameloop('always') only flips the store flag — the rAF loop stays
// parked until the next invalidate(), and with the previous mode 'never' every
// queued invalidate was dropped. Kick one on the hidden→visible edge so the
// first 3D frame paints immediately after the switch.
function WakeOnVisible({ isVisible }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (isVisible) invalidate()
  }, [isVisible, invalidate])
  return null
}

// DEV-only bridge to the r3f root, mirroring window.__pixiApp / __scene /
// __stores in FloorplanSystem. r3f 7 keeps its store in context with no handle
// on the canvas element, so without this there is no way for the MCP / devtools
// console to reach the renderer, scene or camera — which is what any 3D
// measurement (frame cost, pass cost, draw calls) has to talk to.
function DevBridge() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    window.__r3f = { gl, scene, camera, size, invalidate }
    return () => { delete window.__r3f }
  }, [gl, scene, camera, size, invalidate])
  return null
}

function Viewer3D() {
  const floors = useFloorStore((s) => s.floors)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const setActiveFloor = useFloorStore((s) => s.setActiveFloor)
  const activeFloor = floors.find((f) => f.id === activeFloorId) ?? null
  const show3DAllFloors = useEditorStore((s) => s.show3DAllFloors)
  const heatmap3DAllFloors = useEditorStore((s) => s.heatmap3DAllFloors)
  const hmEnabled       = useHeatmapStore((s) => s.enabled)
  const toggleLayer     = useEditorStore((s) => s.toggleLayer)
  const clearSelected   = useEditorStore((s) => s.clearSelected)
  // CanvasArea now keeps Viewer3D mounted but hidden when viewMode === 2D, so
  // we'd otherwise burn GPU rendering an invisible scene. Freeze the r3f loop
  // entirely ('never' — even invalidate() is a no-op) when hidden: 'demand'
  // still repainted the whole scene on every store-driven React commit, which
  // on a software renderer was the largest share of 300-AP drag jank (2D drag
  // → hidden 3D re-rendered every frame). WakeOnVisible kicks one invalidate
  // on the 2D→3D switch because r3f's setFrameloop doesn't restart the loop
  // by itself.
  const viewMode        = useEditorStore((s) => s.viewMode)
  const isVisible       = viewMode === VIEW_MODE.THREE_D
  const inCameraMode    = useEditorStore((s) => s.editorMode === EDITOR_MODE.CAMERA)

  // 53-G9: memoized. This was a bare expression, so single-floor view built a
  // fresh array on every render and the `shadowRadius` memo below (keyed on
  // it) could never hit — hovering an AP re-ran the whole per-floor bounds
  // loop. All-floors mode returns `floors` by identity, so it was already fine.
  const visibleFloors = useMemo(
    () => (show3DAllFloors ? floors : floors.filter((f) => f.id === activeFloorId)),
    [show3DAllFloors, floors, activeFloorId],
  )

  // 全樓層熱圖 driver — compute per-floor fields ONLY while 3D is visible
  // with the toggle on (strategy A). Detach keeps the canvases cached; the
  // fingerprint inside heatmapStack decides whether re-attach recomputes.
  useEffect(() => {
    if (!isVisible || !heatmap3DAllFloors || !hmEnabled || !show3DAllFloors) return undefined
    return attachHeatmapStackDriver()
  }, [isVisible, heatmap3DAllFloors, hmEnabled, show3DAllFloors])

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

  // 51-2: bounding radius of everything the KEY light should shadow, measured
  // from `center`. Driven by the floors actually on screen, so single-floor
  // view gets a tight frustum (sharp shadows) while 全樓層 widens it enough to
  // reach the top of the stack. Falls back to a small radius pre-load so the
  // first frame isn't degenerate.
  const shadowRadius = useMemo(() => {
    if (!visibleFloors.length) return 20
    let maxR = 0
    for (const f of visibleFloors) {
      const { w: fw, h: fh } = pxToMeters(f)
      const elev = elevations[f.id] ?? 0
      // Corner of this floor's slab, relative to the shared centre. Height
      // spans the floor's own elevation up to its ceiling.
      const dx = Math.max(Math.abs(0 - center[0]), Math.abs(fw - center[0]))
      const dz = Math.max(Math.abs(0 - center[2]), Math.abs(fh - center[2]))
      const top = elev + getFloorHeight(f)   // 53-G8
      const dy = Math.max(Math.abs(elev - center[1]), Math.abs(top - center[1]))
      maxR = Math.max(maxR, Math.sqrt(dx * dx + dy * dy + dz * dz))
    }
    // Small margin so AP drop poles / labels sitting just past a wall still
    // cast rather than popping at the frustum edge.
    return Math.max(maxR * 1.08, 8)
  }, [visibleFloors, elevations, center])

  // 51-3: fog range, tied to the scene's own size (reusing the content radius
  // 51-2 already computes) so a 30 m office and a 200 m warehouse recede by
  // the same visual amount. Fog starts past the content, so nothing on the
  // floor being edited is hazed, and saturates out where the ground grid ends.
  const fogNear = shadowRadius * 1.6
  const fogFar = shadowRadius * 6.5

  // 51-4: ground grid placement. Sits a hair below the active floor so it
  // reads as the ground plane the building stands on. Radius scales with the
  // same content radius the shadow and fog use, so the apron of visible grid
  // around the building is proportional on any plan size. At 3.5x it fades
  // out inside fog's 6.5x far distance, so the grid is already gone before
  // its own plane edge could come into view.
  const gridCenter = useMemo(
    () => [w / 2, activeElev - 0.01, h / 2],
    [w, h, activeElev],
  )
  const gridRadius = Math.max(shadowRadius * 3.5, 45)

  // Initial pose: near-top-down birds-eye so the user enters 3D looking down
  // at the active floor — easy to map back to the 2D editor. We can't sit at
  // exactly (target.x, *, target.z) because that's an OrbitControls gimbal
  // singularity (offset = (0, *, 0) → atan2 collapses, internal spherical
  // decomposition picks an arbitrary azimuth, typically 45°). Nudge offset.z
  // a hair so azimuth resolves to 0°. Distance scales with floor diagonal.
  const diag = Math.max(Math.sqrt(w * w + h * h), 8)
  // Top-down eye height (metres above target) that makes the floor fill the
  // screen at the SAME size it has in 2D — so the 2D→3D entry's first painted
  // frame matches the 2D view and the switch is seamless. Reads the live 2D
  // viewport zoom + canvas height; falls back to a diagonal-scaled height when
  // those aren't readable yet. See topDownEntryCam for the derivation.
  const FOV_DEG = 50
  const seamlessEyeHeight = () => {
    const scale2d = useViewportStore.getState().scale
    const canvasH = getSceneRefs()?.app?.canvas?.getBoundingClientRect?.().height
    const floorScale = activeFloor?.scale
    if (scale2d > 0 && canvasH > 0 && floorScale > 0) {
      const tanHalf = Math.tan((FOV_DEG * Math.PI) / 360)
      return canvasH / (2 * tanHalf * floorScale * scale2d)
    }
    return diag * 1.6
  }
  // The floor-world point the 2D view is centred on right now, so the 3D
  // top-down entry looks at the SAME spot (not always the floor's geometric
  // centre). 2D maps canvasPos = (screenPos − viewport.{x,y}) / scale; the
  // screen centre is (canvasW/2, canvasH/2), giving the centred canvas px,
  // which × pxToM (= 1/floorScale) becomes world metres on the XZ floor plane.
  // Falls back to the floor centre when the 2D viewport/canvas aren't readable.
  const seamlessTopDownTarget = () => {
    const vp = useViewportStore.getState()
    const rect = getSceneRefs()?.app?.canvas?.getBoundingClientRect?.()
    const floorScale = activeFloor?.scale
    if (rect?.width > 0 && rect?.height > 0 && vp.scale > 0 && floorScale > 0) {
      const cxCanvas = (rect.width / 2 - vp.x) / vp.scale
      const cyCanvas = (rect.height / 2 - vp.y) / vp.scale
      return [cxCanvas / floorScale, center[1], cyCanvas / floorScale]
    }
    return [center[0], center[1], center[2]]
  }
  // Initial <Canvas camera> position. This is what r3f paints on the FIRST
  // frame the very first time 3D mounts — before the pre-position effect can
  // run (cameraStateRef is still null then) — so it must already match the 2D
  // view's size AND position, otherwise the first entry flashes a wrong pose.
  // Subsequent switches are handled by the layout effect below.
  const camInitTarget = seamlessTopDownTarget()
  const camPos = [camInitTarget[0], camInitTarget[1] + seamlessEyeHeight(), camInitTarget[2] + 0.001]
  // Live entry target (the floor point 2D is centred on) for CameraRig's first
  // mount, so the initial 3D frame matches the 2D position. Kept current each
  // render via the ref so whenever CameraRig mounts it reads the latest value.
  const initialTargetRef = useRef(camInitTarget)
  initialTargetRef.current = camInitTarget

  const cameraStateRef = useRef(null)
  // Manual turntable toggle (the same gentle spin the 2D→3D entry kicks off).
  // The rig's OrbitControls `start` listener flips this back off when the user
  // grabs the camera, via onAutoRotateStop below.
  const [autoRotate, setAutoRotate] = useState(false)
  // Top-right control panel collapse (just its header bar when collapsed).
  const [panelCollapsed, setPanelCollapsed] = useState(false)

  // Shared 3/4 iso camera offset (relative to target), scaled to the floor
  // diagonal so every iso view frames the same regardless of floor size. ONE
  // source of truth for: the 2D→3D entry tween's landing pose, the auto-rotate
  // orbit position, and the 等角 preset — they must match or switching between
  // them visibly jumps the camera. ISO_FRAC pulls the camera in (was 0.95 →
  // looked too far / objects too small); 0.95 vertical keeps the iso tilt.
  const ISO_FRAC = 0.7
  const isoOffset = useMemo(() => {
    const off = Math.max(diag, 8) * ISO_FRAC
    return [off, off * 0.95, off]
  }, [diag])
  const isoCamPos = useMemo(
    () => [center[0] + isoOffset[0], center[1] + isoOffset[1], center[2] + isoOffset[2]],
    [center, isoOffset],
  )

  // 3/4 iso pose used by the 自動旋轉 button (it tweens here, then spins) and the
  // 2D→3D entry tween. Entering 3D parks top-down first, then glides here.
  const entryPose = useMemo(
    () => ({ camPos: isoCamPos, target: center, duration: 1500 }),
    [isoCamPos, center],
  )

  // The top-down park pose 3D enters at. Its HEIGHT is
  // chosen so the floor fills the screen at the SAME size it had in 2D, making
  // the switch seamless (no "shrink then zoom" pop). Derivation: with a
  // vertical-FOV perspective camera looking straight down from height H, one
  // world metre spans  canvasH / (2·H·tan(fov/2))  screen px. In 2D one world
  // metre spans  floorScale · scale2d  screen px (floorScale = px per metre,
  // scale2d = viewport zoom). Equating the two and solving for H:
  //   H = canvasH / (2·tan(fov/2)·floorScale·scale2d)
  // Falls back to the old diagonal-scaled height if the 2D viewport/canvas
  // aren't readable yet. Z nudged a hair off-target to dodge the OrbitControls
  // azimuth singularity.
  // Top-down entry pose: camera sits straight above the 2D-centred floor point
  // at the seamless height, so BOTH the size and the position match the 2D
  // view at the moment of switching. Returns { cam, target }. Camera Z nudged a
  // hair off-target to dodge the OrbitControls gimbal singularity.
  const topDownEntryCam = useCallback(
    () => {
      const tgt = seamlessTopDownTarget()
      const h = seamlessEyeHeight()
      return {
        cam: [tgt[0], tgt[1] + h, tgt[2] + 0.001],
        target: tgt,
      }
    },
    // seamlessEyeHeight / seamlessTopDownTarget read live stores/DOM each call;
    // depend on the inputs that change their result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [center, diag, activeFloor],
  )

  // PRE-POSITION the camera while still in 2D (hidden). The <Canvas camera>
  // prop only seeds the camera on first mount — which happens at app start,
  // before any floor is loaded, so the initial camera sits at a wrong,
  // too-close distance (e.g. dist ≈ 10 instead of ≈ 60). The first time we
  // switch to 3D, r3f flips its frameloop demand→always and paints a frame
  // before our entry effect runs, exposing that stale close-up as a "huge
  // top-down" flash. Fixing the camera here — keyed on the pose, not on the
  // switch — means it's already correct whenever that first frame paints,
  // independent of effect-vs-render ordering. We only do this until the user
  // has actually entered 3D once (after that the camera is theirs to orbit).
  const hasEnteredRef = useRef(false)
  useEffect(() => {
    if (isVisible) return            // only pre-position while hidden (2D)
    if (hasEnteredRef.current) return // user already orbited in 3D — leave it
    const state = cameraStateRef.current
    if (!state) return
    const { camera, controls } = state
    const { cam, target } = topDownEntryCam()
    camera.position.set(cam[0], cam[1], cam[2])
    if (controls) {
      controls.target.set(target[0], target[1], target[2])
      controls.update()
    }
  }, [isVisible, topDownEntryCam, center])

  // Entering 3D plays a 3-stage landing: (1) PARK straight-down at the seamless
  // top-down height (same on-screen floor size + position as 2D — a clean
  // hand-off from the 2D view), (2) after a short beat, smoothly tween to the
  // 3/4 iso pose, (3) then start the gentle turntable spin. park() runs in a
  // layout effect BEFORE the first paint and cancels any in-flight tween, so
  // the first frame is always the seamless top-down — the very first switch and
  // every later one look identical (no stale-seed flash, no drift). The tween
  // is fired from a timer so the user actually sees the top-down beat first.
  const wasVisibleRef = useRef(isVisible)
  const entryTimerRef = useRef(null)
  useLayoutEffect(() => {
    const becameVisible = isVisible && !wasVisibleRef.current
    wasVisibleRef.current = isVisible
    if (entryTimerRef.current) { clearTimeout(entryTimerRef.current); entryTimerRef.current = null }
    if (!becameVisible) return
    hasEnteredRef.current = true
    const state = cameraStateRef.current
    if (!state) return
    const { cam, target } = topDownEntryCam()
    // Stage 1: park top-down (cancels any leftover tween → no first-entry drift).
    if (state.park) state.park(cam, target)
    // Stages 2+3: after a short top-down beat, glide to the iso pose and then
    // spin. fromCam/fromTarget = the parked top-down pose so the move starts
    // exactly where the hand-off left the camera.
    entryTimerRef.current = setTimeout(() => {
      entryTimerRef.current = null
      const st = cameraStateRef.current
      if (!st || !st.tweenTo) return
      st.tweenTo({
        fromCam: cam,
        fromTarget: target,
        camPos: entryPose.camPos,
        target: entryPose.target,
        duration: entryPose.duration,
        autoRotateAfter: true,
      })
    }, 300)
  }, [isVisible, center, topDownEntryCam, entryPose])
  // Clear any pending entry tween on unmount.
  useEffect(() => () => { if (entryTimerRef.current) clearTimeout(entryTimerRef.current) }, [])
  // 28-3 Camera presets: top-down / iso / front. Distance scales with the
  // floor diagonal so small and large plans both frame well. Tween via the
  // CameraRig's tweenTo so OrbitControls picks up the new pose cleanly.
  const applyCameraPreset = useCallback((preset) => {
    const state = cameraStateRef.current
    if (!state || !state.tweenTo) return
    const tgt = center
    const d = Math.max(diag, 8)
    let camPos
    if (preset === 'top') {
      // Pure top-down. Nudge Z a hair off-target to avoid the OrbitControls
      // gimbal singularity (offset = (0, *, 0) collapses azimuth).
      camPos = [tgt[0], tgt[1] + d * 1.6, tgt[2] + 0.001]
    } else if (preset === 'iso') {
      // 3/4 view — reuse the shared iso pose so it matches the 2D→3D entry and
      // the auto-rotate orbit exactly (same ISO_FRAC, same tilt).
      const off = d * ISO_FRAC
      camPos = [tgt[0] + off, tgt[1] + off * 0.95, tgt[2] + off]
    } else if (preset === 'front') {
      // Look from -Z toward the floor, eye-level above mid-floor height.
      camPos = [tgt[0], tgt[1] + d * 0.25, tgt[2] - d * 1.4]
    } else {
      return
    }
    // A preset tween moves to a fixed pose, so it cancels the turntable spin
    // (tweenTo clears autoRotating without autoRotateAfter). Sync the button
    // state off so it doesn't keep showing as active.
    setAutoRotate(false)
    state.tweenTo({ camPos, target: tgt, duration: 600 })
  }, [center, diag])

  // 28-4 Hover readout state: which device (AP / switch / camera) the pointer
  // is over (or null), plus last screen-space pointer position so the HTML
  // tooltip can follow the mouse. Mouse position is tracked at the viewer3d
  // container level so the tooltip lives outside the r3f canvas tree (avoids
  // drei dependency).
  const [hoveredDevice, setHoveredDevice] = useState(null)
  const [pointer, setPointer] = useState({ x: 0, y: 0 })
  const containerRef = useRef(null)
  const handleContainerPointerMove = (e) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }
  const handleAPHover = useCallback((ap) => {
    setHoveredDevice(ap ? { type: 'ap', data: ap } : null)
  }, [])
  const handleSwitchHover = useCallback((sw) => {
    setHoveredDevice(sw ? { type: 'switch', data: sw } : null)
  }, [])
  const handleCameraHover = useCallback((cam) => {
    setHoveredDevice(cam ? { type: 'camera', data: cam } : null)
  }, [])
  // Entering/leaving CAMERA mode unmounts the layer whose marker is hovered,
  // so its onPointerOut never fires — clear the readout or it lingers.
  useEffect(() => { setHoveredDevice(null) }, [inCameraMode])

  // Toggle the manual turntable spin. Turning it ON first tweens the camera
  // back to the 2D→3D entry pose (the 3/4 iso angle) and only starts the
  // turntable once it lands — reusing the exact entry animation path
  // (tweenTo + autoRotateAfter) so the auto-rotate always orbits from the
  // same angle as just-switched-to-3D, regardless of where the user had
  // orbited to. Turning it OFF just stops the spin. The rig also flips this
  // back off via onAutoRotateStop when the user grabs the camera.
  const toggleAutoRotate = useCallback(() => {
    setAutoRotate((on) => {
      const next = !on
      const state = cameraStateRef.current
      if (next && state?.tweenTo) {
        state.tweenTo({
          camPos: entryPose.camPos,
          target: entryPose.target,
          duration: entryPose.duration,
          autoRotateAfter: true,
        })
      } else {
        state?.setAutoRotate?.(false)
      }
      return next
    })
  }, [entryPose])

  return (
    <div
      className="viewer3d"
      ref={containerRef}
      onPointerMove={handleContainerPointerMove}
      onPointerLeave={() => setHoveredDevice(null)}
    >
      {/* All 3D controls are grouped into a single dark-glass top-right panel
          (collapsible) so they read as one panel and don't clash with the
          host product's top-left toolbar. Rows: floor-visibility + auto-rotate,
          camera presets, floor selector. */}
      <div className={`viewer3d__panel${panelCollapsed ? ' viewer3d__panel--collapsed' : ''}`}>
        <div className="viewer3d__panel-head">
          <button
            type="button"
            className="viewer3d__panel-caret"
            onClick={() => setPanelCollapsed((c) => !c)}
            title={panelCollapsed ? '展開' : '收合'}
          >
            <Icon name={panelCollapsed ? 'chevronRight' : 'chevronDown'} size={12} />
          </button>
          <span className="viewer3d__panel-title">3D 視圖</span>
          {/* 3D is view-only (ui-spec §2.5): objects can be selected (right
              panel opens for edits) but geometry is edited back in 2D. */}
          <span
            className="viewer3d__panel-badge"
            title="3D 僅供檢視：點選物件可開啟右側屬性面板編輯參數；移動 / 繪製請回 2D"
          >
            唯讀
          </span>
        </div>

        {!panelCollapsed && (
        <>
        <div className="viewer3d__panel-row">
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
            className={`viewer3d__floors-btn${autoRotate ? ' viewer3d__floors-btn--active' : ''}`}
            onClick={toggleAutoRotate}
            title={autoRotate ? '停止自動旋轉' : '自動旋轉（轉盤環繞，拖曳即停）'}
          >
            🔄 自動旋轉
          </button>
        </div>

        {/* Phase 48+ 全樓層熱圖 — per-floor field planes on every stacked
            floor. Only computes while this toggle is on and 3D is visible;
            unchanged data re-uses cached canvases. */}
        <div className="viewer3d__panel-row">
          <button
            type="button"
            className={`viewer3d__floors-btn${heatmap3DAllFloors ? ' viewer3d__floors-btn--active' : ''}`}
            onClick={() => toggleLayer('heatmap3DAllFloors')}
            disabled={!hmEnabled || !show3DAllFloors}
            title={
              !hmEnabled ? '先開啟熱圖再使用'
                : !show3DAllFloors ? '需先切換為顯示全部樓層'
                : heatmap3DAllFloors ? '關閉其他樓層的熱圖平面'
                : '為每個樓層各算一張熱圖（進 3D 才計算，資料未變時使用快取）'
            }
          >
            🌡️ 全樓層熱圖
          </button>
        </div>

        {/* 28-3 Camera presets — three quick poses to re-orient without
            orbiting manually. */}
        <div className="viewer3d__panel-row" role="group" aria-label="相機視角">
          <button
            type="button"
            className="viewer3d__preset-btn"
            onClick={() => applyCameraPreset('top')}
            title="俯瞰（從正上方往下看）"
          >
            俯瞰
          </button>
          <button
            type="button"
            className="viewer3d__preset-btn"
            onClick={() => applyCameraPreset('iso')}
            title="等角（3/4 透視）"
          >
            等角
          </button>
          <button
            type="button"
            className="viewer3d__preset-btn"
            onClick={() => applyCameraPreset('front')}
            title="正視（從正面水平看）"
          >
            正視
          </button>
        </div>

        {/* 28-2 Floor selector — compact dropdown. Click the trigger to expand
            the list, click a row to switch active floor (heatmap remounts,
            camera tweens, layers retarget). */}
        {floors.length > 0 && (
          <div className="viewer3d__panel-row">
            <FloorSelector
              floors={floors}
              activeFloorId={activeFloorId}
              onSelect={(id) => { if (id !== activeFloorId) setActiveFloor(id) }}
            />
          </div>
        )}
        </>
        )}
      </div>

      {/* 28-4 Device hover readout (AP / switch / camera) — floating HTML
          tooltip. Pointer is captured at the viewer3d container level so the
          tooltip can position itself in local coordinates regardless of where
          the 3D marker is. The tooltip flips to the left/up side of the
          cursor when it would overflow the container. */}
      {hoveredDevice && (
        <DeviceHoverReadout hovered={hoveredDevice} pointer={pointer} container={containerRef.current} />
      )}

      {/* 51-3: the canvas is transparent so the CSS gradient on .viewer3d
          shows through as the sky. Doing it in CSS rather than as a scene mesh
          keeps it out of the depth buffer entirely and costs no draw call. */}
      <Canvas
        shadows
        camera={{ position: camPos, fov: 50, near: 0.1, far: 2000 }}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
        gl={{ alpha: true }}
        frameloop={isVisible ? 'always' : 'never'}
        onPointerMissed={() => clearSelected()}
      >
      <WakeOnVisible isVisible={isVisible} />
      <DevBridge />
      {/* 51-1: IBL now supplies the omnidirectional fill that ambient +
          hemisphere used to fake, and it does so with direction — surfaces
          pick up different light per normal, which is what makes roughness /
          metalness read at all. The analytic fills are pulled down (ambient
          0.28 → 0.12, hemisphere 0.25 → 0.12) rather than removed: they still
          lift the unlit meshBasicMaterial-adjacent surfaces and keep back
          faces off pure black without double-counting the environment.
          KeyLight remains the single shadow caster (51-2 fits its frustum to
          the visible floors rather than a fixed ±80 m). */}
      {/* 51-3 Distance fog. Tints geometry toward the horizon colour with
          distance so the far end of a large plan recedes instead of staying
          as crisp as the near end. Range scales with the scene so small and
          large plans fog the same amount relative to their own size.
          FOG_COLOR matches the bottom stop of the CSS sky gradient, which is
          the band the floor plate meets. */}
      <fog attach="fog" args={[FOG_COLOR, fogNear, fogFar]} />
      <SceneEnvironment intensity={0.30} />
      <ambientLight intensity={0.12} />
      <KeyLight center={center} radius={shadowRadius} />
      <hemisphereLight args={['#e2e8f0', '#1e293b', 0.12]} />

      {floors.length === 0 && <EmptyScene />}

      {visibleFloors.map((f) => (
        <FloorStack
          key={f.id}
          floor={f}
          elevation={elevations[f.id] ?? 0}
          isActive={f.id === activeFloorId}
          onAPHover={handleAPHover}
          onSwitchHover={handleSwitchHover}
          onCameraHover={handleCameraHover}
          inCameraMode={inCameraMode}
        />
      ))}

      {/* 10-5f: floor-hole vertical extents rendered at scene root so a single
          column can span multiple floors regardless of which FloorStack groups
          are mounted (e.g. single-floor view still shows the whole column when
          its home floor is active). CAMERA mode hides them with the rest of
          the RF/structural extras (walls-only rule). */}
      {!inCameraMode && <FloorHoleVolume3D activeFloorId={activeFloorId} />}

      {/* 12-3a: Risers are global vertical shafts spanning their floorIds.
          Rendered at scene root for the same reason as FloorHoleVolume3D. */}
      {!inCameraMode && <RiserLayer3D activeFloorId={activeFloorId} />}

      {/* Ground grid anchored to the active floor size, placed just under the
          active floor's elevation so orientation is clear even when viewing
          upper stories. 51-4: shader grid that fades out with distance
          (see GroundGrid3D) rather than a gridHelper ending at a hard edge.
          1 m minor / 10 m major gives the plan a readable sense of scale. */}
      {activeFloor && (
        <GroundGrid3D
          center={gridCenter}
          radius={gridRadius}
          cell={1}
          major={10}
        />
      )}

      <CameraRig target={center} cameraStateRef={cameraStateRef} onAutoRotateStop={() => setAutoRotate(false)} onAutoRotateStart={() => setAutoRotate(true)} initialTargetRef={initialTargetRef} />
      </Canvas>
    </div>
  )
}

export default Viewer3D
