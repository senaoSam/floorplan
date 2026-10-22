import React, { useMemo, useState } from 'react'
import * as THREE from 'three'
import { useWallStore } from '@/store/useWallStore'
import { useEditorStore } from '@/store/useEditorStore'
import { DEFAULT_WALL_THICKNESS_M } from '@/constants/materials'
import OpeningsDetail from './OpeningDetail3D'
import { getWallSurface, wallTint, makeWallAOPatch, mergedWallAOPatch } from './wallSurface'
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

// Memoized: a wall re-renders only when its own data, floor dimming or
// interactivity changes -- not when another wall is edited (a 2D endpoint drag
// writes the wall store every move while this tree stays mounted, hidden).
// `merged`: a non-active floor draws this wall's body and outline in its
// MergedWalls batch -- here they are hidden (glass walls and openings stay).
const WallMesh = React.memo(function WallMesh({ wall, pxToM, dimOpacity, isActiveFloor, selectable = true, merged = false }) {
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
  // 53-G1: these hooks must stay ABOVE the zero-length early return.
  // Endpoint snapping can make a wall's two endpoints exactly equal, and that
  // render would then run fewer hooks than the previous one — React throws and
  // the whole app blanks (Viewer3D stays mounted in 2D mode, so even pure 2D
  // editing crashes from the hidden 3D tree).
  //
  // Whether THIS wall is selected, so a selection change re-renders only the
  // walls it flips (not every wall on every floor).
  const selectedHere = useEditorStore((s) => s.selectedType === 'wall' && s.selectedId === wall.id)
  const setSelected  = useEditorStore((s) => s.setSelected)
  const [hovered, setHovered] = useState(false)
  // CAMERA mode passes selectable=false — walls are reference geometry there
  // (only cameras are editable), so clicks fall through and hover stays off.
  const canInteract = isActiveFloor && selectable
  // Handlers come off with the active floor (below), so a wall that stops
  // being interactive may never get its pointer-out -- drop the hover.
  React.useEffect(() => { if (!canInteract) setHovered(false) }, [canInteract])

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
  const inBatch = merged && !isGlass

  const isSelected = canInteract && selectedHere
  const isHovered  = canInteract && hovered
  const emissive = isSelected ? SELECT_EMISSIVE : (isHovered ? HOVER_EMISSIVE : '#000000')
  const emissiveIntensity = isSelected ? 0.45 : (isHovered ? 0.25 : 0)

  // CAMERA mode keeps the handlers (inert) so a click on a wall there still
  // counts as a hit and keeps the selected camera.
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
        visible={!inBatch}
        // Glass doesn't cast: three's shadow pass ignores the pane's alpha and
        // would throw the same opaque silhouette a concrete wall does, which
        // is the one thing that would give away that it isn't really glass.
        castShadow={!isGlass}
        receiveShadow
        // Only the active floor's walls carry handlers: r3f raycasts every
        // object that has one on each pointer move, and walls of the other
        // (dimmed) floors only ignored the events. Without them a click there
        // now counts as empty space and clears the selection.
        onClick={isActiveFloor ? onClick : undefined}
        onPointerOver={isActiveFloor ? onPointerOver : undefined}
        onPointerOut={isActiveFloor ? onPointerOut : undefined}
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
            // A transparent DoubleSide material is otherwise drawn twice (back
            // faces, then front) and three marks it needsUpdate before each
            // pass, re-resolving its program -- with dimmed ghost floors that
            // was ~4000 program lookups and +2000 draw calls a frame (3 floors x
            // ~1000 walls).
            forceSinglePass
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
        <lineSegments visible={!inBatch} raycast={() => null}>
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
})

// 59-6: the opaque walls of a non-active floor, drawn as one mesh per surface
// (material + tint) and one outline instead of two objects each. With ~1000
// walls a floor the per-object cost (draw calls, program / uniform switches,
// culling) was most of a frame (3 floors: 69 -> 28 ms). These walls never
// interact (no handlers off the active floor), so nothing per wall is lost:
// same geometry (buildWallGeometry, uv in metres), same material props, the
// same AO through per-vertex attributes (mergedWallAOPatch). Glass walls and
// door / window detail stay per wall (their own transparency order). The
// WallMesh components stay mounted with these parts hidden, so switching the
// active floor flips visibility instead of remounting; rebuilding a floor's
// batch costs ~27 ms per 1000 walls and only runs when its walls or the
// active floor change -- never on the 2D->3D switch itself.
const _p = new THREE.Vector3()
const _n = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _yAxis = new THREE.Vector3(0, 1, 0)

