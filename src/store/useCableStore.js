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
  // 14-1: switch→switch uplink. null = top of the hierarchy (typically the
  // MDF/Router). 'auto' picks copper for <90 m, fiber for ≥90 m.
  uplinkTo: null,
  cableType: 'auto',
}

// Cat 6 spec limit; beyond this, fiber is the practical choice.
export const COPPER_MAX_LENGTH_M = 90

export function getSwitchKindColor(kind) {
  return SWITCH_KINDS.find((k) => k.value === kind)?.color ?? '#10b981'
}

// Cable tray defaults
export const DEFAULT_TRAY_MAGNET_PX = 100

// 19-1 engineering attributes — kind drives fill-ratio rules later (19-4);
// width × depth give the cross-section used for Planning BOM (20-1) and
// (eventually) capacity calculations. Material is a free-form tag that
// affects pricing/weight in BOM and color coding by site convention.
export const TRAY_KINDS = [
  { value: 'wire_basket', label: '網架式 (wire basket)' },
  { value: 'ladder',      label: '梯式 (ladder)' },
  { value: 'solid',       label: '槽式 (solid bottom)' },
  { value: 'conduit',     label: '導管 (conduit)' },
  { value: 'pvc',         label: 'PVC' },
]

export const TRAY_MATERIALS = [
  { value: 'galvanized_steel', label: '鍍鋅鋼' },
  { value: 'stainless_steel',  label: '不鏽鋼' },
  { value: 'aluminum',         label: '鋁' },
  { value: 'fiberglass',       label: '玻璃纖維' },
  { value: 'pvc',              label: 'PVC' },
]

// 19-3 tray discipline / system. Color palette is an "owner default" — sites
// override by editing entries here to match the project's signage convention.
// (Design principle: color legend follows owner/company/discipline standard,
//  not regional code.) `fill` is the translucent body color used by the 2D
// channel polygon; `color` is the border / stroke / 3D edge color.
// `code` is the short tag used in auto-generated names (TRAY-{floor}-{code}-{seq}).
export const TRAY_SYSTEMS = [
  { value: 'data',     label: 'Data',     code: 'D', color: '#818cf8', fill: 'rgba(99, 102, 241, 0.40)' },
  { value: 'power',    label: 'Power',    code: 'P', color: '#ef4444', fill: 'rgba(239, 68, 68, 0.32)'  },
  { value: 'fire',     label: 'Fire',     code: 'F', color: '#f97316', fill: 'rgba(249, 115, 22, 0.32)' },
  { value: 'backbone', label: 'Backbone', code: 'B', color: '#a855f7', fill: 'rgba(168, 85, 247, 0.32)' },
  { value: 'mixed',    label: 'Mixed',    code: 'M', color: '#6b7280', fill: 'rgba(107, 114, 128, 0.32)' },
]

export function getTraySystem(system) {
  return TRAY_SYSTEMS.find((s) => s.value === system) ?? TRAY_SYSTEMS[0]
}

export function getTraySystemColor(system) {
  return getTraySystem(system).color
}

export function getTraySystemFill(system) {
  return getTraySystem(system).fill
}

// 19-2 mount-height presets. `ceiling` resolves dynamically against the
// floor's ceiling height (so changing the floor height re-anchors all
// ceiling-mounted trays). `wall` / `under_raised_floor` are absolute
// conventions. `custom` uses the user-entered mountHeight directly.
export const TRAY_MOUNT_PRESETS = [
  { value: 'ceiling',            label: '天花 (ceiling)',         resolve: (floor) => Math.max(0, (floor?.floorHeight ?? 3) - 0.05) },
  { value: 'wall',               label: '牆面 2.4 m',             resolve: () => 2.4 },
  { value: 'under_raised_floor', label: '架高地板下 0.1 m',       resolve: () => 0.1 },
  { value: 'custom',             label: '自訂',                   resolve: (_floor, tray) => tray?.mountHeight ?? 2.5 },
]

export function resolveTrayMountHeight(tray, floor) {
  const presetVal = tray?.mountPreset ?? 'ceiling'
  const preset = TRAY_MOUNT_PRESETS.find((p) => p.value === presetVal) ?? TRAY_MOUNT_PRESETS[0]
  return preset.resolve(floor, tray)
}

export const DEFAULT_TRAY = {
  kind: 'wire_basket',
  widthMm: 200,
  depthMm: 100,
  materialId: 'galvanized_steel',
  mountPreset: 'ceiling',
  mountHeight: 2.5,   // only consulted when mountPreset === 'custom'
  system: 'data',     // 19-3 discipline — drives color + naming
}

// 19-4 cable cross-section assumptions (Planning BOM estimate). Cat 6 ≈ 6.5 mm
// OD; multimode fiber jacket ≈ 3 mm OD. Real cables vary — these are the
// owner-default planning numbers; bumping them is the right knob if the site
// uses thicker copper (Cat 6A/7) or armoured fiber.
export const CABLE_AREAS_MM2 = {
  copper: 33.2,   // π × (6.5 / 2)²
  fiber:  7.1,    // π × (3.0 / 2)²
}

