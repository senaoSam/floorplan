// Camera model presets (planning aid, Hamina-style "pick a model" workflow).
// Choosing a model fills FOV / range / mount height / tilt so the user doesn't
// hand-dial every camera. Values are representative planning defaults for each
// form factor — not a specific SKU spec sheet.
//
//   fovDeg   — horizontal field of view (360 = fisheye/omni)
//   rangeM   — useful identification distance in metres
//   zM       — typical mount height (m)
//   tiltDeg  — typical downward tilt
export const CAMERA_MODELS = {
  CUSTOM: {
    id: 'custom',
    label: '自訂',
    // no preset values — keep whatever the camera already has
  },
  DOME: {
    id: 'dome',
    label: 'Dome 半球（室內通用）',
    fovDeg: 100,
    rangeM: 12,
    zM: 2.7,
    tiltDeg: 30,
  },
  BULLET: {
    id: 'bullet',
    label: 'Bullet 槍型（長距離走廊）',
    fovDeg: 75,
    rangeM: 20,
    zM: 3,
    tiltDeg: 18,
  },
  TURRET: {
    id: 'turret',
    label: 'Turret 砲塔（室內近距）',
    fovDeg: 90,
    rangeM: 10,
    zM: 2.6,
    tiltDeg: 35,
  },
  WIDE: {
    id: 'wide',
    label: '廣角（大廳/開放空間）',
    fovDeg: 130,
    rangeM: 14,
    zM: 3,
    tiltDeg: 25,
  },
  FISHEYE: {
    id: 'fisheye',
    label: 'Fisheye 魚眼 360°（天花板）',
    fovDeg: 360,
    rangeM: 9,
    zM: 3,
    tiltDeg: 85,   // near top-down
  },
}

// Stable order for the dropdown.
export const CAMERA_MODEL_LIST = [
  CAMERA_MODELS.CUSTOM,
  CAMERA_MODELS.DOME,
  CAMERA_MODELS.BULLET,
  CAMERA_MODELS.TURRET,
  CAMERA_MODELS.WIDE,
  CAMERA_MODELS.FISHEYE,
]

export function cameraModelById(id) {
  return CAMERA_MODEL_LIST.find((m) => m.id === id) ?? CAMERA_MODELS.CUSTOM
}
