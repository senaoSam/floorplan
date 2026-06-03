// Client device profile database (mock) — used by Client View to simulate
// "the network from a specific device's perspective". Pure mock data, in the
// same spirit as apModels.js: hand-written representative devices, not a real
// vendor DB.
//
// Fields:
//   id, name          — identity / dropdown label
//   category          — 'phone' | 'laptop' | 'tablet' | 'iot' (icon / grouping)
//   phy               — '11ac' | '11ax' | '11be' (Wi-Fi 5 / 6/6E / 7) — caps the
//                       MCS table used for data-rate lookup (dataRate.js)
//   bands             — supported bands [2.4, 5, 6?]. Client View only considers
//                       APs on a band this device supports.
//   sixGHzCapable     — whether 6 GHz is available. The UI exposes a toggle that
//                       can disable it at runtime even for capable devices
//                       (matches Hamina's "6 GHz capable" checkbox).
//   spatialStreams    — client RX chains (caps MCS NSS — most clients are 1–2).
//   maxChannelWidth   — widest channel the client will use (MHz).
//   txPowerDbm        — client transmit power (used later for uplink; downlink
//                       view ignores it).
//
// Sorted roughly best → worst so the dropdown reads as a capability ladder.
export const CLIENT_DEVICES = {
  FLAGSHIP_PHONE: {
    id: 'flagship-phone',
    name: '旗艦手機 (Wi-Fi 7)',
    category: 'phone',
    phy: '11be',
    bands: [2.4, 5, 6],
    sixGHzCapable: true,
    spatialStreams: 2,
    maxChannelWidth: 160,
    txPowerDbm: 15,
  },
  MODERN_LAPTOP: {
    id: 'modern-laptop',
    name: '筆電 (Wi-Fi 6E)',
    category: 'laptop',
    phy: '11ax',
    bands: [2.4, 5, 6],
    sixGHzCapable: true,
    spatialStreams: 2,
    maxChannelWidth: 160,
    txPowerDbm: 17,
  },
  TABLET: {
    id: 'tablet',
    name: '平板 (Wi-Fi 6)',
    category: 'tablet',
    phy: '11ax',
    bands: [2.4, 5],
    sixGHzCapable: false,
    spatialStreams: 2,
    maxChannelWidth: 80,
    txPowerDbm: 14,
  },
  OLD_PHONE: {
    id: 'old-phone',
    name: '舊手機 (Wi-Fi 5)',
    category: 'phone',
    phy: '11ac',
    bands: [2.4, 5],
    sixGHzCapable: false,
    spatialStreams: 1,
    maxChannelWidth: 80,
    txPowerDbm: 13,
  },
  IOT_SENSOR: {
    id: 'iot-sensor',
    name: 'IoT 感測器 (2.4 GHz)',
    category: 'iot',
    phy: '11ax',
    bands: [2.4],
    sixGHzCapable: false,
    spatialStreams: 1,
    maxChannelWidth: 20,
    txPowerDbm: 10,
  },
}

export const CLIENT_DEVICE_LIST = Object.values(CLIENT_DEVICES)

export const DEFAULT_CLIENT_DEVICE_ID = CLIENT_DEVICES.FLAGSHIP_PHONE.id

export const getClientDeviceById = (id) =>
  CLIENT_DEVICE_LIST.find((d) => d.id === id) ?? CLIENT_DEVICES.FLAGSHIP_PHONE

// Effective bands the device will use, honouring the runtime 6 GHz toggle.
// When `sixGHzOn` is false, 6 GHz is dropped even from a 6E/7 device.
export function effectiveBands(device, sixGHzOn) {
  if (sixGHzOn && device.sixGHzCapable) return device.bands
  return device.bands.filter((b) => b !== 6)
}
