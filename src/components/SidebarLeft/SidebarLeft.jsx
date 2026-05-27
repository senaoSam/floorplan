import React, { useRef, useState, useEffect } from 'react'
import { useFloorStore, DEFAULT_FLOOR_HEIGHT_M } from '@/store/useFloorStore'
import {
  MATERIAL_LIST,
  FLOOR_SLAB_DEFAULT_DB,
  DEFAULT_FLOOR_SLAB_MATERIAL_ID,
  DEFAULT_FLOOR_SLAB_DB,
} from '@/constants/materials'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useCableStore } from '@/store/useCableStore'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorImport } from '@/features/importer/useFloorImport'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
import { capturePlanPng, triggerImageDownload } from '@/features/exportPng/exportPlanView'
import AutoPowerModal from '@/components/AutoPowerModal/AutoPowerModal'
import './SidebarLeft.sass'

// Ported from oldSrc; trimmed against the PIXI port:
//   * 匯出 PNG ↘ ported Bundle 22 via PIXI renderer.extract.canvas.
//   * 自動規劃整層 AP 功率 ↘ requires AutoPowerModal (heatmap-driven
//     greedy planner) — not ported yet. Button kept but stubs an alert.
// Everything else (add / collapse / rename / align switch / inline floor
// properties / reorder / remove) is identical to oldSrc.

