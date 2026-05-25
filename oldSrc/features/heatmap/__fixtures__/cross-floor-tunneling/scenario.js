// Cross-floor tunneling fixture (HM-T5).
//
// Purpose: isolate the cross-floor slab-loss path so HM-F3a (per-slab dB
// accumulation) and HM-F3c (oblique-incidence sec(θ) magnification) get
// dedicated regression coverage. basic has cross-floor geometry but mostly
// vertical (cosθ ≈ 1, sec ≈ 1) and a hole that bypasses the slab — so the
// sec(θ) clamp at 3.5 has never been hit by any fixture.
//
// Scene shape:
//   • 5 floors stacked, each 3 m tall (slab boundaries at 3 / 6 / 9 / 12 m)
//   • Single concrete slab attenuation (12 dB anchor at 2.4 GHz)
//   • 1 AP on the TOP floor (floor-4) at z = 11.5 m, x = 15 m, y = 10 m
//   • NO walls — slab loss is the only dB term beyond Friis. Wall coverage
//     is basic / dense-walls' job.
//   • NO floor holes — every cross-floor ray pays full slab loss.
//   • Active floor = floor-0 (ground). RX height 1.0 m → vertical drop
//     ~10.5 m, with rx points spread horizontally so AP→rx cos(θ) sweeps
//     from 1.0 (directly below) down to ~0.4 (near sec(θ) cap).
//
// What the diff catches:
//   - Slab dB accumulation per crossing (4 slabs between AP and ground rx)
//   - sec(θ) magnification: rays at shallow angles see slab × min(sec, 3.5)
//   - sec(θ) cap at 3.5: corner rays should saturate, not blow up
//   - Per-AP frequency (5 GHz) drives Friis only — slab loss is wideband-
//     constant by design (slabs use floorSlabAttenuationDb, not lossB).
//
// Reflections + diffraction off — slab path is the focus, not multipath.

import { DEFAULT_FLOOR_SLAB_DB, DEFAULT_FLOOR_SLAB_MATERIAL_ID } from '@/constants/materials'

const IMG_W = 600
const IMG_H = 400
const SCALE = 20         // 20 px/m → world 30 × 20 m
const FLOOR_HEIGHT = 3   // m

// 5 floors stacked. Sidebar order (top → bottom in UI list) is the reverse
// of the elevation stack — floor-4 is highest in the world, floor-0 lowest.
function makeFloor(idx) {
  return {
    id: `floor-${idx}`,
    name: idx === 0 ? 'Ground' : `Level ${idx}`,
    imageWidth: IMG_W,
    imageHeight: IMG_H,
    scale: SCALE,
    rotation: 0,
    floorHeight: FLOOR_HEIGHT,
    floorSlabMaterialId: DEFAULT_FLOOR_SLAB_MATERIAL_ID,
    floorSlabAttenuationDb: DEFAULT_FLOOR_SLAB_DB,
  }
}
export const floors = [
  makeFloor(0),
  makeFloor(1),
  makeFloor(2),
  makeFloor(3),
  makeFloor(4),
]

const ACTIVE_FLOOR_ID = 'floor-0'

export const wallsByFloor = {
  'floor-0': [], 'floor-1': [], 'floor-2': [], 'floor-3': [], 'floor-4': [],
}

// Single AP on the top floor, near one corner of the canvas. Horizontal
// rx grid sweeps from directly below (corner) to ~25 m away — sec(θ)
// progressively grows along the diagonal and saturates at the 3.5 cap
// once the ray's vertical/horizontal ratio crosses 1/√(3.5²-1) ≈ 0.295.
export const apsByFloor = {
  'floor-0': [], 'floor-1': [], 'floor-2': [], 'floor-3': [],
  'floor-4': [
    {
      id: 'ap-tunnel',
      name: 'AP-Tunnel',
      x: 5 * SCALE,    // x = 5 m
      y: 5 * SCALE,    // y = 5 m
      z: 2.5,          // 2.5 m above floor-4 = world z 14.5 m
      frequency: 5, channel: 36, channelWidth: 20,
      txPower: 20,
      antennaMode: 'omni',
      azimuth: 0, beamwidth: 360,
      mountType: 'ceiling',
    },
  ],
}

// Whole-canvas in-scope so the rx grid covers the diagonal sweep.
export const scopesByFloor = {
  'floor-0': [
    {
      id: 'scope-in',
      type: 'in',
      points: [0, 0, IMG_W, 0, IMG_W, IMG_H, 0, IMG_H],
    },
  ],
  'floor-1': [], 'floor-2': [], 'floor-3': [], 'floor-4': [],
}

export const floorHolesByFloor = {
  'floor-0': [], 'floor-1': [], 'floor-2': [], 'floor-3': [], 'floor-4': [],
}

export const engineOpts = {
  gridStepM: 0.5,
  maxReflOrder: 0,
  enableDiffraction: false,
  rxHeightM: 1.0,
}

export const meta = {
  fixtureId: 'cross-floor-tunneling',
  activeFloorId: ACTIVE_FLOOR_ID,
  description: '1 AP on floor-4 (z=14.5 m world), rx grid on floor-0 ground. 5 stacked floors, 4 concrete slabs between AP and rx. No walls / holes / reflections — isolates slab dB accumulation + sec(θ) magnification with cap at 3.5.',
}
