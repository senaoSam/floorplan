import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js'
import { useDragOverlayStore, isAnyBodyDragging } from '@/store/useDragOverlayStore'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useDraftStore } from '@/store/useDraftStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useViewportStore } from '@/store/useViewportStore'
import { getModeCapability } from '@/render/modeCapabilities'

// Cable riser adapter — per-riser interactive Container on
// scene.layers.devicesRiser. Visuals ported 1:1 from
// oldSrc/features/editor/layers/RiserLayer.jsx:
//   * rounded square (18*s, cornerRadius 2*s) — top-down cross-section
//     of the vertical shaft. Fill #1f2937 dark slate, stroke violet
//     #a78bfa (selected → red, hover invert → fill + stroke swap).
//   * inner "+" centred in the square (violet by default).
//   * up / down filled triangles above and below the square — symbolises
//     vertical run.
//   * magnet halo: circular (riser is a point). Fill indigo @ 14%,
//     dashed stroke. Visibility from cap.showMagnet.riser.
//   * name label "<name>" or "<name> (NF)" below.

const RISER_COLOR    = '#a78bfa'
const RISER_SELECTED = '#e74c3c'
const RISER_DARK     = '#1f2937'
const MAGNET_FILL    = 'rgba(167, 139, 250, 0.14)'
const MAGNET_STROKE  = 'rgba(167, 139, 250, 0.5)'
const DRAG_COMMIT_THRESHOLD_PX = 1

const NAME_STYLE = new TextStyle({
  fill: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  align: 'center',
  dropShadow: {
    color: '#000000',
    blur: 4,
    distance: 0,
    alpha: 0.9,
  },
})

