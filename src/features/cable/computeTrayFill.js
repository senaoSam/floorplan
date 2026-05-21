// 19-4 cable fill ratio per tray — Planning BOM estimate, not施工 final BOM.
//
// Strategy: walk every AP route + every S2S link's `points` array. For each
// consecutive (pᵢ, pᵢ₊₁) pair on the same floor, if BOTH points lie on a
// tray's polyline (within tolPx), count the cable as occupying that tray.
//
// This naturally handles:
//   - foot drops (endpoint → endpoint-foot): only one end is on the tray,
//     so it doesn't count toward fill (the drop is perpendicular to the
//     tray, doesn't take up tray cross-section).
//   - cross-tray traversals (cable hops from tray A to tray B at a cross
//     node): both adjacent segments count for their respective trays, so
//     the cable shows up in both — correct (physically it does).
//
// Limitation: a route that just touches a tray at one node (e.g. crossing
// a tray without running along it) doesn't get counted. That matches
// physical reality — a cable that only crosses a tray's path at a single
// point doesn't occupy tray volume.

import { footOnSegment } from './geometry'
import { CABLE_AREAS_MM2, classifyFillRatio, CAPACITY_STATUS, getCapacityProfile } from '@/store/useCableStore'

const ON_POLYLINE_TOL_PX = 1.0

function pointOnPolyline(p, points) {
  for (let i = 0; i < points.length - 1; i++) {
    const f = footOnSegment(p, points[i], points[i + 1])
    if (f.d <= ON_POLYLINE_TOL_PX) return true
  }
  return false
}

// → Map<`${floorId}|${trayId}`, { count, copperCount, fiberCount }>
//
// Each route / S2S link contributes +1 to every tray it traverses. AP cables
// are copper by default (drops are short); S2S links use link.cableType.
export function computeTrayCableLoads({ routes, switchLinks, traysByFloor }) {
  const out = new Map()
  const keyOf = (floorId, trayId) => `${floorId}|${trayId}`
  const bump = (floorId, trayId, cableType) => {
    const k = keyOf(floorId, trayId)
    const e = out.get(k) ?? { count: 0, copperCount: 0, fiberCount: 0 }
    e.count += 1
    if (cableType === 'fiber') e.fiberCount += 1
    else                       e.copperCount += 1
    out.set(k, e)
  }

  const tallyPath = (points, cableType) => {
    if (!points || points.length < 2) return
    // Bucket points by floor so we only check trays on the relevant floor.
    const floorIds = new Set(points.map((p) => p.floorId))
    for (const fid of floorIds) {
      const traysOnFloor = traysByFloor[fid] ?? []
      if (traysOnFloor.length === 0) continue
      // Indices of the path points that live on this floor (preserves order).
      const idxs = []
      for (let i = 0; i < points.length; i++) if (points[i].floorId === fid) idxs.push(i)
      if (idxs.length < 2) continue
      for (const tray of traysOnFloor) {
        let occupied = false
        for (let k = 0; k < idxs.length - 1; k++) {
          const a = points[idxs[k]]
          const b = points[idxs[k + 1]]
          // Only count consecutive original-path neighbours (skip when the
          // two indices aren't adjacent in the source path — the cable
          // actually left the floor between them).
          if (idxs[k + 1] !== idxs[k] + 1) continue
          if (pointOnPolyline(a, tray.points) && pointOnPolyline(b, tray.points)) {
            occupied = true
            break
          }
        }
        if (occupied) bump(fid, tray.id, cableType)
      }
    }
  }

  for (const r of routes.values()) {
    if (!r.points || r.routeStatus !== 'tray') continue
    tallyPath(r.points, 'copper')   // AP→Switch drops default to copper
  }
  for (const link of switchLinks.values()) {
    if (!link.points || link.routeStatus !== 'tray') continue
    tallyPath(link.points, link.cableType ?? 'copper')
  }

  return out
}

// Per-tray fill calc + classification.
//   tray:    { widthMm, depthMm }
//   load:    { count, copperCount, fiberCount } | null
//   profile: { warnRatio, fullRatio } from getCapacityProfile()
// Returns:
//   {
//     trayAreaMm2,
//     cableAreaMm2,
//     fillRatio,                 // 0..N (can exceed 1.0)
//     status: 'ok'|'warn'|'full'|'exceed',
//     statusLabel, statusColor,
//     copperCount, fiberCount, count,
//   }
export function computeTrayFill({ tray, load, profile }) {
  const width  = tray?.widthMm  ?? 0
  const depth  = tray?.depthMm  ?? 0
  const trayAreaMm2 = Math.max(0, width * depth)

  const copperCount = load?.copperCount ?? 0
  const fiberCount  = load?.fiberCount  ?? 0
  const count       = load?.count       ?? 0
  const cableAreaMm2 =
    copperCount * CABLE_AREAS_MM2.copper +
    fiberCount  * CABLE_AREAS_MM2.fiber

  const fillRatio = trayAreaMm2 > 0 ? cableAreaMm2 / trayAreaMm2 : 0
  const status = classifyFillRatio(fillRatio, profile)
  const meta   = CAPACITY_STATUS[status]

  return {
    trayAreaMm2,
    cableAreaMm2,
    fillRatio,
    status,
    statusLabel: meta.label,
    statusColor: meta.color,
    copperCount,
    fiberCount,
    count,
  }
}

// Convenience: same shape as computeTrayCableLoads but keyed by `${trayId}`
// (drops the floor prefix — useful when the caller already knows the floor).
export { getCapacityProfile }
