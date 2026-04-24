import React, { useMemo } from 'react'
import * as THREE from 'three'
import { useAPStore } from '@/store/useAPStore'
import { getPatternById, sampleGain } from '@/constants/antennaPatterns'

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

// Directional-cone presentation parameters.
const DIRECTIONAL_REACH_M = 4.0     // how far the cone projects past the AP
const DIRECTIONAL_MIN_BEAM = 10     // avoid degenerate razor-thin cones
const DIRECTIONAL_MAX_BEAM = 170    // avoid near-sphere cones (omni-like)
const DIRECTIONAL_OPACITY = 0.28

// Custom-pattern horizontal lobe — a polar polygon authored in XY at the AP's
// install height, scaled so the peak gain reaches this radius in meters.
const CUSTOM_PEAK_RADIUS_M = 3.5
const CUSTOM_MIN_DB = -25           // floor for pattern samples; matches APLayer
const CUSTOM_OPACITY = 0.30

// Build a closed XY polygon (in the AP's local XY plane) describing the horizontal
// antenna lobe. Positive X points along azimuth=0; sample[0] is boresight.
function buildCustomLobeGeometry(pattern, azimuthRad, peakRadius, minDb) {
  const samples = pattern.samples
  const n = samples.length
  const shape = new THREE.Shape()
  for (let i = 0; i < n; i++) {
    const db = Math.max(samples[i], minDb)
    // Normalize [-minDb, 0] → [0, peakRadius].
    const r = ((db - minDb) / -minDb) * peakRadius
    const ang = azimuthRad + i * (2 * Math.PI / n)
    const x = r * Math.cos(ang)
    const y = r * Math.sin(ang)
    if (i === 0) shape.moveTo(x, y)
    else         shape.lineTo(x, y)
  }
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}

// Directional beam cone: a downward-pointing cone centered at the AP, tilted
// to face the azimuth. Half-angle = beamwidth / 2.
function DirectionalCone({ azimuthDeg, beamwidthDeg, color, opacity, matOpts }) {
  const bw = Math.max(DIRECTIONAL_MIN_BEAM, Math.min(DIRECTIONAL_MAX_BEAM, beamwidthDeg))
  const halfAngleRad = (bw / 2) * Math.PI / 180
  const reach = DIRECTIONAL_REACH_M
  const radius = Math.tan(halfAngleRad) * reach

  // Cone geometry default: tip at +Y, base at -Y, axis on Y. We want the tip
  // at the AP (origin) and the cone extending outward along the azimuth
  // vector in the XZ plane. So: first translate the geometry so the tip is at
  // origin and the base points toward -Y, then rotate the cone so -Y becomes
  // the azimuth direction in XZ.
  const geom = useMemo(() => {
    const g = new THREE.ConeGeometry(radius, reach, 32, 1, true /* openEnded */)
    // Default cone: base at y=-reach/2, tip at y=reach/2. Shift so tip is at origin.
    g.translate(0, -reach / 2, 0)
    return g
  }, [radius, reach])

  React.useEffect(() => () => geom.dispose(), [geom])

  // Rotate the cone so its −Y axis lines up with the azimuth direction in XZ.
  // Azimuth 0° = +X; canvas convention has +Y (dy) = +Z (world). A rotation
  // around +Z by +90° sends −Y → +X (azimuth 0). Then a rotation around +Y
  // by −azimuth sweeps to the target azimuth.
  const azimuthRad = (azimuthDeg ?? 0) * Math.PI / 180

  return (
    <group rotation={[0, -azimuthRad, 0]}>
      <mesh rotation={[0, 0, -Math.PI / 2]}>
        <primitive object={geom} attach="geometry" />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.35}
          transparent
          opacity={opacity * (matOpts.opacity ?? 1)}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

function CustomLobe({ patternId, azimuthDeg, color, opacity, matOpts }) {
  const pattern = useMemo(() => getPatternById(patternId), [patternId])
  const azimuthRad = (azimuthDeg ?? 0) * Math.PI / 180
  const geom = useMemo(
    () => buildCustomLobeGeometry(pattern, 0, CUSTOM_PEAK_RADIUS_M, CUSTOM_MIN_DB),
    [pattern],
  )
  React.useEffect(() => () => geom.dispose(), [geom])

  // Polygon is authored in XY (local). Lay it flat on XZ and rotate around +Y
  // by −azimuth so the lobe orientation matches APLayer's convention (+x = 0°,
  // clockwise in canvas = clockwise in world when viewed from above).
  return (
    <group rotation={[0, -azimuthRad, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <primitive object={geom} attach="geometry" />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.25}
          transparent
          opacity={opacity * (matOpts.opacity ?? 1)}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

function APMarker({ ap, pxToM, dimOpacity }) {
  const color = FREQ_COLOR[ap.frequency] ?? DEFAULT_COLOR
  const x = (ap.x ?? 0) * pxToM
  const z = (ap.y ?? 0) * pxToM
  const y = ap.z ?? 2.4  // install height in meters

  const transparent = dimOpacity < 1
  const matOpts = { transparent, opacity: dimOpacity, depthWrite: !transparent }

  const mode = ap.antennaMode ?? 'omni'
  const isDirectional = mode === 'directional'
  const isCustom      = mode === 'custom'

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

      {/* Directional beam cone — projected downward from the AP's install height. */}
      {isDirectional && (
        <group position={[0, y - BODY_HEIGHT_M / 2, 0]}>
          <DirectionalCone
            azimuthDeg={ap.azimuth ?? 0}
            beamwidthDeg={ap.beamwidth ?? 60}
            color={color}
            opacity={DIRECTIONAL_OPACITY}
            matOpts={matOpts}
          />
        </group>
      )}

      {/* Custom pattern horizontal lobe — laid flat at the AP's install height. */}
      {isCustom && (
        <group position={[0, y - BODY_HEIGHT_M / 2 - 0.01, 0]}>
          <CustomLobe
            patternId={ap.patternId}
            azimuthDeg={ap.azimuth ?? 0}
            color={color}
            opacity={CUSTOM_OPACITY}
            matOpts={matOpts}
          />
        </group>
      )}
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
