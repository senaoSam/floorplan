/**
 * 將 RSSI (dBm) 轉換為熱力圖顏色 (RGBA)
 * 參考：-50 以上優、-70 良、-80 尚可、-90 差
 */
export function rssiToRGBA(rssi) {
  if (rssi >= -50) return [0, 204, 68, 180]    // 綠
  if (rssi >= -65) return [136, 204, 0, 160]   // 黃綠
  if (rssi >= -75) return [255, 204, 0, 140]   // 黃
  if (rssi >= -85) return [255, 102, 0, 130]   // 橘
  return [204, 0, 0, 110]                       // 紅
}
