import { create } from 'zustand'

export const useAPStore = create((set, get) => ({
  // { [floorId]: AP[] }
  apsByFloor: {},

  getAPs: (floorId) => get().apsByFloor[floorId] ?? [],

  addAP: (floorId, ap) =>
    set((state) => ({
      apsByFloor: {
        ...state.apsByFloor,
        [floorId]: [...(state.apsByFloor[floorId] ?? []), ap],
      },
    })),

  updateAP: (floorId, apId, patch) =>
    set((state) => ({
      apsByFloor: {
        ...state.apsByFloor,
        [floorId]: (state.apsByFloor[floorId] ?? []).map((ap) =>
          ap.id === apId ? { ...ap, ...patch } : ap
        ),
      },
    })),

  removeAP: (floorId, apId) =>
    set((state) => ({
      apsByFloor: {
        ...state.apsByFloor,
        [floorId]: (state.apsByFloor[floorId] ?? []).filter(
          (ap) => ap.id !== apId
        ),
      },
    })),

  setAPs: (floorId, aps) =>
    set((state) => ({
      apsByFloor: { ...state.apsByFloor, [floorId]: aps },
    })),
}))
