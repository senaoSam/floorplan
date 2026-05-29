import { getCachedRoutes } from '@/features/cable/routesCache'

// 17-2 focus halo helper (imperative twin of oldSrc useFocusedDevices).
// Returns the set of AP / switch ids "related" to the current selection so
// PIXI layers can draw an indigo halo around them.
//
//   - AP selected     → its destination switch becomes focused
//   - Switch selected → every AP whose route lands on this switch, plus any
//                       other switch linked to it via S2S uplinks
//
// Returns Set instances so callers can do O(1) membership tests.

const EMPTY_FOCUS = { aps: new Set(), switches: new Set(), apIds: new Set() }

export function computeFocusedDevices({
  selectedId,
  selectedType,
  floors,
  apsByFloor,
  switchesByFloor,
  traysByFloor,
  risers,
}) {
  if (!selectedId || (selectedType !== 'ap' && selectedType !== 'switch')) {
    return EMPTY_FOCUS
  }
  const aps = new Set()
  const switches = new Set()
  // 32-E: getCachedRoutes memoizes by store-slice identity, so selecting an
  // AP (which doesn't change route geometry) is a cache hit — no Dijkstra.
  const { routes, switchLinks } = getCachedRoutes({
    floors, apsByFloor, switchesByFloor, traysByFloor, risers,
  })
  if (selectedType === 'ap') {
    const r = routes.get(selectedId)
    if (r?.switchId) switches.add(r.switchId)
  } else {
    for (const [apId, r] of routes) {
      if (r.switchId === selectedId) aps.add(apId)
    }
    for (const link of switchLinks.values()) {
      if (link.srcId === selectedId)    switches.add(link.targetId)
      if (link.targetId === selectedId) switches.add(link.srcId)
    }
  }
  return { aps, switches }
}

export const FOCUS_HALO_COLOR = '#818cf8'  // indigo-400
export const FOCUS_HALO_ALPHA = 0.85
export const FOCUS_HALO_WIDTH = 3
