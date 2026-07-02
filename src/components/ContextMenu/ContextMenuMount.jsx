import React from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { getModeCapability } from '@/render/modeCapabilities'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'
import { useCableStore, TRAY_SYSTEMS } from '@/store/useCableStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useCameraStore } from '@/store/useCameraStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useDraftStore } from '@/store/useDraftStore'
import { showUiToast } from '@/store/useUiToastStore'
import { generateId } from '@/utils/id'
import ObjectContextMenu from './ObjectContextMenu'

// Bridge between the store-driven contextMenu state and the generic
// ObjectContextMenu component. Resolves the target object from its
// store, builds the items list per type, and wires rename / delete.
//
// MVP item set: 重新命名 + 刪除 + 取消選取 (when target ≠ current
// selection). Per-type extras (Tray split / switch change kind /
// wall add opening) defer to dedicated bundles.
function ContextMenuMount() {
  const ctx = useEditorStore((s) => s.contextMenu)
  const editorMode = useEditorStore((s) => s.editorMode)
  const closeContextMenu = useEditorStore((s) => s.closeContextMenu)
  const setSelected = useEditorStore((s) => s.setSelected)
  const clearSelected = useEditorStore((s) => s.clearSelected)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)

  // Subscribe to all stores so the menu re-renders if the target object
  // gets mutated underneath (e.g. rename via another path).
  const apsByFloor = useAPStore((s) => s.apsByFloor)
  const wallsByFloor = useWallStore((s) => s.wallsByFloor)
  const switchesByFloor = useCableStore((s) => s.switchesByFloor)
  const traysByFloor = useCableStore((s) => s.traysByFloor)
  const scopesByFloor = useScopeStore((s) => s.scopesByFloor)
  const camerasByFloor = useCameraStore((s) => s.camerasByFloor)
  const floorHolesByFloor = useFloorHoleStore((s) => s.floorHolesByFloor)

  if (typeof window !== 'undefined' && window.__debugRMB === true) {
    console.log('[RMB ContextMenuMount] render ctx=', ctx, 'activeFloorId=', activeFloorId)
  }
  if (!ctx || !activeFloorId) return null
  // Modes whose capability disallows the context menu suppress it entirely —
  // e.g. CLIENT_VIEW is a read-only simulation mode where everything else is
  // dimmed, so right-clicking an object shouldn't pop a rename/delete menu.
  // (A layer may still fire openContextMenu; we just don't render it here.)
  if (!getModeCapability(editorMode).allowContextMenu) return null

  const { targetType, targetId, screenX, screenY } = ctx

  // Right-click is a command channel DISJOINT from selection (oldSrc Editor2D
  // 2166-2172 clearIfTargetSelected): deleting an object via its context menu
  // clears the current selection ONLY when that object IS the current
  // selection. Otherwise a user with A selected who right-clicks + deletes a
  // different object B keeps A selected (the right panel keeps showing A).
  const clearIfTargetSelected = () => {
    const s = useEditorStore.getState()
    if (s.selectedId === targetId && s.selectedType === targetType) clearSelected()
  }

  let target = null
  let title = ''
  let onRename = null
  let onDelete = null
  let deleteLabel = '刪除'

  if (targetType === 'ap') {
    target = (apsByFloor[activeFloorId] ?? []).find((a) => a.id === targetId)
    title = target?.name ?? targetId
    onRename = (name) => useAPStore.getState().updateAP(activeFloorId, targetId, { name })
    onDelete = () => {
      useAPStore.getState().removeAP(activeFloorId, targetId)
      clearIfTargetSelected()
    }
  } else if (targetType === 'switch') {
    target = (switchesByFloor[activeFloorId] ?? []).find((s) => s.id === targetId)
    title = target?.name ?? targetId
    onRename = (name) => useCableStore.getState().updateSwitch(activeFloorId, targetId, { name })
    onDelete = () => {
      useCableStore.getState().removeSwitch(activeFloorId, targetId)
      clearIfTargetSelected()
    }
  } else if (targetType === 'cable_tray') {
    target = (traysByFloor[activeFloorId] ?? []).find((t) => t.id === targetId)
    title = target?.name ?? targetId
    onRename = (name) => useCableStore.getState().updateTray(activeFloorId, targetId, { name })
    onDelete = () => {
      useCableStore.getState().removeTray(activeFloorId, targetId)
      clearIfTargetSelected()
    }
  } else if (targetType === 'wall') {
    target = (wallsByFloor[activeFloorId] ?? []).find((w) => w.id === targetId)
    title = target?.name ?? targetId
    onRename = (name) => useWallStore.getState().updateWall(activeFloorId, targetId, { name })
    onDelete = () => {
      useWallStore.getState().removeWall(activeFloorId, targetId)
      clearIfTargetSelected()
    }
  } else if (targetType === 'scope') {
    target = (scopesByFloor[activeFloorId] ?? []).find((s) => s.id === targetId)
    title = target?.name ?? targetId
    onRename = (name) => useScopeStore.getState().updateScope(activeFloorId, targetId, { name })
    onDelete = () => {
      useScopeStore.getState().removeScope(activeFloorId, targetId)
      clearIfTargetSelected()
    }
  } else if (targetType === 'camera') {
    target = (camerasByFloor[activeFloorId] ?? []).find((c) => c.id === targetId)
    title = target?.name ?? targetId
    onRename = (name) => useCameraStore.getState().updateCamera(activeFloorId, targetId, { name })
    onDelete = () => {
      useCameraStore.getState().removeCamera(activeFloorId, targetId)
      clearIfTargetSelected()
    }
  } else if (targetType === 'floor_hole') {
    target = (floorHolesByFloor[activeFloorId] ?? []).find((h) => h.id === targetId)
    title = target?.name ?? targetId
    onRename = (name) => useFloorHoleStore.getState().updateFloorHole(activeFloorId, targetId, { name })
    onDelete = () => {
      useFloorHoleStore.getState().removeFloorHole(activeFloorId, targetId)
      clearIfTargetSelected()
    }
  } else if (targetType === 'cable_riser') {
    // Risers are global (cross-floor); look up against the entire risers
    // array rather than per-floor.
    const risers = useCableStore.getState().risers ?? []
    target = risers.find((r) => r.id === targetId)
    title = target?.name ?? targetId
    onRename = (name) => useCableStore.getState().updateRiser(targetId, { name })
    onDelete = () => {
      useCableStore.getState().removeRiser(targetId)
      clearIfTargetSelected()
    }
  } else if (targetType === 'floor_image') {
    // Bundle 30: floor image is interactive again (capability-gated)
    // so the right-click menu must come back. Delete detaches the
    // imageUrl + dimensions + crop (oldSrc Editor2D 2222-2239).
    const f = useFloorStore.getState().floors.find((x) => x.id === targetId)
    target = f ? { id: targetId, name: f.name } : null
    title = f ? `${f.name} 底圖` : `${targetId} 底圖`
    onRename = null
    deleteLabel = '移除底圖'
    onDelete = () => {
      useFloorStore.getState().updateFloor(targetId, {
        imageUrl: null,
        imageWidth: undefined,
        imageHeight: undefined,
        cropX: null,
        cropY: null,
        cropWidth: null,
        cropHeight: null,
      })
      clearIfTargetSelected()
    }
  }

  if (!target) {
    // Target was removed underneath; close menu silently.
    if (typeof window !== 'undefined' && window.__debugRMB === true) {
      console.log('[RMB ContextMenuMount] target NOT FOUND, closing menu. targetType=', targetType, 'targetId=', targetId, 'wallsByFloor[fid]=', wallsByFloor[activeFloorId], 'scopesByFloor[fid]=', scopesByFloor[activeFloorId])
    }
    closeContextMenu()
    return null
  }

  const selectedId = useEditorStore.getState().selectedId
  const isSelected = selectedId === targetId

  // Undo-hint toast on every context-menu delete (ui-spec §2.4). 移除底圖 is
  // not history-tracked (floor images aren't snapshotted) so it skips the
  // Ctrl+Z promise.
  if (onDelete) {
    const rawDelete = onDelete
    onDelete = () => {
      rawDelete()
      showUiToast(
        targetType === 'floor_image'
          ? '已移除底圖'
          : `已刪除「${title}」（Ctrl+Z 可復原）`,
      )
    }
  }

  const items = []
  if (targetType === 'cable_tray') {
    buildTrayItems(items, ctx, target, activeFloorId, traysByFloor, setSelected, isSelected, onDelete)
  } else if (targetType === 'camera') {
    buildCameraItems(items, target, activeFloorId, setSelected, isSelected, onDelete)
  } else {
    if (!isSelected) {
      items.push({
        id: 'select',
        label: '選取',
        onClick: () => setSelected(targetId, targetType),
      })
    }
    items.push({
      id: 'delete',
      label: deleteLabel,
      danger: true,
      shortcut: 'Del',
      onClick: onDelete,
    })
  }

  // `key` includes targetType + targetId + screen xy so that EVERY new
  // openContextMenu (different object OR same object at a different click
  // position) forces ObjectContextMenu to unmount + remount. Without the
  // remount, the outside-click listener attached when the FIRST menu opened
  // would still be live when the user right-clicks a second object —
  // the second gesture's mousedown would fire that stale listener and
  // close the freshly-opened menu in the same tick. The remount triggers
  // the rAF-deferred listener attach inside ObjectContextMenu, which
  // skips the right-click's own mousedown event.
  return (
    <ObjectContextMenu
      key={`${targetType}:${targetId}:${screenX}:${screenY}`}
      x={screenX}
      y={screenY}
      title={title}
      currentName={target.name ?? targetId}
      onRename={onRename}
      items={items}
      onClose={closeContextMenu}
    />
  )
}

