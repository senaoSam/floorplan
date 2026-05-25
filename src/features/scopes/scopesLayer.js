import { Graphics } from 'pixi.js'

// Scope adapter — fills + outlines polygon scopes on scene.layers.scopes.
// In-scopes (type='in') tint green; out-scopes (type='out') tint red.
// MVP: no per-scope hit-test or selection (scopes are evaluation regions,
// usually defined once + rarely re-selected). Click hit-test arrives when
// DRAW_SCOPE mode lands.

const COLOR_IN_FILL    = 'rgba(34, 197, 94, 0.10)'
const COLOR_IN_STROKE  = 'rgba(34, 197, 94, 0.65)'
const COLOR_OUT_FILL   = 'rgba(239, 68, 68, 0.10)'
const COLOR_OUT_STROKE = 'rgba(239, 68, 68, 0.65)'

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
      g.poly(flat)
        .fill({ color: isOut ? COLOR_OUT_FILL : COLOR_IN_FILL, alpha: 1 })
        .stroke({
          width: 1.5,
          color: isOut ? COLOR_OUT_STROKE : COLOR_IN_STROKE,
          alpha: 1,
        })
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
