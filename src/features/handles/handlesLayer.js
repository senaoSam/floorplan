import { Container, Graphics, Circle } from 'pixi.js'

// Edit handles for the selected wall / tray. Rendered on
// scene.layers.handles so they sit above the object layers but below
// labels.
//
// MVP scope:
//   - wall: two circles at startX/Y + endX/Y; drag rewrites that endpoint
//   - cable_tray: one circle per point; drag rewrites that single vertex
//   - other selected types: handles hidden
//
// Wall body / scope / tray body drag through their respective layers'
// container hit-test — only the endpoint / vertex granularity lives here.

const HANDLE_RADIUS = 5
const HANDLE_HIT_PAD = 2
// Wall endpoint handle (oldSrc convention): white fill + red stroke.
// Tray vertex handle: white fill + system-cyan stroke (lighter so it
// doesn't compete with the white tray-selected border).
const WALL_HANDLE_FILL = '#ffffff'
const WALL_HANDLE_STROKE = '#e74c3c'
const TRAY_HANDLE_FILL = '#ffffff'
const TRAY_HANDLE_STROKE = '#0e7490'

function makeHandleDot(x, y, fill, stroke) {
  const c = new Container()
  c.eventMode = 'static'
  c.cursor = 'crosshair'
  c.hitArea = new Circle(0, 0, HANDLE_RADIUS + HANDLE_HIT_PAD)
  c.position.set(x, y)
  const g = new Graphics()
  g.circle(0, 0, HANDLE_RADIUS)
    .fill({ color: fill, alpha: 1 })
    .stroke({ width: 1.8, color: stroke, alpha: 1 })
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

  const rebuild = () => {
    // Clear all current handles.
    while (root.children.length > 0) {
      const c = root.children[0]
      root.removeChild(c)
      c.destroy({ children: true })
    }

    const { selectedId, selectedType } = useEditorStore.getState()
    if (!selectedId) return
    const fid = useFloorStore.getState().activeFloorId
    if (!fid) return

    if (selectedType === 'wall') {
      const wall = (useWallStore.getState().wallsByFloor[fid] ?? []).find((w) => w.id === selectedId)
      if (!wall) return
      const startHandle = makeHandleDot(wall.startX, wall.startY, WALL_HANDLE_FILL, WALL_HANDLE_STROKE)
      const endHandle = makeHandleDot(wall.endX, wall.endY, WALL_HANDLE_FILL, WALL_HANDLE_STROKE)
      bindWallEndpointDrag(startHandle, wall, 'start')
      bindWallEndpointDrag(endHandle, wall, 'end')
      root.addChild(startHandle)
      root.addChild(endHandle)
      return
    }

    if (selectedType === 'cable_tray') {
      const tray = (useCableStore.getState().traysByFloor[fid] ?? []).find((t) => t.id === selectedId)
      if (!tray) return
      tray.points.forEach((p, idx) => {
        const h = makeHandleDot(p.x, p.y, TRAY_HANDLE_FILL, TRAY_HANDLE_STROKE)
        bindTrayVertexDrag(h, tray, idx)
        root.addChild(h)
      })
    }
  }

  const bindWallEndpointDrag = (handle, wall, end) => {
    handle.on('pointerdown', (e) => {
      if ((e.button ?? 0) !== 0) return
      e.stopPropagation()
      const stage = scene.app.stage
      const startWorld = scene.world.toLocal(e.global)
      const original = { x: wall[end + 'X'], y: wall[end + 'Y'] }
      const fid = useFloorStore.getState().activeFloorId

      const onMove = (ev) => {
        const wp = scene.world.toLocal(ev.global)
        const nx = original.x + (wp.x - startWorld.x)
        const ny = original.y + (wp.y - startWorld.y)
        handle.position.set(nx, ny)
        // Live-update the wall in the store so cable routing + heatmap follow.
        useWallStore.getState().updateWall(fid, wall.id, {
          [end + 'X']: nx,
          [end + 'Y']: ny,
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
        // Commit on every move so cable routes stay attached.
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

  const unsubEditor = useEditorStore.subscribe(rebuild)
  const unsubFloor = useFloorStore.subscribe(rebuild)
  const unsubWall = useWallStore.subscribe(rebuild)
  const unsubCable = useCableStore.subscribe(rebuild)
  rebuild()

  return () => {
    unsubEditor()
    unsubFloor()
    unsubWall()
    unsubCable()
    layer.removeChild(root)
    root.destroy({ children: true })
  }
}
