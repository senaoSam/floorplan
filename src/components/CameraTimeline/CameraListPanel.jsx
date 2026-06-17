import React from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useCameraStore } from '@/store/useCameraStore'
import { useViewportStore } from '@/store/useViewportStore'
import { deviceStatus, STATUS_COLOR } from '@/features/cameras/deviceStatus'
import { cameraModelById } from '@/constants/cameraModels'
import './CameraListPanel.sass'

// Camera roster panel for Camera mode. Lists every camera on the active floor
// with its model + online status; clicking a row selects it (opens the
// CameraPanel) and recentres the viewport on it so it's easy to find on a
// busy plan. Toggled from the camera timeline bar.

function CameraListPanel() {
  const inCameraMode = useEditorStore((s) => s.editorMode === EDITOR_MODE.CAMERA)
  const show = useCameraStore((s) => s.showCameraList)
  const toggle = useCameraStore((s) => s.toggleShowCameraList)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const cameras = useCameraStore((s) => s.camerasByFloor[activeFloorId] ?? [])
  const selectedId = useEditorStore((s) => s.selectedId)
  const selectedType = useEditorStore((s) => s.selectedType)
  const setSelected = useEditorStore((s) => s.setSelected)

  if (!inCameraMode || !activeFloorId || !show) return null

  const focusCamera = (cam) => {
    setSelected(cam.id, 'camera')
    // Recentre the viewport on the camera without changing zoom.
    const vp = useViewportStore.getState()
    const canvas = window.__pixiApp?.canvas
    if (canvas && vp.setViewport) {
      const rect = canvas.getBoundingClientRect()
      const scale = vp.scale || 1
      vp.setViewport({ x: rect.width / 2 - cam.x * scale, y: rect.height / 2 - cam.y * scale, scale })
    }
  }

  return (
    <div className="camera-list">
      <div className="camera-list__head">
        <span className="camera-list__title">相機清單（{cameras.length}）</span>
        <button type="button" className="camera-list__close" onClick={toggle} title="關閉">✕</button>
      </div>

      {cameras.length === 0 ? (
        <div className="camera-list__empty">本樓層還沒有相機。點畫布空白處放置。</div>
      ) : (
        <div className="camera-list__rows">
          {cameras.map((cam) => {
            const status = deviceStatus(cam)
            const model = cameraModelById(cam.model ?? 'custom')
            const isSel = selectedId === cam.id && selectedType === 'camera'
            return (
              <button
                key={cam.id}
                type="button"
                className={`camera-list__row${isSel ? ' camera-list__row--sel' : ''}`}
                onClick={() => focusCamera(cam)}
                title="點擊選取並置中"
              >
                <span className="camera-list__dot" style={{ background: STATUS_COLOR[status] }} />
                <span className="camera-list__name">{cam.name}</span>
                <span className="camera-list__model">{model.id === 'custom' ? '自訂' : model.label.split(' ')[0]}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default CameraListPanel
