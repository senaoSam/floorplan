// Mock camera-frame dimensions — shared by CalibrationModal (where the user
// clicks the 4 frame points) and any consumer that maps frame ↔ floor. Keep
// these in ONE place so they never drift (a mismatch would skew projections).
export const FRAME_W = 420
export const FRAME_H = 236
