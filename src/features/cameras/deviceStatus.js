// Device operational status (Verkada parity). Verkada's floor plan colours
// each device by health: green = online & recording, orange = offline /
// error. We have no real device backend, so status is MOCK.
//
// Cameras default to ONLINE — with only a handful of cameras on a demo floor,
// a random-offline fallback too often left most of the floor uncovered, which
// reads as "broken" rather than "one camera happens to be down". To show the
// offline treatment (dimmed cone, no detection, counts as blind), toggle a
// camera offline from its panel; the stored `device.status` is the only thing
// that makes a camera offline.

export const DEVICE_STATUS = {
  ONLINE: 'online',
  OFFLINE: 'offline',
}

export const STATUS_COLOR = {
  online: '#22c55e',    // green — operational
  offline: '#f97316',   // orange — offline / error (Verkada convention)
}

export const STATUS_LABEL = {
  online: '在線',
  offline: '離線',
}

export function deviceStatus(device) {
  // Only an explicit stored override makes a camera offline; otherwise online.
  return device?.status === DEVICE_STATUS.OFFLINE
    ? DEVICE_STATUS.OFFLINE
    : DEVICE_STATUS.ONLINE
}
