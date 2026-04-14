import { create } from 'zustand'

export const useAPStore = create((set, get) => ({
  // { [floorId]: AP[] }
  apsByFloor: {},
  globalAPCounter: 0,

  getAPs: (floorId) => get().apsByFloor[floorId] ?? [],

  nextAPName: () => {
    const next = get().globalAPCounter + 1
    return `AP-${String(next).padStart(2, '0')}`
  },

  addAP: (floorId, ap) =>
    set((state) => ({
      globalAPCounter: state.globalAPCounter + 1,
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
