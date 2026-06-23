import React, { useState } from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useCameraStore } from '@/store/useCameraStore'
import { useViewportStore } from '@/store/useViewportStore'
import { deviceStatus, STATUS_COLOR, DEVICE_STATUS } from '@/features/cameras/deviceStatus'
import { cameraModelById, CAMERA_MODEL_LIST } from '@/constants/cameraModels'
import './CameraListPanel.sass'

// Camera roster panel for Camera mode. Lists every camera on the active floor
// with its model + online status. A row click selects it (opens CameraPanel)
// and recentres the viewport. Each row also has a checkbox for multi-select:
// when ≥1 is checked, a batch bar appears to apply a model, toggle online/
// offline, or delete the whole selection at once. (Self-contained here — it
// deliberately doesn't touch the canvas marquee-select system.)

function CameraListPanel() {
  const inCameraMode = useEditorStore((s) => s.editorMode === EDITOR_MODE.CAMERA)
  const show = useCameraStore((s) => s.showCameraList)
  const toggle = useCameraStore((s) => s.toggleShowCameraList)
  const collapsed = useCameraStore((s) => s.cameraListCollapsed)
  const toggleCollapsed = useCameraStore((s) => s.toggleCameraListCollapsed)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const cameras = useCameraStore((s) => s.camerasByFloor[activeFloorId] ?? [])
  const selectedId = useEditorStore((s) => s.selectedId)
  const selectedType = useEditorStore((s) => s.selectedType)
  const setSelected = useEditorStore((s) => s.setSelected)
  const clearSelected = useEditorStore((s) => s.clearSelected)
  const removeCamera = useCameraStore((s) => s.removeCamera)
  const updateCamera = useCameraStore((s) => s.updateCamera)

  // Checked rows for batch ops — a Set of camera ids, local to the panel.
  const [checked, setChecked] = useState(() => new Set())

  if (!inCameraMode || !activeFloorId || !show) return null

  // Drop ids that no longer exist (deleted elsewhere) so the batch bar count
  // stays honest.
  const liveIds = new Set(cameras.map((c) => c.id))
  const checkedLive = [...checked].filter((id) => liveIds.has(id))

  const toggleChecked = (id) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const clearChecked = () => setChecked(new Set())

  const focusCamera = (cam) => {
    setSelected(cam.id, 'camera')
    const vp = useViewportStore.getState()
    const canvas = window.__pixiApp?.canvas
    if (canvas && vp.setViewport) {
      const rect = canvas.getBoundingClientRect()
      const scale = vp.scale || 1
      vp.setViewport({ x: rect.width / 2 - cam.x * scale, y: rect.height / 2 - cam.y * scale, scale })
    }
  }

  // Group cameras by their `group` label for the roster. Unlabelled cameras
  // fall into 未分組. Group headers only show once ≥1 camera has a real group
  // (otherwise everything is 未分組 and headers would be noise). Named groups
  // sort alphabetically; 未分組 always sorts last.
  const UNGROUPED = '未分組'
  const groupMap = new Map()
  for (const cam of cameras) {
    const key = (cam.group ?? '').trim() || UNGROUPED
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key).push(cam)
  }
  const showGroupHeaders = [...groupMap.keys()].some((k) => k !== UNGROUPED)
  const groups = [...groupMap.entries()].sort((a, b) => {
    if (a[0] === UNGROUPED) return 1
    if (b[0] === UNGROUPED) return -1
    return a[0].localeCompare(b[0])
  })

  // ── Batch operations over the checked cameras ──
  const batchApplyModel = (modelId) => {
    if (modelId === 'custom') return
    const m = cameraModelById(modelId)
    for (const id of checkedLive) {
      updateCamera(activeFloorId, id, { model: modelId, fovDeg: m.fovDeg, rangeM: m.rangeM, z: m.zM, tiltDeg: m.tiltDeg })
    }
  }
  const batchSetStatus = (status) => {
    for (const id of checkedLive) updateCamera(activeFloorId, id, { status })
  }
  const batchDelete = () => {
    for (const id of checkedLive) {
      removeCamera(activeFloorId, id)
      if (selectedId === id) clearSelected()
    }
    clearChecked()
  }

  return (
    <div className={`camera-list${collapsed ? ' camera-list--collapsed' : ''}`}>
      <div className="camera-list__head">
        <button
          type="button"
          className="camera-list__caret"
          onClick={toggleCollapsed}
          title={collapsed ? '展開' : '收合'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="camera-list__title">相機清單（{cameras.length}）</span>
        <button type="button" className="camera-list__close" onClick={toggle} title="關閉">✕</button>
      </div>

      {!collapsed && (cameras.length === 0 ? (
        <div className="camera-list__empty">本樓層還沒有相機。點畫布空白處放置。</div>
      ) : (
        <>
          <div className="camera-list__rows">
            {groups.map(([groupName, groupCams]) => (
              <React.Fragment key={groupName}>
                {showGroupHeaders && (
                  <div className="camera-list__group">{groupName}（{groupCams.length}）</div>
                )}
                {groupCams.map((cam) => {
                  const status = deviceStatus(cam)
                  const model = cameraModelById(cam.model ?? 'custom')
                  const isSel = selectedId === cam.id && selectedType === 'camera'
                  const isChecked = checked.has(cam.id)
                  return (
                    <div
                      key={cam.id}
                      className={`camera-list__row${isSel ? ' camera-list__row--sel' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="camera-list__check"
                        checked={isChecked}
                        onChange={() => toggleChecked(cam.id)}
                        onClick={(e) => e.stopPropagation()}
                        title="選取以批次操作"
                      />
                      <span
                        role="button"
                        tabIndex={0}
                        className="camera-list__rowmain"
                        onClick={() => focusCamera(cam)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusCamera(cam) } }}
                        title="點擊選取並置中"
                      >
                        <span className="camera-list__dot" style={{ background: STATUS_COLOR[status] }} />
                        <span className="camera-list__name">{cam.name}</span>
                        <span className="camera-list__model">{model.id === 'custom' ? '自訂' : model.label.split(' ')[0]}</span>
                      </span>
                      <button
                        type="button"
                        className="camera-list__del"
                        title="刪除這台相機"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeCamera(activeFloorId, cam.id)
                          if (selectedId === cam.id) clearSelected()
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}
              </React.Fragment>
            ))}
          </div>

          {checkedLive.length > 0 && (
            <div className="camera-list__batch">
              <div className="camera-list__batch-head">
                <span>已選 {checkedLive.length} 台</span>
                <button type="button" onClick={clearChecked} title="取消選取">清除</button>
              </div>
              <div className="camera-list__batch-row">
                <select
                  className="camera-list__batch-model"
                  value=""
                  onChange={(e) => { batchApplyModel(e.target.value); e.target.value = '' }}
                  title="套用型號到所選相機"
                >
                  <option value="" disabled hidden>套用型號…</option>
                  {CAMERA_MODEL_LIST.filter((m) => m.id !== 'custom').map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <button type="button" onClick={() => batchSetStatus(DEVICE_STATUS.ONLINE)} title="設為在線">在線</button>
                <button type="button" onClick={() => batchSetStatus(DEVICE_STATUS.OFFLINE)} title="設為離線">離線</button>
                <button type="button" className="camera-list__batch-del" onClick={batchDelete} title="刪除所選">刪除</button>
              </div>
            </div>
          )}
        </>
      ))}
    </div>
  )
}

export default CameraListPanel
