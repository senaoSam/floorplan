import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import Label3D from './Label3D'
import { claimPointerForUi } from './tabPointerGuard'

// Phase 56 — clickable floor tabs around the outside of the stack, like the
// storey markers on the side of a building.
//
// The Phase 55 rail already switches floors from a fixed place on screen.
// This is the other half: while you are looking AT the model — reading a
// heatmap, following a cable run — the floor you want is right there beside
// the storey it belongs to, so switching costs no trip to the screen edge and
// no hunt for which row of a list is which slab in front of you.
//
// Every storey carries a tab on two OPPOSITE sides. Earlier takes hung a
// single column off one flank and chose that flank from the camera angle;
// whatever rule picked it, tabs appeared and moved as the user orbited, and a
// control that comes and goes for reasons the user never asked about is worse
// than one that is simply always there.
//
// Two opposite sides rather than all four: because they face away from each
// other, one of them is always on the near side of the building whatever the
// camera does, so nothing has to be switched, settled or faded. Four columns
// gave the same guarantee twice over and put three or four pills of the same
// storey on screen at once, which read as clutter over the plan.
//
// Mounted as a sibling of the FloorStacks rather than inside them: a stack
// carries that floor's align rotation/scale (a floor aligned at 30° in 2D
// rotates its whole group), and tabs that inherited per-floor skew would
// wander off the building and size differently storey to storey.

// How far the tabs sit outside the slab edge, in metres. Small on purpose:
// the tabs read as labels stuck to each plate, so the gap only has to clear
// the slab outline.
const TAB_EDGE_GAP_M = 0.55

// Tab height above its floor's slab. Slightly up from the slab so the tab
// sits beside the storey's volume, not buried in the floor plane.
const TAB_LIFT_M = 0.9

// Tab sizing. These are metres AT REFERENCE_DIST_M; each tab is rescaled every
// frame by its own distance to the camera, so a tab keeps the same size on
// screen wherever the camera is.
//
// Fixed screen size rather than true perspective scaling, which this started
// as: at 3 m per storey a five-floor column sat ~48 px apart on screen with
// hit areas about that big, so neighbouring tabs touched and clicks landed on
// the wrong floor — and pulled back far enough to frame a building, the labels
// were too small to read. These are controls first; being convincingly "in
// the scene" is worth less than being legible and hittable at any zoom.
//
// 23.5 rather than 40, which is the same geometry ~70% larger: `k` is
// distance / REFERENCE_DIST_M, so a SMALLER reference means a bigger tab at
// the same camera distance. At 40 the pills were legible but small enough
// that picking a storey took aim. One `k` drives the pill and the hit plane
// together, so the clickable area grows with the label.
const REFERENCE_DIST_M = 23.5

const TAB_HEIGHT_M = 0.62
const TAB_HEIGHT_ACTIVE_M = 0.78
const TAB_HEIGHT_HOVER_M = 0.72

// Clamp so an extreme zoom doesn't make the tabs absurd in either direction.
const TAB_SCALE_MIN = 0.45
const TAB_SCALE_MAX = 3.5

// Pointer cursor while hovering a tab. r3f has no cursor concept — the canvas
// is one element, so this writes its CSS cursor directly.
//
// Ref-counted because the tabs overlap: moving between two of them fires the
// new tab's pointerover before the old one's pointerout, and a plain
// set-on-enter / clear-on-leave pair would let that trailing leave wipe the
// cursor the tab under the pointer had just set. Counting means the cursor
// only resets once nothing is hovered.
let cursorRefs = 0

function pushPointerCursor(gl) {
  cursorRefs += 1
  if (gl?.domElement) gl.domElement.style.cursor = 'pointer'
}

function popPointerCursor(gl) {
  cursorRefs = Math.max(0, cursorRefs - 1)
  if (cursorRefs === 0 && gl?.domElement) gl.domElement.style.cursor = ''
}

// The hit target is an invisible plane rather than the label sprite. Sprites
// are billboarded by the renderer, so raycasting one is fiddly and its size
// changes with the label text; a plane we place ourselves keeps the clickable
// area the same for "1F" and "B2 停車場", and stays comfortably larger than
// the pill so the tab is easy to hit at a distance.
const HIT_W = 1.9
const HIT_H = 0.8

