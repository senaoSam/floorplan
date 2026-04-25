// Deterministic scenario for the basic golden fixture (HM-T1).
//
// This file is the single source of truth for the input. `build-golden.mjs`
// imports it, runs the JS heatmap engine, and emits `field.json` + `meta.json`
// next to it. The diff harness (HM-T2) imports this same scenario, recomputes
// the field with the current engine, and compares against `field.json`.
//
// Coverage rationale (per the discussion that produced HM-T1):
//   - 3 APs: two co-channel 5 GHz on floor 0 to exercise SINR/CCI aggregation,
//     plus one 2.4 GHz directional on floor 1 to exercise per-AP frequency,
//     antenna pattern, and cross-floor slab attenuation.
//   - 10 walls (5 per floor) mixing concrete/drywall/glass/metal/brick/wood
//     so wall lossOblique + Fresnel epsC code paths see every material.
//   - 2 openings: one wood door on a floor-0 wall, one glass window on a
//     floor-1 wall, exercising the wall-segment expansion path.
//   - 1 in-scope polygon covering most of the canvas, plus 1 floor hole that
//     bypasses the slab between floor 0 and floor 1.
//   - rxHeightM = 1.0 (matches HeatmapLayer default).

import { MATERIALS, DEFAULT_FLOOR_SLAB_DB, DEFAULT_FLOOR_SLAB_MATERIAL_ID } from '@/constants/materials'

// Canvas size in pixels; scale = 20 px/m → world = 30 m × 20 m.
const IMG_W = 600
const IMG_H = 400
const SCALE = 20

