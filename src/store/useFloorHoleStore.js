import { create } from 'zustand'

// Hole: { id, points: [x,y,x,y,...] }
export const useFloorHoleStore = create((set) => ({
  floorHolesByFloor: {},

  addFloorHole: (floorId, hole) =>
    set((state) => ({
      floorHolesByFloor: {
        ...state.floorHolesByFloor,
        [floorId]: [...(state.floorHolesByFloor[floorId] ?? []), hole],
      },
    })),

  updateFloorHole: (floorId, holeId, patch) =>
    set((state) => ({
      floorHolesByFloor: {
        ...state.floorHolesByFloor,
        [floorId]: (state.floorHolesByFloor[floorId] ?? []).map((h) =>
          h.id === holeId ? { ...h, ...patch } : h
        ),
      },
    })),

  removeFloorHole: (floorId, holeId) =>
    set((state) => ({
      floorHolesByFloor: {
        ...state.floorHolesByFloor,
        [floorId]: (state.floorHolesByFloor[floorId] ?? []).filter((h) => h.id !== holeId),
      },
    })),

  removeFloorHoles: (floorId, holeIds) =>
    set((state) => {
      const idSet = new Set(holeIds)
      return {
        floorHolesByFloor: {
          ...state.floorHolesByFloor,
          [floorId]: (state.floorHolesByFloor[floorId] ?? []).filter((h) => !idSet.has(h.id)),
        },
      }
    }),
}))