function SidebarLeft() {
  const floors          = useFloorStore((s) => s.floors)
  const activeFloorId   = useFloorStore((s) => s.activeFloorId)
  const setActiveFloor  = useFloorStore((s) => s.setActiveFloor)
  const updateFloor     = useFloorStore((s) => s.updateFloor)
  const removeFloor     = useFloorStore((s) => s.removeFloor)
  const reorderFloors   = useFloorStore((s) => s.reorderFloors)
  const clearWalls      = useWallStore((s) => s.clearFloor)
  const clearAPs        = useAPStore((s) => s.clearFloor)
  const clearScopes     = useScopeStore((s) => s.clearFloor)
  const clearHoles      = useFloorHoleStore((s) => s.clearFloor)
  const clearSwitches   = useCableStore((s) => s.clearFloor)
  const setEditorMode   = useEditorStore((s) => s.setEditorMode)
  const setSelected     = useEditorStore((s) => s.setSelected)

  const { processFile, isLoading, loadingMsg } = useFloorImport()
  const fileInputRef = useRef(null)

  const [editingId, setEditingId]   = useState(null)
  const [editingName, setEditingName] = useState('')
  const editInputRef = useRef(null)

  const [menuOpenId, setMenuOpenId] = useState(null)
  const [pendingRemove, setPendingRemove] = useState(null)
  const [autoPowerOpen, setAutoPowerOpen] = useState(false)
  const [pendingSwitch, setPendingSwitch] = useState(null)

  const editorMode = useEditorStore((s) => s.editorMode)
  const isAlignMode = editorMode === EDITOR_MODE.ALIGN_FLOOR

  const sidebarCollapsed       = useEditorStore((s) => s.sidebarCollapsed)
  const toggleSidebarCollapsed = useEditorStore((s) => s.toggleSidebarCollapsed)

  const requestSetActive = (id) => {
    if (id === activeFloorId) return
    if (isAlignMode) { setPendingSwitch({ id, keepAlign: false }); return }
    setActiveFloor(id)
  }

  const confirmSwitch = () => {
    const s = pendingSwitch
    setPendingSwitch(null)
    if (!s) return
    if (s.keepAlign) {
      setActiveFloor(s.id)
      setEditorMode(EDITOR_MODE.ALIGN_FLOOR)
      setSelected(s.id, 'floor_align')
    } else {
      setEditorMode(EDITOR_MODE.SELECT)
      setActiveFloor(s.id)
    }
  }

  // Drag-and-drop reorder.
  const [dragIndex, setDragIndex] = useState(null)
  const [dropIndex, setDropIndex] = useState(null)

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.select()
    }
  }, [editingId])

  useEffect(() => {
    if (!menuOpenId) return
    const onDocClick = () => setMenuOpenId(null)
    const t = setTimeout(() => document.addEventListener('click', onDocClick), 0)
    return () => { clearTimeout(t); document.removeEventListener('click', onDocClick) }
  }, [menuOpenId])

  const handleAddClick = () => {
    if (isLoading) return
    fileInputRef.current?.click()
  }

  const handleFileChange = (e) => {
    processFile(e.target.files?.[0])
    e.target.value = ''
  }

  const startRename = (floor) => {
    setEditingId(floor.id)
    setEditingName(floor.name)
    setMenuOpenId(null)
  }

  const commitRename = () => {
    const name = editingName.trim()
    if (editingId && name) updateFloor(editingId, { name })
    setEditingId(null)
  }
  const cancelRename = () => setEditingId(null)

  const requestRemove = (floor) => {
    setMenuOpenId(null)
    setPendingRemove(floor)
  }

  const exportPng = (floor) => {
    setMenuOpenId(null)
    if (!floor.imageUrl || !floor.imageWidth || !floor.imageHeight) return
    const doExport = () => {
      // window.__pixiApp + window.__scene are exposed in DEV by
      // FloorplanSystem; in production the FloorplanSystem will hand us
      // these refs directly via a future prop. For now MVP relies on
      // the DEV bridge — matches how exportPng runs anyway (debug tool).
      const app = window.__pixiApp
      const world = window.__scene?.world
      if (!app || !world) {
        // eslint-disable-next-line no-alert
        alert('PIXI scene 還沒就緒，請等載入完再試一次。')
        return
      }
      const png = capturePlanPng({
        app, world,
        imageWidth: floor.imageWidth,
        imageHeight: floor.imageHeight,
        pixelRatio: 2,
      })
      if (!png) return
      const safeName = (floor.name ?? 'plan').replace(/[^\w\-一-龥]+/g, '_')
      const stamp = new Date().toISOString().slice(0, 10)
      triggerImageDownload(png, `floorplan-${safeName}-${stamp}.png`)
    }
    // Switch to the target floor first (so its content is what gets baked)
    // — only needed if the active floor differs.
    if (floor.id !== activeFloorId) {
      setActiveFloor(floor.id)
      setTimeout(doExport, 50)   // let one render frame land
    } else {
      doExport()
    }
  }

  const startAlign = (floor) => {
    setMenuOpenId(null)
    if (isAlignMode && floor.id !== activeFloorId) {
      setPendingSwitch({ id: floor.id, keepAlign: true })
      return
    }
    setActiveFloor(floor.id)
    setEditorMode(EDITOR_MODE.ALIGN_FLOOR)
    setSelected(floor.id, 'floor_align')
  }

  const confirmRemove = () => {
    const floor = pendingRemove
    if (!floor) return
    if (floor.imageUrl?.startsWith('blob:')) {
      try { URL.revokeObjectURL(floor.imageUrl) } catch { /* ignore */ }
    }
    clearWalls(floor.id)
    clearAPs(floor.id)
    clearScopes(floor.id)
    clearHoles(floor.id)
    clearSwitches(floor.id)
    removeFloor(floor.id)
    if (isAlignMode && floor.id === activeFloorId) {
      setEditorMode(EDITOR_MODE.SELECT)
    }
    setPendingRemove(null)
  }

  const handleDragStart = (e, idx) => {
    setDragIndex(idx)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }
  const handleDragOver = (e, idx) => {
    if (dragIndex === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropIndex(idx)
  }
  const handleDrop = (e, idx) => {
    e.preventDefault()
    if (dragIndex !== null && dragIndex !== idx) reorderFloors(dragIndex, idx)
    setDragIndex(null); setDropIndex(null)
  }
  const handleDragEnd = () => { setDragIndex(null); setDropIndex(null) }

  if (sidebarCollapsed) {
    return (
      <aside className="sidebar-left sidebar-left--collapsed">
        <button
          className="sidebar-left__collapse-btn"
          title="展開樓層面板"
          onClick={toggleSidebarCollapsed}
        >
          ›
        </button>
        <ul className="sidebar-left__floor-list sidebar-left__floor-list--collapsed">
          {floors.map((floor) => {
            const isActive = activeFloorId === floor.id
            return (
              <li
                key={floor.id}
                className={`sidebar-left__floor-chip${isActive ? ' sidebar-left__floor-chip--active' : ''}`}
                title={floor.name}
                onClick={() => requestSetActive(floor.id)}
              >
                {floor.name}
              </li>
            )
          })}
        </ul>
      </aside>
    )
  }

  return (
    <aside className="sidebar-left">
      <section className="sidebar-left__section">
        <div className="sidebar-left__section-header">
          <span>樓層{isLoading && <span className="sidebar-left__loading-badge">{loadingMsg}</span>}</span>
          <button
            className="sidebar-left__icon-btn"
            title="新增樓層（匯入平面圖）"
            onClick={handleAddClick}
            disabled={isLoading}
          >
            ＋
          </button>
          <button
            className="sidebar-left__icon-btn"
            title="收合樓層面板"
            onClick={toggleSidebarCollapsed}
          >
            ‹
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.pdf"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>

        <ul className="sidebar-left__floor-list">
          {floors.length === 0 && (
            <li className="sidebar-left__empty">尚未匯入平面圖</li>
          )}
          {floors.map((floor, idx) => {
            const isActive = activeFloorId === floor.id
            const isEditing = editingId === floor.id
            const isMenuOpen = menuOpenId === floor.id
            const isDragOver = dropIndex === idx && dragIndex !== null && dragIndex !== idx
            const floorHeight = floor.floorHeight ?? DEFAULT_FLOOR_HEIGHT_M
            return (
              <React.Fragment key={floor.id}>
              <li
                className={[
                  'sidebar-left__floor-item',
                  isActive ? 'sidebar-left__floor-item--active' : '',
                  isDragOver ? 'sidebar-left__floor-item--drop-target' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => !isEditing && requestSetActive(floor.id)}
                draggable={!isEditing}
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
              >
                <span className="sidebar-left__floor-icon">▣</span>
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    className="sidebar-left__floor-rename"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter')  commitRename()
                      if (e.key === 'Escape') cancelRename()
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="sidebar-left__floor-name">{floor.name}</span>
                )}
                {!isEditing && (
                  <button
                    className="sidebar-left__floor-menu-btn"
                    title="選項"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpenId(isMenuOpen ? null : floor.id)
                    }}
                  >
                    ⋯
                  </button>
                )}
                {isMenuOpen && (
                  <div
                    className="sidebar-left__floor-menu"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button className="sidebar-left__menu-item" onClick={() => startRename(floor)}>重新命名</button>
                    <button className="sidebar-left__menu-item" onClick={() => startAlign(floor)}>對齊樓層</button>
                    <button
                      className="sidebar-left__menu-item"
                      disabled={!floor.imageUrl}
                      title={floor.imageUrl ? '匯出本層平面圖（含 walls / AP / heatmap）為 PNG' : '需先匯入底圖'}
                      onClick={() => exportPng(floor)}
                    >
                      匯出 PNG
                    </button>
                    <button className="sidebar-left__menu-item sidebar-left__menu-item--danger" onClick={() => requestRemove(floor)}>刪除樓層</button>
                  </div>
                )}
              </li>
              {isActive && (
                <li className="sidebar-left__floor-props">
                  <label className="sidebar-left__floor-prop">
                    <span>樓高</span>
                    <input
                      type="number"
                      min="0.5"
                      step="0.1"
                      value={floorHeight}
                      onChange={(e) => {
                        const num = parseFloat(e.target.value)
                        if (!isNaN(num) && num >= 0.5) updateFloor(floor.id, { floorHeight: num })
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span>m</span>
                  </label>
                  <label className="sidebar-left__floor-prop">
                    <span>樓板</span>
                    <select
                      value={floor.floorSlabMaterialId ?? DEFAULT_FLOOR_SLAB_MATERIAL_ID}
                      onChange={(e) => {
                        const matId = e.target.value
                        updateFloor(floor.id, {
                          floorSlabMaterialId: matId,
                          floorSlabAttenuationDb: FLOOR_SLAB_DEFAULT_DB[matId] ?? DEFAULT_FLOOR_SLAB_DB,
                        })
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {MATERIAL_LIST.map((m) => (
                        <option key={m.id} value={m.id}>{m.label} ({m.dbLoss} dB)</option>
                      ))}
                    </select>
                  </label>
                  <label className="sidebar-left__floor-prop">
                    <span>衰減</span>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={floor.floorSlabAttenuationDb ?? DEFAULT_FLOOR_SLAB_DB}
                      onChange={(e) => {
                        const num = parseFloat(e.target.value)
                        if (!isNaN(num) && num >= 0) updateFloor(floor.id, { floorSlabAttenuationDb: num })
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span>dB</span>
                  </label>
                  <button
                    className="sidebar-left__floor-action"
                    title="跑 greedy multi-start 搜索，自動調整 AP txPower 達成目標 RSSI"
                    onClick={(e) => { e.stopPropagation(); setAutoPowerOpen(true) }}
                  >
                    ⚡ 自動規劃整層 AP 功率
                  </button>
                </li>
              )}
              </React.Fragment>
            )
          })}
        </ul>
      </section>

      {pendingRemove && (
        <ConfirmDialog
          title="刪除樓層"
          message={`確定要刪除「${pendingRemove.name}」？其上的牆體、AP、範圍等資料會一併移除，且此操作無法復原。`}
          confirmLabel="刪除"
          cancelLabel="取消"
          danger
          onConfirm={confirmRemove}
          onCancel={() => setPendingRemove(null)}
        />
      )}

      {pendingSwitch && (
        <ConfirmDialog
          title={pendingSwitch.keepAlign ? '切換對齊目標？' : '離開樓層對齊？'}
          message={
            pendingSwitch.keepAlign
              ? '切換到另一個樓層繼續對齊。目前樓層已調整的偏移/縮放/旋轉會保留。要繼續嗎？'
              : '你正在對齊樓層，切換到其他樓層會結束對齊模式（已調整的偏移/縮放/旋轉會保留）。確定要離開嗎？'
          }
          confirmLabel={pendingSwitch.keepAlign ? '切換' : '離開對齊'}
          cancelLabel="繼續對齊"
          onConfirm={confirmSwitch}
          onCancel={() => setPendingSwitch(null)}
        />
      )}
      <AutoPowerModal
        open={autoPowerOpen}
        apIds={[]}
        onClose={() => setAutoPowerOpen(false)}
      />
    </aside>
  )
}

export default SidebarLeft
