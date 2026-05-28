import { Container, Graphics } from 'pixi.js'
import { DropShadowFilter } from 'pixi-filters'
import { useEditorStore } from '@/store/useEditorStore'
import { useDraftStore } from '@/store/useDraftStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useDragOverlayStore, isAnyBodyDragging } from '@/store/useDragOverlayStore'
import { getModeCapability } from '@/render/modeCapabilities'

// Floor-hole adapter — per-hole interactive Container with click-select +
// right-click context menu. Per spec §3.3 the scopes / floorHoles / refWall
// / refVector all share layer 5. Colours match oldSrc FloorHoleLayer:
// violet fill + solid purple stroke. Distinguishes "void / atrium" from
// scope evaluation regions (green/red).

// Visual constants ported 1:1 from oldSrc/features/editor/layers/FloorHoleLayer.jsx
//   normal: violet stroke 3 px, dashed [10, 4], low-alpha violet fill
//   hover : white stroke 4 px, dashed [10, 4], brighter violet fill (0.5 alpha)
//   selected: red stroke 4 px, dashed [10, 4], fill unchanged
const HOLE_FILL            = 'rgba(124, 58, 237, 0.20)'
const HOLE_FILL_HOVER      = 'rgba(124, 58, 237, 0.50)'
const HOLE_STROKE          = '#7c3aed'
const HOLE_STROKE_WIDTH    = 3   // oldSrc normal stroke 3 (was 2 — fix)
const HOLE_STROKE_EMPHASIS = 4
const SELECT_STROKE        = '#e74c3c'
const HOVER_STROKE         = '#ffffff'
const DASH_ON              = 10
const DASH_OFF             = 4

// Dashed-polygon stroke (PIXI v8 stroke() has no native dash). Walks the
// polygon edge-by-edge laying alternating on/off segments. Same helper
// scopesLayer uses for out-scope; inlined here so each layer can tweak
// dash pattern independently.
function drawDashedPolygon(g, flat, dashOn, dashOff, opts) {
  if (!flat || flat.length < 4) return
  const n = flat.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const cx = flat[i * 2], cy = flat[i * 2 + 1]
    const tx = flat[j * 2], ty = flat[j * 2 + 1]
    const len = Math.hypot(tx - cx, ty - cy)
    if (len <= 1e-9) continue
    const ux = (tx - cx) / len
    const uy = (ty - cy) / len
    let cursor = 0
    let phaseOn = true
    let remain = dashOn
    while (cursor < len) {
      const step = Math.min(len - cursor, remain)
      const x1 = cx + ux * cursor
      const y1 = cy + uy * cursor
      const x2 = cx + ux * (cursor + step)
      const y2 = cy + uy * (cursor + step)
      if (phaseOn) g.moveTo(x1, y1).lineTo(x2, y2).stroke(opts)
      cursor += step
      remain -= step
      if (remain <= 1e-9) {
        phaseOn = !phaseOn
        remain = phaseOn ? dashOn : dashOff
      }
    }
  }
}

function makePolygonHitArea(flat) {
  return {
    contains(px, py) {
      if (!flat || flat.length < 6) return false
      const n = flat.length / 2
      let inside = false
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = flat[i * 2],     yi = flat[i * 2 + 1]
        const xj = flat[j * 2],     yj = flat[j * 2 + 1]
        const intersect = ((yi > py) !== (yj > py)) &&
          (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi)
        if (intersect) inside = !inside
      }
      return inside
    },
  }
}

