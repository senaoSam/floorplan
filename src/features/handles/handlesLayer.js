import { Container, Graphics, Circle } from 'pixi.js'
import { useViewportStore } from '@/store/useViewportStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useDraftStore } from '@/store/useDraftStore'
import { EDITOR_MODE } from '@/store/useEditorStore'

// Edit handles for the selected (or hovered) wall + selected tray.
// Rendered on scene.layers.handles so they sit above object layers but
// below labels.
//
// Wall endpoint handle visuals match oldSrc EndpointHandle:
//   - Circle radius 7, fill #fff, stroke #e74c3c, strokeWidth 2.5
//   - cursor crosshair
//   - drag rewrites the endpoint; snaps to other walls' endpoints within
//     SNAP_PX_SCREEN screen-pixels
//   - double-click → enter DRAW_WALL with first point preset to endpoint
//   - shown when wall is selected OR hovered (for discoverability)
//
// Tray vertex handles: white fill + system-cyan stroke (lighter so they
// don't compete with the white tray-selected border).

const HANDLE_RADIUS = 7          // oldSrc 7 * inverseScale
const HANDLE_STROKE_WIDTH = 2.5  // oldSrc 2.5 * inverseScale
const HANDLE_HIT_PAD = 2
const WALL_HANDLE_FILL = '#ffffff'
const WALL_HANDLE_STROKE = '#e74c3c'
const TRAY_HANDLE_RADIUS = 5
const TRAY_HANDLE_STROKE_WIDTH = 1.8
const TRAY_HANDLE_FILL = '#ffffff'
const TRAY_HANDLE_STROKE = '#0e7490'

// oldSrc Editor2D SNAP_PX (= 12 screen px) — endpoint-snap radius for
// wall-handle drag, converted to world px via /viewport.scale.
const SNAP_PX_SCREEN = 12

function makeHandleDot(x, y, fill, stroke, radius, strokeWidth) {
  const c = new Container()
  c.eventMode = 'static'
  c.cursor = 'crosshair'
  c.hitArea = new Circle(0, 0, radius + HANDLE_HIT_PAD)
  c.position.set(x, y)
  const g = new Graphics()
  g.circle(0, 0, radius)
    .fill({ color: fill, alpha: 1 })
    .stroke({ width: strokeWidth, color: stroke, alpha: 1 })
  c.addChild(g)
  return c
}

