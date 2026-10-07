import { probeAt } from '@/features/heatmap/hoverProbe'
import { buildFloorScenario } from '@/features/heatmap/buildCrossFloor'
import { getHeatmapField } from './heatmapFrameBus'

// 57-17: bilinear read of one metric grid at (x, y) metres; NaN neighbours
// fall back to the nearest sample. Returns undefined outside the grid.
function sampleGrid(f, grid, x, y) {
  if (!grid) return undefined
  const gx = (x - f.originX) / f.stepM
  const gy = (y - f.originY) / f.stepM
  if (gx < 0 || gy < 0 || gx > f.nx - 1 || gy > f.ny - 1) return undefined
  const i0 = Math.floor(gx), j0 = Math.floor(gy)
  const i1 = Math.min(i0 + 1, f.nx - 1), j1 = Math.min(j0 + 1, f.ny - 1)
  const tx = gx - i0, ty = gy - j0
  const v00 = grid[j0 * f.nx + i0], v10 = grid[j0 * f.nx + i1]
  const v01 = grid[j1 * f.nx + i0], v11 = grid[j1 * f.nx + i1]
  const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty
  if (Number.isFinite(v)) return v
  const near = grid[Math.round(gy) * f.nx + Math.round(gx)]
  return Number.isFinite(near) ? near : undefined
}

// Wires stage pointermove → heatmap probe → useHoverReadoutStore.
// Rebuilds the scenario lazily (cached by reference signature) so per-
// mousemove cost stays in the per-AP rssiFromAp loop only.

const THROTTLE_MS = 33  // ~30 hz

export function bindHeatmapHover({
  scene,
  useFloorStore,
  useWallStore,
  useAPStore,
  useScopeStore,
  useHeatmapStore,
  useHoverReadoutStore,
  useFloorHoleStore = null,
  useEditorStore = null,
}) {
  const stage = scene.app.stage
  let lastFireAt = 0
  let cachedSig = ''
  let cachedScenario = null

  // 57-17: same scenario the heatmap computes (cross-floor, rx 1.0 m, band
  // filter) -- it supplies the per-AP list / strongest AP; the four metric
  // numbers come from the painted field when one is available.
  const getScenario = () => {
    const { floors, activeFloorId } = useFloorStore.getState()
    const floor = floors.find((f) => f.id === activeFloorId)
    if (!floor || !floor.scale) return null
    const scopes = useScopeStore
      ? (useScopeStore.getState().scopesByFloor?.[activeFloorId] ?? [])
      : []
    const bandFilter = useHeatmapStore.getState().bandFilter || 'all'
    // 57-23: the regulatory domain sets each AP's EIRP-capped TX power.
    const domainId = useEditorStore?.getState().regulatoryDomain ?? ''
    const sig = `${activeFloorId}::${bandFilter}::${domainId}`
    if (sig === cachedSig && cachedScenario !== undefined) return cachedScenario
    cachedSig = sig
    const sc = buildFloorScenario({
      floors,
      floorId: activeFloorId,
      apsByFloor: useAPStore.getState().apsByFloor ?? {},
      wallsByFloor: useWallStore.getState().wallsByFloor ?? {},
      holesByFloor: useFloorHoleStore?.getState().floorHolesByFloor ?? {},
      scopes,
      mapAps: (list) => bandFilter === 'all' ? list : list.filter((a) => String(a.frequency) === bandFilter),
    })
    cachedScenario = sc && sc.aps.length > 0 ? sc : null
    return cachedScenario
  }

  const invalidate = () => { cachedSig = '' }

  const onMove = (e) => {
    const hm = useHeatmapStore.getState()
    if (!hm.enabled) {
      if (useHoverReadoutStore.getState().reading) {
        useHoverReadoutStore.getState().setReading(null)
      }
      return
    }
    const now = performance.now()
    if (now - lastFireAt < THROTTLE_MS) return
    lastFireAt = now

    const scenario = getScenario()
    if (!scenario) return
    const wp = scene.world.toLocal(e.global)
    // Canvas px → meters via floor scale.
    const { floors, activeFloorId } = useFloorStore.getState()
    const floor = floors.find((f) => f.id === activeFloorId)
    if (!floor?.scale) return
    const rx = { x: wp.x / floor.scale, y: wp.y / floor.scale }
    if (rx.x < 0 || rx.y < 0 || rx.x > scenario.size.w || rx.y > scenario.size.h) {
      if (useHoverReadoutStore.getState().reading) {
        useHoverReadoutStore.getState().setReading(null)
      }
      return
    }
    const probe = probeAt(scenario, rx, { reflections: false, diffraction: false })
    if (!probe) return
    // 57-17 (option B): report the numbers the colours were drawn from. The
    // painted field already has the user's reflection / diffraction settings
    // baked in, so there's no per-move physics cost and no mismatch.
    const field = getHeatmapField()
    if (field && field.floorId === activeFloorId) {
      for (const [key, grid] of [['rssiDbm', field.rssi], ['sinrDb', field.sinr], ['snrDb', field.snr], ['cciDbm', field.cci]]) {
        const v = sampleGrid(field, grid, rx.x, rx.y)
        if (v !== undefined) probe[key] = v
      }
    }
    useHoverReadoutStore.getState().setReading(probe)
  }

  // Scenario cache invalidation when stores mutate.
  const unsubFloor = useFloorStore.subscribe(invalidate)
  const unsubWall = useWallStore.subscribe(invalidate)
  const unsubAP = useAPStore.subscribe(invalidate)
  const unsubScope = useScopeStore ? useScopeStore.subscribe(invalidate) : () => {}
  const unsubHole = useFloorHoleStore ? useFloorHoleStore.subscribe(invalidate) : () => {}
  const unsubHeatmap = useHeatmapStore.subscribe(invalidate)   // band filter

  stage.on('pointermove', onMove)

  return () => {
    unsubFloor()
    unsubWall()
    unsubAP()
    unsubScope()
    unsubHole()
    unsubHeatmap()
    stage.off('pointermove', onMove)
    useHoverReadoutStore.getState().setReading(null)
  }
}
