import { Graphics } from 'pixi.js'

// Walls adapter — subscribes to useWallStore + useFloorStore, rebuilds a
// single PIXI.Graphics on change. Openings render on top in their own
// material colour so the gap is visually obvious without pre-cutting the
// wall segment (which is what the 31-4 custom shader will do later).
//
// MVP fidelity: world-space stroke width (will look thicker when zoomed in);
// no AA / DPR / hover-id uniform; no spatial index. Those land with the
// PIXI.Mesh shader rewrite in 31-4.
const WALL_STROKE_WIDTH = 4

export function attachWallsLayer({ scene, useFloorStore, useWallStore }) {
  const layer = scene.layers.walls
  const g = new Graphics()
  layer.addChild(g)

  let lastFloorId = undefined
  let lastWalls = undefined

  const rebuild = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const walls = useWallStore.getState().wallsByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && walls === lastWalls) return
    lastFloorId = activeFloorId
    lastWalls = walls

    g.clear()
    for (const w of walls) {
      g.moveTo(w.startX, w.startY).lineTo(w.endX, w.endY)
      g.stroke({ width: WALL_STROKE_WIDTH, color: w.material.color, alpha: 1 })

      const openings = w.openings ?? []
      if (openings.length === 0) continue
      const dx = w.endX - w.startX
      const dy = w.endY - w.startY
      for (const op of openings) {
        const sx = w.startX + dx * op.startFrac
        const sy = w.startY + dy * op.startFrac
        const ex = w.startX + dx * op.endFrac
        const ey = w.startY + dy * op.endFrac
        g.moveTo(sx, sy).lineTo(ex, ey)
        g.stroke({ width: WALL_STROKE_WIDTH, color: op.material.color, alpha: 1 })
      }
    }
  }

  const unsubFloor = useFloorStore.subscribe(rebuild)
  const unsubWall = useWallStore.subscribe(rebuild)
  rebuild()

  return () => {
    unsubFloor()
    unsubWall()
    layer.removeChild(g)
    g.destroy()
  }
}
