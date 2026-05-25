// Dense-walls fixture (HM-T5).
//
// Purpose: stress wall-loss accumulation when many walls intersect a single
// AP→rx ray. dense-aps has ~600 walls but they're spread across a 60 × 40 m
// floor — typical AP→rx rays cross 2-4 walls. This fixture compresses ~50
// mixed-material walls into 30 × 20 m, so common rays cross 6-10 walls and
// the grid DDA's SEEN_BUF cyclic-dedup buffer, Z filter, oblique-loss, and
// HM-F8 frequency scaling all stack up per ray.
//
// **Regression fixture for SEEN_BUF**: original SEEN_BUF=8 surfaced 5 dB
// RSSI / 14 dB CCI shader drift on the friis baseline because rays through
// the corridor maze touch >8 walls per cell-cluster and the cyclic buffer
// rolled over, leading to double-counted wall losses. Bumping to
// SEEN_BUF=16 cleared all 4 channels to ≤ 0.1 dB.
//
// **Scope**: F5a/F5b friis baseline only (refl=off, diff=off). Reflections
// are intentionally disabled — dense-wall + metal scenarios trigger the
// known fp32 destructive-cancellation outliers (HM-F5c-fix-2) on grid-
// aligned rx samples, which is a different physics class and is already
// covered by basic + dense-aps. dense-walls focuses on wall accumulation.
//
// Scene shape:
//   • Single floor 30 m × 20 m, scale 20 px/m
//   • 3 APs: centre, corner, mid-edge (5 GHz, mixed channels for SINR/CCI)
//   • ~50 walls: concrete perimeter (with windows), drywall corridor maze
//     (with doors), brick/wood interior — no metal (avoids fp32 metal-axis
//     destructive-interference that's covered by basic / dense-aps)
//   • 1 in-scope rectangle covering the whole floor

import { MATERIALS, DEFAULT_FLOOR_SLAB_DB, DEFAULT_FLOOR_SLAB_MATERIAL_ID } from '@/constants/materials'

const FLOOR_W_M = 30
const FLOOR_H_M = 20
const SCALE = 20
const IMG_W = FLOOR_W_M * SCALE
const IMG_H = FLOOR_H_M * SCALE

export const floors = [
  {
    id: 'floor-0',
    name: 'Dense Walls',
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

let nextOpeningId = 0
const door = (frac) => [{
  id: `op-${nextOpeningId++}`,
  startFrac: frac - 0.06,
  endFrac:   frac + 0.06,
  type: 'door',
  material: MATERIALS.WOOD,
  bottomHeight: 0,
  topHeight: 2.1,
}]
const window = (frac) => [{
  id: `op-${nextOpeningId++}`,
  startFrac: frac - 0.08,
  endFrac:   frac + 0.08,
  type: 'window',
  material: MATERIALS.GLASS,
  bottomHeight: 0.9,
  topHeight: 2.4,
}]

// ---- Outer perimeter (4 concrete walls, with one window on each side) ----
pushWall(0, 0, FLOOR_W_M, 0, MATERIALS.CONCRETE, window(0.5))
pushWall(FLOOR_W_M, 0, FLOOR_W_M, FLOOR_H_M, MATERIALS.CONCRETE, window(0.5))
pushWall(FLOOR_W_M, FLOOR_H_M, 0, FLOOR_H_M, MATERIALS.CONCRETE, window(0.5))
pushWall(0, FLOOR_H_M, 0, 0, MATERIALS.CONCRETE, window(0.5))

// ---- Drywall corridor maze ----
// Vertical partitions every 5 m (with door openings at varying positions)
// — splits the floor into 6 columns. Each partition spans the full height
// except at the door slot.
for (let i = 1; i < 6; i++) {
  const x = i * 5
  pushWall(x, 0, x, FLOOR_H_M, MATERIALS.DRYWALL, door(0.2 + (i & 1) * 0.4))
}

// Horizontal partitions every 5 m (with door openings) — splits each column
// into 4 rooms.
for (let j = 1; j < 4; j++) {
  const y = j * 5
  pushWall(0, y, FLOOR_W_M, y, MATERIALS.DRYWALL, door(0.15 + (j & 1) * 0.5))
}

// ---- Brick interior walls (3 segments, off-axis to break grid alignment) ----
pushWall(2.5, 7.5, 7.5, 12.5, MATERIALS.BRICK)
pushWall(13, 3, 18, 7, MATERIALS.BRICK)
pushWall(22, 12, 27, 17, MATERIALS.BRICK)

// ---- Wood stubs (8 short walls, jut into rooms from the partitions) ----
const woodStubs = [
  [6, 3, 8, 3], [11, 8, 13, 8], [17, 13, 19, 13], [22, 17, 24, 17],
  [3, 12, 3, 14], [8, 4, 8, 6], [16, 9, 16, 11], [25, 6, 25, 8],
]
for (const [ax, ay, bx, by] of woodStubs) {
  pushWall(ax, ay, bx, by, MATERIALS.WOOD)
}

export const wallsByFloor = {
  'floor-0': wallsRaw,
}

// ---- APs ----
//
// 3 APs spanning corner / mid-edge / centre so AP→rx rays exercise the
// densest part of the maze from multiple angles. All 5 GHz, two co-channel
// (CCI exercise) and one on a different channel.
const apsRaw = [
  {
    id: 'ap-corner', name: 'AP-Corner',
    x: 3 * SCALE, y: 3 * SCALE, z: 2.7,
    frequency: 5, channel: 36, channelWidth: 40,
    txPower: 20, antennaMode: 'omni',
    azimuth: 0, beamwidth: 360,
    mountType: 'ceiling',
  },
  {
    id: 'ap-centre', name: 'AP-Centre',
    x: 15 * SCALE, y: 10 * SCALE, z: 2.7,
    frequency: 5, channel: 36, channelWidth: 40,
    txPower: 20, antennaMode: 'omni',
    azimuth: 0, beamwidth: 360,
    mountType: 'ceiling',
  },
  {
    id: 'ap-edge', name: 'AP-Edge',
    x: 27 * SCALE, y: 17 * SCALE, z: 2.7,
    frequency: 5, channel: 44, channelWidth: 20,
    txPower: 20, antennaMode: 'omni',
    azimuth: 0, beamwidth: 360,
    mountType: 'ceiling',
  },
]

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
  fixtureId: 'dense-walls',
  activeFloorId: ACTIVE_FLOOR_ID,
  description: '3 APs + ~50 walls (concrete perimeter w/ windows, drywall corridor maze w/ doors, brick/wood interior). Friis-only — stresses SEEN_BUF cyclic-dedup buffer in dense wall scenarios.',
}
