import { create } from 'zustand'

export const useWallStore = create((set, get) => ({
  wallsByFloor: {},
  globalWallCounter: 0,

  getWalls: (floorId) => get().wallsByFloor[floorId] ?? [],

  nextWallName: ({ floor = null } = {}) => {
    const seq = String(get().globalWallCounter + 1).padStart(2, '0')
    const floorTag = floor?.name ? String(floor.name).replace(/\s+/g, '') : null
    return floorTag ? `WALL-${floorTag}-${seq}` : `WALL-${seq}`
  },

  addWall: (floorId, wall) =>
    set((state) => ({
      globalWallCounter: state.globalWallCounter + 1,
      wallsByFloor: {
        ...state.wallsByFloor,
        [floorId]: [...(state.wallsByFloor[floorId] ?? []), wall],
      },
    })),

  updateWall: (floorId, wallId, patch) =>
    set((state) => ({
      wallsByFloor: {
        ...state.wallsByFloor,
        [floorId]: (state.wallsByFloor[floorId] ?? []).map((w) =>
          w.id === wallId ? { ...w, ...patch } : w
        ),
      },
    })),

  removeWall: (floorId, wallId) =>
    set((state) => ({
      wallsByFloor: {
        ...state.wallsByFloor,
        [floorId]: (state.wallsByFloor[floorId] ?? []).filter(
          (w) => w.id !== wallId
        ),
      },
    })),

  removeWalls: (floorId, wallIds) =>
    set((state) => {
      const idSet = new Set(wallIds)
      return {
        wallsByFloor: {
          ...state.wallsByFloor,
          [floorId]: (state.wallsByFloor[floorId] ?? []).filter((w) => !idSet.has(w.id)),
        },
      }
    }),

  updateWalls: (floorId, wallIds, patch) =>
    set((state) => {
      const idSet = new Set(wallIds)
      return {
        wallsByFloor: {
          ...state.wallsByFloor,
          [floorId]: (state.wallsByFloor[floorId] ?? []).map((w) =>
            idSet.has(w.id) ? { ...w, ...patch } : w
          ),
        },
      }
    }),

  setWalls: (floorId, walls) =>
    set((state) => ({
      wallsByFloor: { ...state.wallsByFloor, [floorId]: walls },
    })),

  clearFloor: (floorId) =>
    set((state) => {
      const { [floorId]: _, ...rest } = state.wallsByFloor
      return { wallsByFloor: rest }
    }),

  addOpening: (floorId, wallId, opening) =>
    set((state) => ({
      wallsByFloor: {
        ...state.wallsByFloor,
        [floorId]: (state.wallsByFloor[floorId] ?? []).map((w) =>
          w.id === wallId
            ? { ...w, openings: [...(w.openings ?? []), opening] }
            : w
        ),
      },
    })),

  updateOpening: (floorId, wallId, openingId, patch) =>
    set((state) => ({
      wallsByFloor: {
        ...state.wallsByFloor,
        [floorId]: (state.wallsByFloor[floorId] ?? []).map((w) =>
          w.id === wallId
            ? { ...w, openings: (w.openings ?? []).map((o) => o.id === openingId ? { ...o, ...patch } : o) }
            : w
        ),
      },
    })),

  removeOpening: (floorId, wallId, openingId) =>
    set((state) => ({
      wallsByFloor: {
        ...state.wallsByFloor,
        [floorId]: (state.wallsByFloor[floorId] ?? []).map((w) =>
          w.id === wallId
            ? { ...w, openings: (w.openings ?? []).filter((o) => o.id !== openingId) }
            : w
        ),
      },
    })),
}))
