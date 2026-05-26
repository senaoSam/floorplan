import { create } from 'zustand'
import { generateId } from '@/utils/id'
import { DEFAULT_FLOOR_SLAB_MATERIAL_ID, DEFAULT_FLOOR_SLAB_DB } from '@/constants/materials'

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
      floorSlabMaterialId: DEFAULT_FLOOR_SLAB_MATERIAL_ID,
      floorSlabAttenuationDb: DEFAULT_FLOOR_SLAB_DB,
      floorHeight: DEFAULT_FLOOR_HEIGHT_M,
    }
    set((state) => ({
      floors: [...state.floors, floor],
      activeFloorId: id,
    }))
    return floor
  },

  importImageFloor: (file, imageWidth, imageHeight) => {
    const id = generateId('floor')
    const imageUrl = URL.createObjectURL(file)
    const name = `${get().floors.length + 1}F`
    const floor = {
      id, name, imageUrl, imageWidth, imageHeight,
      opacity: 1, rotation: 0, scale: null, offsetX: 0, offsetY: 0,
      alignOffsetX: 0, alignOffsetY: 0, alignScale: 1, alignRotation: 0,
      cropX: null, cropY: null, cropWidth: null, cropHeight: null,
      floorSlabMaterialId: DEFAULT_FLOOR_SLAB_MATERIAL_ID,
      floorSlabAttenuationDb: DEFAULT_FLOOR_SLAB_DB,
      floorHeight: DEFAULT_FLOOR_HEIGHT_M,
    }
    set((state) => ({
      floors: [...state.floors, floor],
      activeFloorId: id,
    }))
    return floor
  },

  importMultipleFloors: (pages) => {
    const baseIndex = get().floors.length
    const newFloors = pages.map((page, i) => ({
      id: generateId('floor'),
      name: `${baseIndex + i + 1}F`,
      imageUrl: URL.createObjectURL(page.blob),
      imageWidth: page.width,
      imageHeight: page.height,
      opacity: 1, rotation: 0, scale: null, offsetX: 0, offsetY: 0,
      alignOffsetX: 0, alignOffsetY: 0, alignScale: 1, alignRotation: 0,
      cropX: null, cropY: null, cropWidth: null, cropHeight: null,
      floorSlabMaterialId: DEFAULT_FLOOR_SLAB_MATERIAL_ID,
      floorSlabAttenuationDb: DEFAULT_FLOOR_SLAB_DB,
      floorHeight: DEFAULT_FLOOR_HEIGHT_M,
    }))
    set((state) => ({
      floors: [...state.floors, ...newFloors],
      activeFloorId: newFloors[0].id,
    }))
    return newFloors
  },
}))
