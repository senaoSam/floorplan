import { Graphics } from 'pixi.js'

// Scope adapter — fills + outlines polygon scopes on scene.layers.scopes.
// Colours match oldSrc:
//   in-scope  (type='in')  → green fill + solid green stroke
//   out-scope (type='out') → red fill + dashed red stroke

const COLOR_IN_FILL    = 'rgba(46, 213, 115, 0.18)'
const COLOR_IN_STROKE  = '#2ed573'
const COLOR_OUT_FILL   = 'rgba(255, 71, 87, 0.18)'
const COLOR_OUT_STROKE = '#ff4757'
const STROKE_WIDTH     = 3
const DASH_ON  = 8
const DASH_OFF = 4

function drawDashedPolygon(g, flat, dashOn, dashOff, opts) {
  if (!flat || flat.length < 4) return
  const n = flat.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const cx = flat[i * 2], cy = flat[i * 2 + 1]
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

export function attachScopesLayer({ scene, useFloorStore, useScopeStore }) {
  const layer = scene.layers.scopes
  const g = new Graphics()
  layer.addChild(g)

  let lastFloorId = undefined
  let lastScopes = undefined

  const rebuild = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const scopes = useScopeStore.getState().scopesByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && scopes === lastScopes) return
    lastFloorId = activeFloorId
    lastScopes = scopes
    g.clear()
    for (const scope of scopes) {
      if (!scope.points || scope.points.length < 4) continue
      const flat = scope.points.slice()
      const isOut = scope.type === 'out'
      g.poly(flat).fill({
        color: isOut ? COLOR_OUT_FILL : COLOR_IN_FILL,
        alpha: 1,
      })
      const stroke = isOut ? COLOR_OUT_STROKE : COLOR_IN_STROKE
      if (isOut) {
        drawDashedPolygon(g, flat, DASH_ON, DASH_OFF, {
          width: STROKE_WIDTH, color: stroke, alpha: 1,
        })
      } else {
        g.poly(flat).stroke({ width: STROKE_WIDTH, color: stroke, alpha: 1 })
      }
    }
  }

  const unsubFloor = useFloorStore.subscribe(rebuild)
  const unsubScope = useScopeStore.subscribe(rebuild)
  rebuild()

  return () => {
    unsubFloor()
    unsubScope()
    layer.removeChild(g)
    g.destroy()
  }
}
