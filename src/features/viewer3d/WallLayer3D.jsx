import React, { useMemo, useState } from 'react'
import * as THREE from 'three'
import { useWallStore } from '@/store/useWallStore'
import { useEditorStore } from '@/store/useEditorStore'
import OpeningsDetail from './OpeningDetail3D'

// 53-G9: one frozen empty array for the `?? EMPTY` selectors below. A bare
// `?? []` returns a new reference whenever the floor's key is absent, so
// zustand saw a changed slice on EVERY store write and re-rendered.
const EMPTY = Object.freeze([])

// Fixed visual thickness for wall boxes (meters). Walls are semantically 2D
// line segments in the rest of the app, so we pick a small value that still
// renders clearly in 3D without distorting the floorplan's geometry.
const WALL_THICKNESS_M = 0.1

// Default color when a wall's material has no color attribute (shouldn't
// happen for materials from constants/materials.js, but mock imports might).
const DEFAULT_WALL_COLOR = '#94a3b8'

// Build an ExtrudeGeometry for a wall segment whose "side view" is a rectangle
// of size length × height with rectangular holes per opening. Geometry is
// authored centered on (0, 0, 0) so the caller can position it with a single
// center translate + Y rotate, matching the no-openings Box path.
function buildWallGeometry(length, height, openings, wallBottom, thickness) {
  const halfL = length / 2
  const halfH = height / 2

  const shape = new THREE.Shape()
  shape.moveTo(-halfL, -halfH)
  shape.lineTo( halfL, -halfH)
  shape.lineTo( halfL,  halfH)
  shape.lineTo(-halfL,  halfH)
  shape.lineTo(-halfL, -halfH)

  for (const op of openings ?? []) {
    const s = Math.max(0, Math.min(1, op.startFrac ?? 0))
    const e = Math.max(0, Math.min(1, op.endFrac   ?? 0))
    if (e <= s) continue

    // Opening height range is stored in absolute meters; convert to wall-local.
    const opBottom = (op.bottomHeight ?? 0) - wallBottom
    const opTop    = (op.topHeight    ?? height + wallBottom) - wallBottom
    const yLo = Math.max(-halfH, Math.min(halfH, opBottom - halfH))
    const yHi = Math.max(-halfH, Math.min(halfH, opTop    - halfH))
    if (yHi <= yLo) continue

    const xLo = s * length - halfL
    const xHi = e * length - halfL

    // Three.js Shape treats holes as paths with opposite winding from the
    // outer contour. Authoring the hole counter-clockwise relative to the
    // shape's CCW outline reliably produces a subtraction.
    const hole = new THREE.Path()
    hole.moveTo(xLo, yLo)
    hole.lineTo(xLo, yHi)
    hole.lineTo(xHi, yHi)
    hole.lineTo(xHi, yLo)
    hole.lineTo(xLo, yLo)
    shape.holes.push(hole)
  }

  // Extrude along +Z for "thickness", then shift -depth/2 so the geometry is
  // centered on the Z axis as well. bevelEnabled=false keeps edges crisp.
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  })
  geom.translate(0, 0, -thickness / 2)
  return geom
}

// Accent colors: selected = red (matches 2D APLayer/WallLayer selection red),
// hovered = soft white highlight.
const SELECT_EMISSIVE = '#e74c3c'
const HOVER_EMISSIVE  = '#ffffff'

// 51-6: glass walls render as glass rather than as a tinted solid. Matched to
// the window panes OpeningDetail3D already draws (transmission 0.9 / roughness
// 0.05 / ior 1.5 / opacity 0.35) so a glass wall and a glass window in the
// same view read as the same material.
//
// Both glass materials qualify. Low-E is the more transmission-blocking of the
// two for RF, but visually it is still glass — the RF difference is carried by
// dbLoss in the engine, not by how the wall looks.
const GLASS_MATERIAL_IDS = new Set(['glass', 'low_e_glass'])
const GLASS_OPACITY = 0.35

// Outline colour. A cool grey rather than black: against the 51-3 backdrop a
// black outline reads as a gap between surfaces instead of an edge.
const EDGE_COLOR = '#94a3b8'

