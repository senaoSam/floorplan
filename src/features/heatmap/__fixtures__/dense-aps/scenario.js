// Dense-APs fixture (HM-T5).
//
// Purpose: exercise the F5g aggregated path AND the F5h cascade gate, which
// only triggers when apCount ≥ 50. basic and refl-min both fall under that
// threshold, so without a fixture this size, the cascade code path has no
// test coverage and the bench harness has no realistic high-AP scenario.
//
// **Known issue surfaced by this fixture (filed for follow-up)**: shader
// vs JS friis-baseline diff on this scene is ~33 dB on ~80 / 9600 cells
// (98% identical, but isolated outliers up to 33 dB). Outliers cluster on
// rows where ray endpoints sit on perimeter / cubicle wall corners, so
// shader fp32's segSegIntersect t/u boundary check excludes hits that JS
// fp64 still includes. Same class as HM-F5c-fix's reflection outliers but
// in the direct-path scalar path. Cascade (F5h) is innocent: same diff
// observed with cascade disabled (apCount = 49 → gate off). Tracking this
// as part of the F5c-fix scope; dense-aps becomes the regression fixture
// when it lands.
//
// Scene shape:
//   • Single floor 60 m × 40 m, scale 10 px/m
//   • 100 APs in a 10 × 10 jittered grid spanning the whole floor — placed
//     deterministically via a seeded LCG so the field-full / field-friis
//     baselines are reproducible
//   • ~600 walls: a 12-room office partition pattern + a few metal islands
//     to give wall DDA something to grind on; each wall is 4–8 m long, all
//     at full ceiling height so the Z filter is a no-op
//   • Mixed 5 GHz channels (36/40/44/48 with 20/40 MHz widths) so the SINR
//     loop has enough co-channel interferers to be non-trivial
//   • ~30 % of APs are directional (azimuth + 60° beamwidth) so the antenna
//     gain branches in the shader get exercised at scale
//   • Single in-scope rectangle covering the whole floor (no scope mask
//     edge cases — those are basic's job)
//
// Why 100 APs and not 200: keeps JS-baseline build time around ~30 s on a
// laptop. Cascade still triggers identically (gate is ≥ 50) and bench
// numbers are easy to extrapolate. Bumping up later just requires editing
// AP_COUNT and re-running `pnpm heatmap:golden dense-aps`.

import { MATERIALS, DEFAULT_FLOOR_SLAB_DB, DEFAULT_FLOOR_SLAB_MATERIAL_ID } from '@/constants/materials'

const FLOOR_W_M = 60
const FLOOR_H_M = 40
const SCALE = 10
const IMG_W = FLOOR_W_M * SCALE   // 600 px
const IMG_H = FLOOR_H_M * SCALE   // 400 px

const AP_GRID_X = 10
const AP_GRID_Y = 10
const AP_COUNT  = AP_GRID_X * AP_GRID_Y

export const floors = [
  {
    id: 'floor-0',
    name: 'Dense',
    imageWidth: IMG_W,
    imageHeight: IMG_H,
    scale: SCALE,
    rotation: 0,
    floorHeight: 3,
    floorSlabMaterialId: DEFAULT_FLOOR_SLAB_MATERIAL_ID,
    floorSlabAttenuationDb: DEFAULT_FLOOR_SLAB_DB,
  },
]

const ACTIVE_FLOOR_ID = 'floor-0'

// Seeded LCG so AP positions / channels / antenna parameters are
// deterministic. Numerical recipes Park-Miller constants. Seed picked
// arbitrarily — any non-zero uint32 works; record it here so future edits
// can keep continuity if needed.
function lcg(seed) {
  let state = seed >>> 0
  return () => {
    state = Math.imul(state, 48271) >>> 0
    state = state % 0x7fffffff
    return state / 0x7fffffff
  }
}

const rand = lcg(0xBADC0FFE)

// ---- walls ----
//
// Pattern: a 4 × 3 grid of rooms (walls running every 15 m horizontally,
// every 13.3 m vertically) with door openings, plus a few standalone metal
// islands to vary materials.
const WALL_TOP_M = 3
const wallsRaw = []
let nextWallId = 0
function pushWall(ax, ay, bx, by, material, openings = []) {
  wallsRaw.push({
    id: `w-${nextWallId++}`,
    startX: ax * SCALE, startY: ay * SCALE,
    endX:   bx * SCALE, endY:   by * SCALE,
    material,
    bottomHeight: 0,
    topHeight: WALL_TOP_M,
    openings,
  })
}

// Outer perimeter (4 walls) — concrete.
pushWall(0, 0, FLOOR_W_M, 0, MATERIALS.CONCRETE)
pushWall(FLOOR_W_M, 0, FLOOR_W_M, FLOOR_H_M, MATERIALS.CONCRETE)
pushWall(FLOOR_W_M, FLOOR_H_M, 0, FLOOR_H_M, MATERIALS.CONCRETE)
pushWall(0, FLOOR_H_M, 0, 0, MATERIALS.CONCRETE)

