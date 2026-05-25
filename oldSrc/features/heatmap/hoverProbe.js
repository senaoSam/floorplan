// One-off RSSI/SINR readout at an arbitrary point. Used by the hover overlay
// — doesn't touch the sampled field, just runs the physics for a single rx.
import { rssiFromAp, aggregateApContributions } from './propagation'

export function probeAt(scenario, rx, opts = {}) {
  if (!scenario || !scenario.aps.length) return null
  if (scenario.scopeMaskFn && !scenario.scopeMaskFn(rx.x, rx.y)) return null
  const rxAbs = { ...rx, zM: scenario.rxElevationM ?? rx.zM ?? 0 }
  const perAp = scenario.aps.map((ap) =>
    rssiFromAp(ap, rxAbs, scenario.walls, scenario.corners, {
      maxReflOrder: opts.reflections ? 1 : 0,
      // Default off: hover is interactive and the reflection / diffraction JS
      // loops dominate per-mousemove cost. Callers that need full physics
      // (e.g. an offline AP-quality report) must opt in explicitly.
      enableDiffraction: opts.diffraction ?? false,
      floorBoundaries: scenario.floorBoundaries ?? null,
    }).rssiDbm,
  )
  const agg = aggregateApContributions(perAp, scenario.aps)
  return { at: rx, perAp, ...agg, apList: scenario.aps }
}
