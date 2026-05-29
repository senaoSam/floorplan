import React, { useMemo } from 'react'
import * as THREE from 'three'

// --- Size parameters (meters). Single source of truth for both the detail
// meshes here and the hole geometry built in WallLayer3D. ---
// frameDepth extends *through* the wall thickness plus a small protrusion on
// each face so the frame visually "wraps" the opening from both sides.
const DOOR = {
  frameDepth:       0.08,
  frameThickness:   0.06,
  panelInset:       0.02,
  leafThickness:    0.035,
  leafOpacity:      0.9,
  handleRadius:     0.05,
  handleLength:     0.22,
  handleOffset:     0.07,   // from the free edge, inward
  handleInset:      0.04,   // protrusion from the leaf surface
  handleRoseRadius: 0.08,
  handleRoseDepth:  0.02,
  frameColor:       '#6b4e2e',
  leafFallback:     '#8b5e34',
  handleColor:      '#c9a85a',
}
const WIN = {
  frameDepth:       0.05,
  frameThickness:   0.04,
  glassInset:       0.015,
  glassThickness:   0.008,
  mullionWidth:     0.03,
  sillDepth:        0.04,
  sillHeight:       0.03,
  sillOverhang:     0.05,
  frameColor:       '#3e4a5a',
  sillColor:        '#8b95a5',
  glassColor:       '#7cb0d8',
}

