// Seed the Demo floor with the same walls + APs as heatmap_sample's default
// scenario (see heatmap_sample/src/physics/scenario.js). Coordinates are
// translated from meters into the Demo floor's pixel space using the same
// px/m scale DemoLoader sets (200/20 = 10 px/m).
//
// Layout occupies the top-left 30x18 m (300x180 px) patch of the Demo floor.

import { generateId } from '@/utils/id'
import { MATERIALS, getMaterialById } from '@/constants/materials'
import { DEFAULT_AP_MODEL_ID } from '@/constants/apModels'
import { DEFAULT_CHANNEL_WIDTH } from '@/constants/channelWidths'

// Map sample wall lossDb → closest main-system material.
//  12 dB → concrete (exterior)
//   8 dB → brick    (interior default)
//  10 dB → brick    (shielded storage — closest integer > 8)
function materialForLossDb(lossDb) {
  if (lossDb >= 12) return MATERIALS.CONCRETE
  if (lossDb >= 10) return getMaterialById('brick')
  if (lossDb >= 8)  return getMaterialById('brick')
  return MATERIALS.DRYWALL
}

// Build the walls + APs. pxPerM matches the floor's scale (Demo uses 10 px/m).
export function buildDemoSampleObjects(pxPerM) {
  const m = pxPerM // shorter alias for readability

  const mkWall = (ax, ay, bx, by, lossDb = 8, openings) => ({
    id: generateId('wall'),
    startX: ax * m, startY: ay * m,
    endX:   bx * m, endY:   by * m,
    material: materialForLossDb(lossDb),
    topHeight: 3.0,
    bottomHeight: 0,
    openings: openings ?? [],
  })

  const mkOpening = (type, startFrac, endFrac, bottomHeight, topHeight) => ({
    id: generateId('opening'),
    type,
    startFrac, endFrac,
    material: type === 'window' ? MATERIALS.GLASS : MATERIALS.WOOD,
    bottomHeight, topHeight,
  })

  const W = 30
  const H = 18

  // Bottom perimeter (W,H → 0,H). Length = 30 m. Seed 2 doors + 2 windows so
  // the 3D view has something to show off. A vertical divider sits at x=15,
  // so doors straddle it (one on each side of the divider) rather than being
  // centered on it. Layout left-to-right in plan space:
  //   window 1: x ∈ [3, 7]    m
  //   door 1:   x ∈ [11, 12.5] m   (left of the x=15 divider)
  //   door 2:   x ∈ [17.5, 19] m   (right of the x=15 divider)
  //   window 2: x ∈ [23, 27]  m
  // Wall goes (30,18) → (0,18) so startFrac=0 is at x=30. Convert by 1 − x/W.
  const bottomWallOpenings = [
    // window 2 (x=23..27)
    mkOpening('window', 1 - 27   / W, 1 - 23   / W, 0.9, 2.1),
    // door 2 (x=17.5..19)
    mkOpening('door',   1 - 19   / W, 1 - 17.5 / W, 0,   2.1),
    // door 1 (x=11..12.5)
    mkOpening('door',   1 - 12.5 / W, 1 - 11   / W, 0,   2.1),
    // window 1 (x=3..7)
    mkOpening('window', 1 - 7    / W, 1 - 3    / W, 0.9, 2.1),
  ]

  const walls = [
    // Perimeter (12 dB concrete)
    mkWall(0, 0, W, 0, 12),
    mkWall(W, 0, W, H, 12),
    mkWall(W, H, 0, H, 12, bottomWallOpenings),
    mkWall(0, H, 0, 0, 12),

    // Vertical divider down the middle (with door gaps at y=4..5.5, 9..10, 13.5..15)
    mkWall(15, 0,   15, 4,    8),
    mkWall(15, 5.5, 15, 9,    8),
    mkWall(15, 10,  15, 13.5, 8),
    mkWall(15, 15,  15, 18,   8),

    // Horizontal wall top row (A/B ↔ corridor) with door gaps at x=6..8, 21..23
    mkWall(0,  9,    6, 9, 8),
    mkWall(8,  9,   15, 9, 8),
    mkWall(15, 9,   21, 9, 8),
    mkWall(23, 9,   30, 9, 8),

    // Horizontal wall bottom row (corridor ↔ C/D) with door gaps at x=10..13, 20..22
    mkWall(0,  10,   10, 10, 8),
    mkWall(13, 10,   20, 10, 8),
    mkWall(22, 10,   30, 10, 8),

    // Shielded storage room (double-walled): outer shell (22..29, 12..17), inner (23..28, 13..16)
    mkWall(22, 12,   29, 12, 10),
    mkWall(22, 12,   22, 17, 10),
    mkWall(29, 12,   29, 17, 10),
    mkWall(23, 13,   28, 13, 10),
    mkWall(23, 13,   23, 16, 10),
    mkWall(28, 13,   28, 16, 10),
  ]

  const mkAP = (nm, x, y) => ({
    id: generateId('ap'),
    x: x * m, y: y * m,
    z: 2.4,
    txPower: 20,
    frequency: 5,
    channel: 36,
    channelWidth: DEFAULT_CHANNEL_WIDTH[5],
    antennaMode: 'omni',
    azimuth: 0,
    beamwidth: 60,
    patternId: null,
    mountType: 'ceiling',
    modelId: DEFAULT_AP_MODEL_ID,
    name: nm,
    color: '#4fc3f7',
  })

  const aps = [
    mkAP('AP-1', 4, 4),
    mkAP('AP-2', 4, 14),
  ]

  return { walls, aps }
}
