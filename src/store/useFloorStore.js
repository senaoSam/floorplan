import { create } from 'zustand'
import { generateId } from '@/utils/id'

// Default inter-slab distance (meters). Equals the default wall topHeight so
// a multi-storey 3D stack lines up.
export const DEFAULT_FLOOR_HEIGHT_M = 3.0

export const useFloorStore = create((set, get) => ({
  floors: [],
  activeFloorId: null,

  setFloors: (floors) => set({ floors }),

  addFloor: (floor) =>
    set((state) => ({ floors: [...state.floors, floor] })),

  removeFloor: (id) =>
    set((state) => {
      const idx = state.floors.findIndex((f) => f.id === id)
      const nextFloors = state.floors.filter((f) => f.id !== id)
      let nextActive = state.activeFloorId
      if (state.activeFloorId === id) {
        if (nextFloors.length === 0) nextActive = null
        else if (idx > 0)             nextActive = nextFloors[idx - 1].id
        else                          nextActive = nextFloors[0].id
      }
      return { floors: nextFloors, activeFloorId: nextActive }
    }),

  setActiveFloor: (id) => set({ activeFloorId: id }),

  updateFloor: (id, patch) =>
    set((state) => ({
      floors: state.floors.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })),

  setFloorScale: (id, scale) =>
    set((state) => ({
      floors: state.floors.map((f) => (f.id === id ? { ...f, scale } : f)),
    })),

  reorderFloors: (from, to) =>
    set((state) => {
      if (from === to || from < 0 || from >= state.floors.length) return {}
      const next = state.floors.slice()
      const [moved] = next.splice(from, 1)
      const insertAt = Math.max(0, Math.min(to, next.length))
      next.splice(insertAt, 0, moved)
      return { floors: next }
    }),

  getActiveFloor: () => {
    const { floors, activeFloorId } = get()
    return floors.find((f) => f.id === activeFloorId) ?? null
  },

  importFloorFromUrl: (imageUrl, imageWidth, imageHeight, name, defaultScale = null) => {
    const id = generateId('floor')
    const floorName = name ?? `${get().floors.length + 1}F`
    const floor = {
      id, name: floorName, imageUrl, imageWidth, imageHeight,
      opacity: 1, rotation: 0, scale: defaultScale, offsetX: 0, offsetY: 0,
      alignOffsetX: 0, alignOffsetY: 0, alignScale: 1, alignRotation: 0,
      cropX: null, cropY: null, cropWidth: null, cropHeight: null,
      floorHeight: DEFAULT_FLOOR_HEIGHT_M,
    }
    set((state) => ({
      floors: [...state.floors, floor],
      activeFloorId: id,
    }))
    return floor
  },
}))
