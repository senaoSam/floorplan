import { Graphics } from 'pixi.js'

// Floor-hole adapter — dashed dark polygons on scene.layers.scopes (per
// spec §3.3 the scopes / floorHoles / refWall / refVector all share
// layer 5). Visually distinct from scopes (which are tinted green/red);
// holes use a dashed dark grey outline + faint dark fill suggesting
// "void / atrium".

const HOLE_FILL   = 'rgba(15, 23, 42, 0.45)'
const HOLE_STROKE = 'rgba(231, 76, 60, 0.85)'
const HOLE_DASH_ON  = 6
const HOLE_DASH_OFF = 4

function drawDashedPolygon(g, flat, dashOn, dashOff, opts) {
  if (!flat || flat.length < 4) return
  const n = flat.length / 2
  // Loop including closing segment back to first point.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    let cx = flat[i * 2], cy = flat[i * 2 + 1]
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
      g.poly(hole.points.slice()).fill({ color: HOLE_FILL, alpha: 1 })
      drawDashedPolygon(g, hole.points, HOLE_DASH_ON, HOLE_DASH_OFF, {
        width: 1.5, color: HOLE_STROKE, alpha: 1,
      })
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
