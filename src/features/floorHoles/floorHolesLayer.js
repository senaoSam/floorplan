import { Container, Graphics } from 'pixi.js'
import { useEditorStore } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'

// Floor-hole adapter — per-hole interactive Container with click-select +
// right-click context menu. Per spec §3.3 the scopes / floorHoles / refWall
// / refVector all share layer 5. Colours match oldSrc FloorHoleLayer:
// violet fill + solid purple stroke. Distinguishes "void / atrium" from
// scope evaluation regions (green/red).

const HOLE_FILL          = 'rgba(124, 58, 237, 0.20)'
const HOLE_FILL_HOVER    = 'rgba(124, 58, 237, 0.45)'
const HOLE_STROKE        = '#7c3aed'
const HOLE_STROKE_WIDTH  = 2
const HOLE_STROKE_EMPHASIS = 4
const SELECT_STROKE      = '#e74c3c'
const HOVER_STROKE       = '#ffffff'

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
      layer.addChild(c)
      entry = { container: c, graphics: g, hole, floorId }
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
    const { graphics, container, hole } = entry
    const flat = hole.points?.slice() ?? []
    if (flat.length < 6) return
    const editorState = useEditorStore.getState()
    const hoverState = useHoverStore.getState()
    const isSelected = editorState.selectedId === hole.id && editorState.selectedType === 'floor_hole'
    const isHovered  = hoverState.id === hole.id && hoverState.type === 'floor_hole'
    const isInvert   = isHovered && !isSelected

    graphics.clear()
    graphics.poly(flat).fill({ color: isInvert ? HOLE_FILL_HOVER : HOLE_FILL, alpha: 1 })
    const stroke = isSelected ? SELECT_STROKE : (isInvert ? HOVER_STROKE : HOLE_STROKE)
    const width  = (isSelected || isInvert) ? HOLE_STROKE_EMPHASIS : HOLE_STROKE_WIDTH
    graphics.poly(flat).stroke({ width, color: stroke, alpha: 1 })

    container.hitArea = makePolygonHitArea(flat)
  }

  const bindInteractions = (entry) => {
    const { container } = entry
    container.on('pointerdown', (e) => {
      if (typeof window !== 'undefined' && window.__debugRMB === true) {
        console.log('[RMB hole] pointerdown id=', entry.hole.id, 'btn=', e.button)
      }
      if (e.button === 2) {
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
      if (useEditorStore.getState().editorMode !== 'select') return
      e.stopPropagation()
      useEditorStore.getState().setSelected(entry.hole.id, 'floor_hole')
    })
    container.on('pointerover', () => useHoverStore.getState().setHover(entry.hole.id, 'floor_hole'))
    container.on('pointerout', () => useHoverStore.getState().clearHoverIf(entry.hole.id))
  }

  let lastFloorId = undefined
  let lastHoles = undefined

  const reconcile = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const holes = useFloorHoleStore.getState().floorHolesByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && holes === lastHoles) return
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
      if (e) drawHole(e)
    }
  }

  const unsubFloor = useFloorStore.subscribe(reconcile)
  const unsubHole = useFloorHoleStore.subscribe(reconcile)
  const unsubEditor = useEditorStore.subscribe(onEditorChange)
  const unsubHover = useHoverStore.subscribe(onHoverChange)
  reconcile()

  return () => {
    unsubFloor()
    unsubHole()
    unsubEditor()
    unsubHover()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}
