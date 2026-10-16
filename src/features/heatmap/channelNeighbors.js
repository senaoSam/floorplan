// 57-34: neighbour predicate for greedyChannelAssign on the main thread --
// "these two APs hear each other" from the live stores (cross-floor scenario,
// same rule as the plan-quality conflicts). `aps` is the floor's AP list as it
// will be planned (may include not-yet-added APs). Falls back to the legacy
// 300 canvas-px radius when the floor has no scale yet.
// 58-16 (C1): other floors' radios (calibrated floors, same scenario as the
// heatmap) come along as fixed neighbours -- the planner avoids their
// channels and never reassigns them.
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { buildFloorScenario } from './buildCrossFloor'
import { makeApHearingFn } from './apHearing'
import { greedyChannelAssign } from '@/utils/autoChannelPlan'
import { apRadios, radioKey, allRadioKeys, expandRadios, applyRadioResults } from '@/utils/apRadios'

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
  return sc ? makeApHearingFn(sc, { crossFloorFixed: true }) : 300
}

// 58-9: a model change adds radios for bands the device did not have. They get
// channels the way a placed AP's radios do (greedy assignment, neighbours from
// the stores), with every radio that already existed held at its channel.
// `next` = the floor's AP list after the change, `prev` = before it.
//
// No scale → no distances: the 300 canvas-px fallback put every AP of a large
// unscaled image out of range, so every new radio landed on the band's lowest
// channel anyway, silently. Leave the radios at their defaults instead; the
// auto-channel button (disabled until there is a scale) plans them later.
export function assignNewRadioChannels(floorId, next, prev, domainId) {
  if (!useFloorStore.getState().floors.find((f) => f.id === floorId)?.scale) return next
  const prevKeys = new Set(allRadioKeys(prev))
  const fixed = new Map()
  let added = false
  for (const a of next) {
    for (const r of apRadios(a)) {
      const key = radioKey(a.id, r.band)
      if (prevKeys.has(key)) fixed.set(key, r.channel)
      else if (r.enabled) added = true
    }
  }
  if (!added) return next
  const assigned = greedyChannelAssign(expandRadios(next), domainId, storeChannelNeighbors(floorId, next), fixed)
  const fresh = new Map([...assigned].filter(([key]) => !prevKeys.has(key)))
  return applyRadioResults(next, fresh, (a) => ({ channel: a.channel }))
}
