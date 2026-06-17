import React, { useCallback } from 'react'
import { useCameraStore } from '@/store/useCameraStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import { cameraCoverageRadii, DEFAULT_TILT_DEG } from '@/features/cameras/fovPolygon'
import { deviceStatus, DEVICE_STATUS, STATUS_COLOR, STATUS_LABEL } from '@/features/cameras/deviceStatus'
import { CAMERA_MODEL_LIST, cameraModelById } from '@/constants/cameraModels'
import { PanelShell, PanelHeader, PanelSection, PanelField } from './_shared/PanelShell'
import { TextInput, NumberInput, Select } from './_shared/PanelControls'
import './_shared/shared.sass'

// Camera properties panel (Phase 34-1). Opens when a camera marker is
// selected in CAMERA mode. Pure-visual object — only placement metadata,
// no simulation params.

const MIN_FOV = 10
const MAX_FOV = 360
const MIN_RANGE_M = 1

function CameraPanel({ floorId, cameraId }) {
  const camera        = useCameraStore((s) => (s.camerasByFloor[floorId] ?? []).find((c) => c.id === cameraId))
  const updateCamera  = useCameraStore((s) => s.updateCamera)
  const removeCamera  = useCameraStore((s) => s.removeCamera)
  const openLiveView  = useCameraStore((s) => s.openLiveView)
  const clearSelected = useEditorStore((s) => s.clearSelected)
  const floors        = useFloorStore((s) => s.floors)
  const floor         = floors.find((f) => f.id === floorId)
  const hasScale      = !!floor?.scale

  const handleField = useCallback((field, value) => {
    updateCamera(floorId, cameraId, { [field]: value })
  }, [floorId, cameraId, updateCamera])

  // Picking a model preset fills FOV / range / mount height / tilt in one go
  // (azimuth + position are left as-is). 'custom' just records the choice and
  // changes nothing, so manual edits aren't clobbered.
  const applyModel = useCallback((modelId) => {
    const m = cameraModelById(modelId)
    const patch = { model: modelId }
    if (modelId !== 'custom') {
      patch.fovDeg = m.fovDeg
      patch.rangeM = m.rangeM
      patch.z = m.zM
      patch.tiltDeg = m.tiltDeg
    }
    updateCamera(floorId, cameraId, patch)
  }, [floorId, cameraId, updateCamera])

  const handleDelete = () => {
    removeCamera(floorId, cameraId)
    clearSelected()
  }

  if (!camera) return null

  const wrapAzimuth = (v) => (((v % 360) + 360) % 360)
  const rawAz = camera.azimuth ?? 0
  const effAz = wrapAzimuth(rawAz)

  return (
    <PanelShell accent="camera">
      <PanelHeader
        title={camera.name}
        meta={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
            Camera 屬性
          </span>
        }
        onDelete={handleDelete}
      />

      <PanelSection title="識別">
        <PanelField label="名稱">
          <TextInput value={camera.name} onChange={(v) => handleField('name', v)} />
        </PanelField>
        <PanelField label="狀態" hint="離線時不錄影、不偵測，覆蓋計為盲區">
          {(() => {
            const status = deviceStatus(camera)
            const next = status === DEVICE_STATUS.ONLINE ? DEVICE_STATUS.OFFLINE : DEVICE_STATUS.ONLINE
            return (
              <button
                type="button"
                onClick={() => handleField('status', next)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '3px 10px', borderRadius: 12, cursor: 'pointer',
                  border: `1px solid ${STATUS_COLOR[status]}`,
                  background: 'transparent', color: STATUS_COLOR[status],
                  fontSize: 12, fontWeight: 600,
                }}
                title="點擊切換在線／離線"
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[status] }} />
                {STATUS_LABEL[status]}
              </button>
            )
          })()}
        </PanelField>
        <PanelField label="影像">
          <button
            type="button"
            onClick={() => openLiveView(cameraId)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid rgba(16,185,129,0.5)', background: 'rgba(16,185,129,0.12)',
              color: '#10b981', fontSize: 12, fontWeight: 600,
            }}
            title="開啟即時影像（模擬畫面）"
          >
            📹 即時影像
          </button>
        </PanelField>
      </PanelSection>

      <PanelSection title="視野">
        <PanelField label="型號" hint="套用後可再微調各參數">
          <Select
            value={camera.model ?? 'custom'}
            onChange={applyModel}
            options={CAMERA_MODEL_LIST.map((m) => ({ value: m.id, label: m.label }))}
          />
        </PanelField>
        <PanelField label="方位角" hint={effAz !== rawAz ? `實際 ${effAz}°` : '0°=右，順時針'}>
          <NumberInput
            value={rawAz}
            step={1}
            unit="度"
            width={70}
            onChange={(v) => { if (!isNaN(v)) handleField('azimuth', v) }}
          />
        </PanelField>
        <PanelField label="視角 (FOV)" hint={`${MIN_FOV}~${MAX_FOV}，360=環景`}>
          <NumberInput
            value={camera.fovDeg ?? 90}
            min={MIN_FOV}
            max={MAX_FOV}
            step={5}
            unit="度"
            width={70}
            onChange={(v) => { if (!isNaN(v)) handleField('fovDeg', Math.max(MIN_FOV, Math.min(MAX_FOV, v))) }}
          />
        </PanelField>
        <PanelField label="俯角" hint="0=水平，90=垂直朝下">
          <NumberInput
            value={camera.tiltDeg ?? DEFAULT_TILT_DEG}
            min={0}
            max={85}
            step={5}
            unit="度"
            width={70}
            onChange={(v) => { if (!isNaN(v)) handleField('tiltDeg', Math.max(0, Math.min(85, v))) }}
          />
        </PanelField>
        <PanelField label="可視距離" hint="鏡頭解析上限">
          <NumberInput
            value={camera.rangeM ?? 12}
            min={MIN_RANGE_M}
            step={1}
            unit="m"
            width={70}
            onChange={(v) => { if (!isNaN(v) && v >= MIN_RANGE_M) handleField('rangeM', v) }}
          />
        </PanelField>
        {(() => {
          // Derived detection band from height + tilt + FOV — surfaces the
          // tilt trade-off (shallow = far reach + near blind ring). Near edge
          // is measured against the target height (1.4 m), not the floor.
          const { minRangePx, rangePx } = cameraCoverageRadii(camera, 1)
          return (
            <div className="pnl__field" style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>
              偵測覆蓋帶 約 {minRangePx.toFixed(1)}–{rangePx.toFixed(1)} m（以目標高 1.4m 計）
              {minRangePx > 0.3 && '；鏡頭正下方有盲區'}
            </div>
          )
        })()}
        <div className="pnl__field" style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>
          牆會遮擋視野；玻璃牆 / 窗可被看穿
        </div>
        {!hasScale && (
          <div className="pnl__field" style={{ display: 'block', fontSize: 11, color: '#f59e0b' }}>
            ⚠ 尚未設定比例尺，可視距離以預設 40 px/m 估算
          </div>
        )}
      </PanelSection>

      <PanelSection title="安裝">
        <PanelField label="安裝高度">
          <NumberInput
            value={camera.z ?? 2.5}
            min={0}
            step={0.1}
            unit="m"
            width={70}
            onChange={(v) => { if (!isNaN(v) && v >= 0) handleField('z', v) }}
          />
        </PanelField>
      </PanelSection>
    </PanelShell>
  )
}

export default CameraPanel
