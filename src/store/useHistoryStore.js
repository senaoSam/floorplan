// Ported 1:1 from oldSrc/store/useHistoryStore.js — Phase 25 Bundle 18.
//
// Snapshot-based Undo/Redo. Subscribes to floor / wall / AP / scope / floorHole
// / cable / camera stores and pushes a snapshot of the variable BEFORE the
// change into undoStack. Continuous edits (drag, slider) collapse into a single
// snapshot via debounce + idle commit.
//
// The floor store is a partial subscription: only the FLOOR_SNAPSHOT_KEYS
// fields are versioned (see the allow-list below for what's excluded and why).
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

// 53-G5 (T1): the floor-record fields that undo/redo restores.
//
// This is an ALLOW-LIST, not a whole-record clone, and the exclusions are the
// point:
//   - `id` / `name` — identity, not edit state. Renaming a floor is not
//     something Ctrl+Z after a wall edit should silently revert.
//   - `imageUrl` / `imageWidth` / `imageHeight` — the imported bitmap.
//     SidebarLeft:226 calls URL.revokeObjectURL(floor.imageUrl) when a floor is
//     deleted, so restoring an old blob URL can resurrect a dead reference and
//     render a broken image. Image identity is handled by add/removeFloor
//     (which history does not cover), never by field-level undo.
//
// Everything listed is a number/enum the user can get WRONG in a way that
// silently corrupts downstream maths — which is exactly what undo is for. The
// scale case is the motivating one: measuring a 10 m wall and typing 1 m makes
// every cable length, coverage area and heatmap grid on the floor off by 10×.
const FLOOR_SNAPSHOT_KEYS = [
  'scale',
  'floorHeight',
  'floorSlabMaterialId',
  'floorSlabAttenuationDb',
  'opacity', 'rotation', 'offsetX', 'offsetY',
  'cropX', 'cropY', 'cropWidth', 'cropHeight',
  // ALIGN_FLOOR's four fields. FloorplanSystem:638 deliberately swallows the
  // Delete key in ALIGN_FLOOR mode "so alignment work isn't lost", yet the same
  // work had no Ctrl+Z at all until this fix.
  'alignOffsetX', 'alignOffsetY', 'alignScale', 'alignRotation',
]

// Pick just the snapshot-relevant fields off one floor record. Returns null for
// a missing floor so restore can tell "floor had no record" from "all defaults".
function pickFloorFields(floor) {
  if (!floor) return null
  const out = {}
  for (const k of FLOOR_SNAPSHOT_KEYS) out[k] = floor[k]
  return out
}

