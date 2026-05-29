import { probeAt } from '@/features/heatmap/hoverProbe'
import { buildScenario } from '@/features/heatmap/buildScenario'

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
}) {
  const stage = scene.app.stage
  let lastFireAt = 0
  let cachedSig = ''
  let cachedScenario = null

  const getScenario = () => {
    const { floors, activeFloorId } = useFloorStore.getState()
    const floor = floors.find((f) => f.id === activeFloorId)
    if (!floor || !floor.scale) return null
    const walls = useWallStore.getState().wallsByFloor[activeFloorId] ?? []
    const aps = useAPStore.getState().apsByFloor[activeFloorId] ?? []
    if (aps.length === 0) return null
    const scopes = useScopeStore
      ? (useScopeStore.getState().scopesByFloor?.[activeFloorId] ?? [])
      : []
    const sig = `${activeFloorId}::${walls.length}::${aps.length}::${scopes.length}::${floor.scale}`
    if (sig === cachedSig && cachedScenario) return cachedScenario
    cachedSig = sig
    cachedScenario = buildScenario(floor, walls, aps, scopes, null)
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
    if (probe) useHoverReadoutStore.getState().setReading(probe)
  }

  // Scenario cache invalidation when stores mutate.
  const unsubFloor = useFloorStore.subscribe(invalidate)
  const unsubWall = useWallStore.subscribe(invalidate)
  const unsubAP = useAPStore.subscribe(invalidate)
  const unsubScope = useScopeStore ? useScopeStore.subscribe(invalidate) : () => {}

  stage.on('pointermove', onMove)

  return () => {
    unsubFloor()
    unsubWall()
    unsubAP()
    unsubScope()
    stage.off('pointermove', onMove)
    useHoverReadoutStore.getState().setReading(null)
  }
}
