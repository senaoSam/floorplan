import { Graphics } from 'pixi.js'
import { computeRoutes } from '@/features/cable/computeRoutes'

// Cable adapter — runs computeRoutes against the full building data on
// every change to floor / AP / wall / cable stores, then draws the routes
// landing on the active floor:
//   * tray              — solid cyan
//   * fallback-manhattan — dashed grey (manual dash helper since PIXI
//                          v8 Graphics has no native lineDash)
//   * unroutable        — small red ring around the AP
//
// Mounted on scene.layers.cables which is set to eventMode='none' in
// scene.js — cables stay purely visual.

const COLOR_TRAY     = '#06b6d4'
const COLOR_FALLBACK = '#9ca3af'
const COLOR_UNROUTABLE = '#ef4444'
const ROUTE_WIDTH = 1.6
const DASH_ON  = 6
const DASH_OFF = 4

function drawSolid(g, points, color, width) {
  if (!points || points.length < 2) return
  g.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y)
  g.stroke({ width, color, alpha: 1 })
}

function drawDashed(g, points, color, width, dashOn, dashOff) {
  if (!points || points.length < 2) return
  let phaseOn = true
  let remain = dashOn
  let cx = points[0].x, cy = points[0].y
  for (let i = 1; i < points.length; i++) {
    const tx = points[i].x, ty = points[i].y
    const len = Math.hypot(tx - cx, ty - cy)
    if (len <= 1e-9) continue
    const ux = (tx - cx) / len
    const uy = (ty - cy) / len
    let cursor = 0
    while (cursor < len) {
      const step = Math.min(len - cursor, remain)
      const x1 = cx + ux * cursor
      const y1 = cy + uy * cursor
      const x2 = cx + ux * (cursor + step)
      const y2 = cy + uy * (cursor + step)
      if (phaseOn) {
        g.moveTo(x1, y1).lineTo(x2, y2)
        g.stroke({ width, color, alpha: 1 })
      }
      cursor += step
      remain -= step
      if (remain <= 1e-9) {
        phaseOn = !phaseOn
        remain = phaseOn ? dashOn : dashOff
      }
    }
    cx = tx; cy = ty
  }
}

export function attachCablesLayer({
  scene,
  useFloorStore,
  useAPStore,
  useCableStore,
}) {
  const layer = scene.layers.cables
  const g = new Graphics()
  layer.addChild(g)

  const rebuild = () => {
    const { floors, activeFloorId } = useFloorStore.getState()
    const apsByFloor = useAPStore.getState().apsByFloor
    const switchesByFloor = useCableStore.getState().switchesByFloor
    const traysByFloor = useCableStore.getState().traysByFloor
    const risers = useCableStore.getState().risers

    g.clear()
    if (!activeFloorId || floors.length === 0) return

    const { routes } = computeRoutes({
      floors,
      apsByFloor,
      switchesByFloor,
      traysByFloor,
      risers,
    })

    const activeAps = apsByFloor[activeFloorId] ?? []
    for (const ap of activeAps) {
      const route = routes.get(ap.id)
      if (!route) continue
      if (route.routeStatus === 'unroutable') {
        g.circle(ap.x, ap.y, 14)
          .stroke({ width: 2, color: COLOR_UNROUTABLE, alpha: 0.9 })
        continue
      }
      const poly = route.points
      if (!poly || poly.length < 2) continue
      if (route.routeStatus === 'fallback-manhattan') {
        drawDashed(g, poly, COLOR_FALLBACK, ROUTE_WIDTH, DASH_ON, DASH_OFF)
      } else {
        drawSolid(g, poly, COLOR_TRAY, ROUTE_WIDTH)
      }
    }
  }

  const unsubFloor = useFloorStore.subscribe(rebuild)
  const unsubAP = useAPStore.subscribe(rebuild)
  const unsubCable = useCableStore.subscribe(rebuild)
  rebuild()

  return () => {
    unsubFloor()
    unsubAP()
    unsubCable()
    layer.removeChild(g)
    g.destroy()
  }
}
