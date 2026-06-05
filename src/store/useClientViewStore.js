import { create } from 'zustand'
import { DEFAULT_CLIENT_DEVICE_ID } from '@/constants/clientDevices'

// Client View ("see the network from a client's perspective") UI + simulation
// state. Kept isolated from the heatmap store so toggling Client View never
// perturbs heatmap settings, and vice versa.
//
// Shape notes:
//   pos        — client position in CANVAS px (image space), or null when no
//                client has been placed yet. Same coordinate convention as APs.
//   deviceId   — selected client device profile (clientDevices.js).
//   sixGHzOn   — runtime 6 GHz enable (only meaningful for 6E/7-capable
//                devices; effectiveBands() honours it).
//   servingApId — the AP the client is currently associated to. Held across
//                moves so the roaming hysteresis can require a candidate to
//                beat the incumbent by ROAM_HYSTERESIS_DB before switching.
//                Reset to null when the client is (re)placed or the device
//                changes (a different device may not even support the band).
//   reading    — latest simulation result for the panel. Shape:
//                { servingApId, servingApName, distanceM, rssiDbm, snrDb,
//                  sinrDb, band, channelWidth, mcs, mcsLabel, phyRateMbps,
//                  spatialStreams, candidates:[{id,name,rssiDbm}] }
//                null when no client is placed / nothing in range.
//   showAssociationArea — when true, the layer paints the "stays-associated"
//                blue region for the serving AP. Per Hamina, enabling it hides
//                the heatmap (the binder toggles heatmap off, remembering its
//                prior state via heatmapWasEnabled, and restores on disable /
//                mode exit).
//
// Advanced simulation params (mirror Hamina's Client Experience pane):
//   wifi7On       — runtime Wi-Fi 7 enable. Off → an 11be device's data rate
//                   uses the 11ax MCS ladder (cap MCS 11); bands unchanged.
//   linkDirection — 'down' (AP→client) | 'up' (client→AP) | 'worst' (min of
//                   the two, the default, matching Hamina's "Worstlink").
//   clientHeightM — client rx height (m); affects cross-floor slab loss.
//   clientTxDbm   — client transmit power (dBm); used for the uplink direction.
//   noiseFloor    — per-band noise floor (dBm) → SNR/SINR/data rate.
//   minInterferingRssiDbm — APs weaker than this don't count as interferers
//                   in the SINR sum (Hamina "Min. interfering RSSI").
// Any param that changes the simulation clears servingApId + associationCells
// so the binder recomputes from a clean incumbent.
export const useClientViewStore = create((set) => ({
  pos: null,
  deviceId: DEFAULT_CLIENT_DEVICE_ID,
  sixGHzOn: true,
  wifi7On: true,
  linkDirection: 'worst',
  clientHeightM: 1.0,
  clientTxDbm: 10,
  // Defaults match Hamina's pane (lower noise as frequency rises is unusual but
  // mirrors their reference figures; users adjust per environment).
  noiseFloor: { 2.4: -92, 5: -95, 6: -96 },
  minInterferingRssiDbm: -82,
  // Association-area COVERAGE threshold (dBm). A point is "covered" (blue) when
  // the strongest usable AP's RSSI is at/above this. Blue = GOOD-SIGNAL area
  // (signal strong enough for normal use), NOT "can/can't associate" — devices
  // still associate down to ~-85 (MIN_USABLE_RSSI_DBM in simulate.js), just at
  // poor quality. -67 is the common industry "good" coverage design target.
  coverageThresholdDbm: -67,
  servingApId: null,
  // Manually-locked serving AP id (null = automatic: strongest + hysteresis).
  // A what-if tool — real device users can't pick an AP, so the UI labels this
  // as "manual" (non-real-roaming). Only forces `serving`; the coverage blue
  // stays the whole-network union. Cleared on leave/reset.
  lockedApId: null,
  // Single-AP coverage outline. `singleApAreaId` is the MANUALLY-chosen AP whose
  // good-signal outline is shown (null = none chosen manually). The AP actually
  // outlined = singleApAreaId ?? servingApId (manual wins; otherwise follow the
  // serving AP automatically). Only one single-AP outline at a time.
  // `singleApArea` caches the computed outline { polygons } for the layer.
  singleApAreaId: null,
  singleApArea: null,
  reading: null,
  // Default ON — entering Client View shows the device's association area first
  // (Hamina-style device-perspective default). The binder applies the heatmap
  // mutual-exclusion on mode entry, so the heatmap starts hidden too.
  showAssociationArea: true,
  // Remembers whether the heatmap was on before association area hid it, so the
  // binder can restore it when association area is turned off / mode exits.
  heatmapWasEnabled: false,
  // Lightweight right-click menu for CLIENT_VIEW (separate from the generic
  // object context menu, which stays suppressed in this mode). Shape:
  //   { screenX, screenY, apId: string|null }  — apId set when the right-click
  //   landed on an AP marker; null for empty space. null when closed.
  cvMenu: null,
  // Association-area render data: { bounds:{x,y,w,h}, polygons:[flat[x,y,…]] }
  // in canvas px. The blue fill covers `bounds` with the association region
  // (polygons) cut out — Hamina shades the OUTSIDE. Computed on demand and
  // cached; cleared when the client moves / a param changes so it never shows
  // a stale region.
  associationArea: null,

  setPos: (pos) => set({ pos, associationArea: null }),
  setDevice: (deviceId) => set({ deviceId, servingApId: null, associationArea: null, singleApArea: null }),
  setSixGHzOn: (sixGHzOn) => set({ sixGHzOn, servingApId: null, associationArea: null, singleApArea: null }),
  setWifi7On: (wifi7On) => set({ wifi7On, servingApId: null, associationArea: null, singleApArea: null }),
  setLinkDirection: (linkDirection) => set({ linkDirection, servingApId: null, associationArea: null, singleApArea: null }),
  setClientHeightM: (clientHeightM) => set({ clientHeightM, servingApId: null, associationArea: null, singleApArea: null }),
  setClientTxDbm: (clientTxDbm) => set({ clientTxDbm, servingApId: null, associationArea: null, singleApArea: null }),
  setNoiseFloorBand: (band, dbm) => set((s) => ({
    noiseFloor: { ...s.noiseFloor, [band]: dbm },
    servingApId: null,
    associationArea: null,
    singleApArea: null,
  })),
  setMinInterferingRssiDbm: (minInterferingRssiDbm) => set({ minInterferingRssiDbm, servingApId: null, associationArea: null, singleApArea: null }),
  // Affects both coverage blobs (whole-network + single-AP outline) → invalidate
  // both caches so the binder recomputes them.
  setCoverageThresholdDbm: (coverageThresholdDbm) => set({ coverageThresholdDbm, associationArea: null, singleApArea: null }),
  setServingApId: (servingApId) => set({ servingApId }),
  // Lock/unlock the serving AP. Clearing servingApId forces a fresh serving
  // pick (so unlocking immediately re-runs the automatic choice).
  setLockedApId: (lockedApId) => set({ lockedApId, servingApId: null }),
  // Manually choose / clear the single-AP outline AP. Invalidate the cached
  // outline so the binder recomputes for the new target.
  setSingleApAreaId: (singleApAreaId) => set({ singleApAreaId, singleApArea: null }),
  setSingleApArea: (singleApArea) => set({ singleApArea }),
  openCvMenu: (cvMenu) => set({ cvMenu }),
  closeCvMenu: () => set((s) => (s.cvMenu ? { cvMenu: null } : {})),
  setReading: (reading) => set({ reading }),
  setShowAssociationArea: (showAssociationArea) => set({ showAssociationArea }),
  setHeatmapWasEnabled: (heatmapWasEnabled) => set({ heatmapWasEnabled }),
  setAssociationArea: (associationArea) => set({ associationArea }),

  // Called when LEAVING Client View. We KEEP `pos` so the client returns to its
  // last spot on re-entry (position memory — user request). Only the transient
  // simulation outputs (serving / reading / associationArea) are cleared; the
  // binder recomputes them from the remembered pos when the mode is re-entered.
  // Advanced params (device / noise / …) persist as user preferences.
  // showAssociationArea is left as-is (its default-on / toggle state carries
  // over too).
  leave: () => set({
    servingApId: null,
    lockedApId: null,
    reading: null,
    associationArea: null,
    singleApAreaId: null,
    singleApArea: null,
    cvMenu: null,
  }),

  // Hard reset — fully clears the placed client (e.g. floor switch where the
  // remembered pos no longer maps to the same space). Not used by mode switch.
  reset: () => set({
    pos: null,
    servingApId: null,
    lockedApId: null,
    reading: null,
    showAssociationArea: true,
    associationArea: null,
    singleApAreaId: null,
    singleApArea: null,
    cvMenu: null,
  }),
}))

// Roaming hysteresis (dB): a candidate AP must exceed the current serving AP's
// RSSI by this margin before the client switches to it. Models a real device's
// "stickiness" so the serving AP — and therefore the visible roaming boundary —
// doesn't flicker as the client crosses a coverage edge. Discussed + chosen in
// .claude/client-view-spec.md (與純 RSSI 模型效能無差，只差真實度).
export const ROAM_HYSTERESIS_DB = 6

// A candidate AP is shown as a grey roaming-candidate line when its RSSI is
// within this window of the serving AP's RSSI (i.e. "could plausibly roam to").
export const ROAM_CANDIDATE_WINDOW_DB = 12
