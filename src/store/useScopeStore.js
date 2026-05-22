import { create } from 'zustand'

// Zone: { id, name?, points: [x,y,x,y,...], type: 'in'|'out' }
// `name` is user-facing (e.g. "ZONE-01"); falls back to `id` for legacy zones.
export const useScopeStore = create((set, get) => ({
  scopesByFloor: {},
  globalScopeCounter: 0,

  nextScopeName: ({ floor = null } = {}) => {
    const seq = String(get().globalScopeCounter + 1).padStart(2, '0')
    const floorTag = floor?.name ? String(floor.name).replace(/\s+/g, '') : null
    return floorTag ? `ZONE-${floorTag}-${seq}` : `ZONE-${seq}`
  },

  addScope: (floorId, zone) =>
    set((state) => ({
      globalScopeCounter: state.globalScopeCounter + 1,
      scopesByFloor: {
        ...state.scopesByFloor,
        [floorId]: [...(state.scopesByFloor[floorId] ?? []), zone],
      },
    })),

  updateScope: (floorId, zoneId, patch) =>
    set((state) => ({
      scopesByFloor: {
        ...state.scopesByFloor,
        [floorId]: (state.scopesByFloor[floorId] ?? []).map((z) =>
          z.id === zoneId ? { ...z, ...patch } : z
        ),
      },
    })),

  removeScope: (floorId, zoneId) =>
    set((state) => ({
      scopesByFloor: {
        ...state.scopesByFloor,
        [floorId]: (state.scopesByFloor[floorId] ?? []).filter((z) => z.id !== zoneId),
      },
    })),

  removeScopes: (floorId, zoneIds) =>
    set((state) => {
      const idSet = new Set(zoneIds)
      return {
        scopesByFloor: {
          ...state.scopesByFloor,
          [floorId]: (state.scopesByFloor[floorId] ?? []).filter((z) => !idSet.has(z.id)),
        },
      }
    }),

  updateScopes: (floorId, zoneIds, patch) =>
    set((state) => {
      const idSet = new Set(zoneIds)
      return {
        scopesByFloor: {
          ...state.scopesByFloor,
          [floorId]: (state.scopesByFloor[floorId] ?? []).map((z) =>
            idSet.has(z.id) ? { ...z, ...patch } : z
          ),
        },
      }
    }),

  clearFloor: (floorId) =>
    set((state) => {
      const { [floorId]: _, ...rest } = state.scopesByFloor
      return { scopesByFloor: rest }
    }),
}))
