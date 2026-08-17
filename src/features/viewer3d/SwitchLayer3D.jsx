import React, { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry'
import { useCableStore, getSwitchKindColor } from '@/store/useCableStore'
import { useEditorStore } from '@/store/useEditorStore'

// 53-G9: one frozen empty array for the `?? EMPTY` selectors below. A bare
// `?? []` returns a new reference whenever the floor's key is absent, so
// zustand saw a changed slice on EVERY store write and re-rendered.
const EMPTY = Object.freeze([])

// 3D switch / IDF / MDF / router chassis. Each device renders as a small
// rack-shaped box at its `mountHeight` so the user sees the same position
// as the 2D SwitchLayer, plus a thin pole down to the floor for grounding
// context. Body is dark grey to mimic real enterprise rack hardware; a
// thin coloured strip on the front face carries the kind colour so users
// can still tell SW / IDF / MDF / Router apart at a glance.
//
// 29-6 — chassis dimensions now scale with port count and core layer:
//   24-port = 1U  (BASE_W × BASE_H × BASE_D)
//   48-port = 1U  (BASE_W × 1.5)
//   Core    = 2U  (BASE_H × 2.0)
//   Router  = 8-port (BASE_W × 0.7) + small antenna mast
const BASE_W = 0.40   // ~1U rack chassis width on the wall
const BASE_H = 0.10
const BASE_D = 0.22
const POLE_R = 0.012
const BODY_COLOR = '#1f2937'   // slate-800 — reads as black rack metal
const STRIPE_THICKNESS = 0.012  // 1.2 cm front-panel LED strip
const STRIPE_INSET     = 0.008  // peek the strip outside the body so the
                                // emissive isn't drowned by the dark face

// 51-9: rounded chassis edges. Real rack hardware has a chamfer, and at this
// size a hard-edged box reads as a placeholder cube. Small radius — the point
// is to catch a highlight along the edge, not to look moulded.
const CHASSIS_RADIUS = 0.012
const CHASSIS_SEGMENTS = 2

// 51-9 Front-panel port strip, drawn as a canvas texture rather than modelled.
// A 48-port switch would need ~100 extra boxes per device to model; the panel
// is only ever seen face-on at a few centimetres across, so a texture carries
// the same information for one draw call.
//
// Cached per port count: every 24-port switch in the scene shares one texture.
//
// 53-G9 (23x): deliberately NOT given the Label3D LRU. The key is clamped to
// 4–48 on the next line, so this tops out at 45 entries for the lifetime of the
// page — bounded by construction. Label3D needed eviction because its key is a
// user-editable device name (unbounded); the pattern differs because the keys
// do, not by oversight.
const portTextureCache = new Map()
function getPortTexture(portCount) {
  const n = Math.max(4, Math.min(portCount || 24, 48))
  if (portTextureCache.has(n)) return portTextureCache.get(n)

  // Ports run in two rows, as on real 1U gear.
  const cols = Math.ceil(n / 2)
  const cw = 16, ch = 22, gap = 3, padX = 10, padY = 8
  const w = padX * 2 + cols * cw + (cols - 1) * gap
  const h = padY * 2 + 2 * ch + gap

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#1a2230'
  ctx.fillRect(0, 0, w, h)

  for (let i = 0; i < n; i++) {
    const row = i % 2
    const col = Math.floor(i / 2)
    const x = padX + col * (cw + gap)
    const y = padY + row * (ch + gap)
    // Port cavity, then a lighter lip so it reads as recessed.
    ctx.fillStyle = '#0b0f16'
    ctx.fillRect(x, y, cw, ch)
    ctx.fillStyle = '#39465c'
    ctx.fillRect(x, y, cw, 2)
    // Link LED above alternating ports, so the panel isn't uniformly dead.
    if (i % 3 !== 2) {
      ctx.fillStyle = '#4ade80'
      ctx.fillRect(x + 2, y + ch - 4, 4, 2)
    }
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = 4
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
  else tex.encoding = THREE.sRGBEncoding
  tex.needsUpdate = true
  portTextureCache.set(n, tex)
  return tex
}

function SwitchMarker({ sw, pxToM, dimOpacity, isActiveFloor, onHover }) {
  const x = (sw.x ?? 0) * pxToM
  const z = (sw.y ?? 0) * pxToM
  const y = sw.mountHeight ?? 0.5
  const kindColor = getSwitchKindColor(sw.kind ?? 'switch')
  const transparent = dimOpacity < 1
  // 51-3: `fog: false` — the stripe colour identifies the device kind
  // (switch / IDF / MDF / router), so distance must not tint it.
  const matOpts = { transparent, opacity: dimOpacity, depthWrite: !transparent, fog: false }

  // Hover readout (28-4 parity with APs): light the chassis and surface the
  // device info tooltip via the parent-provided onHover callback.
  const [hovered, setHovered] = useState(false)
  const isHovered = isActiveFloor && hovered
  const onPointerOver = (e) => {
    if (!isActiveFloor) return
    e.stopPropagation()
    setHovered(true)
    if (onHover) onHover(sw)
  }
  const onPointerOut = () => {
    setHovered(false)
    if (onHover) onHover(null)
  }

  // 29-6 dimensions
  const portCount = sw.portCount ?? 24
  const isCore    = !!sw.isCoreLayer || sw.kind === 'mdf' || sw.kind === 'router'
  const widthMult = portCount >= 48 ? 1.5 : portCount <= 12 ? 0.7 : 1.0
  const heightMult = isCore ? 2.0 : 1.0
  const bodyW = BASE_W * widthMult
  const bodyH = BASE_H * heightMult
  const bodyD = BASE_D
  const isRouter = sw.kind === 'router'

  // 51-9: rounded chassis. Built per size rather than shared, since the three
  // size classes differ; disposed with the component.
  const chassisGeom = useMemo(
    () => new RoundedBoxGeometry(bodyW, bodyH, bodyD, CHASSIS_SEGMENTS, CHASSIS_RADIUS),
    [bodyW, bodyH, bodyD],
  )
  useEffect(() => () => chassisGeom.dispose(), [chassisGeom])
  const portTexture = useMemo(() => getPortTexture(portCount), [portCount])

  // Front-panel stripe sits along the +Z face of the chassis, centred
  // vertically but slightly inset so it reads as a recessed indicator.
  const stripeZ = bodyD / 2 + STRIPE_INSET / 2

  return (
    <group
      position={[x, 0, z]}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      {y > 0 && (
        <mesh position={[0, y / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[POLE_R, POLE_R, y, 8]} />
          <meshStandardMaterial color="#64748b" roughness={0.7} {...matOpts} />
        </mesh>
      )}
      {/* Body — dark "metal" chassis, 51-9: rounded edges */}
      <mesh position={[0, y, 0]} castShadow receiveShadow geometry={chassisGeom}>
        <meshStandardMaterial
          color={BODY_COLOR}
          roughness={0.6}
          metalness={0.45}
          emissive={isHovered ? '#ffffff' : '#000000'}
          emissiveIntensity={isHovered ? 0.3 : 0}
          {...matOpts}
        />
      </mesh>
      {/* 51-9 Front-panel ports. A thin quad just proud of the face, so the
          texture isn't z-fighting the chassis it sits on. */}
      <mesh position={[0, y - bodyH * 0.08, bodyD / 2 + 0.001]} raycast={() => null}>
        <planeGeometry args={[bodyW * 0.86, bodyH * 0.52]} />
        <meshStandardMaterial
          map={portTexture}
          roughness={0.8}
          metalness={0.1}
          {...matOpts}
        />
      </mesh>
      {/* Front-panel kind indicator strip (full-width, thin) */}
      <mesh position={[0, y, stripeZ]}>
        <boxGeometry args={[bodyW * 0.9, STRIPE_THICKNESS, STRIPE_INSET]} />
        <meshStandardMaterial
          color={kindColor}
          emissive={kindColor}
          emissiveIntensity={0.7}
          roughness={0.3}
          {...matOpts}
        />
      </mesh>
      {/* 29-6 Core layer (MDF) gets a second front-panel stripe for the 2U look. */}
      {sw.kind === 'mdf' && (
        <mesh position={[0, y + bodyH * 0.28, stripeZ]}>
          <boxGeometry args={[bodyW * 0.7, STRIPE_THICKNESS * 0.7, STRIPE_INSET]} />
          <meshStandardMaterial
            color={kindColor}
            emissive={kindColor}
            emissiveIntensity={0.5}
            {...matOpts}
          />
        </mesh>
      )}
      {/* 29-6 Router antenna mast — 12 cm mast topped by a small ball, drawn
          above the chassis so it reads as the WAN-edge "uplink to the world". */}
      {isRouter && (
        <>
          <mesh position={[0, y + bodyH / 2 + 0.06, 0]}>
            <cylinderGeometry args={[0.004, 0.004, 0.12, 6]} />
            <meshStandardMaterial color={kindColor} emissive={kindColor} emissiveIntensity={0.4} {...matOpts} />
          </mesh>
          <mesh position={[0, y + bodyH / 2 + 0.13, 0]}>
            <sphereGeometry args={[0.012, 8, 8]} />
            <meshStandardMaterial color={kindColor} emissive={kindColor} emissiveIntensity={0.7} {...matOpts} />
          </mesh>
        </>
      )}
    </group>
  )
}

export default function SwitchLayer3D({ floorId, pxToM, dimOpacity = 1, isActiveFloor = true, onSwitchHover }) {
  const allSwitches = useCableStore((s) => s.switchesByFloor[floorId] ?? EMPTY)
  // Keep 2D and 3D visibility in sync — same per-kind filter.
  const showSwitchKind = useEditorStore((s) => s.showSwitchKind)
  const switches = allSwitches.filter((sw) => showSwitchKind[sw.kind] !== false)
  if (!switches.length || !pxToM) return null
  return (
    <group>
      {switches.map((sw) => (
        <SwitchMarker
          key={sw.id}
          sw={sw}
          pxToM={pxToM}
          dimOpacity={dimOpacity}
          isActiveFloor={isActiveFloor}
          onHover={isActiveFloor ? onSwitchHover : undefined}
        />
      ))}
    </group>
  )
}
