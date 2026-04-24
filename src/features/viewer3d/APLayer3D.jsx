import React from 'react'
import { useAPStore } from '@/store/useAPStore'

// Match APLayer (2D) so users see the same freq-based color across views.
const FREQ_COLOR = {
  2.4: '#f39c12',
  5:   '#4fc3f7',
  6:   '#a855f7',
}
const DEFAULT_COLOR = '#4fc3f7'

// Marker sizing (meters). Visually prominent without dominating the floorplan.
const BODY_RADIUS_M = 0.18
const BODY_HEIGHT_M = 0.08
const RING_RADIUS_M = 0.28
const RING_TUBE_M   = 0.035
const DROP_RADIUS_M = 0.015   // thin "pole" down to the floor

function APMarker({ ap, pxToM, dimOpacity }) {
  const color = FREQ_COLOR[ap.frequency] ?? DEFAULT_COLOR
  const x = (ap.x ?? 0) * pxToM
  const z = (ap.y ?? 0) * pxToM
  const y = ap.z ?? 2.4  // install height in meters

  const transparent = dimOpacity < 1
  const matOpts = { transparent, opacity: dimOpacity, depthWrite: !transparent }

  return (
    <group position={[x, 0, z]}>
      {/* Vertical pole from floor up to the AP height — makes the install
          height difference between APs visually readable. */}
      {y > 0 && (
        <mesh position={[0, y / 2, 0]}>
          <cylinderGeometry args={[DROP_RADIUS_M, DROP_RADIUS_M, y, 8]} />
          <meshStandardMaterial color="#64748b" roughness={0.6} {...matOpts} />
        </mesh>
      )}

      {/* Body disc at the install height */}
      <mesh position={[0, y, 0]} castShadow>
        <cylinderGeometry args={[BODY_RADIUS_M, BODY_RADIUS_M, BODY_HEIGHT_M, 24]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} emissive={color} emissiveIntensity={0.15} {...matOpts} />
      </mesh>

      {/* Ring around the body — echoes the 2D concentric-circle motif */}
      <mesh position={[0, y + BODY_HEIGHT_M / 2 + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[RING_RADIUS_M, RING_TUBE_M, 10, 36]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.3} emissive={color} emissiveIntensity={0.2} {...matOpts} />
      </mesh>
    </group>
  )
}

export default function APLayer3D({ floorId, pxToM, dimOpacity = 1 }) {
  const aps = useAPStore((s) => s.apsByFloor[floorId] ?? [])
  if (!aps.length || !pxToM) return null
  return (
    <group>
      {aps.map((ap) => (
        <APMarker key={ap.id} ap={ap} pxToM={pxToM} dimOpacity={dimOpacity} />
      ))}
    </group>
  )
}
