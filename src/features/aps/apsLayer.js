import { Container, Graphics, Circle, Text, TextStyle } from 'pixi.js'
import { useDragOverlayStore } from '@/store/useDragOverlayStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'

// AP markers adapter — per-AP interactive Container with click select,
// drag, hover, right-click context menu, frequency-colored marker, and
// name label underneath. Per-band visibility (showAPBand) + master
// showAPs handled by the layer's container.visible (master) + per-AP
// container.visible (band filter).

const FREQ_COLOR = {
  2.4: '#f39c12',
  5:   '#4fc3f7',
  6:   '#a855f7',
}
const FREQ_LABEL = {
  2.4: '2.4G',
  5:   '5G',
  6:   '6G',
}

const FALLBACK_COLOR = '#9aa3ad'
const colorForAP = (ap) => FREQ_COLOR[ap.frequency] ?? FALLBACK_COLOR
const bandLabelForAP = (ap) => FREQ_LABEL[ap.frequency] ?? ''

const AP_RADIUS = 9
const DRAG_COMMIT_THRESHOLD_PX = 1
const NAME_TEXT_STYLE = new TextStyle({
  fill: '#ffffff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  align: 'center',
  stroke: { color: '#0b0d12', width: 3, join: 'round' },
})
const BAND_TEXT_STYLE = new TextStyle({
  fill: '#0b0d12',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 8,
  fontWeight: '700',
  align: 'center',
})

