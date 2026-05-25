// Visualisation-mode catalog for the heatmap. Each mode describes:
//   - label / unit / short help text shown in HeatmapControl and legend
//   - field: which Float32Array from sampleField() feeds the renderer
//   - anchors: 5 colormap stops (value, R, G, B, alpha) — low → high in the
//     renderer's ramp. Shared with HeatmapLegend so the legend bar and the
//     WebGL output stay in sync.
//   - legendStops: values plotted along the legend bar (must match anchors
//     sorted by value ascending; labels are the anchor dB / dBm values)
//   - signBetter: 'high' when higher values are better (green end = high),
//                 'low'  when lower values are better (CCI: low = less noise).

// RSSI anchors. Weakest on the left side of the bar (teal, far edge),
// strongest on the right (red, close).
const RSSI_ANCHORS = [
  [-35, 235,  26,  26, 0.90],
  [-45, 255, 128,  13, 0.88],
  [-55, 255, 217,  26, 0.86],
  [-65, 102, 217,  64, 0.84],
  [-75, 160, 160, 160, 0.80],
]

// SINR — 0 dB ≈ equal signal and interference. 25+ dB ≈ clean.
const SINR_ANCHORS = [
  [35, 235,  26,  26, 0.90],
  [25, 255, 128,  13, 0.88],
  [15, 255, 217,  26, 0.86],
  [ 5, 102, 217,  64, 0.84],
  [-5, 160, 160, 160, 0.80],
]

// SNR — without co-channel interferers; same band as SINR but upshifted.
const SNR_ANCHORS = [
  [60, 235,  26,  26, 0.90],
  [45, 255, 128,  13, 0.88],
  [30, 255, 217,  26, 0.86],
  [15, 102, 217,  64, 0.84],
  [ 0, 160, 160, 160, 0.80],
]

// CCI — aggregate co-channel interference power in dBm. Lower is better, so we
// invert the color sense: the teal "good" end maps to low dBm (quiet), red to
// high dBm (loud). sign='low' flips legend ordering for the user.
const CCI_ANCHORS = [
  [ -45, 235,  26,  26, 0.90],
  [ -55, 255, 128,  13, 0.88],
  [ -70, 255, 217,  26, 0.86],
  [ -85, 102, 217,  64, 0.84],
  [-100, 160, 160, 160, 0.80],
]

export const HEATMAP_MODE_CONFIG = {
  rssi: {
    id: 'rssi',
    label: 'RSSI',
    unit: 'dBm',
    description: '最強 AP 的接收功率',
    field: 'rssi',
    anchors: RSSI_ANCHORS,
    signBetter: 'high',
  },
  sinr: {
    id: 'sinr',
    label: 'SINR',
    unit: 'dB',
    description: '訊號 / (雜訊 + 同頻干擾)',
    field: 'sinr',
    anchors: SINR_ANCHORS,
    signBetter: 'high',
  },
  snr: {
    id: 'snr',
    label: 'SNR',
    unit: 'dB',
    description: '訊號 / 雜訊（忽略干擾）',
    field: 'snr',
    anchors: SNR_ANCHORS,
    signBetter: 'high',
  },
  cci: {
    id: 'cci',
    label: 'CCI',
    unit: 'dBm',
    description: '同頻干擾功率總和',
    field: 'cci',
    anchors: CCI_ANCHORS,
    signBetter: 'low',
  },
}

export const HEATMAP_MODE_LIST = Object.values(HEATMAP_MODE_CONFIG)

export function getModeConfig(mode) {
  return HEATMAP_MODE_CONFIG[mode] ?? HEATMAP_MODE_CONFIG.rssi
}