export function attachRisersLayer({ scene, useFloorStore, useCableStore }) {
  const layer = scene.layers.devicesRiser
  layer.eventMode = 'passive'

  const containers = new Map()

  const ensureContainer = (riser) => {
    let entry = containers.get(riser.id)
    if (!entry) {
      const c = new Container()
      c.eventMode = 'static'
      c.cursor = 'grab'
      const g = new Graphics()
      g.eventMode = 'none'
      const nameLabel = new Text({ text: '', style: NAME_STYLE })
      nameLabel.anchor.set(0.5, 0)
      nameLabel.eventMode = 'none'
      c.addChild(g)
      c.addChild(nameLabel)
      layer.addChild(c)
      entry = { container: c, graphics: g, nameLabel, riser }
      containers.set(riser.id, entry)
      bindInteractions(entry)
    } else {
      entry.riser = riser
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

  const drawRiser = (entry, overrideX, overrideY) => {
    const { graphics, nameLabel, container, riser } = entry
    const x = overrideX ?? riser.x
    const y = overrideY ?? riser.y
    container.position.set(x, y)
    const editor = useEditorStore.getState()
    const hover = useHoverStore.getState()
    const isSelected = editor.selectedId === riser.id && editor.selectedType === 'cable_riser'
    const isHovered  = hover.id === riser.id && hover.type === 'cable_riser'
    const isInvert   = isHovered && !isSelected
    const cap = getModeCapability(editor.editorMode)
    const magnetPolicy = cap.showMagnet?.riser ?? 'never'
    const showMagnet =
      magnetPolicy === 'all' ? true :
      magnetPolicy === 'selectedOnly' ? (isSelected || isHovered) :
      false

    // World-space size (riser container scaled by inverse viewport so
    // size stays constant in screen-px).
    const size = 18
    const magnetPx = riser.magnetDistance ?? 100
    const squareFill = isInvert ? RISER_COLOR : RISER_DARK
    const accentCol  = isSelected ? RISER_SELECTED : (isInvert ? RISER_DARK : RISER_COLOR)
    const strokeW    = isSelected ? 2.5 : isHovered ? 2 : 1.5

    graphics.clear()
    container.hitArea = new Rectangle(-size / 2 - 6, -size / 2 - 12, size + 12, size + 24)

    // Magnet halo (circular).
    if (showMagnet) {
      graphics.circle(0, 0, magnetPx).fill({ color: MAGNET_FILL, alpha: 1 })
      graphics.circle(0, 0, magnetPx).stroke({ width: 1.2, color: MAGNET_STROKE, alpha: 0.7 })
    }
    // Cross-section square.
    graphics
      .roundRect(-size / 2, -size / 2, size, size, 2)
      .fill({ color: squareFill, alpha: 1 })
      .stroke({ width: strokeW, color: accentCol, alpha: 1 })
    // Inner cross.
    graphics
      .moveTo(-size / 2 + 4, 0).lineTo(size / 2 - 4, 0)
      .stroke({ width: 1.2, color: accentCol, alpha: 1 })
    graphics
      .moveTo(0, -size / 2 + 4).lineTo(0, size / 2 - 4)
      .stroke({ width: 1.2, color: accentCol, alpha: 1 })
    // Up / down triangles.
    graphics
      .poly([0, -size / 2 - 5, -3, -size / 2 - 1, 3, -size / 2 - 1])
      .fill({ color: accentCol, alpha: 1 })
    graphics
      .poly([0, size / 2 + 5, -3, size / 2 + 1, 3, size / 2 + 1])
      .fill({ color: accentCol, alpha: 1 })
    // Name label below the square.
    const floorCount = (riser.floorIds ?? []).length
    nameLabel.text = floorCount > 0 ? `${riser.name} (${floorCount}F)` : (riser.name ?? '')
    nameLabel.position.set(0, size / 2 + 4)
  }

  const bindInteractions = (entry) => {
    const { container } = entry
    container.on('pointerdown', (e) => {
      if (e.button === 2) {
        const draft = useDraftStore.getState()
        if (draft.mode != null && draft.points.length > 0) return
        e.stopPropagation()
        useEditorStore.getState().openContextMenu({
          targetType: 'cable_riser',
          targetId: entry.riser.id,
          screenX: e.originalEvent?.clientX ?? 0,
          screenY: e.originalEvent?.clientY ?? 0,
        })
        return
      }
      if ((e.button ?? 0) !== 0) return
      // User-requested: PLACE_RISER + pointerdown on existing riser →
      // drag that riser instead of placing a new one.
      const editorMode = useEditorStore.getState().editorMode
      const cap = getModeCapability(editorMode)
      const isOwnMode = editorMode === EDITOR_MODE.PLACE_RISER
      if (!cap.allowSelectClick.cable && !isOwnMode) return
      e.stopPropagation()
      useEditorStore.getState().setSelected(entry.riser.id, 'cable_riser')
      beginDrag(entry, e)
    })
    container.on('pointerover', () => {
      if (isAnyBodyDragging()) return
      const mode = useEditorStore.getState().editorMode
      const cap = getModeCapability(mode)
      const canGrab = mode === EDITOR_MODE.SELECT || mode === EDITOR_MODE.PLACE_RISER
      container.cursor = canGrab ? 'grab' : ''
      if (!cap.allowSelectHover.cable && !cap.allowCommandHover.cable) return
      useHoverStore.getState().setHover(entry.riser.id, 'cable_riser')
    })
    container.on('pointerout', () => useHoverStore.getState().clearHoverIf(entry.riser.id))
  }

  const beginDrag = (entry, downEvent) => {
    const startWorld = scene.world.toLocal(downEvent.global)
    const startX = entry.riser.x
    const startY = entry.riser.y
    const stage = scene.app.stage
    const onMove = (e) => {
      const wp = scene.world.toLocal(e.global)
      const nx = startX + (wp.x - startWorld.x)
      const ny = startY + (wp.y - startWorld.y)
      useDragOverlayStore.getState().setRiser({ id: entry.riser.id, x: nx, y: ny })
    }
    const onUp = () => {
      const overlay = useDragOverlayStore.getState().riser
      stage.off('pointermove', onMove)
      stage.off('pointerup', onUp)
      stage.off('pointerupoutside', onUp)
      if (overlay && overlay.id === entry.riser.id) {
        const moved = Math.hypot(overlay.x - startX, overlay.y - startY)
        if (moved > DRAG_COMMIT_THRESHOLD_PX) {
          useCableStore.getState().updateRiser(entry.riser.id, { x: overlay.x, y: overlay.y })
        }
      }
      useDragOverlayStore.getState().setRiser(null)
    }
    stage.on('pointermove', onMove)
    stage.on('pointerup', onUp)
    stage.on('pointerupoutside', onUp)
  }

  let lastFloorId = undefined
  let lastRisers = undefined

  const reconcile = () => {
    const fid = useFloorStore.getState().activeFloorId
    const allRisers = useCableStore.getState().risers ?? []
    const visible = allRisers.filter((r) => (r.floorIds ?? []).includes(fid))
    if (fid === lastFloorId && allRisers === lastRisers) {
      applyDragOverlay()
      return
    }
    lastFloorId = fid
    lastRisers = allRisers
    const next = new Set(visible.map((r) => r.id))
    for (const id of Array.from(containers.keys())) {
      if (!next.has(id)) removeContainer(id)
    }
    for (const r of visible) {
      const entry = ensureContainer(r)
      drawRiser(entry)
    }
    applyDragOverlay()
  }

  let lastDragId = null
  const applyDragOverlay = () => {
    const drag = useDragOverlayStore.getState().riser
    if (lastDragId && (!drag || drag.id !== lastDragId)) {
      const prev = containers.get(lastDragId)
      if (prev) drawRiser(prev)
    }
    lastDragId = drag?.id ?? null
    if (drag) {
      const entry = containers.get(drag.id)
      if (entry) drawRiser(entry, drag.x, drag.y)
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
    if (prev) drawRiser(prev)
    if (next && next !== prev) drawRiser(next)
  }

  let lastSelId = useEditorStore.getState().selectedId
  let lastSelType = useEditorStore.getState().selectedType
  let lastMode = useEditorStore.getState().editorMode
  const onEditorChange = () => {
    const s = useEditorStore.getState()
    const sel = s.selectedId !== lastSelId || s.selectedType !== lastSelType
    const mode = s.editorMode !== lastMode
    if (!sel && !mode) return
    const prevId = lastSelId, prevType = lastSelType
    lastSelId = s.selectedId; lastSelType = s.selectedType; lastMode = s.editorMode
    if (mode) {
      for (const e of containers.values()) drawRiser(e)
      return
    }
    if (prevType === 'cable_riser' && prevId) {
      const e = containers.get(prevId)
      if (e) drawRiser(e)
    }
    if (s.selectedType === 'cable_riser' && s.selectedId) {
      const e = containers.get(s.selectedId)
      if (e) drawRiser(e)
    }
  }

  // Inverse-scale: keep glyph at constant screen size.
  const applyInverseScale = () => {
    const inv = 1 / (useViewportStore.getState().scale || 1)
    for (const e of containers.values()) e.container.scale.set(inv)
  }

  const unsubFloor = useFloorStore.subscribe(() => { reconcile(); applyInverseScale() })
  const unsubCable = useCableStore.subscribe(() => { reconcile(); applyInverseScale() })
  const unsubDrag = useDragOverlayStore.subscribe(applyDragOverlay)
  const unsubHover = useHoverStore.subscribe(onHoverChange)
  const unsubEditor = useEditorStore.subscribe(onEditorChange)
  const unsubViewport = useViewportStore.subscribe(applyInverseScale)
  reconcile()
  applyInverseScale()

  return () => {
    unsubFloor()
    unsubCable()
    unsubDrag()
    unsubHover()
    unsubEditor()
    unsubViewport()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}
