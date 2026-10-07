// 57-27: an AP's mount sets the default tilt of a directional / custom
// antenna -- a ceiling patch or sector normally faces down, a wall one faces
// out. Only defaults: the user's own tilt is never overridden, and the
// engines still read `tilt` alone (no mount term in the RF model).

export const MOUNT_DEFAULT_TILT = { ceiling: -90, wall: 0 }

export const mountDefaultTilt = (mountType) => MOUNT_DEFAULT_TILT[mountType ?? 'ceiling'] ?? 0

const isShaped = (mode) => mode === 'directional' || mode === 'custom'

// Switching to a shaped antenna: give a never-set tilt the mount's default.
export function tiltPatchForModeChange(ap, mode) {
  if (!isShaped(mode) || ap.tilt != null) return {}
  return { tilt: mountDefaultTilt(ap.mountType) }
}

// Changing the mount: a tilt still at the old mount's default (or never set
// on a shaped antenna) follows the new mount; a hand-tuned tilt stays.
export function tiltPatchForMountChange(ap, mountType) {
  const atOldDefault = ap.tilt != null && ap.tilt === mountDefaultTilt(ap.mountType)
  const unsetShaped = ap.tilt == null && isShaped(ap.antennaMode)
  if (!atOldDefault && !unsetShaped) return {}
  return { tilt: mountDefaultTilt(mountType) }
}
