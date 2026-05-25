import React from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'
import { useCableStore } from '@/store/useCableStore'
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

  // Subscribe to all four stores so the menu re-renders if the target object
  // gets mutated underneath (e.g. rename via another path).
  const apsByFloor = useAPStore((s) => s.apsByFloor)
  const wallsByFloor = useWallStore((s) => s.wallsByFloor)
  const switchesByFloor = useCableStore((s) => s.switchesByFloor)
  const traysByFloor = useCableStore((s) => s.traysByFloor)

  if (!ctx || !activeFloorId) return null

  const { targetType, targetId, screenX, screenY } = ctx

  let target = null
  let title = ''
  let onRename = null
  let onDelete = null

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
    label: '刪除',
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
