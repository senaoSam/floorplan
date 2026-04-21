// Smooth continuous color ramp keyed to RSSI dBm.
// Uses the user's 5-band categories but interpolates linearly between anchors
// so the heatmap looks organic (no hard tiles).

import { RSSI_BUCKETS } from '../physics/constants.js';

// Anchor points: (dBm → RGB, alpha 0-255)
const ANCHORS = [
  { dbm: -35, rgb: [235,  26,  26], a: Math.round(0.90 * 255) },
  { dbm: -45, rgb: [255, 128,  13], a: Math.round(0.88 * 255) },
  { dbm: -55, rgb: [255, 217,  26], a: Math.round(0.86 * 255) },
  { dbm: -65, rgb: [102, 217,  64], a: Math.round(0.84 * 255) },
  { dbm: -75, rgb: [ 26, 191, 204], a: Math.round(0.80 * 255) }
];

export function dbmToRgb(dbm) {
  if (!isFinite(dbm)) return [10, 20, 30];
  if (dbm >= ANCHORS[0].dbm) return ANCHORS[0].rgb;
  const clamped = Math.max(ANCHORS[ANCHORS.length - 1].dbm, dbm);
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

// Alpha: interpolated from anchor alpha values.
export function dbmToAlpha(dbm) {
  if (!isFinite(dbm)) return 0;
  if (dbm >= ANCHORS[0].dbm) return ANCHORS[0].a;
  const clamped = Math.max(ANCHORS[ANCHORS.length - 1].dbm, dbm);
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const hi = ANCHORS[i];
    const lo = ANCHORS[i + 1];
    if (clamped <= hi.dbm && clamped >= lo.dbm) {
      const t = (hi.dbm - clamped) / (hi.dbm - lo.dbm);
      return Math.round(hi.a + (lo.a - hi.a) * t);
    }
  }
  return ANCHORS[ANCHORS.length - 1].a;
}

export { RSSI_BUCKETS };
