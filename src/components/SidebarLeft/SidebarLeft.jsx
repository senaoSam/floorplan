import React, { useRef, useState, useEffect } from 'react'
import {
  useFloorStore, DEFAULT_FLOOR_HEIGHT_M, getAlignAnchorId,
  MIN_FLOOR_HEIGHT_M, MAX_FLOOR_HEIGHT_M, MAX_SLAB_ATTEN_DB,
} from '@/store/useFloorStore'
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
import { useCameraStore } from '@/store/useCameraStore'
import { useTrackingStore } from '@/store/useTrackingStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorImport } from '@/features/importer/useFloorImport'
import ConfirmDialog from '@/components/ConfirmDialog/ConfirmDialog'
import Icon from '@/components/Icon/Icon'
import { showUiToast } from '@/store/useUiToastStore'
import ProgressPanel from '@/components/ProgressPanel/ProgressPanel'
import DemoLoader from '@/components/DemoLoader/DemoLoader'
import StressLoader from '@/components/StressLoader/StressLoader'
import { capturePlanPng, triggerImageDownload } from '@/features/exportPng/exportPlanView'
import { getSceneRefs } from '@/render/sceneRegistry'
import AutoPowerModal from '@/components/AutoPowerModal/AutoPowerModal'
import AutoPlaceModal from '@/components/AutoPlaceModal/AutoPlaceModal'
import './SidebarLeft.sass'

// Ported from oldSrc; trimmed against the PIXI port:
//   * 匯出 PNG ↘ ported Bundle 22 via PIXI renderer.extract.canvas
//     (scene refs via getSceneRefs(); alert below is only the not-ready guard).
//   * 自動規劃整層 AP 功率 ↘ AutoPowerModal (heatmap-driven greedy planner)
//     ported Bundle 23 — button opens the modal (setAutoPowerOpen).
// Everything else (add / collapse / rename / align switch / inline floor
// properties / reorder / remove) is identical to oldSrc.

