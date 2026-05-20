import React from 'react'
import { useCableStore, getSwitchKindColor } from '@/store/useCableStore'

// 3D switch / IDF / MDF / router chassis. Each device renders as a small
// rack-shaped box at its `mountHeight` so the user sees the same position
// as the 2D SwitchLayer, plus a thin pole down to the floor for grounding
// context. Body is dark grey to mimic real enterprise rack hardware; a
// thin coloured strip on the front face carries the kind colour so users
// can still tell SW / IDF / MDF / Router apart at a glance.
const BODY_W = 0.40   // ~1U rack chassis width on the wall
const BODY_H = 0.10
const BODY_D = 0.22
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

  // Front-panel stripe sits along the +Z face of the chassis, centred
  // vertically but slightly inset so it reads as a recessed indicator.
  const stripeZ = BODY_D / 2 + STRIPE_INSET / 2

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
        <boxGeometry args={[BODY_W, BODY_H, BODY_D]} />
        <meshStandardMaterial
          color={BODY_COLOR}
          roughness={0.6}
          metalness={0.45}
          {...matOpts}
        />
      </mesh>
      {/* Front-panel kind indicator strip (full-width, thin) */}
      <mesh position={[0, y, stripeZ]}>
        <boxGeometry args={[BODY_W * 0.9, STRIPE_THICKNESS, STRIPE_INSET]} />
        <meshStandardMaterial
          color={kindColor}
          emissive={kindColor}
          emissiveIntensity={0.7}
          roughness={0.3}
          {...matOpts}
        />
      </mesh>
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
