import React from 'react'
import { useCableStore, getSwitchKindColor } from '@/store/useCableStore'

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

function SwitchMarker({ sw, pxToM, dimOpacity }) {
  const x = (sw.x ?? 0) * pxToM
  const z = (sw.y ?? 0) * pxToM
  const y = sw.mountHeight ?? 0.5
  const kindColor = getSwitchKindColor(sw.kind ?? 'switch')
  const transparent = dimOpacity < 1
  const matOpts = { transparent, opacity: dimOpacity, depthWrite: !transparent }

  // 29-6 dimensions
  const portCount = sw.portCount ?? 24
  const isCore    = !!sw.isCoreLayer || sw.kind === 'mdf' || sw.kind === 'router'
  const widthMult = portCount >= 48 ? 1.5 : portCount <= 12 ? 0.7 : 1.0
  const heightMult = isCore ? 2.0 : 1.0
  const bodyW = BASE_W * widthMult
  const bodyH = BASE_H * heightMult
  const bodyD = BASE_D
  const isRouter = sw.kind === 'router'

  // Front-panel stripe sits along the +Z face of the chassis, centred
  // vertically but slightly inset so it reads as a recessed indicator.
  const stripeZ = bodyD / 2 + STRIPE_INSET / 2

  return (
    <group position={[x, 0, z]}>
      {y > 0 && (
        <mesh position={[0, y / 2, 0]}>
          <cylinderGeometry args={[POLE_R, POLE_R, y, 8]} />
          <meshStandardMaterial color="#64748b" roughness={0.7} {...matOpts} />
        </mesh>
      )}
      {/* Body — dark "metal" chassis */}
      <mesh position={[0, y, 0]}>
        <boxGeometry args={[bodyW, bodyH, bodyD]} />
        <meshStandardMaterial
          color={BODY_COLOR}
          roughness={0.6}
          metalness={0.45}
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

export default function SwitchLayer3D({ floorId, pxToM, dimOpacity = 1 }) {
  const switches = useCableStore((s) => s.switchesByFloor[floorId] ?? [])
  if (!switches.length || !pxToM) return null
  return (
    <group>
      {switches.map((sw) => (
        <SwitchMarker key={sw.id} sw={sw} pxToM={pxToM} dimOpacity={dimOpacity} />
      ))}
    </group>
  )
}
