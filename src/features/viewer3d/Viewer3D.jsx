import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, extend, useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore, VIEW_MODE, EDITOR_MODE } from '@/store/useEditorStore'
import WallLayer3D from './WallLayer3D'
import CameraLayer3D from './CameraLayer3D'
import TrackLayer3D from './TrackLayer3D'
import APLayer3D from './APLayer3D'
import ScopeLayer3D from './ScopeLayer3D'
import HeatmapPlane3D from './HeatmapPlane3D'
import CameraOverlay3D from './CameraOverlay3D'
import FloorHoleVolume3D from './FloorHoleVolume3D'
import RiserLayer3D from './RiserLayer3D'
import TrayLayer3D from './TrayLayer3D'
import SwitchLayer3D from './SwitchLayer3D'
import CableLayer3D from './CableLayer3D'
import { computeFloorElevations } from '@/utils/floorStacking'
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

// Single shadow-casting directional KEY light. Anchored relative to the active
// floor centre and aimed at it so the orthographic shadow frustum stays
// registered on the floor regardless of floor size/position. The light's
// `target` is an Object3D that must be attached to the scene and pointed at by
// the light; we wire it imperatively after mount (a ref's `.current` change
// does not re-render in R3F, so a JSX `target={ref.current}` would be stale on
// first paint). Frustum half-extent is a generous ±80 m to cover typical floor
// plans (floor dims are dynamic = image px / scale).
function KeyLight({ center }) {
  const lightRef = useRef()
  const targetRef = useRef()
  useEffect(() => {
    if (lightRef.current && targetRef.current) {
      lightRef.current.target = targetRef.current
      lightRef.current.target.updateMatrixWorld()
    }
  })
  return (
    <>
      <object3D ref={targetRef} position={center} />
      <directionalLight
        ref={lightRef}
        position={[center[0] + 60, center[1] + 90, center[2] + 40]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={500}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-bias={-0.0005}
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
function FloorStack({ floor, elevation, isActive, onAPHover, inCameraMode }) {
  const pxToM = 1 / (floor.scale || 100)
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
          <SwitchLayer3D floorId={floor.id} pxToM={pxToM} dimOpacity={dimOpacity} />
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
        </>
      )}
      {inCameraMode && (
        <>
          <CameraLayer3D floorId={floor.id} pxToM={pxToM} dimOpacity={dimOpacity} isActiveFloor={isActive} />
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
function CameraRig({ target, cameraStateRef, onAutoRotateStop }) {
  const controlsRef = useRef()
  const { camera, gl } = useThree()
  // Keep the latest stop-callback in a ref so the one-time `start` listener
  // (registered in an empty-dep effect) always calls the current handler.
  const onAutoRotateStopRef = useRef(onAutoRotateStop)
  onAutoRotateStopRef.current = onAutoRotateStop

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
      controls.target.set(target[0], target[1], target[2])
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
      <gridHelper args={[20, 20, '#475569', '#334155']} />
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
        <span className="viewer3d__floor-trigger-caret">▾</span>
      </button>
      {open && (
        <ul className="viewer3d__floor-list" role="listbox" aria-label="樓層選擇">
          {floors.map((floor) => {
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

// Per-AP tooltip while hovering in 3D. Lives outside the r3f tree as plain
// HTML so we don't need drei <Html> (would force a React 18 / drei upgrade
// the rest of the project hasn't taken). Position is pure container-local
// pixels, computed from the parent's pointer state.
//
// Tooltip flips to the cursor's opposite side when it would overflow the
// viewer container — keeps it on screen at every corner.
const FREQ_LABEL_3D = { 2.4: '2.4 GHz', 5: '5 GHz', 6: '6 GHz' }
const TOOLTIP_OFFSET_PX = 14
function APHoverReadout({ ap, pointer, container }) {
  const elRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  // Re-measure when the tooltip content changes (different AP hovered).
  useEffect(() => {
    if (!elRef.current) return
    const rect = elRef.current.getBoundingClientRect()
    setSize({ w: rect.width, h: rect.height })
  }, [ap.id, ap.name, ap.frequency, ap.channel, ap.channelWidth, ap.txPower])

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

  const freqLabel = FREQ_LABEL_3D[ap.frequency] ?? `${ap.frequency} GHz`
  const channelLabel = ap.channel != null
    ? `Ch ${ap.channel}${ap.channelWidth ? `/${ap.channelWidth}MHz` : ''}`
    : null
  const txLabel = ap.txPower != null ? `${ap.txPower} dBm` : null
  const mountLabel = ap.z != null ? `掛 ${Number(ap.z).toFixed(1)} m` : null
  const antennaLabel = (() => {
    const mode = ap.antennaMode ?? 'omni'
    if (mode === 'omni') return '全向'
    if (mode === 'directional') return `定向 ${ap.azimuth ?? 0}° / ${ap.beamwidth ?? 60}°`
    if (mode === 'custom') return '自訂'
    return mode
  })()

  return (
    <div
      ref={elRef}
      className="viewer3d__hover-readout"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <div className="viewer3d__hover-readout-title">{ap.name ?? ap.id}</div>
      <div className="viewer3d__hover-readout-row">
        <span className="viewer3d__hover-readout-pill" style={{ background: FREQ_COLOR_3D[ap.frequency] ?? '#4fc3f7' }}>{freqLabel}</span>
        {channelLabel && <span>{channelLabel}</span>}
        {txLabel && <span>{txLabel}</span>}
      </div>
      <div className="viewer3d__hover-readout-row viewer3d__hover-readout-row--meta">
        {mountLabel && <span>{mountLabel}</span>}
        <span>{antennaLabel}</span>
      </div>
    </div>
  )
}

// Keep in sync with APLayer3D's FREQ_COLOR so the tooltip pill matches the
// 3D marker color. Duplicated here to avoid a circular import from a layer
// file that owns scene-graph concerns.
const FREQ_COLOR_3D = { 2.4: '#f39c12', 5: '#4fc3f7', 6: '#a855f7' }

function Viewer3D() {
  const floors = useFloorStore((s) => s.floors)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const setActiveFloor = useFloorStore((s) => s.setActiveFloor)
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
  const inCameraMode    = useEditorStore((s) => s.editorMode === EDITOR_MODE.CAMERA)

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
  // Manual turntable toggle (the same gentle spin the 2D→3D entry kicks off).
  // The rig's OrbitControls `start` listener flips this back off when the user
  // grabs the camera, via onAutoRotateStop below.
  const [autoRotate, setAutoRotate] = useState(false)
  // Top-right control panel collapse (just its header bar when collapsed).
  const [panelCollapsed, setPanelCollapsed] = useState(false)

  // 「2D → 3D 落地」鏡頭過渡：俯瞰起手 → 3/4 perspective。Pose 是當下測試
  // 樓層手動 tune 出來的世界座標，後續可改成相對 target 的 offset 讓多樓層
  // 通用。Viewer3D 現在常駐 mount（切換無縫），所以入場動畫不再綁 CameraRig
  // 的首次 mount，而是每次「2D→3D」切換時由下方 effect 主動觸發重播。
  const entryPose = useMemo(
    () => ({ camPos: [41.617, 31.053, 56.264], target: center, duration: 1500 }),
    [center],
  )

  // 每次切到 3D 重播落地動畫。偵測 isVisible 由 false→true 的那一刻：先把
  // 相機瞬移到俯瞰起手位（top-down，避開 OrbitControls gimbal singularity），
  // 再 tween 到 3/4 透視。frameloop 此時剛從 'demand' 升成 'always'，用一個
  // rAF 等 r3f 把 loop 起來再下命令，確保 tween 的每一幀都會被畫出來。
  // The top-down pose the 2D→3D entry animation starts from. Z nudged a hair
  // off-target to dodge the OrbitControls azimuth singularity.
  const entryStartCam = useMemo(
    () => [center[0], center[1] + diag * 1.6, center[2] + 0.001],
    [center, diag],
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
    camera.position.set(entryStartCam[0], entryStartCam[1], entryStartCam[2])
    if (controls) {
      controls.target.set(center[0], center[1], center[2])
      controls.update()
    }
  }, [isVisible, entryStartCam, center])

  // Replay the landing animation every time we enter 3D. The tween is told its
  // explicit start (top-down) via fromCam/fromTarget so it never inherits the
  // stale initial camera — and useFrame snaps the camera to that start on the
  // first tween frame, overwriting any stale pose before it's visible.
  const wasVisibleRef = useRef(isVisible)
  useEffect(() => {
    const becameVisible = isVisible && !wasVisibleRef.current
    wasVisibleRef.current = isVisible
    if (!becameVisible) return
    hasEnteredRef.current = true
    const state = cameraStateRef.current
    if (!state || !state.tweenTo) return
    state.tweenTo({
      fromCam: entryStartCam,
      fromTarget: center,
      camPos: entryPose.camPos,
      target: entryPose.target,
      duration: entryPose.duration,
      autoRotateAfter: true,   // gentle turntable spin once landed
    })
  }, [isVisible, center, entryStartCam, entryPose])
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
      // 3/4 view: 45° azimuth, ~55° polar. offset.x = offset.z, offset.y
      // tuned so the polar reads as a typical iso camera tilt.
      const off = d * 0.95
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

  // 28-4 Hover readout state: which AP the pointer is over (or null), plus
  // last screen-space pointer position so the HTML tooltip can follow the
  // mouse. Mouse position is tracked at the viewer3d container level so the
  // tooltip lives outside the r3f canvas tree (avoids drei dependency).
  const [hoveredAP, setHoveredAP] = useState(null)
  const [pointer, setPointer] = useState({ x: 0, y: 0 })
  const containerRef = useRef(null)
  const handleContainerPointerMove = (e) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }
  const handleAPHover = useCallback((ap) => {
    setHoveredAP(ap)
  }, [])

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
      onPointerLeave={() => setHoveredAP(null)}
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
            {panelCollapsed ? '▸' : '▾'}
          </button>
          <span className="viewer3d__panel-title">3D 視圖</span>
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

      {/* 28-4 AP hover readout — floating HTML tooltip. Pointer is captured at
          the viewer3d container level so the tooltip can position itself in
          local coordinates regardless of where the 3D AP marker is. The
          tooltip flips to the left/up side of the cursor when it would
          overflow the container. */}
      {hoveredAP && (
        <APHoverReadout ap={hoveredAP} pointer={pointer} container={containerRef.current} />
      )}

      <Canvas
        shadows
        camera={{ position: camPos, fov: 50, near: 0.1, far: 2000 }}
        style={{ width: '100%', height: '100%', background: '#0f172a' }}
        frameloop={isVisible ? 'always' : 'demand'}
        onPointerMissed={() => clearSelected()}
      >
      {/* Weak ambient so back faces aren't pure black, plus a single
          shadow-casting directional KEY light (KeyLight) that dominates the
          scene so the oblique shadows read clearly. A slight hemisphere fill
          keeps the lighting from going flat. Applies in ALL modes (not gated). */}
      <ambientLight intensity={0.28} />
      <KeyLight center={center} />
      <hemisphereLight args={['#e2e8f0', '#1e293b', 0.25]} />

      {floors.length === 0 && <EmptyScene />}

      {visibleFloors.map((f) => (
        <FloorStack
          key={f.id}
          floor={f}
          elevation={elevations[f.id] ?? 0}
          isActive={f.id === activeFloorId}
          onAPHover={handleAPHover}
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
          upper stories. */}
      {activeFloor && (
        <gridHelper
          args={[Math.max(w, h) * 1.5, 20, '#334155', '#1e293b']}
          position={[w / 2, activeElev - 0.01, h / 2]}
        />
      )}

      <CameraRig target={center} cameraStateRef={cameraStateRef} onAutoRotateStop={() => setAutoRotate(false)} />
      </Canvas>
    </div>
  )
}

export default Viewer3D
