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

  // ── 門窗 openings ──────────────────────────────────────
  // Opening: { id, type: 'door'|'window', startFrac, endFrac, material, topHeight, bottomHeight }
  // startFrac/endFrac: 0~1 沿牆體方向的比例位置

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
