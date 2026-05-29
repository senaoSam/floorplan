import { Container, Graphics } from 'pixi.js'
import { DropShadowFilter } from 'pixi-filters'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useDraftStore } from '@/store/useDraftStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useDragOverlayStore, isAnyBodyDragging } from '@/store/useDragOverlayStore'
import { getModeCapability } from '@/render/modeCapabilities'

// Scope adapter — per-scope interactive Container with click-select,
// right-click context menu, and hover invert. Visual rules ported from
// oldSrc ScopeLayer.jsx:
//   in-scope  (type='in')  → green fill + solid green stroke
//   out-scope (type='out') → red fill + dashed red stroke
//   selected → red stroke 5 px
//   hovered  → white stroke 5 px + brighter fill (alpha 0.18 → 0.5)

const COLOR_IN_FILL          = 'rgba(46, 213, 115, 0.18)'
const COLOR_IN_FILL_HOVER    = 'rgba(46, 213, 115, 0.5)'
const COLOR_IN_STROKE        = '#2ed573'
const COLOR_OUT_FILL         = 'rgba(255, 71, 87, 0.18)'
const COLOR_OUT_FILL_HOVER   = 'rgba(255, 71, 87, 0.5)'
const COLOR_OUT_STROKE       = '#ff4757'
const SELECT_STROKE          = '#e74c3c'
const HOVER_STROKE           = '#ffffff'
const STROKE_WIDTH           = 3
const STROKE_WIDTH_EMPHASIS  = 5
const DASH_ON  = 8
const DASH_OFF = 4

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

// Even-odd point-in-polygon hit-test for the scope's flat [x,y,x,y,...]
// vertex array. Used as the Container's hitArea so right-click + click +
// hover all register anywhere inside the polygon (not just on the stroke).
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

