import { Graphics } from 'pixi.js'
import { getSwitchKindColor, DEFAULT_SWITCH_BY_KIND } from '@/store/useCableStore'

// Switch chassis adapter — small dark rectangle with a kind-coloured
// border + tiny port LED row. MVP fidelity: no per-port dot count, no
// label text. Full chassis (kind-specific shapes / decoration / label
// pill) lands later when Toolbar + selection / hover interactions
// arrive.

const CHASSIS_HEIGHT = 14
const CHASSIS_WIDTH_BY_KIND = {
  switch: 26,
  idf:    32,
  mdf:    44,
  router: 30,
}

export function attachSwitchesLayer({ scene, useFloorStore, useCableStore }) {
  const layer = scene.layers.devicesSW
  const g = new Graphics()
  layer.addChild(g)

  let lastFloorId = undefined
  let lastSwitches = undefined

  const rebuild = () => {
    const activeFloorId = useFloorStore.getState().activeFloorId
    const switches = useCableStore.getState().switchesByFloor[activeFloorId] ?? []
    if (activeFloorId === lastFloorId && switches === lastSwitches) return
    lastFloorId = activeFloorId
    lastSwitches = switches

    g.clear()
    for (const sw of switches) {
      const kind = sw.kind ?? 'switch'
      const w = CHASSIS_WIDTH_BY_KIND[kind] ?? CHASSIS_WIDTH_BY_KIND.switch
      const h = CHASSIS_HEIGHT
      const color = getSwitchKindColor(kind)

      g.rect(sw.x - w / 2, sw.y - h / 2, w, h)
        .fill({ color: 0x1f2937, alpha: 0.95 })
        .stroke({ width: 1.4, color, alpha: 1 })

      // LED dot — top-left corner, kind color, to make the switch's role
      // recognisable at a glance.
      g.circle(sw.x - w / 2 + 3, sw.y - h / 2 + 3, 1.5).fill({ color, alpha: 1 })
    }
  }

  const unsubFloor = useFloorStore.subscribe(rebuild)
  const unsubCable = useCableStore.subscribe(rebuild)
  rebuild()

  return () => {
    unsubFloor()
    unsubCable()
    layer.removeChild(g)
    g.destroy()
  }
}
