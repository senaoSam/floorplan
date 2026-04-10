import { create } from 'zustand'
import { generateId } from '@/utils/id'

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

  // 從圖片檔案建立新樓層並設為 active
  importImageFloor: (file, imageWidth, imageHeight) => {
    const id = generateId('floor')
    const imageUrl = URL.createObjectURL(file)
    const name = `${get().floors.length + 1}F`
    const floor = {
      id, name, imageUrl, imageWidth, imageHeight,
      opacity: 1, rotation: 0, scale: null, offsetX: 0, offsetY: 0,
    }
    set((state) => ({
      floors: [...state.floors, floor],
      activeFloorId: id,
    }))
    return floor
  },

  // 批次匯入多個頁面（PDF 多頁用）
  importMultipleFloors: (pages) => {
    const baseIndex = get().floors.length
    const newFloors = pages.map((page, i) => ({
      id: generateId('floor'),
      name: `${baseIndex + i + 1}F`,
      imageUrl: URL.createObjectURL(page.blob),
      imageWidth: page.width,
      imageHeight: page.height,
      opacity: 1, rotation: 0, scale: null, offsetX: 0, offsetY: 0,
    }))
    set((state) => ({
      floors: [...state.floors, ...newFloors],
      activeFloorId: newFloors[0].id,
    }))
    return newFloors
  },
}))
