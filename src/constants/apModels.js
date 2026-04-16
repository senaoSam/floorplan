// AP model database — vendor specs used for default txPower caps, supported bands and antenna gains.
// maxTxPower 為各頻段可設定上限 (dBm)；antennaGain 為天線增益 (dBi)。
export const AP_MODELS = {
  GENERIC_WIFI6: {
    id: 'generic-wifi6',
    vendor: 'Generic',
    name: 'Wi-Fi 6 AP',
    wifiGen: 'Wi-Fi 6',
    supportedBands: [2.4, 5],
    maxTxPower: { 2.4: 23, 5: 23 },
    antennaGain: { 2.4: 3, 5: 4 },
  },
  CISCO_C9166: {
    id: 'cisco-c9166',
    vendor: 'Cisco',
    name: 'Catalyst 9166',
    wifiGen: 'Wi-Fi 6E',
    supportedBands: [2.4, 5, 6],
    maxTxPower: { 2.4: 26, 5: 26, 6: 24 },
    antennaGain: { 2.4: 4, 5: 5, 6: 6 },
  },
  ARUBA_AP635: {
    id: 'aruba-ap635',
    vendor: 'Aruba',
    name: 'AP-635',
    wifiGen: 'Wi-Fi 6E',
    supportedBands: [2.4, 5, 6],
    maxTxPower: { 2.4: 24, 5: 24, 6: 24 },
    antennaGain: { 2.4: 3, 5: 5, 6: 6 },
  },
  RUCKUS_R770: {
    id: 'ruckus-r770',
    vendor: 'Ruckus',
    name: 'R770',
    wifiGen: 'Wi-Fi 7',
    supportedBands: [2.4, 5, 6],
    maxTxPower: { 2.4: 27, 5: 27, 6: 24 },
    antennaGain: { 2.4: 4, 5: 6, 6: 6 },
  },
  UBIQUITI_U6_PRO: {
    id: 'ubiquiti-u6-pro',
    vendor: 'Ubiquiti',
    name: 'UniFi U6-Pro',
    wifiGen: 'Wi-Fi 6',
    supportedBands: [2.4, 5],
    maxTxPower: { 2.4: 22, 5: 23 },
    antennaGain: { 2.4: 4, 5: 5.5 },
  },
  UBIQUITI_U6_LITE: {
    id: 'ubiquiti-u6-lite',
    vendor: 'Ubiquiti',
    name: 'UniFi U6-Lite',
    wifiGen: 'Wi-Fi 6',
    supportedBands: [2.4, 5],
    maxTxPower: { 2.4: 20, 5: 20 },
    antennaGain: { 2.4: 3, 5: 3 },
  },
}

export const AP_MODEL_LIST = Object.values(AP_MODELS)

export const DEFAULT_AP_MODEL_ID = AP_MODELS.GENERIC_WIFI6.id

export const getAPModelById = (id) =>
  AP_MODEL_LIST.find((m) => m.id === id) ?? AP_MODELS.GENERIC_WIFI6