function buildMergedWalls(walls, pxToM) {
  const groups = new Map()   // surface key -> { tint, surface, parts: [] }
  const edgeParts = []
  for (const w of walls) {
    const materialId = w.material?.id
    if (GLASS_MATERIAL_IDS.has(materialId)) continue
    const x1 = w.startX * pxToM, z1 = w.startY * pxToM
    const x2 = w.endX * pxToM, z2 = w.endY * pxToM
    const length = Math.hypot(x2 - x1, z2 - z1)
    if (length === 0) continue
    const top = w.topHeight ?? 3
    const bottom = w.bottomHeight ?? 0
    const height = Math.max(top - bottom, 0.01)
    const geometry = buildWallGeometry(length, height, w.openings, bottom, w.thicknessM ?? DEFAULT_WALL_THICKNESS_M)
    const pose = {
      center: [(x1 + x2) / 2, bottom + height / 2, (z1 + z2) / 2],
      rotationY: -Math.atan2(z2 - z1, x2 - x1),
      halfH: height / 2,
      contact: Math.abs(bottom) <= ON_FLOOR_EPS_M ? 1 : 0,
    }
    const color = w.material?.color ?? DEFAULT_WALL_COLOR
    const key = `${materialId ?? ''}|${color}`
    let g = groups.get(key)
    if (!g) {
      g = { key, tint: wallTint(color), surface: getWallSurface(materialId), parts: [] }
      groups.set(key, g)
    }
    g.parts.push({ geometry, pose })
    edgeParts.push({ geometry: new THREE.EdgesGeometry(geometry, 1), pose })
  }

  const bodies = []
  for (const g of groups.values()) {
    let n = 0
    for (const { geometry } of g.parts) n += geometry.attributes.position.count
    const pos = new Float32Array(n * 3)
    const nor = new Float32Array(n * 3)
    const uv = new Float32Array(n * 2)
    const up = new Float32Array(n)
    const contact = new Float32Array(n)
    let o = 0
    for (const { geometry, pose } of g.parts) {
      const p = geometry.attributes.position
      const nm = geometry.attributes.normal
      const tex = geometry.attributes.uv
      _q.setFromAxisAngle(_yAxis, pose.rotationY)
      for (let i = 0; i < p.count; i++, o++) {
        _p.fromBufferAttribute(p, i)
        up[o] = _p.y + pose.halfH
        contact[o] = pose.contact
        _p.applyQuaternion(_q)
        pos[o * 3] = _p.x + pose.center[0]
        pos[o * 3 + 1] = _p.y + pose.center[1]
        pos[o * 3 + 2] = _p.z + pose.center[2]
        _n.fromBufferAttribute(nm, i).applyQuaternion(_q)
        nor[o * 3] = _n.x
        nor[o * 3 + 1] = _n.y
        nor[o * 3 + 2] = _n.z
        uv[o * 2] = tex.getX(i)
        uv[o * 2 + 1] = tex.getY(i)
      }
      geometry.dispose()
    }
    const merged = new THREE.BufferGeometry()
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    merged.setAttribute('aWallUp', new THREE.BufferAttribute(up, 1))
    merged.setAttribute('aWallContact', new THREE.BufferAttribute(contact, 1))
    merged.computeBoundingSphere()
    bodies.push({ key: g.key, tint: g.tint, surface: g.surface, geometry: merged })
  }

  let edges = null
  if (edgeParts.length) {
    let n = 0
    for (const { geometry } of edgeParts) n += geometry.attributes.position.count
    const pos = new Float32Array(n * 3)
    let o = 0
    for (const { geometry, pose } of edgeParts) {
      const p = geometry.attributes.position
      _q.setFromAxisAngle(_yAxis, pose.rotationY)
      for (let i = 0; i < p.count; i++, o++) {
        _p.fromBufferAttribute(p, i).applyQuaternion(_q)
        pos[o * 3] = _p.x + pose.center[0]
        pos[o * 3 + 1] = _p.y + pose.center[1]
        pos[o * 3 + 2] = _p.z + pose.center[2]
      }
      geometry.dispose()
    }
    edges = new THREE.BufferGeometry()
    edges.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    edges.computeBoundingSphere()
  }

  return {
    bodies,
    edges,
    dispose() {
      for (const b of bodies) b.geometry.dispose()
      if (edges) edges.dispose()
    },
  }
}

function MergedWalls({ walls, pxToM, dimOpacity }) {
  const batch = useMemo(() => buildMergedWalls(walls, pxToM), [walls, pxToM])
  React.useEffect(() => () => batch.dispose(), [batch])
  const transparent = dimOpacity < 1
  return (
    <>
      {batch.bodies.map((b) => (
        <mesh key={b.key} castShadow receiveShadow raycast={() => null}>
          <primitive object={b.geometry} attach="geometry" />
          {/* Same props as WallMesh's opaque material (never selected or
              hovered here, so no emissive). */}
          <meshStandardMaterial
            color={b.tint}
            map={b.surface.map}
            bumpMap={b.surface.bumpMap}
            bumpScale={b.surface.bumpScale}
            roughness={b.surface.roughness}
            metalness={b.surface.metalness}
            side={THREE.DoubleSide}
            forceSinglePass
            transparent={transparent}
            opacity={dimOpacity}
            depthWrite={!transparent}
            onBeforeCompile={mergedWallAOPatch}
          />
        </mesh>
      ))}
      {batch.edges && (
        <lineSegments raycast={() => null}>
          <primitive object={batch.edges} attach="geometry" />
          <lineBasicMaterial color={EDGE_COLOR} transparent opacity={0.4 * dimOpacity} />
        </lineSegments>
      )}
    </>
  )
}

export default function WallLayer3D({ floorId, pxToM, dimOpacity = 1, isActiveFloor = true, selectable = true }) {
  const walls = useWallStore((s) => s.wallsByFloor[floorId] ?? EMPTY)
  if (!walls.length || !pxToM) return null
  return (
    <group>
      {walls.map((w) => (
        <WallMesh key={w.id} wall={w} pxToM={pxToM} dimOpacity={dimOpacity} isActiveFloor={isActiveFloor} selectable={selectable} merged={!isActiveFloor} />
      ))}
      {!isActiveFloor && <MergedWalls walls={walls} pxToM={pxToM} dimOpacity={dimOpacity} />}
    </group>
  )
}
