// ---- RF / propagation constants ----
// 5 GHz Ch36 @ 40 MHz → center 5190 MHz
export const FREQ_MHZ = 5190;
export const FREQ_HZ = FREQ_MHZ * 1e6;
export const C = 299792458;                 // m/s
export const WAVELENGTH = C / FREQ_HZ;      // ~0.0578 m
export const K_WAVENUM = (2 * Math.PI) / WAVELENGTH;

// Tx / Rx assumptions (typical enterprise AP)
export const AP_TX_DBM = 20;        // 100 mW EIRP-ish for 5GHz indoor AP
export const AP_ANT_GAIN_DBI = 3;   // omni ceiling
export const RX_ANT_GAIN_DBI = 0;   // client device
export const NOISE_FLOOR_DBM = -95;

// RSSI category thresholds (dBm) — matches user spec
export const RSSI_BUCKETS = [
  { min: -50, max:  -30, label: '極強',  color: [220,  38,  38] },   // red
  { min: -60, max:  -51, label: '優良',  color: [249, 115,  22] },   // orange
  { min: -70, max:  -61, label: '普通',  color: [234, 179,   8] },   // yellow
  { min: -80, max:  -71, label: '不佳',  color: [132, 204,  22] },   // lime
  { min: -90, max:  -81, label: '極差',  color: [ 34, 197,  94] }    // green
];

// ITU-R P.1238 indoor path loss: distance power exponent
// For 5 GHz office: N ~ 31 (log10 slope), we model: PL = 20log10(f_MHz) + N*log10(d_m) + Lf(n) - 28
// Simplified two-slope model with floor/wall losses handled separately.
export const ITU_N_OFFICE_5G = 31;

// Reflection coefficient magnitudes (Fresnel, averaged for TE/TM, normal incidence, typical indoor)
// per material, |Γ|^2 gives reflected power fraction.
export const DEFAULT_WALL = {
  lossDb: 8,              // penetration loss per wall (user spec)
  reflectionMag: 0.45,    // |Γ| ~ drywall/concrete mix at 5GHz
  roughnessM: 0.01        // surface roughness sigma (Rayleigh)
};
