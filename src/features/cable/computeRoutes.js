// Stage 3 — fallback Manhattan routing (no tray yet).
// Spec: .claude/cable-spec.md §6 / §7.
//
// For each AP on a floor: pick the nearest same-floor switch (Manhattan
// distance in canvas px), draw an L-shaped polyline (horizontal first, then
// vertical), and compute cable length in meters as:
//
//   cable_m = (|Δx| + |Δy|) × metersPerPx × (1 + slackDirect) + Z_drop(AP)
//   Z_drop(AP) = (floor.floorHeight - ap.z)   // not slacked
//
// If the floor has no switch, the AP is marked `unroutable`.

const SLACK_DIRECT = 0.20

// Canvas-coord L-shape: AP → corner → switch, horizontal leg first.
function lShape(ap, sw) {
  return [
    { x: ap.x, y: ap.y },
    { x: sw.x, y: ap.y },
    { x: sw.x, y: sw.y },
  ]
}

function manhattanPx(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

// Returns Map<apId, route> where route is:
//   { apId, switchId | null, points: [{x,y},...], cableM, zDropM, routeStatus }
//   routeStatus ∈ 'fallback-manhattan' | 'unroutable'
// (Future 12-2: 'tray' state once graph routing lands.)
export function computeRoutes({ floor, aps, switches }) {
  const out = new Map()
  if (!floor || !aps || aps.length === 0) return out

  const pxPerM = floor.scale         // px / m, set by DRAW_SCALE; null until calibrated
  const ceilingHeight = floor.floorHeight ?? 3.0

  for (const ap of aps) {
    if (switches.length === 0) {
      out.set(ap.id, {
        apId: ap.id,
        switchId: null,
        points: null,
        cableM: null,
        zDropM: null,
        routeStatus: 'unroutable',
      })
      continue
    }

    // Pick nearest same-floor switch by Manhattan distance.
    let best = switches[0]
    let bestD = manhattanPx(ap, best)
    for (let i = 1; i < switches.length; i++) {
      const d = manhattanPx(ap, switches[i])
      if (d < bestD) { bestD = d; best = switches[i] }
    }

    const zDropM = Math.max(0, ceilingHeight - (ap.z ?? 0))
    let cableM = null
    if (pxPerM && pxPerM > 0) {
      const xyM = bestD / pxPerM
      cableM = xyM * (1 + SLACK_DIRECT) + zDropM
    }

    out.set(ap.id, {
      apId: ap.id,
      switchId: best.id,
      points: lShape(ap, best),
      cableM,
      zDropM,
      routeStatus: 'fallback-manhattan',
    })
  }

  return out
}
