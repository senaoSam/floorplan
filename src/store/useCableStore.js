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

// Phase 23 / 29-2 — per-kind real-world defaults.
// References: Cisco Catalyst 9200/9300/9500, Aruba CX 6200/6300/8400,
// Juniper EX2300/EX4400/QFX5120, TIA-942 §5.4, BICSI TDMM 14ed.
//
//   access  (Cisco C9200-24P)        : 24 port / 370 W PoE / SFP+ uplink
//   idf     (Cisco C9300-48S aggreg.) : 48 port / 740 W PoE / SFP28 uplink
//   mdf     (Cisco C9500-48Y4C core)  : 48 port / 0 W / QSFP28 100G uplink
//   router  (Cisco Cat 8300)          : 8 port (4 WAN + 4 LAN) / 0 W / SFP+
//
// uplinkPortType is descriptive (shown in panel, not enforced by routing).
// isCoreLayer flag drives 3D chassis sizing and "no PoE" enforcement.
export const DEFAULT_SWITCH_BY_KIND = {
  switch: {
    kind: 'switch',
    mountHeight: 2.4,
    model: 'Catalyst 9200-24P',
    portCount: 24,
    poeBudget: 370,
    uplinkPortType: 'sfp+',
    uplinkCount: 4,
    uplinkTo: null,
    cableType: 'fiber',
    isCoreLayer: false,
  },
  idf: {
    kind: 'idf',
    mountHeight: 0.5,
    model: 'Catalyst 9300-48S',
    portCount: 48,
    poeBudget: 740,
    uplinkPortType: 'sfp28',
    uplinkCount: 2,
    uplinkTo: null,
    cableType: 'fiber',
    isCoreLayer: false,
  },
  mdf: {
    kind: 'mdf',
    mountHeight: 0.5,
    model: 'Catalyst 9500-48Y4C',
    portCount: 48,
    poeBudget: 0,
    uplinkPortType: 'qsfp28',
    uplinkCount: 2,
    uplinkTo: null,
    cableType: 'fiber',
    isCoreLayer: true,
  },
  router: {
    kind: 'router',
    mountHeight: 0.5,
    model: 'Catalyst 8300',
    portCount: 8,
    poeBudget: 0,
    uplinkPortType: 'sfp+',
    uplinkCount: 2,
    uplinkTo: null,
    cableType: 'fiber',
    isCoreLayer: true,
    wanPortCount: 4,
    lanPortCount: 4,
  },
}

// Kept for legacy imports — same as DEFAULT_SWITCH_BY_KIND.switch.
export const DEFAULT_SWITCH = DEFAULT_SWITCH_BY_KIND.switch

// Phase 23 / 29-3 — uplink hierarchy rules. For each (srcKind, targetKind)
// pair, three states:
//   'main'  — the canonical / recommended target. Shown in dropdown first.
//   'warn'  — technically allowed (e.g. collapsed core / VSS pair), but
//             not the textbook topology. Shown with warning text.
//   null    — disallowed. Hidden from dropdown; existing data showing this
//             gets a flagged warning instead of silent rewrite.
//
// `null` as the *target* in code below means "this kind is allowed to be
// top-of-hierarchy" (final hop, no further uplink).
export const UPLINK_RULES = {
  switch: { switch: null, idf: 'main', mdf: 'warn',  router: null,  null: null },
  idf:    { switch: null, idf: 'warn', mdf: 'main',  router: null,  null: null },
  mdf:    { switch: null, idf: null,   mdf: 'warn',  router: 'main', null: 'main' },
  router: { switch: null, idf: null,   mdf: null,    router: null,   null: 'main' },
}

// Helper: list of allowed target kinds for a given source kind, sorted with
// 'main' first then 'warn'.
export function allowedUplinkKinds(srcKind) {
  const rules = UPLINK_RULES[srcKind] ?? {}
  const main = [], warn = []
  for (const [k, level] of Object.entries(rules)) {
    if (k === 'null') continue
    if (level === 'main') main.push(k)
    else if (level === 'warn') warn.push(k)
  }
  return { main, warn, allowsNull: rules.null != null }
}

// Helper: classify a (src, target) pair. Returns 'main' / 'warn' / 'forbidden'.
// Used by SwitchPanel to flag bad existing data without auto-resetting.
export function classifyUplinkPair(srcKind, targetKind) {
  if (targetKind == null) {
    return UPLINK_RULES[srcKind]?.null === 'main' ? 'main' : 'forbidden'
  }
  const level = UPLINK_RULES[srcKind]?.[targetKind]
  if (level === 'main') return 'main'
  if (level === 'warn') return 'warn'
  return 'forbidden'
}

// Cat 6 spec limit; beyond this, fiber is the practical choice.
export const COPPER_MAX_LENGTH_M = 90