export function attachFloorHolesLayer({ scene, useFloorStore, useFloorHoleStore }) {
  const layer = scene.layers.scopes
  layer.eventMode = 'passive'

  const containers = new Map()

  const ensureContainer = (hole, floorId) => {
    let entry = containers.get(hole.id)
    if (!entry) {
      const c = new Container()
      c.eventMode = 'static'
      c.cursor = 'pointer'
      const g = new Graphics()
      g.eventMode = 'none'
      c.addChild(g)
      // oldSrc shadowColor/Blur/Offset on the Konva Line — port via
      // per-container DropShadowFilter (drawHole mutates per state).
      const shadow = new DropShadowFilter({
        color: 0x000000, alpha: 0.6, blur: 1, offset: { x: 0, y: 0 }, quality: 3,
      })
      c.filters = [shadow]
      layer.addChild(c)
      entry = { container: c, graphics: g, shadow, hole, floorId }
      containers.set(hole.id, entry)
      bindInteractions(entry)
    } else {
      entry.hole = hole
      entry.floorId = floorId
    }
    return entry
  }

  const removeContainer = (id) => {
    const entry = containers.get(id)
    if (!entry) return
    layer.removeChild(entry.container)
    entry.container.destroy({ children: true })
    containers.delete(id)
  }

  const drawHole = (entry) => {
    const { graphics, container, shadow, hole } = entry
    const flat = hole.points?.slice() ?? []
    if (flat.length < 6) return
    const editorState = useEditorStore.getState()
    const hoverState = useHoverStore.getState()
    const isSelected = editorState.selectedId === hole.id && editorState.selectedType === 'floor_hole'
    const isHovered  = hoverState.id === hole.id && hoverState.type === 'floor_hole'
    const isInvert   = isHovered && !isSelected

    if (shadow) {
      if (isInvert) {
        shadow.color = 0xffffff
        shadow.alpha = 0.9
        shadow.blur  = 2
      } else {
        shadow.color = 0x000000
        shadow.alpha = 0.6
        shadow.blur  = 1
      }
    }

    graphics.clear()
    graphics.poly(flat).fill({ color: isInvert ? HOLE_FILL_HOVER : HOLE_FILL, alpha: 1 })
    const stroke = isSelected ? SELECT_STROKE : (isInvert ? HOVER_STROKE : HOLE_STROKE)
    const width  = (isSelected || isInvert) ? HOLE_STROKE_EMPHASIS : HOLE_STROKE_WIDTH
    // oldSrc renders the floor-hole outline ALWAYS dashed [10, 4] —
    // regardless of selected / hover state. The dash signals "this is
    // a void" even when emphasised.
    drawDashedPolygon(graphics, flat, DASH_ON, DASH_OFF, { width, color: stroke, alpha: 1 })

    container.hitArea = makePolygonHitArea(flat)
  }

  const bindInteractions = (entry) => {
    const { container } = entry
    container.on('pointerdown', (e) => {
      if (typeof window !== 'undefined' && window.__debugRMB === true) {
        console.log('[RMB hole] pointerdown id=', entry.hole.id, 'btn=', e.button)
      }
      if (e.button === 2) {
        const draft = useDraftStore.getState()
        if (draft.mode != null && draft.points.length > 0) return
        e.stopPropagation()
        useEditorStore.getState().openContextMenu({
          targetType: 'floor_hole',
          targetId: entry.hole.id,
          screenX: e.originalEvent?.clientX ?? 0,
          screenY: e.originalEvent?.clientY ?? 0,
        })
        return
      }
      if ((e.button ?? 0) !== 0) return
      const cap = getModeCapability(useEditorStore.getState().editorMode)
      if (!cap.allowSelectClick.struct) return
      e.stopPropagation()
      useEditorStore.getState().setSelected(entry.hole.id, 'floor_hole')
      beginHoleDrag(entry, e)
    })
    container.on('pointerover', () => {
      if (isAnyBodyDragging()) return
      const cap = getModeCapability(useEditorStore.getState().editorMode)
      if (!cap.allowSelectHover.struct && !cap.allowCommandHover.struct) return
      useHoverStore.getState().setHover(entry.hole.id, 'floor_hole')
    })
    container.on('pointerout', () => useHoverStore.getState().clearHoverIf(entry.hole.id))
  }

  const DRAG_COMMIT_THRESHOLD_PX = 1
  const beginHoleDrag = (entry, downEvent) => {
    const startWorld = scene.world.toLocal(downEvent.global)
    const stage = scene.app.stage
    const onMove = (e) => {
      const wp = scene.world.toLocal(e.global)
      const dx = wp.x - startWorld.x
      const dy = wp.y - startWorld.y
      useDragOverlayStore.getState().setHole({ id: entry.hole.id, dx, dy })
    }
    const onUp = () => {
      const overlay = useDragOverlayStore.getState().hole
      stage.off('pointermove', onMove)
      stage.off('pointerup', onUp)
      stage.off('pointerupoutside', onUp)
      if (overlay && overlay.id === entry.hole.id) {
        const moved = Math.hypot(overlay.dx, overlay.dy)
        if (moved > DRAG_COMMIT_THRESHOLD_PX) {
          const cur = useFloorHoleStore.getState().floorHolesByFloor[entry.floorId]?.find((h) => h.id === entry.hole.id)
          if (cur) {
            const newPoints = []
            for (let i = 0; i < cur.points.length; i += 2) {
              newPoints.push(cur.points[i] + overlay.dx, cur.points[i + 1] + overlay.dy)
            }
            useFloorHoleStore.getState().updateFloorHole(entry.floorId, entry.hole.id, { points: newPoints })
          }
        }
      }
      useDragOverlayStore.getState().setHole(null)
    }
    stage.on('pointermove', onMove)
    stage.on('pointerup', onUp)
    stage.on('pointerupoutside', onUp)
  }

  let lastFloorId = undefined
  let lastHoles = undefined

  const reconcile = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const holes = useFloorHoleStore.getState().floorHolesByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && holes === lastHoles) {
      applyDragOverlay()
      return
    }
    lastFloorId = activeFloorId
    lastHoles = holes
    const next = new Set(holes.map((h) => h.id))
    for (const id of Array.from(containers.keys())) {
      if (!next.has(id)) removeContainer(id)
    }
    for (const hole of holes) {
      const entry = ensureContainer(hole, activeFloorId)
      drawHole(entry)
    }
    applyDragOverlay()
  }

  let lastDragId = null
  const applyDragOverlay = () => {
    const drag = useDragOverlayStore.getState().hole
    if (lastDragId && (!drag || drag.id !== lastDragId)) {
      const prev = containers.get(lastDragId)
      if (prev) prev.container.position.set(0, 0)
    }
    lastDragId = drag?.id ?? null
    if (drag) {
      const entry = containers.get(drag.id)
      if (entry) entry.container.position.set(drag.dx, drag.dy)
    }
  }

  // Lift hovered / selected hole above sibling holes / scopes.
  const liftToTop = (entry) => {
    if (!entry || !entry.container) return
    if (entry.container.parent === layer) layer.addChild(entry.container)
  }

  let lastHoverId = useHoverStore.getState().id
  const onHoverChange = () => {
    const s = useHoverStore.getState()
    if (s.id === lastHoverId) return
    const prevId = lastHoverId
    lastHoverId = s.id
    const prev = prevId ? containers.get(prevId) : null
    const next = s.id ? containers.get(s.id) : null
    if (prev) drawHole(prev)
    if (next && next !== prev) drawHole(next)
    if (next) liftToTop(next)
  }

  let lastSelectedId = useEditorStore.getState().selectedId
  let lastSelectedType = useEditorStore.getState().selectedType
  const onEditorChange = () => {
    const s = useEditorStore.getState()
    if (s.selectedId === lastSelectedId && s.selectedType === lastSelectedType) return
    const prevId = lastSelectedId
    const prevType = lastSelectedType
    lastSelectedId = s.selectedId
    lastSelectedType = s.selectedType
    if (prevType === 'floor_hole' && prevId) {
      const e = containers.get(prevId)
      if (e) drawHole(e)
    }
    if (s.selectedType === 'floor_hole' && s.selectedId) {
      const e = containers.get(s.selectedId)
      if (e) { drawHole(e); liftToTop(e) }
    }
  }

  const unsubFloor = useFloorStore.subscribe(reconcile)
  const unsubHole = useFloorHoleStore.subscribe(reconcile)
  const unsubEditor = useEditorStore.subscribe(onEditorChange)
  const unsubHover = useHoverStore.subscribe(onHoverChange)
  const unsubDrag = useDragOverlayStore.subscribe(applyDragOverlay)
  reconcile()

  return () => {
    unsubFloor()
    unsubHole()
    unsubEditor()
    unsubHover()
    unsubDrag()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}
