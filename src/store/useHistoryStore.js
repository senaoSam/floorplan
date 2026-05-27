// Ported 1:1 from oldSrc/store/useHistoryStore.js — Phase 25 Bundle 18.
//
// Snapshot-based Undo/Redo. Subscribes to wall / AP / scope / floorHole
// / cable stores and pushes a snapshot of the variable BEFORE the change
// into undoStack. Continuous edits (drag, slider) collapse into a single
// snapshot via debounce + idle commit.
//
// 【新增 store 時需要更新此檔案】
//   1. import 新 store
//   2. takeSnapshot() 加上該 store 的資料
//   3. restoreSnapshot() 加上還原邏輯
//   4. 底部加一組 subscribe 監聽 + _prev 變數
//   5. onStoreChange() 的 raw 物件加上對應欄位

import { create } from 'zustand'
import { useFloorStore } from './useFloorStore'
import { useWallStore } from './useWallStore'
import { useAPStore } from './useAPStore'
import { useScopeStore } from './useScopeStore'
import { useFloorHoleStore } from './useFloorHoleStore'
import { useCableStore } from './useCableStore'

const MAX_HISTORY = 50
const DEBOUNCE_MS = 300

// Flag set while restoreSnapshot() is rewriting the underlying stores;
// onStoreChange skips recording while it's true.
let _restoring = false

function takeSnapshot(floorId) {
  if (!floorId) return null
  return {
    floorId,
    walls: structuredClone(useWallStore.getState().wallsByFloor[floorId] ?? []),
    aps: structuredClone(useAPStore.getState().apsByFloor[floorId] ?? []),
    scopes: structuredClone(useScopeStore.getState().scopesByFloor[floorId] ?? []),
    floorHoles: structuredClone(useFloorHoleStore.getState().floorHolesByFloor[floorId] ?? []),
    switches: structuredClone(useCableStore.getState().switchesByFloor[floorId] ?? []),
    trays:    structuredClone(useCableStore.getState().traysByFloor[floorId] ?? []),
    risers:   structuredClone(useCableStore.getState().risers ?? []),
  }
}

function restoreSnapshot(snapshot) {
  if (!snapshot) return
  const { floorId, walls, aps, scopes, floorHoles, switches, trays, risers } = snapshot
  _restoring = true
  useWallStore.getState().setWalls(floorId, walls)
  useAPStore.getState().setAPs(floorId, aps)
  useScopeStore.setState((s) => ({
    scopesByFloor: { ...s.scopesByFloor, [floorId]: scopes },
  }))
  useFloorHoleStore.setState((s) => ({
    floorHolesByFloor: { ...s.floorHolesByFloor, [floorId]: floorHoles },
  }))
  useCableStore.getState().setSwitches(floorId, switches ?? [])
  useCableStore.getState().setTrays(floorId, trays ?? [])
  useCableStore.getState().setRisers(risers ?? [])
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
    // Flush any pending raw snapshot first so the user's last batch of
    // continuous edits is captured before we rewind.
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
// requestIdleCallback 裡才真正 clone + push.

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
  pushToUndo({
    floorId: raw.floorId,
    walls: structuredClone(raw.walls),
    aps: structuredClone(raw.aps),
    scopes: structuredClone(raw.scopes),
    floorHoles: structuredClone(raw.floorHoles),
    switches: structuredClone(raw.switches),
    trays:    structuredClone(raw.trays),
    risers:   structuredClone(raw.risers ?? []),
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
  if (!_pendingRaw) _pendingRaw = raw
  if (_debounceTimer) clearTimeout(_debounceTimer)
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null
    if (_idleHandle !== null) cancelIdle(_idleHandle)
    _idleHandle = requestIdle(() => {
      _idleHandle = null
      commitPending()
    })
  }, DEBOUNCE_MS)
}

let _prevWalls    = useWallStore.getState().wallsByFloor
let _prevAPs      = useAPStore.getState().apsByFloor
let _prevScopes   = useScopeStore.getState().scopesByFloor
let _prevHoles    = useFloorHoleStore.getState().floorHolesByFloor
let _prevSwitches = useCableStore.getState().switchesByFloor
let _prevTrays    = useCableStore.getState().traysByFloor
let _prevRisers   = useCableStore.getState().risers

function onStoreChange(storeName, prevRef, currentRef) {
  if (_restoring) return
  const floorId = useFloorStore.getState().activeFloorId
  if (!floorId) return
  if (storeName === 'risers') {
    if (prevRef === currentRef) return
  } else if (prevRef[floorId] === currentRef[floorId]) {
    return
  }
  if (_pendingRaw) {
    schedulePushRaw(_pendingRaw)
    return
  }
  const raw = {
    floorId,
    walls:      storeName === 'walls'    ? (prevRef[floorId] ?? []) : (useWallStore.getState().wallsByFloor[floorId] ?? []),
    aps:        storeName === 'aps'      ? (prevRef[floorId] ?? []) : (useAPStore.getState().apsByFloor[floorId] ?? []),
    scopes:     storeName === 'scopes'   ? (prevRef[floorId] ?? []) : (useScopeStore.getState().scopesByFloor[floorId] ?? []),
    floorHoles: storeName === 'holes'    ? (prevRef[floorId] ?? []) : (useFloorHoleStore.getState().floorHolesByFloor[floorId] ?? []),
    switches:   storeName === 'switches' ? (prevRef[floorId] ?? []) : (useCableStore.getState().switchesByFloor[floorId] ?? []),
    trays:      storeName === 'trays'    ? (prevRef[floorId] ?? []) : (useCableStore.getState().traysByFloor[floorId] ?? []),
    risers:     storeName === 'risers'   ? (prevRef ?? [])           : (useCableStore.getState().risers ?? []),
  }
  schedulePushRaw(raw)
}

useWallStore.subscribe((state) => {
  const cur = state.wallsByFloor
  if (cur !== _prevWalls) { onStoreChange('walls', _prevWalls, cur); _prevWalls = cur }
})
useAPStore.subscribe((state) => {
  const cur = state.apsByFloor
  if (cur !== _prevAPs) { onStoreChange('aps', _prevAPs, cur); _prevAPs = cur }
})
useScopeStore.subscribe((state) => {
  const cur = state.scopesByFloor
  if (cur !== _prevScopes) { onStoreChange('scopes', _prevScopes, cur); _prevScopes = cur }
})
useFloorHoleStore.subscribe((state) => {
  const cur = state.floorHolesByFloor
  if (cur !== _prevHoles) { onStoreChange('holes', _prevHoles, cur); _prevHoles = cur }
})
useCableStore.subscribe((state) => {
  const curS = state.switchesByFloor
  if (curS !== _prevSwitches) { onStoreChange('switches', _prevSwitches, curS); _prevSwitches = curS }
  const curT = state.traysByFloor
  if (curT !== _prevTrays) { onStoreChange('trays', _prevTrays, curT); _prevTrays = curT }
  const curR = state.risers
  if (curR !== _prevRisers) { onStoreChange('risers', _prevRisers, curR); _prevRisers = curR }
})