// Build the rich tray context-menu items list (oldSrc Editor2D.jsx
// 2014-2140). Surfaces 選取 / 在此切割 / 從此端延伸 / 合併相鄰 tray /
// 轉換系統 (submenu w/ color swatches) / 刪除.
//
// hitContext is what the tray layer computed at right-click time:
//   { kind: 'segment', segIdx, foot }   ← clicked mid-segment
//   { kind: 'endpoint', endpointIdx }   ← clicked near an endpoint
//   { kind: 'body' }                    ← clicked but outside seg/endpoint thresholds
// mergeCandidate (endpoint hits only): { trayId, side } | null
function buildTrayItems(items, ctx, tray, floorId, traysByFloor, setSelected, isSelected, onDelete) {
  const { hitContext, mergeCandidate } = ctx
  const canSelect = !isSelected
  const canSplit  = hitContext?.kind === 'segment'
  const canEndpoint = hitContext?.kind === 'endpoint'
  const canMerge  = canEndpoint && !!mergeCandidate
  const mergeTarget = mergeCandidate
    ? (traysByFloor[floorId] ?? []).find((t) => t.id === mergeCandidate.trayId)
    : null

  if (canSelect) {
    items.push({ id: 'select', label: '選取', onClick: () => setSelected(tray.id, 'cable_tray') })
    items.push({ id: 'div-after-select', kind: 'divider' })
  }

  // Split: replace the tray with two new trays meeting at the perpendicular
  // foot of the right-click. Both share the foot xy so the graph builder's
  // coincidence-merge (cable-spec §10 / 12-2d) treats them as one node.
  items.push({
    id: 'split',
    label: '在此切割',
    disabled: !canSplit,
    hint: canSplit ? '在點擊處將 tray 切成兩段（共用 vertex）' : '在線段中段點右鍵才能切割',
    onClick: canSplit ? () => {
      const { segIdx, foot } = hitContext
      const ptsA = [...tray.points.slice(0, segIdx + 1), foot]
      const ptsB = [foot, ...tray.points.slice(segIdx + 1)]
      const floor = useFloorStore.getState().floors.find((f) => f.id === floorId)
      useCableStore.getState().removeTray(floorId, tray.id)
      const nameA = useCableStore.getState().nextTrayName({ floor })
      useCableStore.getState().addTray(floorId, { ...tray, id: generateId('tray'), name: nameA, points: ptsA })
      const nameB = useCableStore.getState().nextTrayName({ floor })
      useCableStore.getState().addTray(floorId, { ...tray, id: generateId('tray'), name: nameB, points: ptsB })
    } : undefined,
  })

  // Extend: enter DRAW_CABLE_TRAY with the draft seeded at this endpoint.
  // The user's next clicks append vertices; finishing creates a NEW tray
  // that meets the original at exact xy (graph stays connected).
  items.push({
    id: 'extend',
    label: '從此端延伸',
    disabled: !canEndpoint,
    hint: canEndpoint ? '從這個端點開始畫一條延伸的新 tray（共用端點 xy）' : '在端點附近右鍵才能延伸',
    onClick: canEndpoint ? () => {
      const ep = tray.points[hitContext.endpointIdx]
      useEditorStore.getState().setEditorMode(EDITOR_MODE.DRAW_CABLE_TRAY)
      useDraftStore.getState().beginDraft(EDITOR_MODE.DRAW_CABLE_TRAY, ep)
    } : undefined,
  })

  // Merge: combine the picked tray with the unique adjacent tray that
  // shares this endpoint xy. Result inherits the picked tray's metadata.
  items.push({
    id: 'merge',
    label: '合併相鄰 tray',
    hintInline: canMerge && mergeTarget ? `→ ${mergeTarget.name ?? mergeTarget.id}` : undefined,
    disabled: !canMerge,
    hint: canMerge && mergeTarget
      ? `合併到 ${mergeTarget.name ?? mergeTarget.id}（共用端點）`
      : canEndpoint ? '此端點沒有恰好一條 tray 可合併' : '在端點附近右鍵才能合併',
    onClick: canMerge && mergeTarget ? () => {
      const otherSide = mergeCandidate.side
      const aPoints = hitContext.endpointIdx === 0
        ? [...tray.points].reverse()
        : [...tray.points]
      const otherPoints = otherSide === 'start'
        ? mergeTarget.points
        : [...mergeTarget.points].reverse()
      const merged = [...aPoints, ...otherPoints.slice(1)]
      const floor = useFloorStore.getState().floors.find((f) => f.id === floorId)
      useCableStore.getState().removeTray(floorId, tray.id)
      useCableStore.getState().removeTray(floorId, mergeTarget.id)
      const name = useCableStore.getState().nextTrayName({ floor })
      const newId = generateId('tray')
      useCableStore.getState().addTray(floorId, { ...tray, id: newId, name, points: merged })
      setSelected(newId, 'cable_tray')
    } : undefined,
  })

  items.push({ id: 'div-after-edit', kind: 'divider' })

  // Convert tray's discipline / system colour.
  items.push({
    id: 'convert',
    label: '轉換系統',
    submenu: TRAY_SYSTEMS.map((sys) => ({
      id: `convert-${sys.value}`,
      label: sys.label,
      swatch: sys.color,
      onClick: () => useCableStore.getState().updateTray(floorId, tray.id, { system: sys.value }),
    })),
  })

  items.push({ id: 'div-before-delete', kind: 'divider' })
  items.push({
    id: 'delete',
    label: '刪除',
    danger: true,
    shortcut: 'Del',
    onClick: onDelete,
  })
}