// Build one opening's detail group. The opening is authored in the wall's
// local frame: X runs along the wall length (left=negative, right=positive),
// Y is height (bottom=negative, top=positive), Z is wall thickness (+Z faces
// the wall's "front"). The parent <group> should already be rotated so +X
// tracks along the wall and +Z perpendicular to it.
//
// `cx`, `cy` are the opening center in wall-local coords. `w`, `h` are the
// opening's width × height. `wallThickness` is the wall's depth along Z.
function Door({ cx, cy, w, h, wallThickness, color }) {
  const { frameDepth, frameThickness, panelInset, leafThickness,
          leafOpacity, handleRadius, handleLength, handleOffset, handleInset,
          handleRoseRadius, handleRoseDepth,
          frameColor, leafFallback, handleColor } = DOOR
  const fd = frameDepth
  const ft = Math.min(frameThickness, Math.min(w, h) * 0.2)
  const leafColor = color ?? leafFallback

  // Frame pieces sit across the wall thickness + small protrusion on each side.
  // Shape: ⊓ (no bottom bar for a door — the threshold is the floor).
  const halfW = w / 2
  const halfH = h / 2

  // Closed door: leaf centered in the opening, filling the frame's interior.
  // Slight transparency so the viewer can tell it's a door-like surface
  // rather than a solid wall segment.
  const leafW = Math.max(w - ft * 2 - 0.01, 0.2)
  const leafH = Math.max(h - ft - 0.01,     0.5)

  return (
    <group position={[cx, cy, 0]}>
      {/* Top frame */}
      <mesh position={[0, halfH - ft / 2, 0]}>
        <boxGeometry args={[w, ft, fd]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} />
      </mesh>
      {/* Left jamb */}
      <mesh position={[-halfW + ft / 2, (halfH - ft) / 2 - ft / 2, 0]}>
        <boxGeometry args={[ft, h - ft, fd]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} />
      </mesh>
      {/* Right jamb */}
      <mesh position={[ halfW - ft / 2, (halfH - ft) / 2 - ft / 2, 0]}>
        <boxGeometry args={[ft, h - ft, fd]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} />
      </mesh>

      {/* Closed door leaf, centered within the jambs. */}
      <mesh position={[0, -halfH + leafH / 2 + ft / 2, 0]} castShadow>
        <boxGeometry args={[leafW, leafH, leafThickness]} />
        <meshStandardMaterial
          color={leafColor}
          roughness={0.6}
          transparent
          opacity={leafOpacity}
        />
      </mesh>

      {/* Lever handles on both faces so you always see one from outside the
          wall. Lever runs horizontally along the door's width. */}
      {[1, -1].map((side) => (
        <group
          key={side}
          position={[
            halfW - ft - handleOffset - handleLength / 2,
            -halfH + leafH / 2 + ft / 2,
            side * (leafThickness / 2 + handleInset),
          ]}
        >
          {/* Base rose (round plate) */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry
              args={[handleRoseRadius, handleRoseRadius, handleRoseDepth, 20]}
              attach="geometry"
            />
            <meshStandardMaterial color={handleColor} metalness={0.8} roughness={0.3} />
          </mesh>
          {/* Horizontal lever — cylinder oriented along X */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry
              args={[handleRadius, handleRadius, handleLength, 16]}
              attach="geometry"
            />
            <meshStandardMaterial color={handleColor} metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function Window({ cx, cy, w, h, wallThickness, color }) {
  const { frameDepth, frameThickness, glassInset, glassThickness,
          mullionWidth, sillDepth, sillHeight, sillOverhang,
          frameColor, sillColor, glassColor } = WIN
  const fd = frameDepth
  const ft = Math.min(frameThickness, Math.min(w, h) * 0.18)
  // Use material color as a tint on the frame when provided, otherwise the
  // default deep-gray. Glass always uses the physical-material blue so it
  // reads as glass regardless of the material metadata.
  const frameCol = color && color.toLowerCase() !== '#ffffff' ? color : frameColor

  const halfW = w / 2
  const halfH = h / 2

  // Sill sits just below the opening and overhangs on the front face.
  const sillW = w + sillOverhang * 2
  const sillD = wallThickness + sillOverhang

  // Two glass panes split by a horizontal mullion at the opening's midline.
  const innerW = w - ft * 2
  const innerH = h - ft * 2
  const paneH = (innerH - mullionWidth) / 2

  return (
    <group position={[cx, cy, 0]}>
      {/* Four-sided frame */}
      <mesh position={[0, halfH - ft / 2, 0]}>
        <boxGeometry args={[w, ft, fd]} />
        <meshStandardMaterial color={frameCol} roughness={0.6} />
      </mesh>
      <mesh position={[0, -halfH + ft / 2, 0]}>
        <boxGeometry args={[w, ft, fd]} />
        <meshStandardMaterial color={frameCol} roughness={0.6} />
      </mesh>
      <mesh position={[-halfW + ft / 2, 0, 0]}>
        <boxGeometry args={[ft, h - ft * 2, fd]} />
        <meshStandardMaterial color={frameCol} roughness={0.6} />
      </mesh>
      <mesh position={[ halfW - ft / 2, 0, 0]}>
        <boxGeometry args={[ft, h - ft * 2, fd]} />
        <meshStandardMaterial color={frameCol} roughness={0.6} />
      </mesh>

      {/* Horizontal mullion across the middle */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[innerW, mullionWidth, fd * 0.9]} />
        <meshStandardMaterial color={frameCol} roughness={0.6} />
      </mesh>

      {/* Upper pane */}
      <mesh position={[0,  paneH / 2 + mullionWidth / 2, 0]}>
        <boxGeometry args={[innerW, paneH, glassThickness]} />
        <meshPhysicalMaterial
          color={glassColor}
          transmission={0.9}
          roughness={0.05}
          metalness={0}
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
          ior={1.5}
        />
      </mesh>
      {/* Lower pane */}
      <mesh position={[0, -paneH / 2 - mullionWidth / 2, 0]}>
        <boxGeometry args={[innerW, paneH, glassThickness]} />
        <meshPhysicalMaterial
          color={glassColor}
          transmission={0.9}
          roughness={0.05}
          metalness={0}
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
          ior={1.5}
        />
      </mesh>

      {/* Sill — sits just below the opening and protrudes from the front. */}
      <mesh position={[0, -halfH - sillHeight / 2, sillOverhang / 2]}>
        <boxGeometry args={[sillW, sillHeight, sillD]} />
        <meshStandardMaterial color={sillColor} roughness={0.8} />
      </mesh>
    </group>
  )
}

// Top-level: given a wall and its opening list, render the detail groups
// positioned in the wall's local frame. This is consumed by WallLayer3D,
// which applies the shared wall pose transform.
export default function OpeningsDetail({ wall, length, height, wallThickness }) {
  const items = useMemo(() => {
    const halfH = height / 2
    return (wall.openings ?? []).map((op) => {
      const s = Math.max(0, Math.min(1, op.startFrac ?? 0))
      const e = Math.max(0, Math.min(1, op.endFrac   ?? 0))
      if (e <= s) return null
      const xLo = s * length - length / 2
      const xHi = e * length - length / 2
      const w = xHi - xLo
      const cx = (xLo + xHi) / 2

      const wallBottom = wall.bottomHeight ?? 0
      const opBottom = (op.bottomHeight ?? 0) - wallBottom
      const opTop    = (op.topHeight    ?? height + wallBottom) - wallBottom
      const yLo = Math.max(0, Math.min(height, opBottom))
      const yHi = Math.max(0, Math.min(height, opTop))
      const h = yHi - yLo
      if (h <= 0) return null
      const cy = (yLo + yHi) / 2 - halfH

      return { op, cx, cy, w, h }
    }).filter(Boolean)
  }, [wall.openings, length, height, wall.bottomHeight])

  return (
    <group>
      {items.map(({ op, cx, cy, w, h }) => {
        const color = op.material?.color
        if (op.type === 'window') {
          return (
            <Window key={op.id} cx={cx} cy={cy} w={w} h={h}
                    wallThickness={wallThickness} color={color} />
          )
        }
        return (
          <Door key={op.id} cx={cx} cy={cy} w={w} h={h}
                wallThickness={wallThickness} color={color} />
        )
      })}
    </group>
  )
}
