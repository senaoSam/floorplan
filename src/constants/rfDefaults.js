// RF 物理計算預設值（對齊 .tmp-heatmap NPv1 規格）
// 來源：08-implementation-guide.md §3 / 02-material-models.md §6 / 04-heatmap-pipeline.md §5

// 頻段索引：與 shader u_apFreqBand 一致（0=2.4, 1=5, 2=6）
export const FREQ_BAND_INDEX = { 2.4: 0, 5: 1, 6: 2 }

// 每頻段預設 PLE（path loss exponent）
// 對應 08-implementation-guide.md HeatmapSettings.pathLossExponent[3]
// 室內典型值：2.4G 較低（穿透好但繞射多）、5G 中、6G 高（高頻衰減快）
export const DEFAULT_PLE_PER_BAND = {
  2.4: 3.0,
  5:   3.3,
  6:   3.5,
}

// 每頻段噪聲底（dBm @ 20MHz 頻寬）
// 對應 02-material-models.md §6 wifiNoiseFloor*
// 寬頻修正：N(BW) = N(20) + 10·log10(BW/20)
export const NOISE_FLOOR_DBM_PER_BAND = {
  2.4: -95,
  5:   -95,
  6:   -95,
}

// HeatmapSettings 預設值（對應 08 §3.1 HeatmapSettings struct）
export const HEATMAP_DEFAULTS = {
  clientHeightMeters:        1.0,   // 接收平面高度（手機口袋到頭部，1.0~1.5m）
  cutoutDistanceMeters:      50.0,  // 超距 AP 不算（典型 50~100m）
  diffractionLossDBPer90Deg: 6.0,   // Order ≥ 1 繞射每 90° 損耗
  maxDiffractionOrder:       1,     // DPM 最高繞射階數（0=純直射）
  clientTxPowerDBm:          15.0,  // uplink 計算用 client 發射功率
}