export function getSwitchKindColor(kind) {
  return SWITCH_KINDS.find((k) => k.value === kind)?.color ?? '#10b981'
}

// Cable tray defaults
export const DEFAULT_TRAY_MAGNET_PX = 100

// 19-3 tray discipline / system. Color palette is an "owner default" — sites
// override by editing entries here to match the project's signage convention.
// (Design principle: color legend follows owner/company/discipline standard,
//  not regional code.) `fill` is the translucent body color used by the 2D
// channel polygon; `color` is the border / stroke / 3D edge color.
export const TRAY_SYSTEMS = [
  { value: 'data',     label: 'Data',     color: '#818cf8', fill: 'rgba(99, 102, 241, 0.40)' },
  { value: 'power',    label: 'Power',    color: '#ef4444', fill: 'rgba(239, 68, 68, 0.32)'  },
  { value: 'fire',     label: 'Fire',     color: '#f97316', fill: 'rgba(249, 115, 22, 0.32)' },
  { value: 'backbone', label: 'Backbone', color: '#a855f7', fill: 'rgba(168, 85, 247, 0.32)' },
  { value: 'mixed',    label: 'Mixed',    color: '#6b7280', fill: 'rgba(107, 114, 128, 0.32)' },
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
  widthMm: 200,
  depthMm: 100,
  mountPreset: 'ceiling',
  mountHeight: 2.5,   // only consulted when mountPreset === 'custom'
  system: 'data',     // 19-3 discipline — drives color
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
    set((state) => {
      // 29-3 — auto-fill uplinkTo if the new switch has no uplinkTo yet.
      // Walks building-wide switches looking for the recommended target kind
      // for this src kind ('main' first, fall back to 'warn'), picks the
      // physically nearest by Manhattan distance. If nothing valid is found,
      // uplinkTo stays null (user can wire manually).
      let finalSw = sw
      if (sw.uplinkTo == null && UPLINK_RULES[sw.kind]) {
        const rules = UPLINK_RULES[sw.kind]
        let bestMain = null, bestMainDist = Infinity
        let bestWarn = null, bestWarnDist = Infinity
        for (const list of Object.values(state.switchesByFloor)) {
          for (const other of (list ?? [])) {
            if (other.id === sw.id) continue
            const level = rules[other.kind]
            if (level !== 'main' && level !== 'warn') continue
            const dist = Math.abs((other.x ?? 0) - sw.x) + Math.abs((other.y ?? 0) - sw.y)
            if (level === 'main' && dist < bestMainDist) { bestMain = other; bestMainDist = dist }
            else if (level === 'warn' && dist < bestWarnDist) { bestWarn = other; bestWarnDist = dist }
          }
        }
        const pick = bestMain ?? bestWarn
        if (pick) finalSw = { ...sw, uplinkTo: pick.id }
      }

      // User-requested: backfill orphan uplinks when a higher-tier switch
      // is added (oldSrc shipped the same one-direction auto-fill so an
      // SW→IDF→MDF→RTR placed in that order left every switch's uplinkTo
      // null, and no S2S lines rendered). Walk all existing switches and
      // give them this new switch as uplinkTo iff (a) their uplinkTo is
      // null and (b) finalSw is a 'main' target under their kind's rules.
      const updatedByFloor = { ...state.switchesByFloor }
      for (const [fid, list] of Object.entries(updatedByFloor)) {
        updatedByFloor[fid] = (list ?? []).map((other) => {
          if (other.uplinkTo != null) return other
          const otherRules = UPLINK_RULES[other.kind] ?? {}
          if (otherRules[finalSw.kind] !== 'main') return other
          return { ...other, uplinkTo: finalSw.id }
        })
      }

      return {
        globalSwitchCounter: state.globalSwitchCounter + 1,
        switchesByFloor: {
          ...updatedByFloor,
          [floorId]: [...(updatedByFloor[floorId] ?? []), finalSw],
        },
      }
    }),

  updateSwitch: (floorId, swId, patch) =>
    set((state) => ({
      switchesByFloor: {
        ...state.switchesByFloor,
        [floorId]: (state.switchesByFloor[floorId] ?? []).map((s) =>
          s.id === swId ? { ...s, ...patch } : s,
        ),
      },
    })),

  // 29-2 — change a switch's kind and auto-apply the new kind's defaults
  // (portCount / poeBudget / uplinkPortType / mountHeight / model / etc).
  // Preserves position (x, y), id, name, and the explicit uplinkTo *only if*
  // the new kind still allows that target (UPLINK_RULES). User-customised
  // free-text fields (model) get reset since the new kind's hardware family
  // is fundamentally different — easier to re-edit than to deduce equivalence.
  changeSwitchKind: (floorId, swId, newKind) =>
    set((state) => {
      const list = state.switchesByFloor[floorId] ?? []
      const cur = list.find((s) => s.id === swId)
      if (!cur || cur.kind === newKind) return {}
      const newDefaults = DEFAULT_SWITCH_BY_KIND[newKind]
      if (!newDefaults) return {}
      // Keep uplinkTo only if still allowed under the new kind's rules.
      // Resolving the target's kind needs a flat lookup across all floors.
      let keepUplink = false
      if (cur.uplinkTo) {
        let targetKind = null
        for (const swArr of Object.values(state.switchesByFloor)) {
          const t = (swArr ?? []).find((s) => s.id === cur.uplinkTo)
          if (t) { targetKind = t.kind; break }
        }
        if (targetKind != null) {
          const level = UPLINK_RULES[newKind]?.[targetKind]
          keepUplink = level === 'main' || level === 'warn'
        }
      }
      // If we're dropping the old uplinkTo, try to auto-fill a new one based
      // on the same nearest-main-target logic addSwitch uses. This handles
      // "改 SW → IDF" right when an MDF already exists somewhere — without
      // it, the user sees a 「尚未指定上連目標」 warning even though there's
      // a perfectly fine target one click away.
      let nextUplinkTo = keepUplink ? cur.uplinkTo : null
      if (!keepUplink && UPLINK_RULES[newKind]) {
        const rules = UPLINK_RULES[newKind]
        let bestMain = null, bestMainDist = Infinity
        let bestWarn = null, bestWarnDist = Infinity
        for (const swArr of Object.values(state.switchesByFloor)) {
          for (const other of (swArr ?? [])) {
            if (other.id === cur.id) continue
            const level = rules[other.kind]
            if (level !== 'main' && level !== 'warn') continue
            const dist = Math.abs((other.x ?? 0) - cur.x) + Math.abs((other.y ?? 0) - cur.y)
            if (level === 'main' && dist < bestMainDist) { bestMain = other; bestMainDist = dist }
            else if (level === 'warn' && dist < bestWarnDist) { bestWarn = other; bestWarnDist = dist }
          }
        }
        const pick = bestMain ?? bestWarn
        if (pick) nextUplinkTo = pick.id
      }
      const merged = {
        ...newDefaults,
        id: cur.id,
        name: cur.name,
        x: cur.x,
        y: cur.y,
        uplinkTo: nextUplinkTo,
      }
      return {
        switchesByFloor: {
          ...state.switchesByFloor,
          [floorId]: list.map((s) => (s.id === swId ? merged : s)),
        },
      }
    }),

  removeSwitch: (floorId, swId) =>
    set((state) => {
      // Drop dangling uplinkTo across the whole building so no other switch
      // ends up pointing at a now-deleted target. Without this the
      // surviving switches keep a stale id that the UI has to detect and
      // warn about — annoying since the user already destroyed the target.
      const next = {}
      for (const [fId, list] of Object.entries(state.switchesByFloor)) {
        next[fId] = (list ?? [])
          .filter((s) => !(fId === floorId && s.id === swId))
          .map((s) => (s.uplinkTo === swId ? { ...s, uplinkTo: null } : s))
      }
      return { switchesByFloor: next }
    }),

  removeSwitches: (floorId, swIds) =>
    set((state) => {
      const idSet = new Set(swIds)
      // Same dangling-uplink cleanup as removeSwitch but for a batch.
      const next = {}
      for (const [fId, list] of Object.entries(state.switchesByFloor)) {
        next[fId] = (list ?? [])
          .filter((s) => !(fId === floorId && idSet.has(s.id)))
          .map((s) => (idSet.has(s.uplinkTo) ? { ...s, uplinkTo: null } : s))
      }
      return { switchesByFloor: next }
    }),

  setSwitches: (floorId, switches) =>
    set((state) => ({
      switchesByFloor: { ...state.switchesByFloor, [floorId]: switches },
    })),

  // ── Tray actions ──────────────────────────────────────────────────────

  getTrays: (floorId) => get().traysByFloor[floorId] ?? [],

  // Auto-name format: TRAY-{floorTag}-{seq}. Used to depend on system code
  // (D/P/F/B/M) but that locked the name in at creation time — changing the
  // discipline afterwards left a misleading label. Names are stable IDs;
  // discipline is communicated via color + the dropdown in the panel.
  nextTrayName: ({ floor = null } = {}) => {
    const seq = String(get().globalTrayCounter + 1).padStart(2, '0')
    const floorTag = floor?.name ? String(floor.name).replace(/\s+/g, '') : null
    return floorTag ? `TRAY-${floorTag}-${seq}` : `TRAY-${seq}`
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
