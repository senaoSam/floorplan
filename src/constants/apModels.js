// AP model database — vendor specs used for default txPower caps, supported bands, antenna gains.
// maxTxPower 為各頻段可設定上限 (dBm)；antennaGain 為天線增益 (dBi)；
// streamCount 為 MIMO spatial stream 數（per-band，用於 802.11ax data rate 查表，RX-4）。
// poeWattage 為 worst-case（滿載三頻 + 全 PoE-out USB）耗電量 (W)，給 switch 的 PoE
//   budget 計算用；用 worst-case 而非典型值，規劃時才不會低估供電需求（47-13）。
// poeClass 為該 AP 需要的 PoE 供電等級（'3af' / '3at' / '3bt'），對比 switch 的
//   每埠供電標準——per-port class 不足會砍 radio（47-13）。
export const AP_MODELS = {
  GENERIC_WIFI6: {
    id: 'generic-wifi6',
    vendor: 'Generic',
    name: 'Wi-Fi 6 AP',
    wifiGen: 'Wi-Fi 6',
    supportedBands: [2.4, 5],
    maxTxPower: { 2.4: 23, 5: 23 },
    antennaGain: { 2.4: 3, 5: 4 },
    streamCount: { 2.4: 2, 5: 2 },
    poeWattage: 18,
    poeClass: '3at',
  },
  CISCO_C9166: {
    id: 'cisco-c9166',
    vendor: 'Cisco',
    name: 'Catalyst 9166',
    wifiGen: 'Wi-Fi 6E',
    supportedBands: [2.4, 5, 6],
    maxTxPower: { 2.4: 26, 5: 26, 6: 24 },
    antennaGain: { 2.4: 4, 5: 5, 6: 6 },
    streamCount: { 2.4: 4, 5: 4, 6: 4 },
    poeWattage: 32,
    poeClass: '3bt',
  },
  ARUBA_AP635: {
    id: 'aruba-ap635',
    vendor: 'Aruba',
    name: 'AP-635',
    wifiGen: 'Wi-Fi 6E',
    supportedBands: [2.4, 5, 6],
    maxTxPower: { 2.4: 24, 5: 24, 6: 24 },
    antennaGain: { 2.4: 3, 5: 5, 6: 6 },
    streamCount: { 2.4: 2, 5: 4, 6: 2 },
    poeWattage: 28,
    poeClass: '3bt',
  },
  RUCKUS_R770: {
    id: 'ruckus-r770',
    vendor: 'Ruckus',
    name: 'R770',
    wifiGen: 'Wi-Fi 7',
    supportedBands: [2.4, 5, 6],
    maxTxPower: { 2.4: 27, 5: 27, 6: 24 },
    antennaGain: { 2.4: 4, 5: 6, 6: 6 },
    streamCount: { 2.4: 4, 5: 4, 6: 4 },
    poeWattage: 38,
    poeClass: '3bt',
  },
  UBIQUITI_U6_PRO: {
    id: 'ubiquiti-u6-pro',
    vendor: 'Ubiquiti',
    name: 'UniFi U6-Pro',
    wifiGen: 'Wi-Fi 6',
    supportedBands: [2.4, 5],
    maxTxPower: { 2.4: 22, 5: 23 },
    antennaGain: { 2.4: 4, 5: 5.5 },
    streamCount: { 2.4: 2, 5: 4 },
    poeWattage: 14,
    poeClass: '3at',
  },
  UBIQUITI_U6_LITE: {
    id: 'ubiquiti-u6-lite',
    vendor: 'Ubiquiti',
    name: 'UniFi U6-Lite',
    wifiGen: 'Wi-Fi 6',
    supportedBands: [2.4, 5],
    maxTxPower: { 2.4: 20, 5: 20 },
    antennaGain: { 2.4: 3, 5: 3 },
    streamCount: { 2.4: 2, 5: 2 },
    poeWattage: 12,
    poeClass: '3af',
  },
}

// 47-12 — per-band 建立預設 TX (dBm)。企業實務常見值（2.4G 8–14 / 5G 14–17）取
// 中間偏典型；6G 對齊 5G。新建 AP 若模型 maxTxPower 更低，由呼叫端自行 clamp。
// 單一來源：所有 AP 建立點與 buildScenario fallback 都引用 getDefaultTxPower。
export const DEFAULT_TX_POWER_DBM = { 2.4: 11, 5: 15, 6: 15 }

export const getDefaultTxPower = (band) => DEFAULT_TX_POWER_DBM[band] ?? 15

// 47-13 — PoE 供電等級元資料。perPortWatt 為該標準每埠最大可供電量 (W，PSE 端額定)。
// rank 用來比大小（AP 需求 > switch 供給即不足）。af=15.4W / at=30W / bt=60W(Type3)。
// 註：802.3bt Type4 可達 90W，但企業 access AP 幾乎都在 Type3 級距內，故以 60W 為準。
export const POE_CLASSES = {
  '3af': { rank: 1, label: '802.3af', perPortWatt: 15.4 },
  '3at': { rank: 2, label: '802.3at (PoE+)', perPortWatt: 30 },
  '3bt': { rank: 3, label: '802.3bt (PoE++)', perPortWatt: 60 },
}

export const getPoeClassMeta = (cls) => POE_CLASSES[cls] ?? POE_CLASSES['3at']

export const AP_MODEL_LIST = Object.values(AP_MODELS)

export const DEFAULT_AP_MODEL_ID = AP_MODELS.GENERIC_WIFI6.id

export const getAPModelById = (id) =>
  AP_MODEL_LIST.find((m) => m.id === id) ?? AP_MODELS.GENERIC_WIFI6

// Per-AP PoE consumption (worst-case, 47-13). Falls back to a conservative 18 W
// when the model (or an unknown modelId) has no `poeWattage` field. Used by
// SwitchPanel to flag PoE-budget over-capacity warnings.
export const getAPPoeWattage = (ap) => {
  const m = getAPModelById(ap?.modelId ?? DEFAULT_AP_MODEL_ID)
  return m.poeWattage ?? 18
}

// Per-AP required PoE class (47-13). Falls back to '3at' (PoE+) when the model
// has no `poeClass` field — a safe middle assumption for an unknown enterprise
// AP. Compared against a switch's per-port PoE standard in SwitchPanel.
export const getAPPoeClass = (ap) => {
  const m = getAPModelById(ap?.modelId ?? DEFAULT_AP_MODEL_ID)
  return m.poeClass ?? '3at'
}
