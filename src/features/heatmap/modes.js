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

// RSSI anchors. Colour sense: strong = green (good), weak = red (poor).
const RSSI_ANCHORS = [
  [-35, 102, 217,  64, 0.90],
  [-45, 255, 217,  26, 0.88],
  [-55, 255, 128,  13, 0.86],
  [-65, 255, 128,  13, 0.84],
  [-75, 235,  26,  26, 0.80],
]

// SINR — 0 dB ≈ equal signal and interference. 25+ dB ≈ clean.
// Colour sense: strong = green (good), weak = red (poor).
const SINR_ANCHORS = [
  [35, 102, 217,  64, 0.90],
  [25, 255, 217,  26, 0.88],
  [15, 255, 128,  13, 0.86],
  [ 5, 255, 128,  13, 0.84],
  [-5, 235,  26,  26, 0.80],
]

// SNR — without co-channel interferers; same band as SINR but upshifted.
// Colour sense: strong = green (good), weak = red (poor).
const SNR_ANCHORS = [
  [60, 102, 217,  64, 0.90],
  [45, 255, 217,  26, 0.88],
  [30, 255, 128,  13, 0.86],
  [15, 255, 128,  13, 0.84],
  [ 0, 235,  26,  26, 0.80],
]

// CCI — aggregate co-channel interference power in dBm. Lower is better, so the
// "good" (quiet) end maps to low dBm = green, loud high dBm = red.
// sign='low' flips legend ordering for the user.
const CCI_ANCHORS = [
  [ -45, 235,  26,  26, 0.90],
  [ -55, 255, 128,  13, 0.88],
  [ -70, 255, 128,  13, 0.86],
  [ -85, 255, 217,  26, 0.84],
  [-100, 102, 217,  64, 0.80],
]

// 52-D3: `plain` is a plain-language name for the acronym, and `plainHelp`
// says what the metric answers in words a non-RF reader can act on. The
// tester's words: "RSSI / SINR / SNR / CCI — I don't understand a single one,
// and there's nowhere to ask." The acronym is kept as the primary label (it is
// what the industry and every other tool uses) with the plain name alongside.
export const HEATMAP_MODE_CONFIG = {
  rssi: {
    id: 'rssi',
    label: 'RSSI',
    plain: '訊號強度',
    unit: 'dBm',
    description: '最強 AP 的接收功率',
    plainHelp: '收得到多強的訊號。最常用的一項——先看這個。',
    field: 'rssi',
    anchors: RSSI_ANCHORS,
    signBetter: 'high',
  },
  sinr: {
    id: 'sinr',
    label: 'SINR',
    plain: '訊號品質',
    unit: 'dB',
    description: '訊號 / (雜訊 + 同頻干擾)',
    plainHelp: '扣掉雜訊與其他 AP 干擾後，訊號還剩多乾淨。訊號強不代表品質好。',
    field: 'sinr',
    anchors: SINR_ANCHORS,
    signBetter: 'high',
  },
  snr: {
    id: 'snr',
    label: 'SNR',
    plain: '訊號雜訊比',
    unit: 'dB',
    description: '訊號 / 雜訊（忽略干擾）',
    plainHelp: '只比訊號與背景雜訊，不算其他 AP 的干擾。',
    field: 'snr',
    anchors: SNR_ANCHORS,
    signBetter: 'high',
  },
  cci: {
    id: 'cci',
    label: 'CCI',
    plain: '同頻干擾',
    unit: 'dBm',
    description: '同頻干擾功率總和',
    plainHelp: '同頻道的其他 AP 互相干擾的強度。這項越低越好。',
    field: 'cci',
    anchors: CCI_ANCHORS,
    signBetter: 'low',
  },
}

export const HEATMAP_MODE_LIST = Object.values(HEATMAP_MODE_CONFIG)

export function getModeConfig(mode) {
  return HEATMAP_MODE_CONFIG[mode] ?? HEATMAP_MODE_CONFIG.rssi
}
