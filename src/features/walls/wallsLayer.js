import { Container, Graphics } from 'pixi.js'
import { useEditorStore } from '@/store/useEditorStore'
import { useHoverStore } from '@/store/useHoverStore'

// Walls adapter — per-wall Container with click hit-test (no drag yet —
// wall edit needs endpoint handles which arrive with 31-4 / 31-8 spec).
// Openings render on top in their material colour; clicking an opening
// selects the parent wall.

const WALL_STROKE_WIDTH = 4
const HIT_TOLERANCE_PX = 5

function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 <= 1e-9) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const qx = ax + t * dx
  const qy = ay + t * dy
  return Math.hypot(px - qx, py - qy)
}

function makeSegmentHitArea(ax, ay, bx, by, tolerance) {
  return {
    contains(x, y) {
      return pointToSegmentDistance(x, y, ax, ay, bx, by) <= tolerance
    },
  }
}

export function attachWallsLayer({ scene, useFloorStore, useWallStore }) {
  const layer = scene.layers.walls
  layer.eventMode = 'passive'

  const containers = new Map()

  const ensureContainer = (wall, floorId) => {
    let entry = containers.get(wall.id)
    if (!entry) {
      const c = new Container()
      c.eventMode = 'static'
      c.cursor = 'pointer'
      const g = new Graphics()
      c.addChild(g)
      layer.addChild(c)
      entry = { container: c, graphics: g, wall, floorId }
      containers.set(wall.id, entry)
      bindInteractions(entry)
    } else {
      entry.wall = wall
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

  const drawWall = (entry) => {
    const { graphics, container, wall } = entry
    graphics.clear()
    graphics.moveTo(wall.startX, wall.startY).lineTo(wall.endX, wall.endY)
    graphics.stroke({ width: WALL_STROKE_WIDTH, color: wall.material.color, alpha: 1 })

    const openings = wall.openings ?? []
    if (openings.length > 0) {
      const dx = wall.endX - wall.startX
      const dy = wall.endY - wall.startY
      for (const op of openings) {
        const sx = wall.startX + dx * op.startFrac
        const sy = wall.startY + dy * op.startFrac
        const ex = wall.startX + dx * op.endFrac
        const ey = wall.startY + dy * op.endFrac
        graphics.moveTo(sx, sy).lineTo(ex, ey)
        graphics.stroke({ width: WALL_STROKE_WIDTH, color: op.material.color, alpha: 1 })
      }
    }

    container.hitArea = makeSegmentHitArea(
      wall.startX, wall.startY,
      wall.endX, wall.endY,
      HIT_TOLERANCE_PX,
    )
  }

  const bindInteractions = (entry) => {
    const { container } = entry
    container.on('pointerdown', (e) => {
      if (e.button === 2) {
        e.stopPropagation()
        useEditorStore.getState().openContextMenu({
          targetType: 'wall',
          targetId: entry.wall.id,
          screenX: e.originalEvent?.clientX ?? 0,
          screenY: e.originalEvent?.clientY ?? 0,
        })
        return
      }
      if ((e.button ?? 0) !== 0) return
      e.stopPropagation()
      useEditorStore.getState().setSelected(entry.wall.id, 'wall')
    })
    container.on('pointerover', () => useHoverStore.getState().setHover(entry.wall.id, 'wall'))
    container.on('pointerout', () => useHoverStore.getState().clearHoverIf(entry.wall.id))
  }

  let lastFloorId = undefined
  let lastWalls = undefined

  const reconcile = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const walls = useWallStore.getState().wallsByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && walls === lastWalls) return
    lastFloorId = activeFloorId
    lastWalls = walls
    const next = new Set(walls.map((w) => w.id))
    for (const id of Array.from(containers.keys())) {
      if (!next.has(id)) removeContainer(id)
    }
    for (const wall of walls) {
      const entry = ensureContainer(wall, activeFloorId)
      drawWall(entry)
    }
  }

  const unsubFloor = useFloorStore.subscribe(reconcile)
  const unsubWall = useWallStore.subscribe(reconcile)
  reconcile()

  return () => {
    unsubFloor()
    unsubWall()
    for (const id of Array.from(containers.keys())) removeContainer(id)
  }
}