// 19-4 capacity profiles. Two presets + `custom`. Per the project's design
// principles, we never call these "code violations" — they are owner-chosen
// planning thresholds, not NEC / TIA-569 enforcement. Sites that follow a
// specific standard (e.g. NEC Article 392 40% rule) pick the matching preset
// or define their own custom thresholds.
//
// status mapping (used by classifyFillRatio):
//   ratio < warnRatio  → 'ok'      (OK)
//   ratio < fullRatio  → 'warn'    (注意)
//   ratio ≤ 1.0        → 'full'    (滿載)
//   ratio > 1.0        → 'exceed'  (超出)
export const CAPACITY_PROFILES = [
  { value: 'planning', label: 'Planning（25% / 40%）', warnRatio: 0.25, fullRatio: 0.40 },
  { value: 'standard', label: 'Standard（40% / 60%）', warnRatio: 0.40, fullRatio: 0.60 },
  { value: 'custom',   label: '自訂',                  warnRatio: null, fullRatio: null },
]

export const DEFAULT_CAPACITY_PROFILE = 'planning'

export function getCapacityProfile(value, customCapacity) {
  const preset = CAPACITY_PROFILES.find((p) => p.value === value) ?? CAPACITY_PROFILES[0]
  if (preset.value !== 'custom') return preset
  return {
    value: 'custom',
    label: preset.label,
    warnRatio: customCapacity?.warnRatio ?? 0.25,
    fullRatio: customCapacity?.fullRatio ?? 0.40,
  }
}

export const CAPACITY_STATUS = {
  ok:     { label: 'OK',     color: '#10b981' },
  warn:   { label: '注意',   color: '#f59e0b' },
  full:   { label: '滿載',   color: '#f97316' },
  exceed: { label: '超出',   color: '#ef4444' },
}

export function classifyFillRatio(ratio, profile) {
  if (!Number.isFinite(ratio)) return 'ok'
  if (ratio > 1.0) return 'exceed'
  if (ratio >= profile.fullRatio) return 'full'
  if (ratio >= profile.warnRatio) return 'warn'
  return 'ok'
}

// Riser defaults — riser is a GLOBAL object (cable-spec §2):
// shape: { id, name, x, y, floorIds: [floorId,...], magnetDistance }
// xy is shared across every floor the riser passes through.
export const DEFAULT_RISER_MAGNET_PX = 100

export const useCableStore = create((set, get) => ({
  // { [floorId]: Switch[] }
  switchesByFloor: {},
  globalSwitchCounter: 0,

  // { [floorId]: Tray[] }
  // Tray shape: { id, name, points: [{x,y}, ...], magnetDistance }
  // points are canvas coords (image px); magnetDistance is canvas px.
  // `name` is user-facing (e.g. "TRAY-03"); falls back to `id` for legacy
  // trays loaded without one.
  traysByFloor: {},
  globalTrayCounter: 0,

  // Global risers — one entry per physical riser, regardless of how many
  // floors it spans. cable-spec §2: { id, name, x, y, floorIds, magnetDistance }
  risers: [],
  globalRiserCounter: 0,

  // 19-4 capacity rule (global). User picks a preset or 'custom'; custom
  // thresholds live in customCapacity. Never hard-coded as a code rule —
  // each owner picks the right numbers for their fill convention.
  capacityProfile: DEFAULT_CAPACITY_PROFILE,
  customCapacity: { warnRatio: 0.25, fullRatio: 0.40 },

  setCapacityProfile: (value) => set({ capacityProfile: value }),

  setCustomCapacity: (patch) =>
    set((state) => ({
      customCapacity: { ...state.customCapacity, ...patch },
    })),

  // 20-1 waste factor — multiplier applied to the Planning BOM total length
  // (e.g. 1.10 = 10% extra for cuts / overlap / fittings allowance). This is
  // a planning estimate, not施工 final BOM — site team adjusts during install.
  wasteFactor: 1.10,
  setWasteFactor: (value) => set({ wasteFactor: value }),

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

  // Auto-name format (18-4 + 19-3): TRAY-{floorTag}-{sysCode}-{seq}.
  // - floorTag uses floor.name with whitespace stripped (e.g. "1F" → "1F"),
  //   omitted entirely when no floor is supplied (legacy callers).
  // - sysCode is the TRAY_SYSTEMS code letter (D / P / F / B / M).
  // - seq is the zero-padded global counter.
  nextTrayName: ({ floor = null, system = 'data' } = {}) => {
    const seq = String(get().globalTrayCounter + 1).padStart(2, '0')
    const sysCode = getTraySystem(system).code
    const floorTag = floor?.name ? String(floor.name).replace(/\s+/g, '') : null
    return floorTag
      ? `TRAY-${floorTag}-${sysCode}-${seq}`
      : `TRAY-${sysCode}-${seq}`
  },

  addTray: (floorId, tray) =>
    set((state) => ({
      globalTrayCounter: state.globalTrayCounter + 1,
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
