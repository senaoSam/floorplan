import React, { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useAPStore } from '@/store/useAPStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { getPatternById, sampleGain } from '@/constants/antennaPatterns'
import Label3D from './Label3D'

// 47-8a: off-band APs are dimmed (not hidden) to match the 2D heatmap band
// filter — keep the same factor as apsLayer's BAND_DIM_ALPHA.
const BAND_DIM_ALPHA = 0.3

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

// Custom-pattern 3D lobe — a volumetric radiation surface centered on the AP,
// scaled so the peak gain reaches this radius in meters.
const CUSTOM_PEAK_RADIUS_M = 3.5
const CUSTOM_MIN_DB = -25           // floor for pattern samples; matches APLayer
const CUSTOM_OPACITY = 0.30
const LOBE_AZ_SEGS = 64
const LOBE_EL_SEGS = 32

// Volumetric antenna lobe: a spherical parametric surface where the radius at
// (azimuth, elevation) is the normalized combined gain. The catalog only
// authors a horizontal cut, so the vertical cut reuses the same samples
// (patch/sector antennas are roughly symmetric) — combined in dB space:
//   r(az, el) = normalize(Gh(az) + Gv(el − tilt)) · peakRadius
// tiltDeg (Phase 40) shifts the vertical cut so the surface matches the exact
// engine formula in apGainDbi — baked into the geometry rather than a rigid
// group rotation, because the engine's Gv depends only on el − tilt (the back
// lobe rises WITH the boresight, unlike a rigid rotation).
// Local axes: boresight (az 0) = +X, canvas +Y = local +Z, elevation on ±Y.
function buildCustomLobeGeometry(pattern, peakRadius, minDb, tiltDeg) {
  const tiltRad = (tiltDeg ?? 0) * Math.PI / 180
  const positions = new Float32Array((LOBE_EL_SEGS + 1) * (LOBE_AZ_SEGS + 1) * 3)
  let p = 0
  for (let j = 0; j <= LOBE_EL_SEGS; j++) {
    const el = -Math.PI / 2 + (j / LOBE_EL_SEGS) * Math.PI
    const gv = sampleGain(pattern, el - tiltRad)
    for (let i = 0; i <= LOBE_AZ_SEGS; i++) {
      const az = i * (2 * Math.PI / LOBE_AZ_SEGS)
      const db = Math.max(sampleGain(pattern, az) + gv, minDb)
      // Normalize [-minDb, 0] → [0, peakRadius].
      const r = ((db - minDb) / -minDb) * peakRadius
      positions[p++] = r * Math.cos(el) * Math.cos(az)
      positions[p++] = r * Math.sin(el)
      positions[p++] = r * Math.cos(el) * Math.sin(az)
    }
  }
  const indices = []
  for (let j = 0; j < LOBE_EL_SEGS; j++) {
    for (let i = 0; i < LOBE_AZ_SEGS; i++) {
      const a = j * (LOBE_AZ_SEGS + 1) + i
      const b = a + LOBE_AZ_SEGS + 1
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  return geom
}

// Directional beam cone: a downward-pointing cone centered at the AP, tilted
// to face the azimuth. Half-angle = beamwidth / 2. tiltDeg (Phase 40) pitches
// the cone axis out of the horizontal plane (+up / −down).
function DirectionalCone({ azimuthDeg, beamwidthDeg, tiltDeg, color, opacity, matOpts }) {
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
  // by −azimuth sweeps to the target azimuth. The inner group pitches the
  // axis by +tilt around local Z (+X → up), applied after the azimuth spin.
  const azimuthRad = (azimuthDeg ?? 0) * Math.PI / 180
  const tiltRad    = (tiltDeg ?? 0) * Math.PI / 180

  return (
    <group rotation={[0, -azimuthRad, 0]}>
      <group rotation={[0, 0, tiltRad]}>
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
    </group>
  )
}

function CustomLobe({ patternId, azimuthDeg, tiltDeg, color, opacity, matOpts }) {
  const pattern = useMemo(() => getPatternById(patternId), [patternId])
  const azimuthRad = (azimuthDeg ?? 0) * Math.PI / 180
  const geom = useMemo(
    () => buildCustomLobeGeometry(pattern, CUSTOM_PEAK_RADIUS_M, CUSTOM_MIN_DB, tiltDeg ?? 0),
    [pattern, tiltDeg],
  )
  React.useEffect(() => () => geom.dispose(), [geom])

  // Lobe is authored with boresight = local +X. Rotate around +Y by −azimuth
  // so the orientation matches APLayer's convention (+x = 0°, clockwise in
  // canvas = clockwise in world when viewed from above).
  return (
    <group rotation={[0, -azimuthRad, 0]}>
      <mesh>
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

// 51-9: the AP label used to be a byte-for-byte copy of Label3D (canvas pill
// + billboarded sprite), which meant the supersampling fix had to be made
// twice. Uses the shared component now; the 0.5 m pill height that read well
// against the 0.36 m AP disc is Label3D's default.

// Selection / hover accent — red emissive glow (matches 2D APLayer) layered
// on top of the existing freq color so the AP still reads as its band.
const SELECT_EMISSIVE = '#e74c3c'
const HOVER_EMISSIVE  = '#ffffff'

// 51-9 Selection pulse. A selected AP is already tinted red, but in a dense
// scene that reads as "one more red thing" rather than "this is the one you
// picked" — motion is what separates it, since nothing else in the view moves.
//
// Driven by useFrame, which is gated by r3f's frameloop, so this animates only
// while 3D is actually visible and does not resurrect the Phase 45 freeze.
const PULSE_PERIOD_S = 1.6
const PULSE_MIN_SCALE = 1.0
const PULSE_MAX_SCALE = 1.5

function SelectionPulse({ radius }) {
  const ref = useRef(null)
  useFrame(({ clock }) => {
    const g = ref.current
    if (!g) return
    // 0..1 sawtooth: expand outward, fading as it goes, then restart.
    const t = (clock.elapsedTime % PULSE_PERIOD_S) / PULSE_PERIOD_S
    const s = PULSE_MIN_SCALE + (PULSE_MAX_SCALE - PULSE_MIN_SCALE) * t
    g.scale.set(s, s, s)
    if (g.material) g.material.opacity = 0.55 * (1 - t)
  })
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <ringGeometry args={[radius * 0.92, radius, 48]} />
      <meshBasicMaterial
        color={SELECT_EMISSIVE}
        transparent
        opacity={0.55}
        side={THREE.DoubleSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  )
}

// Memoized: updateAP replaces only the edited AP's object (per-item immutable
// map in useAPStore), so a single-AP move re-renders ONE marker instead of
// all N. Without this, a 300-AP scene rebuilt every marker's subtree on any
// AP edit — measured as the dominant share of a ~2 s main-thread stall on
// drag release (three.js re-created VAOs + walked every object), even while
// the 3D view was hidden (Viewer3D stays mounted in 2D mode).
const APMarker = React.memo(function APMarker({ ap, pxToM, dimOpacity, isActiveFloor, onHover }) {
  const color = FREQ_COLOR[ap.frequency] ?? DEFAULT_COLOR
  const x = (ap.x ?? 0) * pxToM
  const z = (ap.y ?? 0) * pxToM
  const y = ap.z ?? 2.4  // install height in meters

  const transparent = dimOpacity < 1
  // 51-3: `fog: false` on every marker material. The body/ring colour IS the
  // frequency band (orange 2.4 / blue 5 / purple 6 GHz) and the beam cone and
  // custom lobe inherit it, so letting distance tint them would blur the band
  // apart across a floor. These are meshStandardMaterial, not the unlit
  // materials the other data layers use, so they need the flag just the same.
  const matOpts = { transparent, opacity: dimOpacity, depthWrite: !transparent, fog: false }

  const mode = ap.antennaMode ?? 'omni'
  const isDirectional = mode === 'directional'
  const isCustom      = mode === 'custom'
  const isWallMount   = (ap.mountType ?? 'ceiling') === 'wall'
  const azimuthRad    = (ap.azimuth ?? 0) * Math.PI / 180

  // Selection / hover bookkeeping.
  const selectedId   = useEditorStore((s) => s.selectedId)
  const selectedType = useEditorStore((s) => s.selectedType)
  const setSelected  = useEditorStore((s) => s.setSelected)
  const [hovered, setHovered] = useState(false)
  const isSelected = isActiveFloor && selectedType === 'ap' && selectedId === ap.id
  const isHovered  = isActiveFloor && hovered

  // When selected, swap the ring + body emissive to red accent; default still
  // uses the freq color so unselected APs look as before.
  const accentEmissive = isSelected ? SELECT_EMISSIVE : (isHovered ? HOVER_EMISSIVE : color)
  const bodyEmissiveIntensity = isSelected ? 0.55 : (isHovered ? 0.30 : 0.15)
  const ringEmissiveIntensity = isSelected ? 0.7  : (isHovered ? 0.40 : 0.20)
  const ringColor = isSelected ? SELECT_EMISSIVE : color

  const onClick = (e) => {
    if (!isActiveFloor) return
    e.stopPropagation()
    setSelected(ap.id, 'ap')
  }
  const onPointerOver = (e) => {
    if (!isActiveFloor) return
    e.stopPropagation()
    setHovered(true)
    if (onHover) onHover(ap)
  }
  const onPointerOut = () => {
    setHovered(false)
    if (onHover) onHover(null)
  }

  return (
    <group
      position={[x, 0, z]}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      {/* Ceiling mount: vertical drop pole from floor up to install height.
          Wall mount: no pole — the AP reads as mounted on an implied wall
          surface, with the mount bracket instead suggesting attachment. */}
      {!isWallMount && y > 0 && (
        <mesh position={[0, y / 2, 0]}>
          <cylinderGeometry args={[DROP_RADIUS_M, DROP_RADIUS_M, y, 8]} />
          <meshStandardMaterial color="#64748b" roughness={0.6} {...matOpts} />
        </mesh>
      )}

      {/* Mount bracket for wall-mounted APs: a short arm pointing opposite
          to the azimuth (i.e. into the wall), hinting at the attachment. */}
      {isWallMount && (
        <group position={[0, y, 0]} rotation={[0, -azimuthRad, 0]}>
          <mesh position={[-BODY_RADIUS_M - 0.05, 0, 0]}>
            <boxGeometry args={[0.1, 0.08, 0.04]} />
            <meshStandardMaterial color="#475569" roughness={0.6} {...matOpts} />
          </mesh>
        </group>
      )}

      {/*
        AP body + ring. For ceiling mount the disc is horizontal (axis Y).
        For wall mount the disc stands upright and faces the azimuth: an
        outer group spins around Y by −azimuth so local +X lines up with the
        azimuth, then an inner group tips the disc axis 90° around Z so its
        axis (local Y) ends up along +X in the outer frame.
      */}
      <group position={[0, y, 0]} rotation={isWallMount ? [0, -azimuthRad, 0] : [0, 0, 0]}>
        <group rotation={isWallMount ? [0, 0, -Math.PI / 2] : [0, 0, 0]}>
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[BODY_RADIUS_M, BODY_RADIUS_M, BODY_HEIGHT_M, 24]} />
            <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} emissive={accentEmissive} emissiveIntensity={bodyEmissiveIntensity} {...matOpts} />
          </mesh>
          <mesh position={[0, BODY_HEIGHT_M / 2 + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[RING_RADIUS_M, RING_TUBE_M, 10, 36]} />
            <meshStandardMaterial color={ringColor} roughness={0.4} metalness={0.3} emissive={accentEmissive} emissiveIntensity={ringEmissiveIntensity} {...matOpts} />
          </mesh>
        </group>
      </group>

      {/* 51-9: expanding ring on the selected AP. Sits just under the disc so
          it reads as emanating from the unit. Active floor only — a pulsing
          ghost on a dimmed floor would pull the eye to the wrong storey. */}
      {isSelected && (
        <group position={[0, y - BODY_HEIGHT_M / 2 - 0.01, 0]}>
          <SelectionPulse radius={RING_RADIUS_M * 1.15} />
        </group>
      )}

      {/* Floating name label above the ring */}
      {ap.name && (
        <Label3D
          text={ap.name}
          position={[0, y + 0.6, 0]}
          opacity={dimOpacity}
        />
      )}

      {/* Directional beam cone. Ceiling mount: cone tip at the AP and axis
          sweeping outward along azimuth (already horizontal in DirectionalCone
          because we tipped −Y to +X there). Wall mount: same geometry — the
          DirectionalCone is built in the horizontal plane, so both mount
          modes share the same orientation math. */}
      {isDirectional && (
        <group position={[0, y - (isWallMount ? 0 : BODY_HEIGHT_M / 2), 0]}>
          <DirectionalCone
            azimuthDeg={ap.azimuth ?? 0}
            beamwidthDeg={ap.beamwidth ?? 60}
            tiltDeg={ap.tilt ?? 0}
            color={color}
            opacity={DIRECTIONAL_OPACITY}
            matOpts={matOpts}
          />
        </group>
      )}

      {/* Custom pattern volumetric lobe — centered on the AP body. */}
      {isCustom && (
        <group position={[0, y - BODY_HEIGHT_M / 2 - 0.01, 0]}>
          <CustomLobe
            patternId={ap.patternId}
            azimuthDeg={ap.azimuth ?? 0}
            tiltDeg={ap.tilt ?? 0}
            color={color}
            opacity={CUSTOM_OPACITY}
            matOpts={matOpts}
          />
        </group>
      )}
    </group>
  )
})

export default function APLayer3D({ floorId, pxToM, dimOpacity = 1, isActiveFloor = true, onAPHover }) {
  const allAPs = useAPStore((s) => s.apsByFloor[floorId] ?? [])
  // Keep 2D and 3D visibility in sync — same per-band layer toggle (hides).
  const showAPBand = useEditorStore((s) => s.showAPBand)
  // 47-8a: heatmap band filter dims (not hides) off-band APs — mirror 2D.
  const heatmapOn = useHeatmapStore((s) => s.enabled)
  const bandFilter = useHeatmapStore((s) => s.bandFilter)
  const aps = allAPs.filter((ap) => showAPBand[ap.frequency] !== false)
  if (!aps.length || !pxToM) return null
  const bandActive = heatmapOn && bandFilter && bandFilter !== 'all'
  return (
    <group>
      {aps.map((ap) => {
        const offBand = bandActive && String(ap.frequency) !== bandFilter
        return (
          <APMarker
            key={ap.id}
            ap={ap}
            pxToM={pxToM}
            dimOpacity={offBand ? dimOpacity * BAND_DIM_ALPHA : dimOpacity}
            isActiveFloor={isActiveFloor}
            onHover={isActiveFloor ? onAPHover : undefined}
          />
        )
      })}
    </group>
  )
}