// Two floors, 3 m apart, both with default concrete slab attenuation.
export const floors = [
  {
    id: 'floor-0',
    name: 'Ground',
    imageWidth: IMG_W,
    imageHeight: IMG_H,
    scale: SCALE,
    rotation: 0,
    floorHeight: 3,
    floorSlabMaterialId: DEFAULT_FLOOR_SLAB_MATERIAL_ID,
    floorSlabAttenuationDb: DEFAULT_FLOOR_SLAB_DB,
  },
  {
    id: 'floor-1',
    name: 'Upper',
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

// Walls — px coordinates. topHeight/bottomHeight in metres above the floor's
// own ground level (matches what UI emits).
export const wallsByFloor = {
  'floor-0': [
    // Concrete partition with a wood door (door at fractional 0.4–0.6).
    {
      id: 'w0-concrete-door',
      startX: 100, startY: 80, endX: 100, endY: 320,
      material: MATERIALS.CONCRETE,
      bottomHeight: 0, topHeight: 3,
      openings: [
        {
          id: 'w0-door',
          type: 'door',
          startFrac: 0.4, endFrac: 0.6,
          material: MATERIALS.WOOD,
          bottomHeight: 0, topHeight: 2.1,
        },
      ],
    },
    // Drywall horizontal divider, full height.
    {
      id: 'w0-drywall',
      startX: 100, startY: 200, endX: 500, endY: 200,
      material: MATERIALS.DRYWALL,
      bottomHeight: 0, topHeight: 3,
    },
    // Brick exterior segment.
    {
      id: 'w0-brick',
      startX: 500, startY: 80, endX: 500, endY: 320,
      material: MATERIALS.BRICK,
      bottomHeight: 0, topHeight: 3,
    },
    // Half-height metal partition (counter-style) — should be transparent
    // to rays whose Z sits above topHeight=1.2 m. Exercises HM-F2e.
    {
      id: 'w0-metal-half',
      startX: 200, startY: 200, endX: 200, endY: 320,
      material: MATERIALS.METAL,
      bottomHeight: 0, topHeight: 1.2,
    },
    // Glass full-height.
    {
      id: 'w0-glass',
      startX: 300, startY: 80, endX: 400, endY: 80,
      material: MATERIALS.GLASS,
      bottomHeight: 0, topHeight: 3,
    },
  ],
  'floor-1': [
    // Concrete shaft wall with a glass window.
    {
      id: 'w1-concrete-window',
      startX: 150, startY: 100, endX: 450, endY: 100,
      material: MATERIALS.CONCRETE,
      bottomHeight: 0, topHeight: 3,
      openings: [
        {
          id: 'w1-window',
          type: 'window',
          startFrac: 0.45, endFrac: 0.65,
          material: MATERIALS.GLASS,
          bottomHeight: 1.0, topHeight: 2.2,
        },
      ],
    },
    // Wood interior wall.
    {
      id: 'w1-wood',
      startX: 200, startY: 100, endX: 200, endY: 300,
      material: MATERIALS.WOOD,
      bottomHeight: 0, topHeight: 3,
    },
    // Drywall partition.
    {
      id: 'w1-drywall',
      startX: 350, startY: 100, endX: 350, endY: 300,
      material: MATERIALS.DRYWALL,
      bottomHeight: 0, topHeight: 3,
    },
    // Brick column.
    {
      id: 'w1-brick',
      startX: 200, startY: 300, endX: 350, endY: 300,
      material: MATERIALS.BRICK,
      bottomHeight: 0, topHeight: 3,
    },
    // Concrete short stub at high elevation — only blocks rays above 1.5 m.
    {
      id: 'w1-concrete-high',
      startX: 250, startY: 200, endX: 320, endY: 200,
      material: MATERIALS.CONCRETE,
      bottomHeight: 1.5, topHeight: 3,
    },
  ],
}

// 3 APs:
//   ap-a, ap-b: floor-0, both 5 GHz Ch36@40 — co-channel SINR/CCI exercise.
//   ap-c:      floor-1, 2.4 GHz Ch6@20 directional — per-AP frequency,
//              antenna pattern, cross-floor slab attenuation.
export const apsByFloor = {
  'floor-0': [
    {
      id: 'ap-a',
      name: 'AP-A',
      x: 200, y: 150, z: 2.7,
      frequency: 5, channel: 36, channelWidth: 40,
      txPower: 20,
      antennaMode: 'omni',
      mountType: 'ceiling',
    },
    {
      id: 'ap-b',
      name: 'AP-B',
      x: 420, y: 260, z: 2.7,
      frequency: 5, channel: 36, channelWidth: 40,
      txPower: 18,
      antennaMode: 'omni',
      mountType: 'ceiling',
    },
  ],
  'floor-1': [
    {
      id: 'ap-c',
      name: 'AP-C',
      x: 300, y: 200, z: 2.5,
      frequency: 2.4, channel: 6, channelWidth: 20,
      txPower: 17,
      antennaMode: 'directional',
      azimuth: 90, beamwidth: 90,
      mountType: 'ceiling',
    },
  ],
}

// In-scope polygon (covers ~90 % of the canvas). Out-of-scope rectangle
// in the bottom-right corner so the mask actually filters something.
export const scopesByFloor = {
  'floor-0': [
    {
      id: 'scope-in',
      type: 'in',
      points: [40, 40, 580, 40, 580, 360, 40, 360],
    },
    {
      id: 'scope-out',
      type: 'out',
      points: [500, 280, 580, 280, 580, 360, 500, 360],
    },
  ],
  'floor-1': [],
}

// One floor hole spanning floor-0 → floor-1 (bypasses the slab between them).
export const floorHolesByFloor = {
  'floor-0': [
    {
      id: 'hole-atrium',
      points: [80, 240, 160, 240, 160, 320, 80, 320],
      bottomFloorId: 'floor-0',
      topFloorId: 'floor-1',
    },
  ],
  'floor-1': [],
}

// Engine options — match HeatmapLayer's runtime defaults so the fixture
// matches what the user actually sees.
export const engineOpts = {
  gridStepM: 0.5,
  maxReflOrder: 1,
  enableDiffraction: true,
  rxHeightM: 1.0,
}

export const meta = {
  fixtureId: 'basic',
  activeFloorId: ACTIVE_FLOOR_ID,
  description: '3 APs (two co-channel 5GHz + one directional 2.4GHz upstairs), 10 walls, 1 door, 1 window, 1 atrium hole, 1 in-scope, 1 out-scope.',
}
