// ── Undo / Redo（Snapshot-based）──────────────────────────────────
// 自動監聽下方所有 data store 的變化，變化前的狀態自動推入 undoStack。
//
// 【新增 store 時需要更新此檔案】
// 當新增新的 data store（如 useSwitchStore、useCableStore 等），需要：
//   1. import 新 store
//   2. takeSnapshot() 加上該 store 的資料
//   3. restoreSnapshot() 加上還原邏輯
//   4. 底部加一組 subscribe 監聽 + _prev 變數
//   5. onStoreChange() 的 snap 物件加上對應欄位

import { create } from 'zustand'
import { useFloorStore } from './useFloorStore'
import { useWallStore } from './useWallStore'
import { useAPStore } from './useAPStore'
import { useScopeStore } from './useScopeStore'
import { useFloorHoleStore } from './useFloorHoleStore'

const MAX_HISTORY = 50
const DEBOUNCE_MS = 300

// 旗標：還原中不記錄歷史
let _restoring = false

// 【擴充點 A】新增 store 時，在此加入該 store 的資料欄位
function takeSnapshot(floorId) {
  if (!floorId) return null
  return {
    floorId,
    walls: structuredClone(useWallStore.getState().wallsByFloor[floorId] ?? []),
    aps: structuredClone(useAPStore.getState().apsByFloor[floorId] ?? []),
    scopes: structuredClone(useScopeStore.getState().scopesByFloor[floorId] ?? []),
    floorHoles: structuredClone(useFloorHoleStore.getState().floorHolesByFloor[floorId] ?? []),
    // 未來：switches, cables, cameras ...
  }
}

// 【擴充點 B】新增 store 時，在此加入還原邏輯
function restoreSnapshot(snapshot) {
  if (!snapshot) return
  const { floorId, walls, aps, scopes, floorHoles } = snapshot
  _restoring = true
  useWallStore.getState().setWalls(floorId, walls)
  useAPStore.getState().setAPs(floorId, aps)
  useScopeStore.setState((s) => ({
    scopesByFloor: { ...s.scopesByFloor, [floorId]: scopes },
  }))
  useFloorHoleStore.setState((s) => ({
    floorHolesByFloor: { ...s.floorHolesByFloor, [floorId]: floorHoles },
  }))
  // 未來：restoreSnapshot 加入 switches, cables, cameras ...
  _restoring = false
}

function pushToUndo(snap) {
  useHistoryStore.setState((s) => ({
    undoStack: [...s.undoStack.slice(-(MAX_HISTORY - 1)), snap],
    redoStack: [],
  }))
}

export const useHistoryStore = create((set, get) => ({
  undoStack: [],
  redoStack: [],

  undo: () => {
    const { undoStack } = get()
    if (undoStack.length === 0) return

    // 若有待推入的 pending snapshot，先 flush
    flushPending()

    const floorId = useFloorStore.getState().activeFloorId
    if (!floorId) return

    const currentSnap = takeSnapshot(floorId)
    const prevSnap = get().undoStack[get().undoStack.length - 1]
    if (prevSnap.floorId !== floorId) return

    restoreSnapshot(prevSnap)
    set((s) => ({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, currentSnap],
    }))
  },

  redo: () => {
    const { redoStack } = get()
    if (redoStack.length === 0) return

    const floorId = useFloorStore.getState().activeFloorId
    if (!floorId) return

    const nextSnap = redoStack[redoStack.length - 1]
    if (nextSnap.floorId !== floorId) return

    const currentSnap = takeSnapshot(floorId)
    restoreSnapshot(nextSnap)
    set((s) => ({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, currentSnap],
    }))
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  clearHistory: () => set({ undoStack: [], redoStack: [] }),
}))

// ── Debounce 機制：拖曳等連續操作合併為一次 undo 步驟 ──────────
// 當偵測到第一次變化時，記住「變化前」快照但先不推入 stack，
// 等 DEBOUNCE_MS 內沒有新變化才真正推入。
// 若持續變化（拖曳中），只保留最初的那份快照。

let _pendingSnap = null
let _debounceTimer = null

function flushPending() {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer)
    _debounceTimer = null
  }
  if (_pendingSnap) {
    pushToUndo(_pendingSnap)
    _pendingSnap = null
  }
}

function schedulePush(snap) {
  // 第一次觸發：記住「變化前」快照
  if (!_pendingSnap) {
    _pendingSnap = snap
  }
  // 重設 debounce timer
  if (_debounceTimer) clearTimeout(_debounceTimer)
  _debounceTimer = setTimeout(() => {
    if (_pendingSnap) {
      pushToUndo(_pendingSnap)
      _pendingSnap = null
    }
    _debounceTimer = null
  }, DEBOUNCE_MS)
}

// ── 【擴充點 C】監聽 data store 的變化 ──────────────────────────
// 新增 store 時，加一組 _prev 變數 + subscribe 區塊
let _prevWalls = useWallStore.getState().wallsByFloor
let _prevAPs = useAPStore.getState().apsByFloor
let _prevScopes = useScopeStore.getState().scopesByFloor
let _prevHoles = useFloorHoleStore.getState().floorHolesByFloor

function onStoreChange(storeName, prevRef, currentRef) {
  if (_restoring) return
  const floorId = useFloorStore.getState().activeFloorId
  if (!floorId) return
  if (prevRef[floorId] === currentRef[floorId]) return

  // 用「變化前」的資料組合快照
  const snap = {
    floorId,
    walls: structuredClone(storeName === 'walls' ? (prevRef[floorId] ?? []) : (useWallStore.getState().wallsByFloor[floorId] ?? [])),
    aps: structuredClone(storeName === 'aps' ? (prevRef[floorId] ?? []) : (useAPStore.getState().apsByFloor[floorId] ?? [])),
    scopes: structuredClone(storeName === 'scopes' ? (prevRef[floorId] ?? []) : (useScopeStore.getState().scopesByFloor[floorId] ?? [])),
    floorHoles: structuredClone(storeName === 'holes' ? (prevRef[floorId] ?? []) : (useFloorHoleStore.getState().floorHolesByFloor[floorId] ?? [])),
  }

  schedulePush(snap)
}

useWallStore.subscribe((state) => {
  const cur = state.wallsByFloor
  if (cur !== _prevWalls) {
    onStoreChange('walls', _prevWalls, cur)
    _prevWalls = cur
  }
})

useAPStore.subscribe((state) => {
  const cur = state.apsByFloor
  if (cur !== _prevAPs) {
    onStoreChange('aps', _prevAPs, cur)
    _prevAPs = cur
  }
})

useScopeStore.subscribe((state) => {
  const cur = state.scopesByFloor
  if (cur !== _prevScopes) {
    onStoreChange('scopes', _prevScopes, cur)
    _prevScopes = cur
  }
})

useFloorHoleStore.subscribe((state) => {
  const cur = state.floorHolesByFloor
  if (cur !== _prevHoles) {
    onStoreChange('holes', _prevHoles, cur)
    _prevHoles = cur
  }
})
