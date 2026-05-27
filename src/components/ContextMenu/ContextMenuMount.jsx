import React from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'
import { useCableStore, TRAY_SYSTEMS } from '@/store/useCableStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useDraftStore } from '@/store/useDraftStore'
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

  if (typeof window !== 'undefined' && window.__debugRMB === true) {
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
    if (typeof window !== 'undefined' && window.__debugRMB === true) {
      console.log('[RMB ContextMenuMount] target NOT FOUND, closing menu. targetType=', targetType, 'targetId=', targetId, 'wallsByFloor[fid]=', wallsByFloor[activeFloorId], 'scopesByFloor[fid]=', scopesByFloor[activeFloorId])
    }
    closeContextMenu()
    return null
  }

  const selectedId = useEditorStore.getState().selectedId
  const isSelected = selectedId === targetId

  const items = []
  if (targetType === 'cable_tray') {
    buildTrayItems(items, ctx, target, activeFloorId, traysByFloor, setSelected, isSelected, onDelete)
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

export default ContextMenuMount
