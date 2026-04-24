import { DEFAULT_FLOOR_HEIGHT_M } from '@/store/useFloorStore'

// Compute the ground-level Y (in meters) of every floor given the stacking
// convention "floors[0] sits at y=0 and each subsequent floor sits on top".
// Returns an object { [floorId]: elevationM }. Floors without an explicit
// `floorHeight` fall back to DEFAULT_FLOOR_HEIGHT_M.
export function computeFloorElevations(floors) {
  const out = {}
  let y = 0
  for (const f of floors) {
    out[f.id] = y
    y += f.floorHeight ?? DEFAULT_FLOOR_HEIGHT_M
  }
  return out
}