// Internal partitions — drywall with one door opening per partition.
// Vertical partitions at x = 15, 30, 45 (3 walls × full height = 3).
let nextOpeningId = 0
const door = (frac) => [{
  id: `op-${nextOpeningId++}`,
  startFrac: frac - 0.05,
  endFrac:   frac + 0.05,
  type: 'door',
  material: MATERIALS.WOOD,
  bottomHeight: 0,
  topHeight: 2.1,
}]
for (const x of [15, 30, 45]) {
  pushWall(x, 0, x, FLOOR_H_M, MATERIALS.DRYWALL, door(0.35))
}
// Horizontal partitions at y = 13.3, 26.6 (2 walls × full width = 2).
for (const y of [13.33, 26.66]) {
  pushWall(0, y, FLOOR_W_M, y, MATERIALS.DRYWALL, door(0.5))
}

// Metal islands — small enclosed boxes in 3 rooms to make reflection /
// wall-loss code paths see metal even with reflection off (metal still
// adds a heavy direct-path loss).
function pushMetalBox(cx, cy, w, h) {
  const x0 = cx - w / 2, y0 = cy - h / 2
  const x1 = cx + w / 2, y1 = cy + h / 2
  pushWall(x0, y0, x1, y0, MATERIALS.METAL)
  pushWall(x1, y0, x1, y1, MATERIALS.METAL)
  pushWall(x1, y1, x0, y1, MATERIALS.METAL)
  pushWall(x0, y1, x0, y0, MATERIALS.METAL)
}
pushMetalBox(7,  6,  3, 2)
pushMetalBox(22, 20, 4, 3)
pushMetalBox(50, 33, 3, 2)

// Many small drywall stubs — split each room into cubicles. Adds ~520
// short walls so total wall count crosses 600.
const cubicleCols = 12
const cubicleRows = 8
const cubW = FLOOR_W_M / cubicleCols
const cubH = FLOOR_H_M / cubicleRows
for (let cy = 0; cy < cubicleRows; cy++) {
  for (let cx = 0; cx < cubicleCols; cx++) {
    const x0 = cx * cubW
    const y0 = cy * cubH
    // Half-walls jutting in from each cubicle's NW corner — random
    // orientation so the grid acceleration sees both axes.
    if (rand() > 0.35) {
      const len = 1.5 + rand() * 1.5
      pushWall(x0 + 0.5, y0 + 0.5, x0 + 0.5 + len, y0 + 0.5, MATERIALS.DRYWALL)
    }
    if (rand() > 0.35) {
      const len = 1.5 + rand() * 1.5
      pushWall(x0 + 0.5, y0 + 0.5, x0 + 0.5, y0 + 0.5 + len, MATERIALS.DRYWALL)
    }
  }
}

export const wallsByFloor = {
  'floor-0': wallsRaw,
}

// ---- APs ----
//
// 10×10 grid with up to ±2 m jitter per axis. Channels cycle through
// {36, 40, 44, 48} so groups of co-channel APs exist at every spatial
// scale (cascade can't accidentally null out CCI loops).
const CHANNELS = [36, 40, 44, 48]
const CHANNEL_WIDTHS = [20, 40]
const apsRaw = []
const apCellW = FLOOR_W_M / AP_GRID_X
const apCellH = FLOOR_H_M / AP_GRID_Y
for (let gy = 0; gy < AP_GRID_Y; gy++) {
  for (let gx = 0; gx < AP_GRID_X; gx++) {
    const idx = gy * AP_GRID_X + gx
    const cx = (gx + 0.5) * apCellW + (rand() - 0.5) * 2.0
    const cy = (gy + 0.5) * apCellH + (rand() - 0.5) * 2.0
    const ch = CHANNELS[idx % CHANNELS.length]
    const bw = CHANNEL_WIDTHS[(idx >> 2) & 1]
    const isDirectional = rand() < 0.30
    apsRaw.push({
      id: `ap-${idx}`,
      name: `AP-${idx}`,
      x: cx * SCALE,
      y: cy * SCALE,
      z: 2.7,
      frequency: 5,
      channel: ch,
      channelWidth: bw,
      txPower: 20,
      antennaMode: isDirectional ? 'directional' : 'omni',
      azimuth:    isDirectional ? Math.floor(rand() * 360) : 0,
      beamwidth:  isDirectional ? 60 : 360,
      mountType: 'ceiling',
    })
  }
}

export const apsByFloor = {
  'floor-0': apsRaw,
}

export const scopesByFloor = {
  'floor-0': [
    {
      id: 'scope-in',
      type: 'in',
      points: [0, 0, IMG_W, 0, IMG_W, IMG_H, 0, IMG_H],
    },
  ],
}

export const floorHolesByFloor = {
  'floor-0': [],
}

export const engineOpts = {
  gridStepM: 0.5,
  maxReflOrder: 0,
  enableDiffraction: false,
  rxHeightM: 1.0,
}

export const meta = {
  fixtureId: 'dense-aps',
  activeFloorId: ACTIVE_FLOOR_ID,
  description: `${AP_COUNT} APs (10×10 jittered grid) + ~600 walls (cubicle pattern + metal islands). Triggers HM-F5h cascade gate (apCount ≥ 50).`,
}
