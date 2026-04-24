import React, { useRef, useState, useEffect } from 'react'
import { useFloorStore, DEFAULT_FLOOR_HEIGHT_M } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorImport } from '@/features/importer/useFloorImport'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
import './SidebarLeft.sass'

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
  const setEditorMode   = useEditorStore((s) => s.setEditorMode)
  const setSelected     = useEditorStore((s) => s.setSelected)

  const { processFile, isLoading, loadingMsg } = useFloorImport()
  const fileInputRef = useRef(null)

  // Rename inline state; null = not editing.
  const [editingId, setEditingId]   = useState(null)
  const [editingName, setEditingName] = useState('')
  const editInputRef = useRef(null)

  // Menu popover per floor (⋯ button).
  const [menuOpenId, setMenuOpenId] = useState(null)

  // Pending removal — null = no dialog open, otherwise the floor object to remove.
  const [pendingRemove, setPendingRemove] = useState(null)

  // Pending floor switch while in align mode — holds { id, keepAlign }.
  // keepAlign=true means user chose "Align another floor" from that floor's
  // menu, so we stay in align mode on the new floor after confirmation.
  const [pendingSwitch, setPendingSwitch] = useState(null)

  const editorMode = useEditorStore((s) => s.editorMode)
  const isAlignMode = editorMode === EDITOR_MODE.ALIGN_FLOOR

  const requestSetActive = (id) => {
    if (id === activeFloorId) return
    if (isAlignMode) {
      setPendingSwitch({ id, keepAlign: false })
      return
    }
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

  // Close menu on any outside click.
  useEffect(() => {
    if (!menuOpenId) return
    const onDocClick = () => setMenuOpenId(null)
    // Defer attachment so the click that opened the menu doesn't immediately close it.
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

  const startAlign = (floor) => {
    setMenuOpenId(null)
    // If already aligning a different floor, ask for confirmation before
    // switching the align target.
    if (isAlignMode && floor.id !== activeFloorId) {
      setPendingSwitch({ id: floor.id, keepAlign: true })
      return
    }
    setActiveFloor(floor.id)
    setEditorMode(EDITOR_MODE.ALIGN_FLOOR)
    // Open right-panel context for the align panel (dispatched by PanelRight).
    setSelected(floor.id, 'floor_align')
  }

  const confirmRemove = () => {
    const floor = pendingRemove
    if (!floor) return
    // Free the imported image blob URL (createObjectURL) before discarding the floor.
    if (floor.imageUrl?.startsWith('blob:')) {
      try { URL.revokeObjectURL(floor.imageUrl) } catch {}
    }
    clearWalls(floor.id)
    clearAPs(floor.id)
    clearScopes(floor.id)
    clearHoles(floor.id)
    removeFloor(floor.id)
    // Removing the active floor while aligning would leave the panel orphaned;
    // drop back to SELECT so the UI stays consistent.
    if (isAlignMode && floor.id === activeFloorId) {
      setEditorMode(EDITOR_MODE.SELECT)
    }
    setPendingRemove(null)
  }

  const handleDragStart = (e, idx) => {
    setDragIndex(idx)
    e.dataTransfer.effectAllowed = 'move'
    // Firefox requires some data to be set, else drag aborts immediately.
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
    if (dragIndex !== null && dragIndex !== idx) {
      reorderFloors(dragIndex, idx)
    }
    setDragIndex(null); setDropIndex(null)
  }

  const handleDragEnd = () => { setDragIndex(null); setDropIndex(null) }

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
    </aside>
  )
}

export default SidebarLeft
