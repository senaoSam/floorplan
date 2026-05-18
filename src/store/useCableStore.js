import { create } from 'zustand'

// Switch / IDF / MDF / Router endpoints (per-floor) — the base layer the cable
// system snaps cables onto. Future: traysByFloor, risers, slack parameters
// (see .claude/cable-spec.md §2).
//
// Switch shape:
//   { id, name, x, y, mountHeight, kind, model, portCount, poeBudget }
//   - x, y: canvas coords (image px), same convention as walls/APs
//   - kind: 'switch' | 'idf' | 'mdf' | 'router'
//   - mountHeight: meters above floor (rack height; default 0.5 m)
//   - poeBudget: watts (0 = no PoE)
export const SWITCH_KINDS = [
  { value: 'switch', label: 'Switch', color: '#10b981' },
  { value: 'idf',    label: 'IDF',    color: '#3b82f6' },
  { value: 'mdf',    label: 'MDF',    color: '#8b5cf6' },
  { value: 'router', label: 'Router', color: '#f59e0b' },
]

export const DEFAULT_SWITCH = {
  kind: 'switch',
  mountHeight: 0.5,
  model: 'POE-24-port',
  portCount: 24,
  poeBudget: 370,
}

export function getSwitchKindColor(kind) {
  return SWITCH_KINDS.find((k) => k.value === kind)?.color ?? '#10b981'
}

// Cable tray defaults
export const DEFAULT_TRAY_MAGNET_PX = 100

// Riser defaults — riser is a GLOBAL object (cable-spec §2):
// shape: { id, name, x, y, floorIds: [floorId,...], magnetDistance }
// xy is shared across every floor the riser passes through.
export const DEFAULT_RISER_MAGNET_PX = 100

export const useCableStore = create((set, get) => ({
  // { [floorId]: Switch[] }
  switchesByFloor: {},
  globalSwitchCounter: 0,

  // { [floorId]: Tray[] }
  // Tray shape: { id, points: [{x,y}, ...], magnetDistance }
  // points are canvas coords (image px); magnetDistance is canvas px.
  traysByFloor: {},

  // Global risers — one entry per physical riser, regardless of how many
  // floors it spans. cable-spec §2: { id, name, x, y, floorIds, magnetDistance }
  risers: [],
  globalRiserCounter: 0,

  getSwitches: (floorId) => get().switchesByFloor[floorId] ?? [],

  nextSwitchName: (kind = 'switch') => {
    const prefix = kind === 'idf' ? 'IDF' : kind === 'mdf' ? 'MDF' : kind === 'router' ? 'RTR' : 'SW'
    const next = get().globalSwitchCounter + 1
    return `${prefix}-${String(next).padStart(2, '0')}`
  },

  addSwitch: (floorId, sw) =>
    set((state) => ({
      globalSwitchCounter: state.globalSwitchCounter + 1,
      switchesByFloor: {
        ...state.switchesByFloor,
        [floorId]: [...(state.switchesByFloor[floorId] ?? []), sw],
      },
    })),

  updateSwitch: (floorId, swId, patch) =>
    set((state) => ({
      switchesByFloor: {
        ...state.switchesByFloor,
        [floorId]: (state.switchesByFloor[floorId] ?? []).map((s) =>
          s.id === swId ? { ...s, ...patch } : s,
        ),
      },
    })),

  removeSwitch: (floorId, swId) =>
    set((state) => ({
      switchesByFloor: {
        ...state.switchesByFloor,
        [floorId]: (state.switchesByFloor[floorId] ?? []).filter((s) => s.id !== swId),
      },
    })),

  removeSwitches: (floorId, swIds) =>
    set((state) => {
      const idSet = new Set(swIds)
      return {
        switchesByFloor: {
          ...state.switchesByFloor,
          [floorId]: (state.switchesByFloor[floorId] ?? []).filter((s) => !idSet.has(s.id)),
        },
      }
    }),

  setSwitches: (floorId, switches) =>
    set((state) => ({
      switchesByFloor: { ...state.switchesByFloor, [floorId]: switches },
    })),

  // ── Tray actions ──────────────────────────────────────────────────────

  getTrays: (floorId) => get().traysByFloor[floorId] ?? [],

  addTray: (floorId, tray) =>
    set((state) => ({
      traysByFloor: {
        ...state.traysByFloor,
        [floorId]: [...(state.traysByFloor[floorId] ?? []), tray],
      },
    })),

  updateTray: (floorId, trayId, patch) =>
    set((state) => ({
      traysByFloor: {
        ...state.traysByFloor,
        [floorId]: (state.traysByFloor[floorId] ?? []).map((t) =>
          t.id === trayId ? { ...t, ...patch } : t,
        ),
      },
    })),

  removeTray: (floorId, trayId) =>
    set((state) => ({
      traysByFloor: {
        ...state.traysByFloor,
        [floorId]: (state.traysByFloor[floorId] ?? []).filter((t) => t.id !== trayId),
      },
    })),

  removeTrays: (floorId, trayIds) =>
    set((state) => {
      const idSet = new Set(trayIds)
      return {
        traysByFloor: {
          ...state.traysByFloor,
          [floorId]: (state.traysByFloor[floorId] ?? []).filter((t) => !idSet.has(t.id)),
        },
      }
    }),

  setTrays: (floorId, trays) =>
    set((state) => ({
      traysByFloor: { ...state.traysByFloor, [floorId]: trays },
    })),

  clearFloor: (floorId) =>
    set((state) => {
      const { [floorId]: _s, ...restS } = state.switchesByFloor
      const { [floorId]: _t, ...restT } = state.traysByFloor
      // Risers are global — only drop this floor from their floorIds.
      // Risers that end up with zero floors are kept (user can re-add floors)
      // since removing them silently would surprise users mid-edit.
      const risers = state.risers.map((r) => ({
        ...r,
        floorIds: (r.floorIds ?? []).filter((id) => id !== floorId),
      }))
      return { switchesByFloor: restS, traysByFloor: restT, risers }
    }),

  // ── Riser actions ─────────────────────────────────────────────────────

  nextRiserName: () => {
    const next = get().globalRiserCounter + 1
    return `RISER-${String(next).padStart(2, '0')}`
  },

  addRiser: (riser) =>
    set((state) => ({
      globalRiserCounter: state.globalRiserCounter + 1,
      risers: [...state.risers, riser],
    })),

  updateRiser: (riserId, patch) =>
    set((state) => ({
      risers: state.risers.map((r) => (r.id === riserId ? { ...r, ...patch } : r)),
    })),

  removeRiser: (riserId) =>
    set((state) => ({ risers: state.risers.filter((r) => r.id !== riserId) })),

  removeRisers: (riserIds) =>
    set((state) => {
      const idSet = new Set(riserIds)
      return { risers: state.risers.filter((r) => !idSet.has(r.id)) }
    }),

  setRisers: (risers) => set({ risers }),
}))
