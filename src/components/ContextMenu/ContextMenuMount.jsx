import React from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'
import { useCableStore } from '@/store/useCableStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
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
  const floorHolesByFloor = useFloorHoleStore((s) => s.floorHolesByFloor)
  const floors = useFloorStore((s) => s.floors)

  if (typeof window !== 'undefined' && window.__debugRMB !== false) {
    console.log('[RMB ContextMenuMount] render ctx=', ctx, 'activeFloorId=', activeFloorId)
  }
  if (!ctx || !activeFloorId) return null

  const { targetType, targetId, screenX, screenY } = ctx

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
      clearSelected()
    }
  } else if (targetType === 'switch') {
    target = (switchesByFloor[activeFloorId] ?? []).find((s) => s.id === targetId)
    title = target?.name ?? targetId
    onRename = (name) => useCableStore.getState().updateSwitch(activeFloorId, targetId, { name })
    onDelete = () => {
      useCableStore.getState().removeSwitch(activeFloorId, targetId)
      clearSelected()
    }
  } else if (targetType === 'cable_tray') {
    target = (traysByFloor[activeFloorId] ?? []).find((t) => t.id === targetId)
    title = target?.name ?? targetId
    onRename = (name) => useCableStore.getState().updateTray(activeFloorId, targetId, { name })
    onDelete = () => {
      useCableStore.getState().removeTray(activeFloorId, targetId)
      clearSelected()
    }
  } else if (targetType === 'wall') {
    target = (wallsByFloor[activeFloorId] ?? []).find((w) => w.id === targetId)
    title = target?.name ?? targetId
    onRename = (name) => useWallStore.getState().updateWall(activeFloorId, targetId, { name })
    onDelete = () => {
      useWallStore.getState().removeWall(activeFloorId, targetId)
      clearSelected()
    }
  } else if (targetType === 'scope') {
    target = (scopesByFloor[activeFloorId] ?? []).find((s) => s.id === targetId)
    title = target?.name ?? targetId
    onRename = (name) => useScopeStore.getState().updateScope(activeFloorId, targetId, { name })
    onDelete = () => {
      useScopeStore.getState().removeScope(activeFloorId, targetId)
      clearSelected()
    }
  } else if (targetType === 'floor_hole') {
    target = (floorHolesByFloor[activeFloorId] ?? []).find((h) => h.id === targetId)
    title = target?.name ?? targetId
    onRename = (name) => useFloorHoleStore.getState().updateFloorHole(activeFloorId, targetId, { name })
    onDelete = () => {
      useFloorHoleStore.getState().removeFloorHole(activeFloorId, targetId)
      clearSelected()
    }
  } else if (targetType === 'floor_image') {
    // Floor image has no name and no native "delete" — `刪除` here means
    // detach the imageUrl from the floor record (oldSrc Editor2D.jsx).
    const f = floors.find((x) => x.id === targetId)
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
      clearSelected()
    }
  }

  if (!target) {
    // Target was removed underneath; close menu silently.
    closeContextMenu()
    return null
  }

  const selectedId = useEditorStore.getState().selectedId
  const isSelected = selectedId === targetId

  const items = []
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

  return (
    <ObjectContextMenu
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

export default ContextMenuMount