function takeSnapshot(floorId) {
  if (!floorId) return null
  return {
    floorId,
    // 53-G5 (T1): floor geometry/scale fields for THIS floor only. Unlike
    // switches (building-wide because uplinkTo is rewritten across floors),
    // every field above is strictly per-floor, so the active floor suffices.
    floorFields: pickFloorFields(
      useFloorStore.getState().floors.find((f) => f.id === floorId)),
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
  const { floorId, walls, aps, scopes, floorHoles, switchesAll, trays, risers, cameras, tripwires, camZones, unplacedCameras, floorFields } = snapshot
  _restoring = true
  // 53-G5 (T1): restore floor fields by merging the allow-listed keys onto the
  // live record, so fields deliberately excluded above (id/name/imageUrl/dims)
  // keep their CURRENT values rather than being reverted or dropped.
  if (floorFields) {
    useFloorStore.setState((s) => ({
      floors: s.floors.map((f) => (f.id === floorId ? { ...f, ...floorFields } : f)),
    }))
  }
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
  // 53-G5 (T7): setAPs only ratchets the AP-name counter upward, so after a
  // rewind it still reflects APs that no longer exist and the next placement
  // skips a number. Recount from the restored data (all floors) once every
  // store above has been written.
  useAPStore.getState().recountAPCounter()
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
    // 53-G5 (P3-17): flush BEFORE the emptiness check. The first edit of a
    // session only exists as _pendingRaw for DEBOUNCE_MS (300ms) + one idle
    // callback, so an early `undoStack.length === 0` return made Ctrl+Z a no-op
    // during that window — right when a user who just made a mistake presses it.
    flushPending()
    if (get().undoStack.length === 0) return
    const floorId = useFloorStore.getState().activeFloorId
    if (!floorId) return
    const currentSnap = takeSnapshot(floorId)
    const prevSnap = get().undoStack[get().undoStack.length - 1]
    // 53-G5 (P1-12): a snapshot for another floor used to return silently while
    // the toolbar button stayed lit. Jump to that floor and rewind it there —
    // the stack stays in order and the user sees the edit being undone.
    if (prevSnap.floorId !== floorId) {
      useFloorStore.getState().setActiveFloor(prevSnap.floorId)
      const jumped = takeSnapshot(prevSnap.floorId)
      restoreSnapshot(prevSnap)
      set((s) => ({
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, jumped],
      }))
      return
    }
    restoreSnapshot(prevSnap)
    set((s) => ({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, currentSnap],
    }))
  },

  redo: () => {
    // 53-G5 (P3-18): redo must flush too. Without it, a pending edit committed
    // AFTER the redo landed pushed a snapshot of already-rewound state, so the
    // redo silently overwrote the edit just made and the undo stack stopped
    // being chronological.
    flushPending()
    if (get().redoStack.length === 0) return
    const floorId = useFloorStore.getState().activeFloorId
    if (!floorId) return
    const nextSnap = get().redoStack[get().redoStack.length - 1]
    // 53-G5 (P1-12): same cross-floor handling as undo.
    if (nextSnap.floorId !== floorId) {
      useFloorStore.getState().setActiveFloor(nextSnap.floorId)
      const jumped = takeSnapshot(nextSnap.floorId)
      restoreSnapshot(nextSnap)
      set((s) => ({
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, jumped],
      }))
      return
    }
    const currentSnap = takeSnapshot(floorId)
    restoreSnapshot(nextSnap)
    set((s) => ({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, currentSnap],
    }))
  },

  // 53-G5 (P3-17): `hasPending` mirrors the module-local _pendingRaw into store
  // state so the toolbar can react to it. A pending raw IS undoable now that
  // undo() flushes first, and the button must not sit greyed out for the 300ms
  // debounce window right after the first edit. Kept as reactive state rather
  // than a getter because Toolbar subscribes to fields, not functions.
  hasPending: false,

  canUndo: () => get().undoStack.length > 0 || get().hasPending,
  canRedo: () => get().redoStack.length > 0,

  // 52-A1: must also drop the pending raw. Loaders replace a whole floor via
  // setWalls/setAPs, which schedules a debounced snapshot of the state BEFORE
  // the load (an empty floor). Clearing only the stacks lets that snapshot land
  // DEBOUNCE_MS later, so the first Ctrl+Z wipes everything just loaded.
  clearHistory: () => {
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null }
    if (_idleHandle !== null) { cancelIdle(_idleHandle); _idleHandle = null }
    setPendingRaw(null)
    set({ undoStack: [], redoStack: [], hasPending: false })
  },

  // 47-19: when a floor is deleted its snapshots become dead weight — undo hits
  // `prevSnap.floorId !== activeFloorId` and returns without popping, so the
  // stack jams and Ctrl+Z stops responding. Drop every snapshot keyed to the
  // removed floor (and any pending raw for it) so the stacks stay live.
  dropFloor: (floorId) => {
    if (_pendingRaw && _pendingRaw.floorId === floorId) {
      if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null }
      if (_idleHandle !== null) { cancelIdle(_idleHandle); _idleHandle = null }
      setPendingRaw(null)
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

// 53-G5 (P3-17): single writer for _pendingRaw so the store's `hasPending`
// mirror can never drift from it. Every assignment goes through here.
function setPendingRaw(raw) {
  _pendingRaw = raw
  const has = raw !== null
  if (useHistoryStore.getState().hasPending !== has) {
    useHistoryStore.setState({ hasPending: has })
  }
}

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
  setPendingRaw(null)
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
    // 53-G5 (T1): plain numbers/strings, but clone for consistency with the
    // rest of the snapshot (and so a later mutable field can't alias).
    floorFields: raw.floorFields ? structuredClone(raw.floorFields) : null,
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
  if (!_pendingRaw) setPendingRaw(raw)
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

let _prevFloors   = useFloorStore.getState().floors
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
  } else if (storeName === 'floor') {
    // 53-G5 (T1): `floors` is an ARRAY, not a floor-keyed map, so any floor's
    // edit produces a new array ref. Compare only the snapshot-relevant fields
    // of the ACTIVE floor, or every unrelated change (renaming another floor,
    // reordering, switching the align anchor) would push a redundant snapshot
    // and push real undo steps off the 50-deep stack.
    const before = pickFloorFields(prevRef.find((f) => f.id === floorId))
    const after  = pickFloorFields(currentRef.find((f) => f.id === floorId))
    // A floor that just appeared or disappeared is add/removeFloor's business,
    // not a field edit — those aren't undoable, so ignore.
    if (!before || !after) return
    if (FLOOR_SNAPSHOT_KEYS.every((k) => before[k] === after[k])) return
  } else if (prevRef[floorId] === currentRef[floorId]) {
    return
  }
  if (_pendingRaw) {
    // 47-21: a pending raw for a DIFFERENT floor must be committed before we
    // start recording this floor's change — otherwise the cross-floor edit is
    // folded into the previous floor's snapshot and this floor's first step
    // can't be undone. Same-floor changes coalesce as before.
    if (_pendingRaw.floorId !== floorId) {
      flushPending()
      // fall through to build a fresh raw for the current floor
    } else {
      schedulePushRaw(_pendingRaw)
      return
    }
  }
  const raw = {
    floorId,
    // 53-G5 (T1): on a floor-field edit the "before" comes from prevRef;
    // otherwise capture the floor's current fields so an unrelated edit's
    // snapshot still round-trips scale/floorHeight unchanged.
    floorFields: pickFloorFields(
      (storeName === 'floor' ? prevRef : useFloorStore.getState().floors)
        .find((f) => f.id === floorId)),
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

// 53-G5 (T1): the floor store was never subscribed at all, so scale,
// floorHeight, slab attenuation, crop and the four ALIGN_FLOOR fields had no
// undo whatsoever.
useFloorStore.subscribe((state) => {
  const cur = state.floors
  if (cur !== _prevFloors) { onStoreChange('floor', _prevFloors, cur); _prevFloors = cur }
})
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
