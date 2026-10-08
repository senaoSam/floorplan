// 57-34: neighbour predicate for greedyChannelAssign on the main thread --
// "these two APs hear each other" from the live stores (cross-floor scenario,
// same rule as the plan-quality conflicts). `aps` is the floor's AP list as it
// will be planned (may include not-yet-added APs). Falls back to the legacy
// 300 canvas-px radius when the floor has no scale yet.
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { buildFloorScenario } from './buildCrossFloor'
import { makeApHearingFn } from './apHearing'

export function storeChannelNeighbors(floorId, aps) {
  const floors = useFloorStore.getState().floors
  const floor = floors.find((f) => f.id === floorId)
  if (!floor?.scale) return 300
  const sc = buildFloorScenario({
    floors,
    floorId,
    apsByFloor: { ...useAPStore.getState().apsByFloor, [floorId]: aps },
    wallsByFloor: useWallStore.getState().wallsByFloor,
    holesByFloor: useFloorHoleStore.getState().floorHolesByFloor,
  })
  return sc ? makeApHearingFn(sc) : 300
}