function SidebarLeft() {
  const floors          = useFloorStore((s) => s.floors)
  const activeFloorId   = useFloorStore((s) => s.activeFloorId)
  const setActiveFloor  = useFloorStore((s) => s.setActiveFloor)
  const updateFloor     = useFloorStore((s) => s.updateFloor)
  const removeFloor     = useFloorStore((s) => s.removeFloor)
  const reorderFloors   = useFloorStore((s) => s.reorderFloors)
  const anchorFloorId   = useFloorStore(getAlignAnchorId)
  const setAlignAnchorFloor = useFloorStore((s) => s.setAlignAnchorFloor)
  const clearWalls      = useWallStore((s) => s.clearFloor)
  const clearAPs        = useAPStore((s) => s.clearFloor)
  const clearScopes     = useScopeStore((s) => s.clearFloor)
  const clearHoles      = useFloorHoleStore((s) => s.clearFloor)
  const clearSwitches   = useCableStore((s) => s.clearFloor)
  const clearCameras    = useCameraStore((s) => s.clearFloor)
  const clearTracks     = useTrackingStore((s) => s.clearFloor)
  const setEditorMode   = useEditorStore((s) => s.setEditorMode)
  const setSelected     = useEditorStore((s) => s.setSelected)
  const setAlignRefFloors = useEditorStore((s) => s.setAlignRefFloors)

  const { processFile, isLoading, loadingMsg } = useFloorImport()
  const fileInputRef = useRef(null)

  const [editingId, setEditingId]   = useState(null)
  const [editingName, setEditingName] = useState('')
  const editInputRef = useRef(null)

  const [menuOpenId, setMenuOpenId] = useState(null)
  const [pendingRemove, setPendingRemove] = useState(null)
  const [autoPowerOpen, setAutoPowerOpen] = useState(false)
  const [autoPlaceOpen, setAutoPlaceOpen] = useState(false)
  const [pendingSwitch, setPendingSwitch] = useState(null)
  // Set when the user asks to align the ANCHOR floor — confirmed before
  // proceeding, since the anchor is the pose everyone else aligns onto.
  const [pendingAnchorAlign, setPendingAnchorAlign] = useState(null)

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
      // Reseed the ref-overlay list for the NEW aligned floor — the current
      // list was seeded as "everyone except the previous floor", so the
      // previous floor (now a reference) would stay invisible.
      setAlignRefFloors(null)
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
    // contextmenu too: the row's right-click opener stops propagation, so
    // any right-click that reaches document means "elsewhere" — close.
    const t = setTimeout(() => {
      document.addEventListener('click', onDocClick)
      document.addEventListener('contextmenu', onDocClick)
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('contextmenu', onDocClick)
    }
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
      // Read the live scene from the production-safe registry (works in all
      // build modes; the old window.__pixiApp / __scene path was DEV-only and
      // broke PNG export in production). See render/sceneRegistry.js.
      const refs = getSceneRefs()
      if (!refs) {
        showUiToast('畫布尚未載入完成，請稍候再試一次匯出')
        return
      }
      const png = capturePlanPng({
        app: refs.app, world: refs.world,
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

  const doStartAlign = (floor) => {
    if (isAlignMode && floor.id !== activeFloorId) {
      setPendingSwitch({ id: floor.id, keepAlign: true })
      return
    }
    setActiveFloor(floor.id)
    setEditorMode(EDITOR_MODE.ALIGN_FLOOR)
    setSelected(floor.id, 'floor_align')
  }

  const startAlign = (floor) => {
    setMenuOpenId(null)
    // Anchor gate: aligning the anchor moves the reference everyone else
    // aligns onto — confirm first (escape hatch kept for genuine re-basing).
    if (floor.id === anchorFloorId) {
      setPendingAnchorAlign(floor)
      return
    }
    doStartAlign(floor)
  }

  const setAnchor = (floor) => {
    setMenuOpenId(null)
    setAlignAnchorFloor(floor.id)
    showUiToast(`已將「${floor.name}」設為對齊基準樓層`)
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
    // 47-15: the confirm dialog says cameras/tracks are removed too, so clear
    // them — otherwise the floor's cameras, tripwires, zones and mock tracks
    // linger as ghost devices keyed by the now-deleted floor id.
    clearCameras(floor.id)
    clearTracks(floor.id)
    // 47-19: drop this floor's undo/redo snapshots so a dead snapshot can't jam
    // the stack (undo returns early on floorId mismatch and never pops).
    useHistoryStore.getState().dropFloor(floor.id)
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
          <Icon name="chevronRight" size={12} />
        </button>
        <ul className="sidebar-left__floor-list sidebar-left__floor-list--collapsed">
          {floors.slice().reverse().map((floor) => {
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
        <div className="sidebar-left__dev sidebar-left__dev--collapsed">
          <StressLoader />
          <DemoLoader />
          <ProgressPanel />
        </div>
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
            <Icon name="chevronLeft" size={12} />
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
          {/* Display top-down = highest floor first (matches building-plan
              convention + the 3D stack where floors[0] sits on the ground).
              We reverse only the render order and keep each floor's REAL array
              index so drag/reorder/drop-highlight keep operating on `floors`. */}
          {floors.map((floor, idx) => ({ floor, idx })).reverse().map(({ floor, idx }) => {
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
                onContextMenu={(e) => {
                  // Right-click opens the same options menu as the ⋯ button —
                  // discoverability parity (the hover-only ⋯ was the sole entry
                  // into 對齊樓層 / 匯出 / 刪除).
                  e.preventDefault()
                  e.stopPropagation()
                  if (!isEditing) setMenuOpenId(floor.id)
                }}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
              >
                {/* Reorder affordance (ui-spec B11): dragging starts from the
                    grip only, so row clicks (= switch floor) can't turn into
                    accidental drags. */}
                <span
                  className="sidebar-left__floor-grip"
                  title="拖曳調整樓層順序"
                  draggable={!isEditing}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onClick={(e) => e.stopPropagation()}
                >
                  ⠿
                </span>
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
                  <span className="sidebar-left__floor-name">
                    {floor.name}
                    {floor.id === anchorFloorId && (
                      <span
                        className="sidebar-left__anchor-badge"
                        title="對齊基準樓層：其他樓層以它為基準對齊，建議固定不動"
                      >
                        📌
                      </span>
                    )}
                  </span>
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
                      disabled={floor.id === anchorFloorId}
                      title="其他樓層以基準樓層為參考對齊；基準樓層本身建議固定不動"
                      onClick={() => setAnchor(floor)}
                    >
                      {floor.id === anchorFloorId ? '✓ 對齊基準' : '設為對齊基準'}
                    </button>
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
                      min={MIN_FLOOR_HEIGHT_M}
                      max={MAX_FLOOR_HEIGHT_M}
                      step="0.1"
                      value={floorHeight}
                      onChange={(e) => {
                        // 52-B4: clamp both ends — `min` alone let 999999 m through.
                        const num = parseFloat(e.target.value)
                        if (isNaN(num) || num < MIN_FLOOR_HEIGHT_M) return
                        updateFloor(floor.id, { floorHeight: Math.min(num, MAX_FLOOR_HEIGHT_M) })
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
                      max={MAX_SLAB_ATTEN_DB}
                      step="0.5"
                      value={floor.floorSlabAttenuationDb ?? DEFAULT_FLOOR_SLAB_DB}
                      onChange={(e) => {
                        // 52-B4: clamp the top end too.
                        const num = parseFloat(e.target.value)
                        if (isNaN(num) || num < 0) return
                        updateFloor(floor.id, { floorSlabAttenuationDb: Math.min(num, MAX_SLAB_ATTEN_DB) })
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span>dB</span>
                  </label>
                  <button
                    className="sidebar-left__floor-action"
                    title="依覆蓋目標自動計算本樓層 AP 的建議位置與頻道（先預覽再套用）"
                    onClick={(e) => { e.stopPropagation(); setAutoPlaceOpen(true) }}
                  >
                    📍 自動規劃 AP 放置
                  </button>
                  <button
                    className="sidebar-left__floor-action"
                    title="自動調整本樓層各 AP 的發射功率，達成目標訊號涵蓋"
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

      {/* Dev widgets (demo / stress / progress) — pinned to the sidebar
          bottom, OUTSIDE the canvas overlays: this whole block is removed
          for production, so it must not participate in canvas UIUX. */}
      <div className="sidebar-left__dev">
        <StressLoader />
        <DemoLoader />
        <ProgressPanel />
      </div>

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

      {pendingAnchorAlign && (
        <ConfirmDialog
          title="對齊基準樓層？"
          message={`「${pendingAnchorAlign.name}」是對齊基準樓層，其他樓層都以它為參考，移動它會讓整棟的對齊一起偏移。建議改對齊其他樓層。仍要對齊它嗎？`}
          confirmLabel="仍要對齊"
          cancelLabel="取消"
          onConfirm={() => {
            const f = pendingAnchorAlign
            setPendingAnchorAlign(null)
            doStartAlign(f)
          }}
          onCancel={() => setPendingAnchorAlign(null)}
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
      <AutoPlaceModal
        open={autoPlaceOpen}
        onClose={() => setAutoPlaceOpen(false)}
      />
    </aside>
  )
}

export default SidebarLeft
