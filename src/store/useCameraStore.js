import { create } from 'zustand'

// 53-G7 (23j): derive the next NN for `PREFIX-NN` names from the names actually
// present, building-wide, instead of a stored counter.
//
// `setCameras` / `setTripwires` / `setZones` all replace a floor's list without
// advancing their counter — the same hole `setAPs` had (fixed in 52-A4) and
// `setSwitches` had (fixed alongside this as E1). These three have no caller
// yet, so nothing is broken today; they are a loaded gun aimed at whoever adds
// the first bulk import. Counting from the contents removes the class of bug
// rather than patching the three call sites: whatever the names say IS the
// state, so a name can never collide after a bulk load, an undo, or a floor
// deletion.
//
// Building-wide (not per-floor) because these names are printed and referenced
// on their own; two floors each owning a `CAM-01` cannot be told apart.
function highestNameNumber(byFloor, prefix, extraLists = []) {
  const re = new RegExp(`^${prefix}-(\\d+)$`)
  let max = 0
  const scan = (list) => {
    for (const item of (list ?? [])) {
      const m = re.exec(item?.name ?? '')
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
  }
  for (const list of Object.values(byFloor ?? {})) scan(list)
  for (const list of extraLists) scan(list)
  return max
}

// Surveillance cameras (Phase 34). Same per-floor keyed shape as useAPStore.
// Camera = { id, name, x, y, z, azimuth, fovDeg, rangeM }
//   x/y      — canvas px (image space), same convention as APs
//   z        — mount height in meters (visual metadata only)
//   azimuth  — 0° points +x (east), increases clockwise (AP convention)
//   fovDeg   — horizontal field of view; >= 360 renders as a full circle
//   rangeM   — view distance in meters (converted via floor.scale px/m)
export const useCameraStore = create((set, get) => ({
  camerasByFloor: {},
  globalCameraCounter: 0,
  // Unplaced cameras (Verkada "Add Cameras" parity): an org-level pool of
  // cameras that exist but aren't on any floor yet, waiting to be dropped onto
  // the plan. Same camera shape minus a meaningful x/y. The Device List panel
  // lists them under "尚未放置" with a "place here" action. Not per-floor —
  // an unplaced camera belongs to no floor until placed.
  unplacedCameras: [],
  // Analytics objects (Phase 34-5), per floor like cameras:
  //   Tripwire = { id, name, x1, y1, x2, y2 }      — counting line
  //   Zone     = { id, name, x, y, w, h }          — rectangular analysis zone
  tripwiresByFloor: {},
  zonesByFloor: {},
  globalTripwireCounter: 0,
  globalZoneCounter: 0,
  // Blind-spot overlay: shade everything no camera can see.
  showBlindSpots: false,
  // Overlap overlay: tint single-camera vs multi-camera (redundant) coverage.
  showOverlap: false,
  // Floor-wide occupancy trend panel (Verkada "Occupancy Trends" parity).
  showTrendPanel: false,
  // Clip the occupancy/flow heatmap to camera FOV coverage (Verkada renders
  // footfall only inside FOV). On by default to match Command; off shows the
  // raw floor-wide footfall for comparison. Only online cameras contribute.
  clipHeatmapToFov: true,
  // Camera list panel: roster of every camera on the floor. Docked as a
  // left rail in CAMERA mode (Verkada "Device List" parity), so it defaults
  // visible for discoverability; the timeline-bar chip toggles it.
  showCameraList: true,
  cameraListCollapsed: false,
  // Coverage target % — the coverage panel flags pass/fail against this.
  coverageTargetPct: 80,
  // Live-view popover (Verkada parity): the camera whose feed is open, or
  // null. The feed is a MOCK placeholder — we have no real stream — but the
  // interaction ("click a device, see its feed") matches Command.
  liveViewCameraId: null,
  // Heat-map calibration modal (Verkada parity, see verkada-notes §L): the
  // camera being calibrated, or null. The user drops 4 points on the floorplan
  // and 4 on the mock camera frame; we solve a homography and store it on the
  // camera as `calibration = { floorPts, framePts, H, errorPx }`.
  calibrateCameraId: null,
  // Two-click draw sub-tool inside CAMERA mode: null | 'tripwire' | 'zone'.
  // First click stores draftPoint, second commits the object. While a tool is
  // armed, canvas clicks do NOT place cameras (FloorplanSystem routes here).
  drawTool: null,
  draftPoint: null,

  getCameras: (floorId) => get().camerasByFloor[floorId] ?? [],

  // 53-G7: unplacedCameras must be scanned too — a pooled camera holds a real
  // CAM-NN name, so ignoring the pool would hand the same name to a placed one.
  nextCameraName: () => {
    const s = get()
    const next = highestNameNumber(s.camerasByFloor, 'CAM', [s.unplacedCameras]) + 1
    return `CAM-${String(next).padStart(2, '0')}`
  },

  addCamera: (floorId, camera) =>
    set((state) => ({
      globalCameraCounter: state.globalCameraCounter + 1,
      camerasByFloor: {
        ...state.camerasByFloor,
        [floorId]: [...(state.camerasByFloor[floorId] ?? []), camera],
      },
    })),

  updateCamera: (floorId, cameraId, patch) =>
    set((state) => ({
      camerasByFloor: {
        ...state.camerasByFloor,
        [floorId]: (state.camerasByFloor[floorId] ?? []).map((c) =>
          c.id === cameraId ? { ...c, ...patch } : c
        ),
      },
    })),

  removeCamera: (floorId, cameraId) =>
    set((state) => ({
      camerasByFloor: {
        ...state.camerasByFloor,
        [floorId]: (state.camerasByFloor[floorId] ?? []).filter(
          (c) => c.id !== cameraId
        ),
      },
      // 52-D9: drop the live-view pointer when its camera goes away. Nothing
      // renders from it today (the popover checks the camera exists), so this
      // is state hygiene — but a dangling id is exactly the kind of thing a
      // later consumer trusts and then crashes on.
      liveViewCameraId: state.liveViewCameraId === cameraId ? null : state.liveViewCameraId,
    })),

  setCameras: (floorId, cameras) =>
    set((state) => ({
      camerasByFloor: { ...state.camerasByFloor, [floorId]: cameras },
    })),

  // ── Unplaced camera pool (Verkada "Add Cameras") ──────────────────────────
  // Add a camera to the unplaced pool. Bumps the global counter so its auto
  // name keeps marching with placed cameras (CAM-05, CAM-06…).
  addUnplacedCamera: (camera) =>
    set((state) => ({
      globalCameraCounter: state.globalCameraCounter + 1,
      unplacedCameras: [...state.unplacedCameras, camera],
    })),
  removeUnplacedCamera: (cameraId) =>
    set((state) => ({
      unplacedCameras: state.unplacedCameras.filter((c) => c.id !== cameraId),
    })),
  // Drop an unplaced camera onto a floor at (x, y): move it out of the pool and
  // into camerasByFloor with real coordinates. No counter bump — it already
  // got its number when it entered the pool.
  placeCamera: (floorId, cameraId, x, y) =>
    set((state) => {
      const cam = state.unplacedCameras.find((c) => c.id === cameraId)
      if (!cam) return {}
      return {
        unplacedCameras: state.unplacedCameras.filter((c) => c.id !== cameraId),
        camerasByFloor: {
          ...state.camerasByFloor,
          [floorId]: [...(state.camerasByFloor[floorId] ?? []), { ...cam, x, y }],
        },
      }
    }),

  clearFloor: (floorId) =>
    set((state) => {
      const { [floorId]: goneCams, ...rest } = state.camerasByFloor
      const { [floorId]: __, ...restT } = state.tripwiresByFloor
      const { [floorId]: ___, ...restZ } = state.zonesByFloor
      // 53-G7 (F5-4): the two modal ids referenced cameras that just ceased to
      // exist. Deleting the floor while a live-view popover or the calibration
      // modal was open on one of its cameras left the id pointing at nothing —
      // a dangling reference the modals resolve with `.find()`, so they render
      // as an empty shell rather than closing.
      const goneIds = new Set((goneCams ?? []).map((c) => c.id))
      return {
        camerasByFloor: rest,
        tripwiresByFloor: restT,
        zonesByFloor: restZ,
        liveViewCameraId: goneIds.has(state.liveViewCameraId) ? null : state.liveViewCameraId,
        calibrateCameraId: goneIds.has(state.calibrateCameraId) ? null : state.calibrateCameraId,
      }
    }),

  // ── Tripwires ───────────────────────────────────────────────────────────
  // 53-G7: see highestNameNumber — derived from contents, not the counter.
  nextTripwireName: () =>
    `LINE-${String(highestNameNumber(get().tripwiresByFloor, 'LINE') + 1).padStart(2, '0')}`,
  addTripwire: (floorId, tripwire) =>
    set((state) => ({
      globalTripwireCounter: state.globalTripwireCounter + 1,
      tripwiresByFloor: {
        ...state.tripwiresByFloor,
        [floorId]: [...(state.tripwiresByFloor[floorId] ?? []), tripwire],
      },
    })),
  updateTripwire: (floorId, id, patch) =>
    set((state) => ({
      tripwiresByFloor: {
        ...state.tripwiresByFloor,
        [floorId]: (state.tripwiresByFloor[floorId] ?? []).map((t) =>
          t.id === id ? { ...t, ...patch } : t
        ),
      },
    })),
  removeTripwire: (floorId, id) =>
    set((state) => ({
      tripwiresByFloor: {
        ...state.tripwiresByFloor,
        [floorId]: (state.tripwiresByFloor[floorId] ?? []).filter((t) => t.id !== id),
      },
    })),
  setTripwires: (floorId, tripwires) =>
    set((state) => ({
      tripwiresByFloor: { ...state.tripwiresByFloor, [floorId]: tripwires },
    })),

  // ── Zones ───────────────────────────────────────────────────────────────
  // 53-G7: see highestNameNumber — derived from contents, not the counter.
  nextZoneName: () =>
    `ZONE-${String(highestNameNumber(get().zonesByFloor, 'ZONE') + 1).padStart(2, '0')}`,
  addZone: (floorId, zone) =>
    set((state) => ({
      globalZoneCounter: state.globalZoneCounter + 1,
      zonesByFloor: {
        ...state.zonesByFloor,
        [floorId]: [...(state.zonesByFloor[floorId] ?? []), zone],
      },
    })),
  updateZone: (floorId, id, patch) =>
    set((state) => ({
      zonesByFloor: {
        ...state.zonesByFloor,
        [floorId]: (state.zonesByFloor[floorId] ?? []).map((z) =>
          z.id === id ? { ...z, ...patch } : z
        ),
      },
    })),
  removeZone: (floorId, id) =>
    set((state) => ({
      zonesByFloor: {
        ...state.zonesByFloor,
        [floorId]: (state.zonesByFloor[floorId] ?? []).filter((z) => z.id !== id),
      },
    })),
  setZones: (floorId, zones) =>
    set((state) => ({
      zonesByFloor: { ...state.zonesByFloor, [floorId]: zones },
    })),

  // ── Blind spots / draw tool ─────────────────────────────────────────────
  toggleShowBlindSpots: () => set((s) => ({ showBlindSpots: !s.showBlindSpots })),
  toggleShowOverlap: () => set((s) => ({ showOverlap: !s.showOverlap })),
  toggleShowTrendPanel: () => set((s) => ({ showTrendPanel: !s.showTrendPanel })),
  toggleClipHeatmapToFov: () => set((s) => ({ clipHeatmapToFov: !s.clipHeatmapToFov })),
  toggleShowCameraList: () => set((s) => ({ showCameraList: !s.showCameraList })),
  toggleCameraListCollapsed: () => set((s) => ({ cameraListCollapsed: !s.cameraListCollapsed })),
  setCoverageTargetPct: (coverageTargetPct) =>
    set({ coverageTargetPct: Math.max(0, Math.min(100, coverageTargetPct)) }),
  openLiveView: (cameraId) => set({ liveViewCameraId: cameraId }),
  closeLiveView: () => set({ liveViewCameraId: null }),
  openCalibrate: (cameraId) => set({ calibrateCameraId: cameraId }),
  closeCalibrate: () => set({ calibrateCameraId: null }),
  setDrawTool: (drawTool) => set({ drawTool, draftPoint: null }),
  setDraftPoint: (draftPoint) => set({ draftPoint }),
}))
