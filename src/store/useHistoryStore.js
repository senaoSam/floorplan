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

// ── Debounce + idle 機制：拖曳等連續操作合併為一次 undo 步驟 ──────────
// P-3 優化：不在事件發生的當下 structuredClone，而是先記下「變化前」的 raw
// reference（連續操作只保留最初那份），等 DEBOUNCE_MS 沒有新變化後，在
// requestIdleCallback 裡才真正 clone + push，讓放開拖曳那一幀保持順暢。
//
// pendingRaw 結構：{ floorId, walls, aps, scopes, floorHoles } — 全是原始 array reference

let _pendingRaw = null
let _debounceTimer = null
let _idleHandle = null

const requestIdle =
  typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
    ? (cb) => window.requestIdleCallback(cb, { timeout: 500 })
    : (cb) => setTimeout(cb, 0)
const cancelIdle =
  typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function'
    ? (id) => window.cancelIdleCallback(id)
    : (id) => clearTimeout(id)

function commitPending() {
  if (!_pendingRaw) return
  const raw = _pendingRaw
  _pendingRaw = null
  // 此刻才真正 clone（在 idle 時間 / undo 前同步補 flush）
  pushToUndo({
    floorId: raw.floorId,
    walls: structuredClone(raw.walls),
    aps: structuredClone(raw.aps),
    scopes: structuredClone(raw.scopes),
    floorHoles: structuredClone(raw.floorHoles),
  })
}

function flushPending() {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer)
    _debounceTimer = null
  }
  if (_idleHandle !== null) {
    cancelIdle(_idleHandle)
    _idleHandle = null
  }
  commitPending()
}

function schedulePushRaw(raw) {
  // 第一次觸發：記住「變化前」raw reference（不 clone）
  if (!_pendingRaw) {
    _pendingRaw = raw
  }
  // 重設 debounce timer
  if (_debounceTimer) clearTimeout(_debounceTimer)
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null
    // 把實際 clone + push 推到 idle，避免放開拖曳那一幀卡頓
    if (_idleHandle !== null) cancelIdle(_idleHandle)
    _idleHandle = requestIdle(() => {
      _idleHandle = null
      commitPending()
    })
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

  // P-3：只記錄「變化前」的 raw array reference，延到 idle 才 clone。
  // 連續變化時 _pendingRaw 已存在就直接忽略（保留最初那份 = 正確的 undo 目標）。
  if (_pendingRaw) {
    // 仍要重設 debounce timer，讓連續操作延後 commit
    schedulePushRaw(_pendingRaw)
    return
  }

  const raw = {
    floorId,
    walls:      storeName === 'walls'  ? (prevRef[floorId] ?? []) : (useWallStore.getState().wallsByFloor[floorId] ?? []),
    aps:        storeName === 'aps'    ? (prevRef[floorId] ?? []) : (useAPStore.getState().apsByFloor[floorId] ?? []),
    scopes:     storeName === 'scopes' ? (prevRef[floorId] ?? []) : (useScopeStore.getState().scopesByFloor[floorId] ?? []),
    floorHoles: storeName === 'holes'  ? (prevRef[floorId] ?? []) : (useFloorHoleStore.getState().floorHolesByFloor[floorId] ?? []),
  }

  schedulePushRaw(raw)
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
