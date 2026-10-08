import { computeFloorElevations } from '@/utils/floorStacking'
import { MATERIAL_LIST, DEFAULT_FLOOR_SLAB_MATERIAL_ID } from '@/constants/materials'
import { buildScenario } from './buildScenario'

// Cross-floor scenario assembly — extracted from heatmapAdapter (Phase 48)
// so the 3D all-floors heatmap stack can build the same crossFloor input for
// ANY target floor, not just the 2D-active one.
//
// Behaviour notes carried over verbatim from the adapter:
//   * Build crossFloor even for a single floor — buildScenario takes a
//     different (3D rx geometry) path when crossFloor is an object vs null,
//     and the null path's contours drift subtly (MCP-verified vs oldSrc).
//   * 決策② (Phase 48): floors WITHOUT a calibrated scale are excluded from
//     cross-floor geometry (APs / walls / holes) instead of being silently
//     mis-positioned with the target floor's px/m. Slab attenuation still
//     applies (elevation-based, needs no geometry).
//   * `floorRef` hands buildScenario the authoring floor record so buckets
//     can be mapped through the inter-floor align transform.
//
// Args:
//   floors         — full floor list (order = stacking order)
//   activeFloorId  — the TARGET floor the field is computed for
//   apsByFloor / wallsByFloor / holesByFloor — store maps
//   mapAps         — (list) => list; per-floor AP filter (band filter, drag
//                    overlay …). Identity when omitted.
//
// Returns { crossFloor, excludedFloors } — crossFloor is null only when
// there are no floors at all; excludedFloors lists names of uncalibrated
// floors that actually had content to exclude.
export function buildCrossFloorData({
  floors,
  activeFloorId,
  apsByFloor,
  wallsByFloor,
  holesByFloor,
  mapAps = (list) => list,
}) {
  if (!floors || floors.length === 0) return { crossFloor: null, excludedFloors: [] }

  const elevations = computeFloorElevations(floors)
  const floorIndexById = new Map(floors.map((f, i) => [f.id, i]))

  const excludedFloors = []
  for (const f of floors) {
    if (f.scale || f.id === activeFloorId) continue
    const hasContent =
      (apsByFloor[f.id]?.length ?? 0) > 0 ||
      (wallsByFloor[f.id]?.length ?? 0) > 0 ||
      (holesByFloor[f.id]?.length ?? 0) > 0
    if (hasContent) excludedFloors.push(f.name ?? f.id)
  }

  const floorStack = floors.map((f) => ({
    id: f.id,
    elevationM: elevations[f.id] ?? 0,
    slabDb: f.floorSlabAttenuationDb ?? 0,
    // 57-25: the slab material's ITU frequency exponent -- slabDb is the
    // 2.4 GHz anchor and scales like a wall of the same material.
    slabLossB: MATERIAL_LIST.find((m) => m.id === (f.floorSlabMaterialId ?? DEFAULT_FLOOR_SLAB_MATERIAL_ID))?.lossB ?? 0,
    scale: f.scale,
    floorRef: f,
    holes: (f.scale ? (holesByFloor[f.id] ?? []) : []).map((h) => ({
      points: h.points,
      fromIdx: floorIndexById.get(h.bottomFloorId ?? f.id) ?? floorIndexById.get(f.id),
      toIdx:   floorIndexById.get(h.topFloorId    ?? f.id) ?? floorIndexById.get(f.id),
    })),
  }))

  const apsAcrossFloors = []
  for (const f of floors) {
    if (!f.scale && f.id !== activeFloorId) continue
    const floorAPs = mapAps(apsByFloor[f.id] ?? [])
    const floorElev = elevations[f.id] ?? 0
    for (const ap of floorAPs) {
      apsAcrossFloors.push({
        ...ap,
        posPx: { x: ap.x, y: ap.y },
        elevationM: floorElev,
        floorScale: f.scale,
        floorRef: f,
      })
    }
  }

  const otherFloorWalls = []
  for (const f of floors) {
    if (f.id === activeFloorId) continue
    if (!f.scale) continue
    const fws = wallsByFloor[f.id] ?? []
    if (fws.length === 0) continue
    otherFloorWalls.push({
      elevationM: elevations[f.id] ?? 0,
      scale: f.scale,
      floorRef: f,
      walls: fws,
    })
  }

  return {
    crossFloor: {
      activeElevationM: elevations[activeFloorId] ?? 0,
      rxHeightM: 1.0,
      floorStack,
      apsByFloor: apsAcrossFloors,
      otherFloorWalls,
    },
    excludedFloors,
  }
}

// 57-17: the scenario the 2D heatmap computes for a floor (cross-floor APs,
// walls and slabs; receiver at 1.0 m), for the point readers -- hover,
// Client View, planQuality -- so their numbers come from the same geometry as
// the colours. Before this they built a planar scenario (rx at floor level,
// no other floors).
//   mapAps -- per-floor AP filter (e.g. the heatmap band filter); identity
//             when omitted.
// Returns null when the floor is missing.
export function buildFloorScenario({
  floors,
  floorId,
  apsByFloor = {},
  wallsByFloor = {},
  holesByFloor = {},
  scopes = [],
  mapAps = (list) => list,
  env = null,   // 57-34: see buildScenario's currentScenarioEnv
}) {
  const floor = (floors ?? []).find((f) => f.id === floorId)
  if (!floor) return null
  const { crossFloor } = buildCrossFloorData({
    floors, activeFloorId: floorId, apsByFloor, wallsByFloor, holesByFloor, mapAps,
  })
  return buildScenario(floor, wallsByFloor[floorId] ?? [], mapAps(apsByFloor[floorId] ?? []), scopes, crossFloor, env)
}
