import { create } from 'zustand'

// Hole: { id, name?, points: [x,y,x,y,...] }
// `name` is user-facing (e.g. "HOLE-01"); falls back to `id` for legacy holes.
export const useFloorHoleStore = create((set, get) => ({
  floorHolesByFloor: {},
  globalFloorHoleCounter: 0,

  nextFloorHoleName: ({ floor = null } = {}) => {
    const seq = String(get().globalFloorHoleCounter + 1).padStart(2, '0')
    const floorTag = floor?.name ? String(floor.name).replace(/\s+/g, '') : null
    return floorTag ? `HOLE-${floorTag}-${seq}` : `HOLE-${seq}`
  },

  addFloorHole: (floorId, hole) =>
    set((state) => ({
      globalFloorHoleCounter: state.globalFloorHoleCounter + 1,
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

  clearFloor: (floorId) =>
    set((state) => {
      const { [floorId]: _, ...rest } = state.floorHolesByFloor
      return { floorHolesByFloor: rest }
    }),
}))