// One tab: the label and its click/hover target.
//
// No connector line back to the slab. That was needed when the tabs stood off
// the building's corner and read as floating; hugging the edge, each tab is
// already touching the plate it names, and the lines were long diagonals that
// added clutter without adding information.
function FloorTab({ name, tabPos, active, onSelect, onHoverChange, hovered }) {
  const baseHeight = active ? TAB_HEIGHT_ACTIVE_M : hovered ? TAB_HEIGHT_HOVER_M : TAB_HEIGHT_M
  const { camera, gl } = useThree()
  const [k, setK] = useState(1)
  // Whether THIS tab currently holds a cursor reference, so unmounting while
  // hovered (switching floors re-renders the tower) releases it instead of
  // leaving the canvas stuck on a pointer.
  const holdsCursor = useRef(false)

  const grabCursor = () => {
    if (holdsCursor.current) return
    holdsCursor.current = true
    pushPointerCursor(gl)
  }
  const releaseCursor = () => {
    if (!holdsCursor.current) return
    holdsCursor.current = false
    popPointerCursor(gl)
  }
  useEffect(() => releaseCursor, [])

  // Distance-compensating scale, recomputed per frame. Applied to the pill and
  // the hit plane together so they stay in register — scaling only the sprite
  // (via sizeAttenuation) would leave the clickable area shrinking with
  // distance, which is the half that matters.
  useFrame(() => {
    const dx = camera.position.x - tabPos[0]
    const dy = camera.position.y - tabPos[1]
    const dz = camera.position.z - tabPos[2]
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const next = Math.min(TAB_SCALE_MAX, Math.max(TAB_SCALE_MIN, d / REFERENCE_DIST_M))
    // Only re-render when it actually moves the tab; distance jitters slightly
    // every frame and a setState per frame would churn the whole tower.
    setK((prev) => (Math.abs(prev - next) > 0.01 ? next : prev))
  })

  const height = baseHeight * k
  return (
    <group>
      <Label3D
        text={name}
        position={tabPos}
        heightM={height}
        // The pill is decoration; the plane below is the control. Without
        // this the sprite raycasts first (it ignores depth) and swallows the
        // clicks meant for the tab.
        interactive={false}
        // Selected tabs paint the pill itself blue with dark text, rather
        // than sitting a blue plate behind a dark pill — that read as a
        // highlight bar behind the label instead of a selected label.
        variant={active ? 'accent' : 'plain'}
        // Non-active tabs stay legible rather than fading like the storeys
        // they mark: a control you cannot read is not a control.
        opacity={active ? 1 : hovered ? 1 : 0.82}
      />
      <mesh
        position={tabPos}
        onPointerOver={(e) => { e.stopPropagation(); grabCursor(); onHoverChange(true) }}
        onPointerOut={(e) => { e.stopPropagation(); releaseCursor(); onHoverChange(false) }}
        // Claim the gesture before OrbitControls' own canvas listener reads
        // it as the user grabbing the camera — otherwise the lift this click
        // is about to request gets cancelled the moment it starts.
        onPointerDown={(e) => { e.stopPropagation(); claimPointerForUi() }}
        onClick={(e) => { e.stopPropagation(); onSelect() }}
      >
        <planeGeometry args={[HIT_W * k, HIT_H * k]} />
        {/* Invisible but still raycastable. `visible={false}` would take it
            out of raycasting too, so it is a fully transparent material. */}
        <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

export default function FloorTabTower3D({ floors, elevations, activeFloorId, floorSizes, onSelect }) {
  // Hover is keyed on the FLOOR, not the tab: a storey's four tabs are one
  // control shown four times, so pointing at any of them lights all four and
  // the feedback is the same wherever the user happens to be looking.
  const [hoveredId, setHoveredId] = useState(null)

  // Building footprint across every visible floor, so the tabs sit outside the
  // whole stack rather than clipping into a storey wider than the one they are
  // anchored to.
  const bounds = useMemo(() => {
    let maxW = 0, maxD = 0
    for (const f of floors) {
      const s = floorSizes[f.id]
      if (!s) continue
      if (s.w > maxW) maxW = s.w
      if (s.h > maxD) maxD = s.h
    }
    return { w: maxW, d: maxD }
  }, [floors, floorSizes])

  // Midpoint of the two long edges, with the outward normal to push along.
  // The pair is chosen on the footprint's proportions: tabs go on the LONG
  // sides, so the column runs along the face that has the most room and the
  // building's narrow ends stay clear.
  const sides = useMemo(() => {
    const { w, d } = bounds
    return w >= d
      ? [
        { edge: [w / 2, 0], dir: [0, -1] },
        { edge: [w / 2, d], dir: [0, 1] },
      ]
      : [
        { edge: [w, d / 2], dir: [1, 0] },
        { edge: [0, d / 2], dir: [-1, 0] },
      ]
  }, [bounds])

  const tabs = useMemo(() => {
    if (!floors.length || !bounds.w || !bounds.d) return []
    const out = []
    for (const f of floors) {
      const y = (elevations[f.id] ?? 0) + TAB_LIFT_M
      for (let i = 0; i < sides.length; i++) {
        const s = sides[i]
        out.push({
          key: `${f.id}:${i}`,
          floorId: f.id,
          name: f.name,
          pos: [
            s.edge[0] + s.dir[0] * TAB_EDGE_GAP_M,
            y,
            s.edge[1] + s.dir[1] * TAB_EDGE_GAP_M,
          ],
        })
      }
    }
    return out
  }, [floors, elevations, sides, bounds])

  if (!tabs.length) return null

  return (
    <group>
      {tabs.map((t) => (
        <FloorTab
          key={t.key}
          name={t.name}
          tabPos={t.pos}
          active={t.floorId === activeFloorId}
          hovered={hoveredId === t.floorId}
          onHoverChange={(on) => setHoveredId((prev) => (on ? t.floorId : prev === t.floorId ? null : prev))}
          onSelect={() => onSelect(t.floorId)}
        />
      ))}
    </group>
  )
}
