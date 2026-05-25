import { Graphics } from 'pixi.js'
import { getTraySystem } from '@/store/useCableStore'

// Cable tray adapter — magnet halo + polyline body. MVP fidelity: single
// system-coloured polyline (not the bordered "channel" style 17-1 ships
// in oldSrc) so the visual is recognisable but the rewrite stays small.
// Bordered channel + vertex handles arrive with the tray edit interactions
// (Layer 18-x) in a later bundle.

const TRAY_LINE_WIDTH = 5
const MAGNET_FILL = 'rgba(255, 255, 255, 0.06)'

function drawPolyline(g, points, opts) {
  if (!points || points.length < 2) return
  g.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y)
  g.stroke(opts)
}

export function attachTraysLayer({ scene, useFloorStore, useCableStore }) {
  const layer = scene.layers.trays
  const haloG = new Graphics()
  const bodyG = new Graphics()
  layer.addChild(haloG)
  layer.addChild(bodyG)

  let lastFloorId = undefined
  let lastTrays = undefined

  const rebuild = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const trays = useCableStore.getState().traysByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && trays === lastTrays) return
    lastFloorId = activeFloorId
    lastTrays = trays

    haloG.clear()
    bodyG.clear()

    for (const tray of trays) {
      const sys = getTraySystem(tray.system)
      const magnetPx = tray.magnetDistance ?? 100

      // Magnet halo — capsule along polyline rendered as a single thick
      // translucent stroke. (Border outline deferred to the edit mode
      // version where it carries hit-test affordance.)
      drawPolyline(haloG, tray.points, {
        width: magnetPx * 2,
        color: MAGNET_FILL,
        alpha: 1,
        cap: 'round',
        join: 'round',
      })

      // Body polyline (system colour).
      drawPolyline(bodyG, tray.points, {
        width: TRAY_LINE_WIDTH,
        color: sys.color,
        alpha: 1,
        cap: 'round',
        join: 'round',
      })

      // Vertex pips.
      for (const p of tray.points) {
        bodyG.circle(p.x, p.y, 3).fill({ color: sys.color, alpha: 1 })
      }
    }
  }

  const unsubFloor = useFloorStore.subscribe(rebuild)
  const unsubCable = useCableStore.subscribe(rebuild)
  rebuild()

  return () => {
    unsubFloor()
    unsubCable()
    layer.removeChild(haloG)
    layer.removeChild(bodyG)
    haloG.destroy()
    bodyG.destroy()
  }
}
