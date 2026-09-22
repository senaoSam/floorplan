import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Phase 55 — vertical floor rail pinned to the right edge of the 3D viewer.
//
// Replaces the 28-2 FloorSelector dropdown: same job (switch active floor from
// a fixed screen position) but readable at a glance instead of behind a click,
// and draggable, so scanning a tall building is one gesture rather than one
// click per storey.
//
// Deliberately a 2D DOM overlay rather than world-space geometry: it never
// rotates out of view, never ends up behind the building, and doesn't have to
// look like it belongs in a scene whose other objects are all real things
// (slabs, walls, APs). The in-scene counterpart — clickable floor tabs on the
// stack itself — is Phase 56, and shares this rail's active-floor styling so
// the two read as two views of one thing rather than two separate controls.

// Rail geometry. Cells are fixed-height rather than stretched to fill: a
// two-storey building shouldn't get 300px-tall cells, and a twenty-storey one
// scrolls (below) rather than shrinking its labels to nothing.
const CELL_H = 30

// Above this many floors the rail scrolls instead of growing past the viewer.
// The rail is centred vertically, so its height is what has to stay bounded.
const MAX_VISIBLE_CELLS = 12

export default function FloorElevatorRail({
  floors,
  activeFloorId,
  onSelect,
  onDraggingChange,
  showAllFloors,
  onToggleAllFloors,
}) {
  const cellsRef = useRef(null)
  // Drag state lives in a ref, not state: the pointer handlers need the
  // current value synchronously and re-rendering per pointermove would fight
  // the 3D canvas for frame budget.
  const dragRef = useRef({ active: false, pointerId: null, lastId: null })
  const [dragging, setDragging] = useState(false)

  // Report drag start/end upward so CameraRig can hold the floor-change lift
  // (Phase 55 decision 5). Kept in an effect rather than called inline from
  // the pointer handlers so the parent only ever sees transitions, and only
  // after this component has actually committed the state.
  const onDraggingChangeRef = useRef(onDraggingChange)
  onDraggingChangeRef.current = onDraggingChange
  useEffect(() => {
    onDraggingChangeRef.current?.(dragging)
  }, [dragging])

  // Top-down: highest floor first. Matches SidebarLeft, the old FloorSelector,
  // and the 3D stack itself (floors[0] sits on the ground). Reverse for render
  // only — every callback carries floor.id, so no index bookkeeping.
  const topDown = useMemo(() => floors.slice().reverse(), [floors])

  const scrolls = topDown.length > MAX_VISIBLE_CELLS

  // Which floor a pointer at this client Y is over. Reads the live cell rects
  // so it stays correct when the rail scrolls or the window resizes.
  const floorIdAtClientY = useCallback((clientY) => {
    const host = cellsRef.current
    if (!host) return null
    const cells = host.children
    if (!cells.length) return null
    // Clamp to the ends rather than returning null past them: dragging off the
    // top should pin to the top floor, not stall at wherever it left.
    const first = cells[0].getBoundingClientRect()
    const last = cells[cells.length - 1].getBoundingClientRect()
    if (clientY <= first.top) return cells[0].dataset.floorId
    if (clientY >= last.bottom) return cells[cells.length - 1].dataset.floorId
    for (const cell of cells) {
      const r = cell.getBoundingClientRect()
      if (clientY >= r.top && clientY < r.bottom) return cell.dataset.floorId
    }
    return null
  }, [])

  const commit = useCallback((floorId) => {
    if (!floorId) return
    // Only fire on an actual change of cell. setActiveFloor kicks off a camera
    // tween and remounts the heatmap plane; re-firing it for every pointermove
    // inside one cell would restart both dozens of times per drag.
    if (floorId === dragRef.current.lastId) return
    dragRef.current.lastId = floorId
    onSelect(floorId)
  }, [onSelect])

  const onPointerDown = useCallback((e) => {
    // Left button only — right-click belongs to the canvas context menu.
    if (e.button !== 0) return
    const id = floorIdAtClientY(e.clientY)
    if (!id) return
    dragRef.current = { active: true, pointerId: e.pointerId, lastId: null }
    setDragging(true)
    // Capture on the rail so the drag survives the pointer leaving it — the
    // useful gesture is a mostly-vertical swipe, which drifts sideways over
    // the 3D canvas and would otherwise drop the drag mid-scan.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* no capture support */ }
    commit(id)
    e.preventDefault()
  }, [commit, floorIdAtClientY])

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current.active || e.pointerId !== dragRef.current.pointerId) return
    commit(floorIdAtClientY(e.clientY))
  }, [commit, floorIdAtClientY])

  const endDrag = useCallback((e) => {
    if (!dragRef.current.active) return
    if (e && e.pointerId !== dragRef.current.pointerId) return
    dragRef.current = { active: false, pointerId: null, lastId: null }
    setDragging(false)
  }, [])

  // A drag can also end with the pointer released outside the window, where no
  // pointerup reaches the rail. Without this the rail would stay stuck in its
  // dragging state (camera tween suppressed) until the next click.
  useEffect(() => {
    if (!dragging) return
    const onWindowUp = () => endDrag(null)
    window.addEventListener('pointerup', onWindowUp)
    window.addEventListener('pointercancel', onWindowUp)
    return () => {
      window.removeEventListener('pointerup', onWindowUp)
      window.removeEventListener('pointercancel', onWindowUp)
    }
  }, [dragging, endDrag])

  // Keep the active cell in view when the rail scrolls — switching floors from
  // SidebarLeft or the 3D tabs shouldn't leave the rail's highlight offscreen.
  useEffect(() => {
    if (!scrolls || dragRef.current.active) return
    const host = cellsRef.current
    if (!host) return
    for (const cell of host.children) {
      if (cell.dataset.floorId === activeFloorId) {
        cell.scrollIntoView({ block: 'nearest' })
        break
      }
    }
  }, [activeFloorId, scrolls])

  if (!floors.length) return null

  return (
    <div
      className={`viewer3d__rail${dragging ? ' viewer3d__rail--dragging' : ''}`}
      // The rail is a control surface, so it owns its pointer events; the
      // wrapper around it stays transparent to clicks meant for the canvas.
      data-dragging={dragging ? 'true' : undefined}
    >
      {/* Scope switch — moved here from the 3D panel (Phase 55 decision 6).
          It belongs with the floor list: "which floor" and "one or all of
          them" are the same question asked two ways.

          A two-segment switch rather than one toggling button. A single
          button has to answer "am I showing the current state or the state
          I'd switch to?" with a tooltip; showing both options and lighting
          the live one answers it at a glance. Labels are two characters so
          the pair fits the rail's width without widening it.

          Each segment is its own button and only fires when it isn't already
          the live one, so clicking the lit half is inert instead of toggling
          away from what the user just asked for. */}
      <div className="viewer3d__rail-scope" role="group" aria-label="樓層顯示範圍">
        <button
          type="button"
          className={`viewer3d__rail-seg${showAllFloors ? ' viewer3d__rail-seg--on' : ''}`}
          onClick={() => { if (!showAllFloors) onToggleAllFloors() }}
          title="顯示全部樓層"
          aria-pressed={showAllFloors}
        >
          全樓
        </button>
        <button
          type="button"
          className={`viewer3d__rail-seg${!showAllFloors ? ' viewer3d__rail-seg--on' : ''}`}
          onClick={() => { if (showAllFloors) onToggleAllFloors() }}
          title="只顯示當前樓層"
          aria-pressed={!showAllFloors}
        >
          單層
        </button>
      </div>

      <div
        ref={cellsRef}
        className={`viewer3d__rail-cells${scrolls ? ' viewer3d__rail-cells--scroll' : ''}`}
        style={scrolls ? { maxHeight: `${MAX_VISIBLE_CELLS * CELL_H}px` } : undefined}
        role="listbox"
        aria-label="樓層選擇"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {topDown.map((floor) => {
          const isActive = floor.id === activeFloorId
          return (
            <div
              key={floor.id}
              data-floor-id={floor.id}
              role="option"
              aria-selected={isActive}
              className={`viewer3d__rail-cell${isActive ? ' viewer3d__rail-cell--active' : ''}`}
              style={{ height: `${CELL_H}px` }}
              title={floor.name}
            >
              <span className="viewer3d__rail-cell-label">{floor.name}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