function WallMesh({ wall, pxToM, dimOpacity, isActiveFloor, selectable = true }) {
  const {
    startX, startY, endX, endY,
    topHeight = 3, bottomHeight = 0,
    material,
    openings,
  } = wall

  // Derive the wall's length / height / pose from its 2D endpoints.
  const { length, height, center, rotationY } = useMemo(() => {
    const x1 = startX * pxToM, z1 = startY * pxToM
    const x2 = endX   * pxToM, z2 = endY   * pxToM
    const dx = x2 - x1, dz = z2 - z1
    const len = Math.sqrt(dx * dx + dz * dz)
    const h = Math.max(topHeight - bottomHeight, 0.01)
    return {
      length: len,
      height: h,
      center: [(x1 + x2) / 2, bottomHeight + h / 2, (z1 + z2) / 2],
      // Box / extruded face is authored along local +X. atan2(dz, dx) rotates
      // around +Y so the long axis lines up with the wall segment.
      rotationY: -Math.atan2(dz, dx),
    }
  }, [startX, startY, endX, endY, topHeight, bottomHeight, pxToM])

  // Recompute extruded geometry only when topology actually changes. Dimming
  // opacity changes don't need a geometry rebuild.
  const geometry = useMemo(() => {
    if (length === 0) return null
    return buildWallGeometry(length, height, openings, bottomHeight, WALL_THICKNESS_M)
  }, [length, height, openings, bottomHeight])

  // Dispose the extruded geometry when the mesh unmounts / rebuilds so we
  // don't leak GPU buffers on frequent wall edits.
  React.useEffect(() => {
    return () => { if (geometry) geometry.dispose() }
  }, [geometry])

  // 51-6 Wall outline. A shaded box reads as a generic solid; an outlined one
  // reads as drawn architecture, and it keeps corners and openings legible
  // where two same-material walls meet and their faces merge into one tone.
  // Derived from the same geometry, so door/window cut-outs are outlined too.
  const edges = useMemo(() => {
    if (!geometry) return null
    // 1° threshold: keep the crisp box/opening edges, drop the triangulation
    // seams across the flat faces that a 0° threshold would expose.
    return new THREE.EdgesGeometry(geometry, 1)
  }, [geometry])
  React.useEffect(() => {
    return () => { if (edges) edges.dispose() }
  }, [edges])

  // Select/hover visuals. Only the active-floor wall layer is interactive —
  // ghost floors ignore pointer events so the user doesn't accidentally
  // select a dimmed wall from an upstairs/downstairs floor.
  //
  // 53-G1: these four hooks must stay ABOVE the zero-length early return.
  // Endpoint snapping can make a wall's two endpoints exactly equal, and that
  // render would then run fewer hooks than the previous one — React throws and
  // the whole app blanks (Viewer3D stays mounted in 2D mode, so even pure 2D
  // editing crashes from the hidden 3D tree).
  const selectedId   = useEditorStore((s) => s.selectedId)
  const selectedType = useEditorStore((s) => s.selectedType)
  const setSelected  = useEditorStore((s) => s.setSelected)
  const [hovered, setHovered] = useState(false)

  if (length === 0 || !geometry) return null

  const color = material?.color ?? DEFAULT_WALL_COLOR
  const transparent = dimOpacity < 1
  const hasOpenings = (wall.openings?.length ?? 0) > 0
  const isGlass = GLASS_MATERIAL_IDS.has(material?.id)

  // CAMERA mode passes selectable=false — walls are reference geometry there
  // (only cameras are editable), so clicks fall through and hover stays off.
  const canInteract = isActiveFloor && selectable
  const isSelected = canInteract && selectedType === 'wall' && selectedId === wall.id
  const isHovered  = canInteract && hovered
  const emissive = isSelected ? SELECT_EMISSIVE : (isHovered ? HOVER_EMISSIVE : '#000000')
  const emissiveIntensity = isSelected ? 0.45 : (isHovered ? 0.25 : 0)

  const onClick = (e) => {
    if (!canInteract) return
    e.stopPropagation()
    setSelected(wall.id, 'wall')
  }
  const onPointerOver = (e) => {
    if (!canInteract) return
    e.stopPropagation()
    setHovered(true)
  }
  const onPointerOut = () => setHovered(false)

  return (
    <group position={center} rotation={[0, rotationY, 0]}>
      <mesh
        // Glass doesn't cast: three's shadow pass ignores transmission and
        // would throw the same opaque silhouette a concrete wall does, which
        // is the one thing that would give away that it isn't really glass.
        castShadow={!isGlass}
        receiveShadow
        onClick={onClick}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      >
        <primitive object={geometry} attach="geometry" />
        {isGlass ? (
          <meshPhysicalMaterial
            color={color}
            transmission={0.9}
            roughness={0.05}
            metalness={0}
            ior={1.5}
            side={THREE.DoubleSide}
            transparent
            opacity={GLASS_OPACITY * dimOpacity}
            depthWrite={false}
            emissive={emissive}
            emissiveIntensity={emissiveIntensity}
          />
        ) : (
          <meshStandardMaterial
            color={color}
            roughness={0.85}
            metalness={0.05}
            side={THREE.DoubleSide}
            transparent={transparent}
            opacity={dimOpacity}
            depthWrite={!transparent}
            emissive={emissive}
            emissiveIntensity={emissiveIntensity}
          />
        )}
      </mesh>
      {/* 51-6 outline. On a glass wall this carries most of the read — the
          pane itself is nearly invisible, so without the frame the wall would
          vanish. Hence the stronger alpha there. */}
      {edges && (
        <lineSegments raycast={() => null}>
          <primitive object={edges} attach="geometry" />
          <lineBasicMaterial
            color={isSelected ? SELECT_EMISSIVE : EDGE_COLOR}
            transparent
            opacity={(isGlass ? 0.75 : 0.4) * dimOpacity}
          />
        </lineSegments>
      )}
      {hasOpenings && (
        <OpeningsDetail
          wall={wall}
          length={length}
          height={height}
          wallThickness={WALL_THICKNESS_M}
        />
      )}
    </group>
  )
}

export default function WallLayer3D({ floorId, pxToM, dimOpacity = 1, isActiveFloor = true, selectable = true }) {
  const walls = useWallStore((s) => s.wallsByFloor[floorId] ?? EMPTY)
  if (!walls.length || !pxToM) return null
  return (
    <group>
      {walls.map((w) => (
        <WallMesh key={w.id} wall={w} pxToM={pxToM} dimOpacity={dimOpacity} isActiveFloor={isActiveFloor} selectable={selectable} />
      ))}
    </group>
  )
}