export function attachHandlesLayer({
  scene,
  useFloorStore,
  useWallStore,
  useCableStore,
  useEditorStore,
}) {
  const layer = scene.layers.handles
  layer.eventMode = 'passive'

  const root = new Container()
  layer.addChild(root)

  const targetWall = () => {
    const editor = useEditorStore.getState()
    const hover = useHoverStore.getState()
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return null
    // Hide handles when not in SELECT mode (oldSrc capability.showHandles).
    if (editor.editorMode !== EDITOR_MODE.SELECT) return null
    const walls = useWallStore.getState().wallsByFloor[fid] ?? []
    // Prefer selected wall; fall back to hovered wall so the handles act
    // as a hover affordance ("you can grab this endpoint") before any
    // click has happened — matches oldSrc isSelected || isHovered.
    if (editor.selectedType === 'wall' && editor.selectedId) {
      const w = walls.find((w) => w.id === editor.selectedId)
      if (w) return w
    }
    if (hover.type === 'wall' && hover.id) {
      const w = walls.find((w) => w.id === hover.id)
      if (w) return w
    }
    return null
  }

  const rebuild = () => {
    while (root.children.length > 0) {
      const c = root.children[0]
      root.removeChild(c)
      c.destroy({ children: true })
    }

    const wall = targetWall()
    if (wall) {
      const startHandle = makeHandleDot(
        wall.startX, wall.startY,
        WALL_HANDLE_FILL, WALL_HANDLE_STROKE,
        HANDLE_RADIUS, HANDLE_STROKE_WIDTH,
      )
      const endHandle = makeHandleDot(
        wall.endX, wall.endY,
        WALL_HANDLE_FILL, WALL_HANDLE_STROKE,
        HANDLE_RADIUS, HANDLE_STROKE_WIDTH,
      )
      bindWallEndpointDrag(startHandle, wall, 'start')
      bindWallEndpointDrag(endHandle, wall, 'end')
      root.addChild(startHandle)
      root.addChild(endHandle)
      return
    }

    const { selectedId, selectedType } = useEditorStore.getState()
    if (!selectedId) return
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return

    if (selectedType === 'cable_tray') {
      const tray = (useCableStore.getState().traysByFloor[fid] ?? []).find((t) => t.id === selectedId)
      if (!tray) return
      tray.points.forEach((p, idx) => {
        const h = makeHandleDot(
          p.x, p.y,
          TRAY_HANDLE_FILL, TRAY_HANDLE_STROKE,
          TRAY_HANDLE_RADIUS, TRAY_HANDLE_STROKE_WIDTH,
        )
        bindTrayVertexDrag(h, tray, idx)
        root.addChild(h)
      })
    }
  }

  // Snap-to-endpoint while dragging a wall handle. Returns the snapped
  // {x, y} if any other wall's endpoint is within snapDist; otherwise
  // returns the original {x, y}. Mirrors oldSrc snapToEndpoint().
  const snapToEndpoint = (pos, walls, snapDist, excludeWallId) => {
    for (const w of walls) {
      if (w.id === excludeWallId) continue
      const eps = [
        { x: w.startX, y: w.startY },
        { x: w.endX,   y: w.endY   },
      ]
      for (const ep of eps) {
        if (Math.hypot(pos.x - ep.x, pos.y - ep.y) < snapDist) return ep
      }
    }
    return pos
  }

  const bindWallEndpointDrag = (handle, wall, end) => {
    let dragMoved = false

    handle.on('pointerdown', (e) => {
      if ((e.button ?? 0) !== 0) return
      e.stopPropagation()
      dragMoved = false
      const stage = scene.app.stage
      const startWorld = scene.world.toLocal(e.global)
      const original = { x: wall[end + 'X'], y: wall[end + 'Y'] }
      const fid = useFloorStore.getState().activeFloorId

      const onMove = (ev) => {
        const wp = scene.world.toLocal(ev.global)
        const raw = {
          x: original.x + (wp.x - startWorld.x),
          y: original.y + (wp.y - startWorld.y),
        }
        const moveMag = Math.hypot(raw.x - original.x, raw.y - original.y)
        if (moveMag > 0.5) dragMoved = true
        const scale = useViewportStore.getState().scale || 1
        const snapDist = SNAP_PX_SCREEN / scale
        const walls = useWallStore.getState().wallsByFloor[fid] ?? []
        const snapped = snapToEndpoint(raw, walls, snapDist, wall.id)
        handle.position.set(snapped.x, snapped.y)
        useWallStore.getState().updateWall(fid, wall.id, {
          [end + 'X']: snapped.x,
          [end + 'Y']: snapped.y,
        })
      }
      const onUp = () => {
        stage.off('pointermove', onMove)
        stage.off('pointerup', onUp)
        stage.off('pointerupoutside', onUp)
      }
      stage.on('pointermove', onMove)
      stage.on('pointerup', onUp)
      stage.on('pointerupoutside', onUp)
    })

    // Double-click → extend a new wall from this endpoint. PIXI doesn't
    // emit `dblclick`; we detect it via two `click` events within 350 ms.
    let lastClickAt = 0
    handle.on('click', (e) => {
      if ((e.button ?? 0) !== 0) return
      if (dragMoved) return
      const now = performance.now()
      const isDbl = now - lastClickAt < 350
      lastClickAt = now
      if (!isDbl) return
      e.stopPropagation()
      const endpoint = end === 'start'
        ? { x: wall.startX, y: wall.startY }
        : { x: wall.endX,   y: wall.endY   }
      const editor = useEditorStore.getState()
      editor.clearSelected?.()
      editor.setEditorMode(EDITOR_MODE.DRAW_WALL)
      useDraftStore.getState().beginDraft(EDITOR_MODE.DRAW_WALL, endpoint)
    })
  }

  const bindTrayVertexDrag = (handle, tray, vertexIdx) => {
    handle.on('pointerdown', (e) => {
      if ((e.button ?? 0) !== 0) return
      e.stopPropagation()
      const stage = scene.app.stage
      const startWorld = scene.world.toLocal(e.global)
      const original = { x: tray.points[vertexIdx].x, y: tray.points[vertexIdx].y }
      const fid = useFloorStore.getState().activeFloorId

      const onMove = (ev) => {
        const wp = scene.world.toLocal(ev.global)
        const nx = original.x + (wp.x - startWorld.x)
        const ny = original.y + (wp.y - startWorld.y)
        handle.position.set(nx, ny)
        const nextPoints = tray.points.map((p, i) => i === vertexIdx ? { x: nx, y: ny } : p)
        useCableStore.getState().updateTray(fid, tray.id, { points: nextPoints })
      }
      const onUp = () => {
        stage.off('pointermove', onMove)
        stage.off('pointerup', onUp)
        stage.off('pointerupoutside', onUp)
      }
      stage.on('pointermove', onMove)
      stage.on('pointerup', onUp)
      stage.on('pointerupoutside', onUp)
    })
  }

  // Screen-space handle sizing — each handle is a separate Container; we
  // set every child's scale to 1 / viewport.scale so they don't shrink to
  // nothing when zoomed out.
  const applyInverseScale = () => {
    const inv = 1 / (useViewportStore.getState().scale || 1)
    for (const child of root.children) child.scale.set(inv)
  }

  const unsubEditor = useEditorStore.subscribe(() => { rebuild(); applyInverseScale() })
  const unsubFloor = useFloorStore.subscribe(() => { rebuild(); applyInverseScale() })
  const unsubWall = useWallStore.subscribe(() => { rebuild(); applyInverseScale() })
  const unsubCable = useCableStore.subscribe(() => { rebuild(); applyInverseScale() })
  const unsubHover = useHoverStore.subscribe(() => { rebuild(); applyInverseScale() })
  const unsubViewport = useViewportStore.subscribe(applyInverseScale)
  rebuild()
  applyInverseScale()

  return () => {
    unsubEditor()
    unsubFloor()
    unsubWall()
    unsubCable()
    unsubHover()
    unsubViewport()
    layer.removeChild(root)
    root.destroy({ children: true })
  }
}
