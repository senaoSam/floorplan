import { create } from 'zustand'
import { generateId } from '@/utils/id'
import { DEFAULT_FLOOR_SLAB_MATERIAL_ID, DEFAULT_FLOOR_SLAB_DB } from '@/constants/materials'

// Default inter-slab distance (meters). Equals the default wall topHeight so
// a multi-storey 3D stack lines up.
export const DEFAULT_FLOOR_HEIGHT_M = 3.0

// 52-B4: bounds for the per-floor numeric inputs. Only `min` was enforced, so
// a floor height of 999999 m was accepted — it broke the 3D stack (cables shot
// off-screen, slabs z-fighting) and, worse, showed a cable length of 1000009 m
// in the AP panel that looked like a normal estimate and would land in the BOM.
//
// floorHeight is the storey-to-storey SPACING, not the wall height (walls carry
// their own topHeight). It feeds three things, so the ceiling is set by the
// tightest of them rather than by "tallest plausible storey":
//   1. 3D stacking — each floor sits at the running sum of the ones below
//   2. cable drop  — computeRoutes adds (floorHeight - ap.z) per AP
//   3. tray 'ceiling' preset — resolves to floorHeight - 0.05
// 20 m covers an atrium, warehouse or sports hall while keeping a single
// cable drop from silently reaching BOM-breaking lengths.
// 100 dB is past total blockage (metal is 30).
export const MIN_FLOOR_HEIGHT_M = 0.5
export const MAX_FLOOR_HEIGHT_M = 20
export const MAX_SLAB_ATTEN_DB = 100

// 52-A2: typo guard for a floorplan's px/m scale — NOT a performance limit.
// A 1000px image spans 20 km at 0.05 px/m and 20 cm at 5000 px/m; outside that
// the user mistyped. Large-but-real sites (a 2 km campus is ~0.5 px/m) must
// stay allowed, so heatmap cost is bounded separately by the grid-cell ceiling
// in sampleField, which coarsens the step instead of refusing the scale.
export const MIN_PX_PER_M = 0.05
export const MAX_PX_PER_M = 5000

// Effective align-anchor floor: the explicitly pinned one, else the bottom
// floor (floors[0], the 3D ground level). The anchor is ADVISORY — it gates
// nothing in the engine; SidebarLeft warns before aligning it so one floor
// stays fixed and the others align onto it (per-floor align poses are
// absolute, so moving every floor drifts the whole stack).
export const getAlignAnchorId = (s) =>
  s.alignAnchorFloorId ?? s.floors[0]?.id ?? null

export const useFloorStore = create((set, get) => ({
  floors: [],
  activeFloorId: null,
  // Explicit align-anchor pick (菜單「設為對齊基準」); null = default to the
  // bottom floor via getAlignAnchorId.
  alignAnchorFloorId: null,

  setAlignAnchorFloor: (id) => set({ alignAnchorFloorId: id }),

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
      return {
        floors: nextFloors,
        activeFloorId: nextActive,
        // Deleted anchor → fall back to the bottom-floor default.
        alignAnchorFloorId: state.alignAnchorFloorId === id ? null : state.alignAnchorFloorId,
      }
    }),

  setActiveFloor: (id) => set({ activeFloorId: id }),

  updateFloor: (id, patch) =>
    set((state) => ({
      floors: state.floors.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })),

  // 52-A2: every scale writer funnels through here (ScaleDialog + the AI
  // auto-scale), so this is the one place that can stop an absurd value.
  // Small scale is the dangerous direction: the heatmap opens its grid on
  // imageSize/scale, so 0.004 px/m (measuring 20px and typing 5000 metres)
  // asks for ~4.8e11 Float32Array elements and OOMs the tab. Reject
  // non-finite / non-positive input outright rather than clamping it, since
  // there is no sane value to guess.
  setFloorScale: (id, scale) =>
    set((state) => {
      if (!Number.isFinite(scale) || scale <= 0) return state
      const clamped = Math.min(Math.max(scale, MIN_PX_PER_M), MAX_PX_PER_M)
      return {
        floors: state.floors.map((f) => (f.id === id ? { ...f, scale: clamped } : f)),
      }
    }),

  // Inter-floor alignment transform — patch keys live on the floor record
  // (alignOffsetX/Y, alignScale, alignRotation). Applied as a Container
  // transform during ALIGN_FLOOR mode; object coords are not rewritten.
  setAlignTransform: (id, patch) =>
    set((state) => ({
      floors: state.floors.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })),

  resetAlignTransform: (id) =>
    set((state) => ({
      floors: state.floors.map((f) =>
        f.id === id ? { ...f, alignOffsetX: 0, alignOffsetY: 0, alignScale: 1, alignRotation: 0 } : f,
      ),
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
