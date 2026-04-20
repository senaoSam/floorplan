// Smooth continuous color ramp keyed to RSSI dBm.
// Uses the user's 5-band categories but interpolates linearly between anchors
// so the heatmap looks organic (no hard tiles).

import { RSSI_BUCKETS } from '../physics/constants.js';

// Anchor points: (dBm → RGB). We pick the middle of each band as anchor so the
// gradient flows: red → orange → yellow → lime → green → deep green.
const ANCHORS = [
  { dbm: -30, rgb: [220,  38,  38] },
  { dbm: -45, rgb: [239,  68,  68] },
  { dbm: -55, rgb: [249, 115,  22] },
  { dbm: -65, rgb: [234, 179,   8] },
  { dbm: -75, rgb: [132, 204,  22] },
  { dbm: -85, rgb: [ 34, 197,  94] },
  { dbm: -95, rgb: [ 21, 128,  61] },
  { dbm:-110, rgb: [ 10,  40,  24] }
];

export function dbmToRgb(dbm) {
  if (!isFinite(dbm)) return [10, 20, 30];
  // Anything stronger than -30 dBm saturates to the top-band red.
  if (dbm >= ANCHORS[0].dbm) return ANCHORS[0].rgb;
  const clamped = Math.max(-110, dbm);
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const hi = ANCHORS[i];
    const lo = ANCHORS[i + 1];
    if (clamped <= hi.dbm && clamped >= lo.dbm) {
      const t = (hi.dbm - clamped) / (hi.dbm - lo.dbm);
      return [
        Math.round(hi.rgb[0] + (lo.rgb[0] - hi.rgb[0]) * t),
        Math.round(hi.rgb[1] + (lo.rgb[1] - hi.rgb[1]) * t),
        Math.round(hi.rgb[2] + (lo.rgb[2] - hi.rgb[2]) * t)
      ];
    }
  }
  return ANCHORS[ANCHORS.length - 1].rgb;
}

// Alpha: make weak signal a bit transparent so floorplan shows through.
export function dbmToAlpha(dbm) {
  if (!isFinite(dbm)) return 80;
  if (dbm >= -50) return 220;
  if (dbm <= -95) return 90;
  return Math.round(90 + ((dbm + 95) / 45) * 130);
}

export { RSSI_BUCKETS };
