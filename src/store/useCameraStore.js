import { create } from 'zustand'

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
  // Analytics objects (Phase 34-5), per floor like cameras:
  //   Tripwire = { id, name, x1, y1, x2, y2 }      — counting line
  //   Zone     = { id, name, x, y, w, h }          — rectangular analysis zone
  tripwiresByFloor: {},
  zonesByFloor: {},
  globalTripwireCounter: 0,
  globalZoneCounter: 0,
  // Blind-spot overlay: shade everything no camera can see.
  showBlindSpots: false,
  // Floor-wide occupancy trend panel (Verkada "Occupancy Trends" parity).
  showTrendPanel: false,
  // Live-view popover (Verkada parity): the camera whose feed is open, or
  // null. The feed is a MOCK placeholder — we have no real stream — but the
  // interaction ("click a device, see its feed") matches Command.
  liveViewCameraId: null,
  // Two-click draw sub-tool inside CAMERA mode: null | 'tripwire' | 'zone'.
  // First click stores draftPoint, second commits the object. While a tool is
  // armed, canvas clicks do NOT place cameras (FloorplanSystem routes here).
  drawTool: null,
  draftPoint: null,

  getCameras: (floorId) => get().camerasByFloor[floorId] ?? [],

  nextCameraName: () => {
    const next = get().globalCameraCounter + 1
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
    })),

  setCameras: (floorId, cameras) =>
    set((state) => ({
      camerasByFloor: { ...state.camerasByFloor, [floorId]: cameras },
    })),

  clearFloor: (floorId) =>
    set((state) => {
      const { [floorId]: _, ...rest } = state.camerasByFloor
      const { [floorId]: __, ...restT } = state.tripwiresByFloor
      const { [floorId]: ___, ...restZ } = state.zonesByFloor
      return { camerasByFloor: rest, tripwiresByFloor: restT, zonesByFloor: restZ }
    }),

  // ── Tripwires ───────────────────────────────────────────────────────────
  nextTripwireName: () => `LINE-${String(get().globalTripwireCounter + 1).padStart(2, '0')}`,
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
  nextZoneName: () => `ZONE-${String(get().globalZoneCounter + 1).padStart(2, '0')}`,
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
  toggleShowTrendPanel: () => set((s) => ({ showTrendPanel: !s.showTrendPanel })),
  openLiveView: (cameraId) => set({ liveViewCameraId: cameraId }),
  closeLiveView: () => set({ liveViewCameraId: null }),
  setDrawTool: (drawTool) => set({ drawTool, draftPoint: null }),
  setDraftPoint: (draftPoint) => set({ draftPoint }),
}))
