import { create } from 'zustand'

export const useWallStore = create((set, get) => ({
  // { [floorId]: Wall[] }
  wallsByFloor: {},

  getWalls: (floorId) => get().wallsByFloor[floorId] ?? [],

  addWall: (floorId, wall) =>
    set((state) => ({
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
}))
