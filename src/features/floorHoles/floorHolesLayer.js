import { Graphics } from 'pixi.js'

// Floor-hole adapter — purple-tinted polygons on scene.layers.scopes (per
// spec §3.3 the scopes / floorHoles / refWall / refVector all share
// layer 5). Colours match oldSrc FloorHoleLayer: violet fill + solid
// purple stroke. Distinguishes "void / atrium" from scope evaluation
// regions (green/red).

const HOLE_FILL   = 'rgba(124, 58, 237, 0.20)'
const HOLE_STROKE = '#7c3aed'
const HOLE_STROKE_WIDTH = 2

export function attachFloorHolesLayer({ scene, useFloorStore, useFloorHoleStore }) {
  const layer = scene.layers.scopes
  const g = new Graphics()
  layer.addChild(g)

  let lastFloorId = undefined
  let lastHoles = undefined

  const rebuild = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const holes = useFloorHoleStore.getState().floorHolesByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && holes === lastHoles) return
    lastFloorId = activeFloorId
    lastHoles = holes
    g.clear()
    for (const hole of holes) {
      if (!hole.points || hole.points.length < 4) continue
      g.poly(hole.points.slice())
        .fill({ color: HOLE_FILL, alpha: 1 })
        .stroke({ width: HOLE_STROKE_WIDTH, color: HOLE_STROKE, alpha: 1 })
    }
  }

  const unsubFloor = useFloorStore.subscribe(rebuild)
  const unsubHole = useFloorHoleStore.subscribe(rebuild)
  rebuild()

  return () => {
    unsubFloor()
    unsubHole()
    layer.removeChild(g)
    g.destroy()
  }
}
