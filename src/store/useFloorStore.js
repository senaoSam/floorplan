import { create } from 'zustand'

export const useFloorStore = create((set, get) => ({
  // 樓層列表
  floors: [],
  activeFloorId: null,

  // 比例尺 px/m
  scale: null,

  setFloors: (floors) => set({ floors }),

  addFloor: (floor) =>
    set((state) => ({ floors: [...state.floors, floor] })),

  removeFloor: (id) =>
    set((state) => ({
      floors: state.floors.filter((f) => f.id !== id),
      activeFloorId: state.activeFloorId === id ? null : state.activeFloorId,
    })),

  setActiveFloor: (id) => set({ activeFloorId: id }),

  updateFloor: (id, patch) =>
    set((state) => ({
      floors: state.floors.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })),

  setScale: (scale) => set({ scale }),

  getActiveFloor: () => {
    const { floors, activeFloorId } = get()
    return floors.find((f) => f.id === activeFloorId) ?? null
  },
}))
