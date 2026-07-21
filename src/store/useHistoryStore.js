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
import { useCameraStore } from './useCameraStore'

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
    // 47-17: add/removeSwitch rewrite uplinkTo on switches BUILDING-WIDE (dangling
    // null on remove, backfill on add), so the snapshot must carry every floor's
    // switches — not just the active floor's — or undo leaves other floors'
    // uplinks broken. Restored wholesale below.
    switchesAll: structuredClone(useCableStore.getState().switchesByFloor ?? {}),
    trays:    structuredClone(useCableStore.getState().traysByFloor[floorId] ?? []),
    risers:   structuredClone(useCableStore.getState().risers ?? []),
    cameras:  structuredClone(useCameraStore.getState().camerasByFloor[floorId] ?? []),
    tripwires: structuredClone(useCameraStore.getState().tripwiresByFloor[floorId] ?? []),
    camZones:  structuredClone(useCameraStore.getState().zonesByFloor[floorId] ?? []),
    // 47-16: placeCamera moves a camera out of the org-level unplaced pool into a
    // floor. Without capturing the pool, undo restores camerasByFloor (camera
    // gone from the floor) but not the pool (not back either) → camera vanishes.
    unplacedCameras: structuredClone(useCameraStore.getState().unplacedCameras ?? []),
  }
}

function restoreSnapshot(snapshot) {
  if (!snapshot) return
  const { floorId, walls, aps, scopes, floorHoles, switchesAll, trays, risers, cameras, tripwires, camZones, unplacedCameras } = snapshot
  _restoring = true
  useWallStore.getState().setWalls(floorId, walls)
  useAPStore.getState().setAPs(floorId, aps)
  useScopeStore.setState((s) => ({
    scopesByFloor: { ...s.scopesByFloor, [floorId]: scopes },
  }))
  useFloorHoleStore.setState((s) => ({
    floorHolesByFloor: { ...s.floorHolesByFloor, [floorId]: floorHoles },
  }))
  // 47-17: restore switches for the whole building so cross-floor uplinkTo
  // rewrites are undone everywhere, not just on the active floor.
  useCableStore.setState({ switchesByFloor: switchesAll ?? {} })
  useCableStore.getState().setTrays(floorId, trays ?? [])
  useCableStore.getState().setRisers(risers ?? [])
  useCameraStore.getState().setCameras(floorId, cameras ?? [])
  useCameraStore.getState().setTripwires(floorId, tripwires ?? [])
  useCameraStore.getState().setZones(floorId, camZones ?? [])
  // 47-16: restore the org-level unplaced camera pool.
  useCameraStore.setState({ unplacedCameras: unplacedCameras ?? [] })
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

  // 47-19: when a floor is deleted its snapshots become dead weight — undo hits
  // `prevSnap.floorId !== activeFloorId` and returns without popping, so the
  // stack jams and Ctrl+Z stops responding. Drop every snapshot keyed to the
  // removed floor (and any pending raw for it) so the stacks stay live.
  dropFloor: (floorId) => {
    if (_pendingRaw && _pendingRaw.floorId === floorId) {
      if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null }
      if (_idleHandle !== null) { cancelIdle(_idleHandle); _idleHandle = null }
      _pendingRaw = null
    }
    set((s) => ({
      undoStack: s.undoStack.filter((snap) => snap.floorId !== floorId),
      redoStack: s.redoStack.filter((snap) => snap.floorId !== floorId),
    }))
  },
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
    switchesAll: structuredClone(raw.switchesAll ?? {}),
    trays:    structuredClone(raw.trays),
    risers:   structuredClone(raw.risers ?? []),
    cameras:  structuredClone(raw.cameras ?? []),
    tripwires: structuredClone(raw.tripwires ?? []),
    camZones:  structuredClone(raw.camZones ?? []),
    unplacedCameras: structuredClone(raw.unplacedCameras ?? []),
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
let _prevCameras  = useCameraStore.getState().camerasByFloor
let _prevTripwires = useCameraStore.getState().tripwiresByFloor
let _prevCamZones  = useCameraStore.getState().zonesByFloor
let _prevUnplaced  = useCameraStore.getState().unplacedCameras

function onStoreChange(storeName, prevRef, currentRef) {
  if (_restoring) return
  const floorId = useFloorStore.getState().activeFloorId
  if (!floorId) return
  if (storeName === 'risers' || storeName === 'unplaced') {
    // Building-/org-level arrays (not keyed by floor): compare the ref directly.
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
    // 47-17: 'switches' change → the "before" is the whole prev map (prevRef);
    // other changes capture the current whole map. Restored building-wide.
    switchesAll: storeName === 'switches' ? (prevRef ?? {}) : (useCableStore.getState().switchesByFloor ?? {}),
    trays:      storeName === 'trays'    ? (prevRef[floorId] ?? []) : (useCableStore.getState().traysByFloor[floorId] ?? []),
    risers:     storeName === 'risers'   ? (prevRef ?? [])           : (useCableStore.getState().risers ?? []),
    cameras:    storeName === 'cameras'  ? (prevRef[floorId] ?? []) : (useCameraStore.getState().camerasByFloor[floorId] ?? []),
    tripwires:  storeName === 'tripwires' ? (prevRef[floorId] ?? []) : (useCameraStore.getState().tripwiresByFloor[floorId] ?? []),
    camZones:   storeName === 'camZones'  ? (prevRef[floorId] ?? []) : (useCameraStore.getState().zonesByFloor[floorId] ?? []),
    // 47-16: always capture the PREVIOUS unplaced pool. placeCamera mutates
    // camerasByFloor + unplacedCameras in one set(), so by the time the
    // 'cameras' change fires here getState().unplacedCameras is already the
    // AFTER pool — _prevUnplaced is the before-value we must snapshot to undo.
    unplacedCameras: _prevUnplaced ?? [],
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
useCameraStore.subscribe((state) => {
  const cur = state.camerasByFloor
  // Order matters: process camerasByFloor BEFORE updating _prevUnplaced, so the
  // 'cameras' snapshot (built from _prevUnplaced) captures the pre-place pool.
  // placeCamera mutates both in one set(); the cameras raw already carries the
  // before-pool, and the 'unplaced' branch below then coalesces into it via
  // _pendingRaw rather than recording a second snapshot (47-16).
  if (cur !== _prevCameras) { onStoreChange('cameras', _prevCameras, cur); _prevCameras = cur }
  const curT = state.tripwiresByFloor
  if (curT !== _prevTripwires) { onStoreChange('tripwires', _prevTripwires, curT); _prevTripwires = curT }
  const curZ = state.zonesByFloor
  if (curZ !== _prevCamZones) { onStoreChange('camZones', _prevCamZones, curZ); _prevCamZones = curZ }
  const curU = state.unplacedCameras
  if (curU !== _prevUnplaced) { onStoreChange('unplaced', _prevUnplaced, curU); _prevUnplaced = curU }
})
useCableStore.subscribe((state) => {
  const curS = state.switchesByFloor
  if (curS !== _prevSwitches) { onStoreChange('switches', _prevSwitches, curS); _prevSwitches = curS }
  const curT = state.traysByFloor
  if (curT !== _prevTrays) { onStoreChange('trays', _prevTrays, curT); _prevTrays = curT }
  const curR = state.risers
  if (curR !== _prevRisers) { onStoreChange('risers', _prevRisers, curR); _prevRisers = curR }
})