// Build the camera context-menu items list, mirroring the CameraPanel actions
// (PanelRight/CameraPanel.jsx): 選取 / 複製相機 / 即時影像 / 校正熱圖 / 刪除.
// Labels reuse the exact strings/icons from CameraPanel buttons. ObjectContextMenu's
// `fire()` wrapper closes the menu after every item click, so no explicit close here.
function buildCameraItems(items, camera, floorId, setSelected, isSelected, onDelete) {
  if (!isSelected) {
    items.push({ id: 'select', label: '選取', onClick: () => setSelected(camera.id, 'camera') })
  }

  // 複製相機 — replicate CameraPanel.handleDuplicate: clone all params except
  // id/name, offset +24/+24 px, fresh name, then select the copy.
  items.push({
    id: 'duplicate',
    label: '複製相機',
    icon: '⧉',
    onClick: () => {
      const store = useCameraStore.getState()
      const id = generateId('cam')
      const { id: _omit, name: _omitName, ...rest } = camera
      store.addCamera(floorId, {
        ...rest,
        id,
        name: store.nextCameraName(),
        x: camera.x + 24,
        y: camera.y + 24,
      })
      setSelected(id, 'camera')
    },
  })

  // 📹 即時影像 — open the mock live-view popover.
  items.push({
    id: 'live-view',
    label: '即時影像',
    icon: '📹',
    onClick: () => useCameraStore.getState().openLiveView(camera.id),
  })

  // 校正熱圖 — open the 4-point heat-map calibration modal. Label flips to
  // 已校正 once calibration exists, matching CameraPanel's button text.
  items.push({
    id: 'calibrate',
    label: camera.calibration ? '已校正' : '校正熱圖',
    icon: '🎯',
    onClick: () => useCameraStore.getState().openCalibrate(camera.id),
  })

  items.push({ id: 'div-before-delete', kind: 'divider' })
  items.push({
    id: 'delete',
    label: '刪除',
    danger: true,
    shortcut: 'Del',
    onClick: onDelete,
  })
}

export default ContextMenuMount