export function attachAPsLayer({ scene, useFloorStore, useAPStore }) {
  const layer = scene.layers.devicesAP
  layer.eventMode = 'passive'

  // Container per AP keyed by id so we can update positions without
  // rebuilding the whole tree on drag.
  const containers = new Map()

  const ensureContainer = (ap, floorId) => {
    let entry = containers.get(ap.id)
    if (!entry) {
      const c = new Container()
      c.eventMode = 'static'
      c.cursor = 'pointer'
      c.hitArea = new Circle(0, 0, AP_RADIUS + 4)
      const g = new Graphics()
      const bandText = new Text({ text: '', style: BAND_TEXT_STYLE })
      bandText.anchor.set(0.5)
      bandText.eventMode = 'none'
      const nameText = new Text({ text: '', style: NAME_TEXT_STYLE })
      nameText.anchor.set(0.5, 0)
      nameText.y = AP_RADIUS + 5
      nameText.eventMode = 'none'
      c.addChild(g)
      c.addChild(bandText)
      c.addChild(nameText)
      layer.addChild(c)
      entry = { container: c, graphics: g, bandText, nameText, ap, floorId }
      containers.set(ap.id, entry)
      bindInteractions(entry)
    } else {
      entry.ap = ap
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

  const drawAP = (entry, overrideX, overrideY) => {
    const { graphics, bandText, nameText, ap } = entry
    const x = overrideX ?? ap.x
    const y = overrideY ?? ap.y
    entry.container.position.set(x, y)

    graphics.clear()
    graphics
      .circle(0, 0, AP_RADIUS)
      .fill({ color: colorForAP(ap), alpha: 0.95 })
      .stroke({ width: 2, color: 0xffffff, alpha: 0.9 })

    // Directional APs show a wedge in their broadcast direction. (Omni
    // / custom skipped — omni doesn't need a direction hint and custom
    // patterns need a per-pattern preview, deferred to its own bundle.)
    if (ap.antennaMode === 'directional') {
      const az = ((ap.azimuth ?? 0) - 90) * Math.PI / 180
      const half = ((ap.beamwidth ?? 60) / 2) * Math.PI / 180
      const r = AP_RADIUS + 12
      graphics.moveTo(0, 0)
        .lineTo(Math.cos(az - half) * r, Math.sin(az - half) * r)
        .arc(0, 0, r, az - half, az + half, false)
        .closePath()
        .fill({ color: colorForAP(ap), alpha: 0.18 })
    }

    bandText.text = bandLabelForAP(ap)
    nameText.text = ap.name ?? ''

    // Per-band visibility filter (read fresh each draw so toggling in
    // LayerToggle doesn't need its own subscription path).
    const showAPBand = useEditorStore.getState().showAPBand
    entry.container.visible = !!(showAPBand?.[ap.frequency] ?? true)
  }

  const bindInteractions = (entry) => {
    const { container } = entry
    container.on('pointerdown', (e) => {
      if (e.button === 2) {
        e.stopPropagation()
        useEditorStore.getState().openContextMenu({
          targetType: 'ap',
          targetId: entry.ap.id,
          screenX: e.originalEvent?.clientX ?? 0,
          screenY: e.originalEvent?.clientY ?? 0,
        })
        return
      }
      if ((e.button ?? 0) !== 0) return
      e.stopPropagation()
      useEditorStore.getState().setSelected(entry.ap.id, 'ap')
      beginDrag(entry, e)
    })
    container.on('pointerover', () => useHoverStore.getState().setHover(entry.ap.id, 'ap'))
    container.on('pointerout', () => useHoverStore.getState().clearHoverIf(entry.ap.id))
  }

  const beginDrag = (entry, downEvent) => {
    const startWorld = scene.world.toLocal(downEvent.global)
    const startAPX = entry.ap.x
    const startAPY = entry.ap.y
    const stage = scene.app.stage

    const onMove = (e) => {
      const wp = scene.world.toLocal(e.global)
      const nextX = startAPX + (wp.x - startWorld.x)
      const nextY = startAPY + (wp.y - startWorld.y)
      useDragOverlayStore.getState().setAP({ id: entry.ap.id, x: nextX, y: nextY })
    }
    const onUp = () => {
      const overlay = useDragOverlayStore.getState().ap
      stage.off('pointermove', onMove)
      stage.off('pointerup', onUp)
      stage.off('pointerupoutside', onUp)
      if (overlay && overlay.id === entry.ap.id) {
        const moved = Math.hypot(overlay.x - startAPX, overlay.y - startAPY)
        if (moved > DRAG_COMMIT_THRESHOLD_PX) {
          useAPStore.getState().updateAP(entry.floorId, entry.ap.id, {
            x: overlay.x,
            y: overlay.y,
          })
        }
      }
      useDragOverlayStore.getState().setAP(null)
    }
    stage.on('pointermove', onMove)
    stage.on('pointerup', onUp)
    stage.on('pointerupoutside', onUp)
  }

  // ── Reconciler from stores ────────────────────────────────────────────
  let lastFloorId = undefined
  let lastAPs = undefined

  const reconcile = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const aps = useAPStore.getState().apsByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && aps === lastAPs) {
      applyDragOverlay()
      return
    }
    lastFloorId = activeFloorId
    lastAPs = aps

    const next = new Set(aps.map((a) => a.id))
    for (const id of Array.from(containers.keys())) {
      if (!next.has(id)) removeContainer(id)
    }
    for (const ap of aps) {
      const entry = ensureContainer(ap, activeFloorId)
      drawAP(entry)
    }
    applyDragOverlay()
  }

  let lastDragId = null
  const applyDragOverlay = () => {
    const drag = useDragOverlayStore.getState().ap
    // When the dragged AP changes (or drag clears), restore the previous AP
    // to its store-committed position. Without this it would stay frozen at
    // the last overlay coordinates after the user releases.
    if (lastDragId && (!drag || drag.id !== lastDragId)) {
      const prev = containers.get(lastDragId)
      if (prev) drawAP(prev)
    }
    lastDragId = drag?.id ?? null
    if (drag) {
      const entry = containers.get(drag.id)
      if (entry) drawAP(entry, drag.x, drag.y)
    }
  }

  // Re-draw all when showAPBand changes so per-band visibility filter
  // applies without restructuring the container tree. Tracked by ref so
  // unrelated editor-store changes (selection / mode / hover) don't pay
  // the full redraw cost on every set.
  let lastShowAPBand = useEditorStore.getState().showAPBand
  const redrawAll = () => {
    const nextBand = useEditorStore.getState().showAPBand
    if (nextBand === lastShowAPBand) return
    lastShowAPBand = nextBand
    for (const entry of containers.values()) {
      const drag = useDragOverlayStore.getState().ap
      if (drag && drag.id === entry.ap.id) {
        drawAP(entry, drag.x, drag.y)
      } else {
        drawAP(entry)
      }
    }
  }

  const unsubFloor = useFloorStore.subscribe(reconcile)
  const unsubAP = useAPStore.subscribe(reconcile)
  const unsubDrag = useDragOverlayStore.subscribe(applyDragOverlay)
  const unsubEditor = useEditorStore.subscribe(redrawAll)
  reconcile()

  return () => {
    unsubFloor()
    unsubAP()
    unsubDrag()
    unsubEditor()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}
