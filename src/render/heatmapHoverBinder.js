import { probeAt } from '@/features/heatmap/hoverProbe'
import { buildFloorScenario } from '@/features/heatmap/buildCrossFloor'
import { getHeatmapField } from './heatmapFrameBus'
import { withOnlyBand } from '@/utils/apRadios'
import { BAND_MAP_BANDS, BAND_MAP_NO_SIGNAL_DBM, classifyBand } from '@/features/heatmap/bandMap'

// 57-17: bilinear read of one metric grid at (x, y) metres; NaN neighbours
// fall back to the nearest sample. Returns undefined outside the grid.
// 58-12: `stride` / `off` read one channel of the packed band field (4
// floats per cell).
function sampleGrid(f, grid, x, y, stride = 1, off = 0) {
  if (!grid) return undefined
  const gx = (x - f.originX) / f.stepM
  const gy = (y - f.originY) / f.stepM
  if (gx < 0 || gy < 0 || gx > f.nx - 1 || gy > f.ny - 1) return undefined
  const i0 = Math.floor(gx), j0 = Math.floor(gy)
  const i1 = Math.min(i0 + 1, f.nx - 1), j1 = Math.min(j0 + 1, f.ny - 1)
  const tx = gx - i0, ty = gy - j0
  const at = (j, i) => grid[(j * f.nx + i) * stride + off]
  const v00 = at(j0, i0), v10 = at(j0, i1)
  const v01 = at(j1, i0), v11 = at(j1, i1)
  const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty
  if (Number.isFinite(v)) return v
  const near = at(Math.round(gy), Math.round(gx))
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
  useClientViewStore = null,
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
    // 57-28: noise floor / min interfering RSSI live in the scenario's `rf`.
    const cv = useClientViewStore?.getState()
    const rfSig = cv ? `${JSON.stringify(cv.noiseFloor)}::${cv.minInterferingRssiDbm}` : ''
    const sig = `${activeFloorId}::${bandFilter}::${domainId}::${rfSig}`
    if (sig === cachedSig && cachedScenario !== undefined) return cachedScenario
    cachedSig = sig
    const sc = buildFloorScenario({
      floors,
      floorId: activeFloorId,
      apsByFloor: useAPStore.getState().apsByFloor ?? {},
      wallsByFloor: useWallStore.getState().wallsByFloor ?? {},
      holesByFloor: useFloorHoleStore?.getState().floorHolesByFloor ?? {},
      scopes,
      mapAps: (list) => bandFilter === 'all' ? list : list.map((a) => withOnlyBand(a, bandFilter)).filter(Boolean),
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
    // 58-15 (C5): no radio left (e.g. none the domain allows) -- drop the
    // last reading instead of leaving it up.
    if (!scenario || scenario.aps.length === 0) {
      if (useHoverReadoutStore.getState().reading) useHoverReadoutStore.getState().setReading(null)
      return
    }
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
      // 58-12: band map -- each band's painted RSSI here and the band a
      // phone would join (same rule as the paint).
      if (field.band) {
        const r = BAND_MAP_BANDS.map((b, slot) => sampleGrid(field, field.band, rx.x, rx.y, 4, slot) ?? BAND_MAP_NO_SIGNAL_DBM)
        probe.bandMap = { rssiByBand: { 2.4: r[0], 5: r[1], 6: r[2] }, ...classifyBand(r[0], r[1], r[2]) }
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
  // 58-7: a band switch also drops the reading -- its per-band rows belong
  // to the old band until the pointer moves again.
  let lastBand = useHeatmapStore.getState().bandFilter
  const unsubHeatmap = useHeatmapStore.subscribe((s) => {
    invalidate()
    if (s.bandFilter !== lastBand) {
      lastBand = s.bandFilter
      if (useHoverReadoutStore.getState().reading) useHoverReadoutStore.getState().setReading(null)
    }
  })

  // 58-15 (C5): so does a domain switch -- radios it rules out are gone from
  // the scenario.
  let lastDomain = useEditorStore?.getState().regulatoryDomain
  const unsubEditor = useEditorStore ? useEditorStore.subscribe((s) => {
    if (s.regulatoryDomain === lastDomain) return
    lastDomain = s.regulatoryDomain
    invalidate()
    if (useHoverReadoutStore.getState().reading) useHoverReadoutStore.getState().setReading(null)
  }) : () => {}

  stage.on('pointermove', onMove)
  // The readout follows the cursor (CursorTip): off the canvas it goes.
  const canvasEl = scene.app.canvas
  const onLeave = () => {
    if (useHoverReadoutStore.getState().reading) useHoverReadoutStore.getState().setReading(null)
  }
  canvasEl?.addEventListener('pointerleave', onLeave)

  return () => {
    unsubEditor()
    unsubFloor()
    unsubWall()
    unsubAP()
    unsubScope()
    unsubHole()
    unsubHeatmap()
    stage.off('pointermove', onMove)
    canvasEl?.removeEventListener('pointerleave', onLeave)
    useHoverReadoutStore.getState().setReading(null)
  }
}