export function attachScopesLayer({ scene, useFloorStore, useScopeStore }) {
  const layer = scene.layers.scopes
  layer.eventMode = 'passive'

  const containers = new Map()

  const ensureContainer = (scope, floorId) => {
    let entry = containers.get(scope.id)
    if (!entry) {
      const c = new Container()
      c.eventMode = 'static'
      c.cursor = 'pointer'
      const g = new Graphics()
      g.eventMode = 'none'
      c.addChild(g)
      // oldSrc Konva Line has shadowColor / shadowBlur / shadowOffset.
      // Default: black rgba(0,0,0,0.6) blur 4. Hover: white blur 8.
      // PIXI v8 doesn't ship a built-in drop shadow on Graphics, so we
      // attach a per-container DropShadowFilter that drawScope mutates
      // on state change.
      const shadow = new DropShadowFilter({
        color: 0x000000, alpha: 0.6, blur: 1, offset: { x: 0, y: 0 }, quality: 3,
      })
      c.filters = [shadow]
      layer.addChild(c)
      entry = { container: c, graphics: g, shadow, scope, floorId }
      containers.set(scope.id, entry)
      bindInteractions(entry)
    } else {
      entry.scope = scope
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

  const drawScope = (entry) => {
    const { graphics, container, shadow, scope } = entry
    const flat = scope.points?.slice() ?? []
    if (flat.length < 6) return
    const isOut = scope.type === 'out'
    const editorState = useEditorStore.getState()
    const hoverState = useHoverStore.getState()
    const isSelected = editorState.selectedId === scope.id && editorState.selectedType === 'scope'
    const isHovered  = hoverState.id === scope.id && hoverState.type === 'scope'
    const isInvert   = isHovered && !isSelected

    // Update shadow per oldSrc: hover → white blur 8, else black blur 4.
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
    const fillColor = isInvert
      ? (isOut ? COLOR_OUT_FILL_HOVER : COLOR_IN_FILL_HOVER)
      : (isOut ? COLOR_OUT_FILL       : COLOR_IN_FILL)
    graphics.poly(flat).fill({ color: fillColor, alpha: 1 })

    const baseStroke = isOut ? COLOR_OUT_STROKE : COLOR_IN_STROKE
    let stroke = baseStroke
    let width = STROKE_WIDTH
    if (isSelected) { stroke = SELECT_STROKE; width = STROKE_WIDTH_EMPHASIS }
    else if (isInvert) { stroke = HOVER_STROKE; width = STROKE_WIDTH_EMPHASIS }

    // oldSrc out-scope ALWAYS dashes [8, 4], regardless of selected /
    // hover state — the dash carries the "out" semantic. In-scope stays
    // solid in every state.
    if (isOut) {
      drawDashedPolygon(graphics, flat, DASH_ON, DASH_OFF, { width, color: stroke, alpha: 1 })
    } else {
      graphics.poly(flat).stroke({ width, color: stroke, alpha: 1 })
    }

    container.hitArea = makePolygonHitArea(flat)
  }

  const bindInteractions = (entry) => {
    const { container } = entry
    container.on('pointerdown', (e) => {
      if (typeof window !== 'undefined' && window.__debugRMB === true) {
        console.log('[RMB scope] pointerdown id=', entry.scope.id, 'btn=', e.button)
      }
      if (e.button === 2) {
        const draft = useDraftStore.getState()
        if (draft.mode != null && draft.points.length > 0) return
        e.stopPropagation()
        useEditorStore.getState().openContextMenu({
          targetType: 'scope',
          targetId: entry.scope.id,
          screenX: e.originalEvent?.clientX ?? 0,
          screenY: e.originalEvent?.clientY ?? 0,
        })
        return
      }
      if ((e.button ?? 0) !== 0) return
      // SELECT or DRAW_SCOPE → click body drags this scope. User wants
      // own-mode drag to work like DRAW_WALL / PLACE_AP. (DRAW_SCOPE
      // clicks on empty canvas still place draft polygon points — only
      // clicks landing INSIDE an existing scope hit this branch.)
      const editorMode = useEditorStore.getState().editorMode
      const cap = getModeCapability(editorMode)
      const isOwnMode = editorMode === EDITOR_MODE.DRAW_SCOPE
      if (!cap.allowSelectClick.struct && !isOwnMode) return
      e.stopPropagation()
      useEditorStore.getState().setSelected(entry.scope.id, 'scope')
      beginScopeDrag(entry, e)
    })
    container.on('pointerover', () => {
      if (isAnyBodyDragging()) return
      const mode = useEditorStore.getState().editorMode
      const cap = getModeCapability(mode)
      const canGrab = mode === EDITOR_MODE.SELECT || mode === EDITOR_MODE.DRAW_SCOPE
      container.cursor = canGrab ? 'grab' : ''
      if (!cap.allowSelectHover.struct && !cap.allowCommandHover.struct) return
      useHoverStore.getState().setHover(entry.scope.id, 'scope')
    })
    container.on('pointerout', () => useHoverStore.getState().clearHoverIf(entry.scope.id))
  }

  const DRAG_COMMIT_THRESHOLD_PX = 1
  const beginScopeDrag = (entry, downEvent) => {
    const startWorld = scene.world.toLocal(downEvent.global)
    const stage = scene.app.stage
    const onMove = (e) => {
      const wp = scene.world.toLocal(e.global)
      const dx = wp.x - startWorld.x
      const dy = wp.y - startWorld.y
      useDragOverlayStore.getState().setScope({ id: entry.scope.id, dx, dy })
    }
    const onUp = () => {
      const overlay = useDragOverlayStore.getState().scope
      stage.off('pointermove', onMove)
      stage.off('pointerup', onUp)
      stage.off('pointerupoutside', onUp)
      if (overlay && overlay.id === entry.scope.id) {
        const moved = Math.hypot(overlay.dx, overlay.dy)
        if (moved > DRAG_COMMIT_THRESHOLD_PX) {
          const cur = useScopeStore.getState().scopesByFloor[entry.floorId]?.find((s) => s.id === entry.scope.id)
          if (cur) {
            const newPoints = []
            for (let i = 0; i < cur.points.length; i += 2) {
              newPoints.push(cur.points[i] + overlay.dx, cur.points[i + 1] + overlay.dy)
            }
            useScopeStore.getState().updateScope(entry.floorId, entry.scope.id, { points: newPoints })
          }
        }
      }
      useDragOverlayStore.getState().setScope(null)
    }
    stage.on('pointermove', onMove)
    stage.on('pointerup', onUp)
    stage.on('pointerupoutside', onUp)
  }

  let lastFloorId = undefined
  let lastScopes = undefined

  const reconcile = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const scopes = useScopeStore.getState().scopesByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && scopes === lastScopes) {
      applyDragOverlay()
      return
    }
    lastFloorId = activeFloorId
    lastScopes = scopes
    const next = new Set(scopes.map((s) => s.id))
    for (const id of Array.from(containers.keys())) {
      if (!next.has(id)) removeContainer(id)
    }
    for (const scope of scopes) {
      const entry = ensureContainer(scope, activeFloorId)
      drawScope(entry)
    }
    applyDragOverlay()
    applyModeDim()
  }

  let lastDragId = null
  const applyDragOverlay = () => {
    const drag = useDragOverlayStore.getState().scope
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

  // Lift hovered / selected scope above sibling scopes / floor holes.
  const liftToTop = (entry) => {
    if (!entry || !entry.container) return
    if (entry.container.parent === layer) layer.addChild(entry.container)
  }

  // Hover / selection redraws — only redraw affected scopes.
  let lastHoverId = useHoverStore.getState().id
  const onHoverChange = () => {
    const s = useHoverStore.getState()
    if (s.id === lastHoverId) return
    const prevId = lastHoverId
    lastHoverId = s.id
    const prev = prevId ? containers.get(prevId) : null
    const next = s.id ? containers.get(s.id) : null
    if (prev) drawScope(prev)
    if (next && next !== prev) drawScope(next)
    if (next) liftToTop(next)
  }

  // Per-container alpha for sibling-type cross-dim. Scopes share the
  // `scopes` scene layer with floor-holes, so keepLayers can't dim one
  // without the other. Apply alpha at the container level instead:
  // DRAW_FLOOR_HOLE mode → all scope containers fade to 0.4 (so the
  // user focuses on hole-drawing). Other modes → 1.
  const applyModeDim = () => {
    const mode = useEditorStore.getState().editorMode
    const dim = mode === EDITOR_MODE.DRAW_FLOOR_HOLE
    for (const entry of containers.values()) {
      entry.container.alpha = dim ? 0.4 : 1
    }
  }

  let lastSelectedId = useEditorStore.getState().selectedId
  let lastSelectedType = useEditorStore.getState().selectedType
  let lastModeForDim = useEditorStore.getState().editorMode
  const onEditorChange = () => {
    const s = useEditorStore.getState()
    if (s.editorMode !== lastModeForDim) {
      lastModeForDim = s.editorMode
      applyModeDim()
    }
    if (s.selectedId === lastSelectedId && s.selectedType === lastSelectedType) return
    const prevId = lastSelectedId
    const prevType = lastSelectedType
    lastSelectedId = s.selectedId
    lastSelectedType = s.selectedType
    if (prevType === 'scope' && prevId) {
      const e = containers.get(prevId)
      if (e) drawScope(e)
    }
    if (s.selectedType === 'scope' && s.selectedId) {
      const e = containers.get(s.selectedId)
      if (e) { drawScope(e); liftToTop(e) }
    }
  }

  const unsubFloor = useFloorStore.subscribe(reconcile)
  const unsubScope = useScopeStore.subscribe(reconcile)
  const unsubEditor = useEditorStore.subscribe(onEditorChange)
  const unsubHover = useHoverStore.subscribe(onHoverChange)
  const unsubDrag = useDragOverlayStore.subscribe(applyDragOverlay)
  reconcile()

  return () => {
    unsubFloor()
    unsubScope()
    unsubDrag()
    unsubEditor()
    unsubHover()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}
