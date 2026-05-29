import { DEFAULT_FLOOR_HEIGHT_M } from '@/store/useFloorStore'

// Ports oldSrc/features/viewer3d/floorStacking.js — single source of
// truth for stacking floors vertically. Stacks floors[0] at y=0 and each
// subsequent floor on top of the previous one's floorHeight. Floors
// without explicit floorHeight fall back to DEFAULT_FLOOR_HEIGHT_M.
//
// Returns { [floorId]: elevationM } — elevation of the floor's slab in
// metres, used by heatmap propagation (cross-floor slab attenuation,
// floor holes) and the 3D viewer's floor stacking when that port lands.
export function computeFloorElevations(floors) {
  const out = {}
  let y = 0
  for (const f of floors) {
    out[f.id] = y
    y += f.floorHeight ?? DEFAULT_FLOOR_HEIGHT_M
  }
  return out
}
