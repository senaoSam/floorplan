import { create } from 'zustand'

// Zone: { id, points: [x,y,x,y,...], type: 'in'|'out' }
export const useScopeStore = create((set) => ({
  scopesByFloor: {},

  addScope: (floorId, zone) =>
    set((state) => ({
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
}))
