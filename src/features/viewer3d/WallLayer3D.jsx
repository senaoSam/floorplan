import React, { useMemo, useState } from 'react'
import * as THREE from 'three'
import { useWallStore } from '@/store/useWallStore'
import { useEditorStore } from '@/store/useEditorStore'
import { DEFAULT_WALL_THICKNESS_M } from '@/constants/materials'
import OpeningsDetail from './OpeningDetail3D'
import { getWallSurface, wallTint, makeWallAOPatch } from './wallSurface'
import { glassMaterialProps } from './glassMaterial'

// 53-G9: one frozen empty array for the `?? EMPTY` selectors below. A bare
// `?? []` returns a new reference whenever the floor's key is absent, so
// zustand saw a changed slice on EVERY store write and re-rendered.
const EMPTY = Object.freeze([])

// Walls are semantically 2D line segments to the RF engines, but they carry a
// visual `thicknessM` that the user edits. Fall back to the default for walls
// created before the field existed (old saves, undo snapshots).

// Default color when a wall's material has no color attribute (shouldn't
// happen for materials from constants/materials.js, but mock imports might).
const DEFAULT_WALL_COLOR = '#94a3b8'

// Build an ExtrudeGeometry for a wall segment whose "side view" is a rectangle
// of size length × height with rectangular holes per opening. The finished
// geometry is centered on (0, 0, 0) so the caller can position it with a single
// center translate + Y rotate, matching the no-openings Box path.
//
// The Shape itself is authored with its origin at the wall's bottom-left and
// only translated to center afterwards: ExtrudeGeometry copies shape coords
// into uv, so this makes uv "metres along / metres up from the floor" — the
// procedural wall textures (wallSurface.js) tile in metres and their brick
// courses and panel joints start at the floor on every wall.
function buildWallGeometry(length, height, openings, wallBottom, thickness) {
  const halfL = length / 2
  const halfH = height / 2

  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(length, 0)
  shape.lineTo(length, height)
  shape.lineTo(0, height)
  shape.lineTo(0, 0)

  for (const op of openings ?? []) {
    const s = Math.max(0, Math.min(1, op.startFrac ?? 0))
    const e = Math.max(0, Math.min(1, op.endFrac   ?? 0))
    if (e <= s) continue

    // Opening height range is stored in absolute meters; convert to wall-local.
    const opBottom = (op.bottomHeight ?? 0) - wallBottom
    const opTop    = (op.topHeight    ?? height + wallBottom) - wallBottom
    const yLo = Math.max(0, Math.min(height, opBottom))
    const yHi = Math.max(0, Math.min(height, opTop))
    if (yHi <= yLo) continue

    const xLo = s * length
    const xHi = e * length

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

  // Extrude along +Z for "thickness", then shift so the geometry is centered
  // on all three axes (uv keeps the bottom-left origin — translate() moves
  // positions only). bevelEnabled=false keeps edges crisp.
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  })
  geom.translate(-halfL, -halfH, -thickness / 2)
  return geom
}

// Accent colors: selected = red (matches 2D APLayer/WallLayer selection red),
// hovered = soft white highlight.
const SELECT_EMISSIVE = '#e74c3c'
const HOVER_EMISSIVE  = '#ffffff'

// 51-6: glass walls render as glass rather than as a tinted solid, with the
// same material as the window panes OpeningDetail3D draws (glassMaterial.js —
// Fresnel alpha + sky reflection) so a glass wall and a glass window in the
// same view read as the same material.
//
// Both glass materials qualify. Low-E is the more transmission-blocking of the
// two for RF, but visually it is still glass — the RF difference is carried by
// dbLoss in the engine, not by how the wall looks.
const GLASS_MATERIAL_IDS = new Set(['glass', 'low_e_glass'])

// A wall counts as standing on the floor (gets the contact-AO band at its
// foot) when its bottom is within this of floor level.
const ON_FLOOR_EPS_M = 0.02

// Outline colour. A cool grey rather than black: against the 51-3 backdrop a
// black outline reads as a gap between surfaces instead of an edge.
const EDGE_COLOR = '#94a3b8'

function WallMesh({ wall, pxToM, dimOpacity, isActiveFloor, selectable = true }) {
  const {
    startX, startY, endX, endY,
    topHeight = 3, bottomHeight = 0,
    material,
    openings,
    thicknessM = DEFAULT_WALL_THICKNESS_M,
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
    return buildWallGeometry(length, height, openings, bottomHeight, thicknessM)
  }, [length, height, openings, bottomHeight, thicknessM])

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

  // Fake-AO uniforms. One object per wall, mutated in place as the wall is
  // edited; the compiled shader holds references to these same objects (see
  // makeWallAOPatch), so a height edit lands without a recompile. Also above
  // the early return, for the same 53-G1 reason as the hooks above.
  const aoUniforms = useMemo(() => ({
    uWallHalfH: { value: 0 },
    uWallContact: { value: 1 },
  }), [])
  aoUniforms.uWallHalfH.value = height / 2
  aoUniforms.uWallContact.value = Math.abs(bottomHeight) <= ON_FLOOR_EPS_M ? 1 : 0
  const aoPatch = useMemo(() => makeWallAOPatch(aoUniforms), [aoUniforms])

  const color = material?.color ?? DEFAULT_WALL_COLOR
  const tint = useMemo(() => wallTint(color), [color])

  if (length === 0 || !geometry) return null

  const transparent = dimOpacity < 1
  const hasOpenings = (wall.openings?.length ?? 0) > 0
  const isGlass = GLASS_MATERIAL_IDS.has(material?.id)
  const surface = isGlass ? null : getWallSurface(material?.id)

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
        // Glass doesn't cast: three's shadow pass ignores the pane's alpha and
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
          // key: switching glass ↔ opaque swaps the material TYPE's props
          // wholesale; a fresh element avoids carrying one's onBeforeCompile
          // onto the other.
          <meshStandardMaterial
            key="glass"
            {...glassMaterialProps(color, dimOpacity)}
            emissive={emissive}
            emissiveIntensity={emissiveIntensity}
          />
        ) : (
          // Realistic surface (wallSurface.js): painted albedo × a light tint
          // of the material's identification colour, height map as bump, and
          // per-material roughness/metalness. The AO patch darkens the wall
          // foot and lower band.
          <meshStandardMaterial
            key="opaque"
            color={tint}
            map={surface.map}
            bumpMap={surface.bumpMap}
            bumpScale={surface.bumpScale}
            roughness={surface.roughness}
            metalness={surface.metalness}
            side={THREE.DoubleSide}
            transparent={transparent}
            opacity={dimOpacity}
            depthWrite={!transparent}
            emissive={emissive}
            emissiveIntensity={emissiveIntensity}
            onBeforeCompile={aoPatch}
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
          wallThickness={thicknessM}
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
