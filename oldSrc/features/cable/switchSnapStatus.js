// 17-4 — per-switch snap status for visual indication on the canvas.
//
// Pure geometric check, independent of routing: a switch is "snapped" if it
// lies within the magnet radius of at least one tray on the same floor. We
// expose each snap target (trayId, foot xy, drop distance) so SwitchLayer
// can draw a dashed foot-drop line from the chassis to every snapped tray —
// makes "snap-but-no-AP-traffic" visually distinguishable from "not snapped".
//
// Why compute here instead of consuming buildGraph: keeping the indicator
// independent of routing means it works the same whether routes are stale,
// pending, or skipped entirely. The data the user sees ("am I in magnet
// range?") shouldn't depend on whether Dijkstra has finished.

import { closestPointOnPolyline } from './geometry'

// trays:    [{ id, points: [{x,y}], magnetDistance }]
// switches: [{ id, x, y, ... }]
// Returns:
//   Map<switchId, {
//     snapped: boolean,
//     drops:   [{ trayId, footXy: {x,y}, dropPx, magnetPx }],
//   }>
export function computeSwitchSnaps(switches, trays) {
  const out = new Map()
  // Pre-compute cumulative lengths once per tray (small win when many switches).
  const trayInfo = trays.map((t) => {
    const pts = t.points ?? []
    if (pts.length < 2) return null
    let cum = [0]
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
    }
    return { tray: t, cum, magnet: t.magnetDistance ?? 100 }
  }).filter(Boolean)

  for (const sw of switches) {
    const drops = []
    for (const info of trayInfo) {
      const c = closestPointOnPolyline({ x: sw.x, y: sw.y }, info.tray.points, info.cum)
      if (c.d <= info.magnet) {
        drops.push({
          trayId: info.tray.id,
          footXy: { x: c.foot.x, y: c.foot.y },
          dropPx: c.d,
          magnetPx: info.magnet,
        })
      }
    }
    out.set(sw.id, { snapped: drops.length > 0, drops })
  }
  return out
}
