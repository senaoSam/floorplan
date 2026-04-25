// Minimal reflection fixture (HM-F5c+d debug aid).
//
// One AP + one reflective concrete wall. No openings, no diffraction
// corners-of-interest, no other walls. The whole point is to give the
// reflection-only path the simplest possible scene so a 40 dB diff in
// the basic fixture can be bisected to "is the reflection physics right?"
// without other paths drowning out the signal.
//
// Geometry (chosen so reflection contribution is large enough to be visible
// in dB after multi-frequency averaging — AP close to wall + metal wall to
// maximise |Γ|):
//   • Floor: 20 m × 20 m, scale 30 px/m
//   • Wall:  vertical METAL wall at x=8m, from y=2 to y=18 (16 m long)
//   • AP:    at (4, 10, 2.7), 5 GHz Ch36 @ 40 MHz, omni
//             → only 4 m from the reflector → reflection ~ direct strength
//
// Expected behaviour:
//   • Direct ray strong on AP side (x < 8)
//   • Reflected ray off the metal wall (Γ = -1, no Fresnel attenuation)
//     adds ~3 dB constructive boost or deep null depending on phase
//   • Behind the wall (x > 8) only direct attenuated by metal (20 dB)

import { MATERIALS, DEFAULT_FLOOR_SLAB_DB, DEFAULT_FLOOR_SLAB_MATERIAL_ID } from '@/constants/materials'

const SIDE_M = 20
const SCALE  = 30                    // px/m
const SIDE_PX = SIDE_M * SCALE       // 600 px

export const floors = [
  {
    id: 'floor-0',
    name: 'Refl-min',
    imageWidth: SIDE_PX,
    imageHeight: SIDE_PX,
    scale: SCALE,
    rotation: 0,
    floorHeight: 3,
    floorSlabMaterialId: DEFAULT_FLOOR_SLAB_MATERIAL_ID,
    floorSlabAttenuationDb: DEFAULT_FLOOR_SLAB_DB,
  },
]

const ACTIVE_FLOOR_ID = 'floor-0'

export const wallsByFloor = {
  'floor-0': [
    {
      id: 'w-metal',
      startX:  8 * SCALE, startY:  2 * SCALE,
      endX:    8 * SCALE, endY:   18 * SCALE,
      material: MATERIALS.METAL,
      bottomHeight: 0, topHeight: 3,
    },
  ],
}

export const apsByFloor = {
  'floor-0': [
    {
      id: 'ap-a',
      name: 'AP-A',
      x: 4 * SCALE, y: 10 * SCALE, z: 2.7,
      frequency: 5, channel: 36, channelWidth: 40,
      txPower: 20,
      antennaMode: 'omni',
      mountType: 'ceiling',
    },
  ],
}

// One in-scope polygon covering the whole canvas: simplest possible mask.
export const scopesByFloor = {
  'floor-0': [
    {
      id: 'scope-in',
      type: 'in',
      points: [0, 0, SIDE_PX, 0, SIDE_PX, SIDE_PX, 0, SIDE_PX],
    },
  ],
}

export const floorHolesByFloor = {
  'floor-0': [],
}

export const engineOpts = {
  gridStepM: 0.5,
  maxReflOrder: 1,
  enableDiffraction: false,    // diffraction off — pure reflection isolation
  rxHeightM: 1.0,
}

export const meta = {
  fixtureId: 'refl-min',
  activeFloorId: ACTIVE_FLOOR_ID,
  description: '1 AP + 1 reflective concrete wall. Reflection-only isolation fixture for HM-F5c+d debug.',
}
