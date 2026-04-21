// Default office floor: 30 x 18 m, 4+ rooms + a shielded storage room,
// 2 APs, internal walls forming clear coverage holes.
// Units: meters. Walls are line segments.
// Corners are inferred from wall endpoints (used for diffraction).

import { DEFAULT_WALL, AP_TX_DBM } from './constants.js';

function mkWall(ax, ay, bx, by, extra = {}) {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    lossDb: extra.lossDb ?? DEFAULT_WALL.lossDb,
    reflectionMag: extra.reflectionMag ?? DEFAULT_WALL.reflectionMag,
    roughnessM: extra.roughnessM ?? DEFAULT_WALL.roughnessM,
    kind: extra.kind ?? 'interior'
  };
}

export function defaultScenario() {
  const W = 30;    // width (m) — larger floor so far corners go green
  const H = 18;    // height (m)

  // ---- perimeter (12 dB, strong reflector) ----
  const perim = [
    mkWall(0, 0, W, 0, { lossDb: 12, reflectionMag: 0.6, kind: 'exterior' }),
    mkWall(W, 0, W, H, { lossDb: 12, reflectionMag: 0.6, kind: 'exterior' }),
    mkWall(W, H, 0, H, { lossDb: 12, reflectionMag: 0.6, kind: 'exterior' }),
    mkWall(0, H, 0, 0, { lossDb: 12, reflectionMag: 0.6, kind: 'exterior' })
  ];

  // ---- Internal walls @ 8 dB ----
  // Layout:
  //   Room A (top-left)    |    Room B (top-right)
  //   ---- corridor (y≈9..10) ----
  //   Room C (bottom-left) |    Room D (bottom-right)
  //   + a shielded storage room in the far right, enclosed by extra walls
  const internal = [
    // vertical divider down the middle (with door gaps)
    mkWall(15, 0,   15, 4),
    mkWall(15, 5.5, 15, 9),
    mkWall(15, 10,  15, 13.5),
    mkWall(15, 15,  15, 18),

    // horizontal wall top row (A/B ↔ corridor) with door gaps
    mkWall(0,  9,    6, 9),
    mkWall(8,  9,   15, 9),
    mkWall(15, 9,   21, 9),
    mkWall(23, 9,   30, 9),

    // horizontal wall bottom row (corridor ↔ C/D)
    mkWall(0,  10,   10, 10),
    mkWall(13, 10,   20, 10),
    mkWall(22, 10,   30, 10),

    // ---- shielded storage room in far right, double-walled ----
    // outer shell around (22..29, 12..17) — effectively adds ~16 dB per side
    mkWall(22, 12,   29, 12, { lossDb: 10 }),  // outer top
    mkWall(22, 12,   22, 17, { lossDb: 10 }),  // outer left
    mkWall(29, 12,   29, 17, { lossDb: 10 }),  // outer right
    // inner shell (23..28, 13..16) — second layer makes this a dead zone
    mkWall(23, 13,   28, 13, { lossDb: 10 }),
    mkWall(23, 13,   23, 16, { lossDb: 10 }),
    mkWall(28, 13,   28, 16, { lossDb: 10 })
  ];

  const walls = [...perim, ...internal];

  // Collect unique corner points (wall endpoints) for diffraction.
  const cornerMap = new Map();
  for (const w of walls) {
    for (const p of [w.a, w.b]) {
      const k = `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
      if (!cornerMap.has(k)) cornerMap.set(k, p);
    }
  }
  const corners = Array.from(cornerMap.values());

  // ---- 2 APs on 5 GHz Ch36 (same channel → co-channel interference) ----
  // Both APs on the left half so the right far side + shielded room go green.
  const aps = [
    { id: 'AP-1', pos: { x: 4,  y: 4  }, txDbm: AP_TX_DBM, channel: 36 },
    { id: 'AP-2', pos: { x: 4,  y: 14 }, txDbm: AP_TX_DBM, channel: 36 }
  ];

  return { size: { w: W, h: H }, walls, corners, aps };
}
