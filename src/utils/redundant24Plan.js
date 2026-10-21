// 58-13: switch off redundant 2.4 GHz radios on one floor.
//
// A 2.4 GHz radio only matters where a phone would actually join 2.4 GHz:
// cells where no 5 / 6 GHz radio reaches BAND_AVAILABLE_RSSI_DBM (Client
// View's band choice, clientView/simulate). Within those cells, the radio's
// share is where it reaches COVERAGE_THRESHOLD_DBM. Like Cisco FRA's coverage
// overlap factor, the radio is redundant when at least COF_MIN of that share
// is also covered by another live 2.4 GHz radio (any floor). Radios are tried
// densest first (most overlapped), one at a time against the radios still on:
//   - a radio left as the only cover of a switched-off radio's share is
//     protected from being switched off itself (FRA's coverage contributor),
//   - the floor's 2.4 GHz coverage of the needing cells may drop by at most
//     MAX_DROP_PCT points in total.
// `legacy`: 2.4-only clients on site -- every cell needs 2.4 GHz (FRA as is).
// A radio is only a candidate while its device keeps another live radio: a
// device switched off as a whole is a removal, not this.
// Direct path only, like Client View and the planners.

import { rssiFromAp } from '@/features/heatmap/propagation'
import { buildFloorScenario } from '@/features/heatmap/buildCrossFloor'
import { BAND_AVAILABLE_RSSI_DBM } from '@/features/clientView/simulate'
import { COVERAGE_THRESHOLD_DBM } from '@/constants/coverage'

export const COF_MIN = 0.95
export const MAX_DROP_PCT = 1
const GRID_STEP_M = 1
const FIELD_OPTS = { maxReflOrder: 0, enableDiffraction: false }
const SLICE_MS = 12
const yieldTask = () => new Promise((r) => setTimeout(r, 0))

// -> { disable: [{ apId, name }], stats } or { error }
export async function runRedundant24Plan({
  floor, aps, floors, apsByFloor, wallsByFloor, holesByFloor, scopes = [], env = null,
  legacy = false, onProgress = null, isCancelled = () => false,
}) {
  const scenario = buildFloorScenario({
    floors, floorId: floor.id,
    apsByFloor: { ...(apsByFloor ?? {}), [floor.id]: aps },
    wallsByFloor, holesByFloor, scopes, env,
  })
  if (!scenario) return { error: 'invalid-floor' }

  const entries = scenario.aps   // live radios (enabled, allowed by the domain)
  const floorIds = new Set(aps.map((a) => a.id))
  const r24 = entries.filter((e) => e.frequency === 2.4)
  const r56 = entries.filter((e) => e.frequency !== 2.4)
  // Devices with another live radio besides 2.4 GHz.
  const keepsOther = new Set(r56.map((e) => e.deviceId))
  const candidates = r24
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => floorIds.has(e.deviceId) && keepsOther.has(e.deviceId))
  if (candidates.length === 0) return { error: 'no-candidates' }

  // Cells: 1 m inside the plan and the scope mask, at receiver height.
  const { w, h } = scenario.size
  const maskFn = scenario.scopeMaskFn ?? (() => true)
  const rxZ = scenario.rxElevationM ?? 0
  const cells = []
  for (let y = 0; y <= h; y += GRID_STEP_M) {
    for (let x = 0; x <= w; x += GRID_STEP_M) if (maskFn(x, y)) cells.push({ x, y, zM: rxZ })
  }
  const propOpts = { ...FIELD_OPTS, floorBoundaries: scenario.floorBoundaries ?? null }
  // Free-space bound (no walls, no slabs) -- only ever higher than the real
  // RSSI, so a radio below the threshold there is below it for sure.
  const reaches = (e, rx, dbm) => rssiFromAp(e, rx, [], [], FIELD_OPTS).rssiDbm >= dbm
    && rssiFromAp(e, rx, scenario.walls, scenario.corners, propOpts).rssiDbm >= dbm

  // Per needing cell: the 2.4 GHz radios (index into r24) covering it.
  const coverers = []
  let sliceStart = performance.now()
  for (let c = 0; c < cells.length; c++) {
    const rx = cells[c]
    const needs = legacy || !r56.some((e) => reaches(e, rx, BAND_AVAILABLE_RSSI_DBM))
    if (needs) {
      const list = []
      for (let k = 0; k < r24.length; k++) if (reaches(r24[k], rx, COVERAGE_THRESHOLD_DBM)) list.push(k)
      coverers.push(list)
    }
    if (performance.now() - sliceStart > SLICE_MS) {
      await yieldTask()
      if (isCancelled()) return null
      onProgress?.((c + 1) / cells.length)
      sliceStart = performance.now()
    }
  }

  const needCells = coverers.length
  const count = coverers.map((l) => l.length)
  const shareOf = r24.map(() => [])
  coverers.forEach((l, c) => { for (const k of l) shareOf[k].push(c) })
  const coveredNow = () => count.reduce((n, v) => n + (v > 0 ? 1 : 0), 0)
  const before = coveredNow()

  // Densest first: the most overlapped share (mean other coverers per cell).
  const density = (k) => (shareOf[k].length === 0 ? Infinity
    : shareOf[k].reduce((s, c) => s + count[c] - 1, 0) / shareOf[k].length)
  const order = candidates.map(({ i }) => i).sort((a, b) => density(b) - density(a))

  const off = new Set()
  const protectedSet = new Set()
  let covered = before
  for (const k of order) {
    if (protectedSet.has(k)) continue
    const share = shareOf[k]
    const othersCover = share.filter((c) => count[c] - 1 >= 1).length
    const cof = share.length === 0 ? 1 : othersCover / share.length
    if (cof < COF_MIN) continue
    const lost = share.length - othersCover
    if (needCells > 0 && ((before - (covered - lost)) / needCells) * 100 > MAX_DROP_PCT) continue
    off.add(k)
    covered -= lost
    for (const c of share) {
      count[c]--
      // The one radio still covering this cell carries the switched-off share.
      if (count[c] === 1) protectedSet.add(coverers[c].find((j) => !off.has(j)))
    }
  }

  const disable = [...off].map((k) => ({ apId: r24[k].deviceId, name: r24[k].name }))
  return {
    disable,
    stats: {
      candidates: candidates.length,
      radios24: r24.filter((e) => floorIds.has(e.deviceId)).length,
      cells: cells.length,
      needCells,
      coverageBefore: needCells ? before / needCells : null,
      coverageAfter: needCells ? covered / needCells : null,
      legacy,
    },
  }
}
