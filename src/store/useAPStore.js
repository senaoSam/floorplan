import { create } from 'zustand'

// Highest NN across `AP-NN` names in a list (0 when none match). Used to keep
// globalAPCounter ahead of bulk-loaded APs so generated names never collide.
const AP_NAME_RE = /^AP-(\d+)$/
function highestAPNumber(aps) {
  let max = 0
  for (const ap of aps ?? []) {
    const m = AP_NAME_RE.exec(ap?.name ?? '')
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max
}

export const useAPStore = create((set, get) => ({
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

  removeAPs: (floorId, apIds) =>
    set((state) => {
      const idSet = new Set(apIds)
      return {
        apsByFloor: {
          ...state.apsByFloor,
          [floorId]: (state.apsByFloor[floorId] ?? []).filter((ap) => !idSet.has(ap.id)),
        },
      }
    }),

  updateAPs: (floorId, apIds, patch) =>
    set((state) => {
      const idSet = new Set(apIds)
      return {
        apsByFloor: {
          ...state.apsByFloor,
          [floorId]: (state.apsByFloor[floorId] ?? []).map((ap) =>
            idSet.has(ap.id) ? { ...ap, ...patch } : ap
          ),
        },
      }
    }),

  // 52-A4: bulk loads (demo / stress fill / auto-plan apply) come in with names
  // already assigned, so the counter has to catch up to them. Without this it
  // stays at 0 and the next hand-placed AP is named AP-01 again — a duplicate
  // that reaches the exported PDF's cable table, where two identical rows can't
  // be told apart on site. Only ever moves forward, so it is safe to call for a
  // partial floor while other floors hold higher numbers.
  setAPs: (floorId, aps) =>
    set((state) => ({
      apsByFloor: { ...state.apsByFloor, [floorId]: aps },
      globalAPCounter: Math.max(state.globalAPCounter, highestAPNumber(aps)),
    })),

  clearFloor: (floorId) =>
    set((state) => {
      const { [floorId]: _, ...rest } = state.apsByFloor
      return { apsByFloor: rest }
    }),
}))
