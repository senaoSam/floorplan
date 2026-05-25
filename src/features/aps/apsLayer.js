import { Graphics } from 'pixi.js'

// AP markers adapter — Graphics circle per AP, fill tinted by frequency.
// MVP: world-space radius (will look bigger when zoomed in); no sprite atlas
// batching yet — that's 31-6's job once we measure where the perf ceiling
// sits with 1000 APs.

const FREQ_COLOR = {
  2.4: '#f39c12',
  5:   '#4fc3f7',
  6:   '#a855f7',
}

const FALLBACK_COLOR = '#9aa3ad'

const colorForAP = (ap) => FREQ_COLOR[ap.frequency] ?? FALLBACK_COLOR

const AP_RADIUS = 9

export function attachAPsLayer({ scene, useFloorStore, useAPStore }) {
  const layer = scene.layers.devicesAP
  const g = new Graphics()
  layer.addChild(g)

  let lastFloorId = undefined
  let lastAPs = undefined

  const rebuild = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const aps = useAPStore.getState().apsByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && aps === lastAPs) return
    lastFloorId = activeFloorId
    lastAPs = aps

    g.clear()
    for (const ap of aps) {
      g.circle(ap.x, ap.y, AP_RADIUS)
        .fill({ color: colorForAP(ap), alpha: 0.95 })
        .stroke({ width: 2, color: 0xffffff, alpha: 0.9 })
    }
  }

  const unsubFloor = useFloorStore.subscribe(rebuild)
  const unsubAP = useAPStore.subscribe(rebuild)
  rebuild()

  return () => {
    unsubFloor()
    unsubAP()
    layer.removeChild(g)
    g.destroy()
  }
}
