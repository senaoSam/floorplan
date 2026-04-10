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

  setWalls: (floorId, walls) =>
    set((state) => ({
      wallsByFloor: { ...state.wallsByFloor, [floorId]: walls },
    })),
}))
