import React, { useCallback } from 'react'
import { useCameraStore } from '@/store/useCameraStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import { cameraCoverageRadii, DEFAULT_TILT_DEG } from '@/features/cameras/fovPolygon'
import { deviceStatus, DEVICE_STATUS, STATUS_COLOR, STATUS_LABEL } from '@/features/cameras/deviceStatus'
import { CAMERA_MODEL_LIST, cameraModelById } from '@/constants/cameraModels'
import { PanelShell, PanelHeader, PanelSection, PanelField } from './_shared/PanelShell'
import { TextInput, NumberInput, Select } from './_shared/PanelControls'
import { generateId } from '@/utils/id'
import { wrapAzimuth } from '@/utils/angle'
import './_shared/shared.sass'

// Camera properties panel (Phase 34-1). Opens when a camera marker is
// selected in CAMERA mode. Pure-visual object — only placement metadata,
// no simulation params.

const MIN_FOV = 10
const MAX_FOV = 360
const MIN_RANGE_M = 1

// Common camera mount heights (m) for one-click setting.
const HEIGHT_PRESETS = [
  { m: 2.5, title: '室內天花板' },
  { m: 3, title: '標準' },
  { m: 4, title: '挑高 / 大廳' },
  { m: 6, title: '戶外桿' },
]

// Shared inline style for the azimuth nudge / aim buttons.
const NUDGE_BTN = {
  padding: '2px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
  border: '1px solid rgba(255,255,255,0.18)', background: 'transparent',
  color: '#94a3b8', fontWeight: 600,
}

function CameraPanel({ floorId, cameraId }) {
  const camera        = useCameraStore((s) => (s.camerasByFloor[floorId] ?? []).find((c) => c.id === cameraId))
  const updateCamera  = useCameraStore((s) => s.updateCamera)
  const removeCamera  = useCameraStore((s) => s.removeCamera)
  const addCamera     = useCameraStore((s) => s.addCamera)
  const nextCameraName = useCameraStore((s) => s.nextCameraName)
  const openLiveView  = useCameraStore((s) => s.openLiveView)
  const openCalibrate = useCameraStore((s) => s.openCalibrate)
  const clearSelected = useEditorStore((s) => s.clearSelected)
  const setSelected   = useEditorStore((s) => s.setSelected)
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

  // Duplicate the camera with all its params (azimuth/fov/range/z/tilt/model/
  // status), offset slightly so it's visible, then select the copy.
  const handleDuplicate = () => {
    if (!camera) return
    const id = generateId('cam')
    // 47-20: drop calibration — the copy is offset +24px so the source's
    // frame→floor homography no longer aligns; keeping it would falsely mark
    // the copy 已校正.
    const { id: _omit, name: _omitName, calibration: _omitCal, ...rest } = camera
    addCamera(floorId, {
      ...rest,
      id,
      name: nextCameraName(),
      x: camera.x + 24,
      y: camera.y + 24,
    })
    setSelected(id, 'camera')
  }

  if (!camera) return null

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
        <PanelField label="區域" hint="如 大廳／車庫；清單依此分組">
          <TextInput
            value={camera.group ?? ''}
            placeholder="未分組"
            onChange={(v) => handleField('group', v)}
          />
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
        <PanelField label="熱圖校正" hint="點 4 對點求單應性矩陣，對齊 Verkada 做法">
          <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
            <button
              type="button"
              onClick={() => openCalibrate(cameraId)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 12px', borderRadius: 8, cursor: 'pointer',
                border: camera.calibration ? '1px solid rgba(16,185,129,0.5)' : '1px solid rgba(56,189,248,0.5)',
                background: camera.calibration ? 'rgba(16,185,129,0.12)' : 'rgba(56,189,248,0.12)',
                color: camera.calibration ? '#10b981' : '#38bdf8', fontSize: 12, fontWeight: 600,
              }}
              title="開啟 4 點校正（在平面圖與相機畫面點對應點）"
            >
              🎯 {camera.calibration ? '已校正' : '校正熱圖'}
            </button>
            {!camera.calibration && (
              <span style={{ color: '#f59e0b', fontSize: 11, lineHeight: 1.3 }}>
                尚未校正：軌跡以平面座標顯示；校正後熱圖更貼合此相機視野
              </span>
            )}
          </span>
        </PanelField>
        <PanelField label="複製" hint="複製這台含所有參數">
          <button
            type="button"
            onClick={handleDuplicate}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.2)', background: 'transparent',
              color: '#e2e8f0', fontSize: 12, fontWeight: 600,
            }}
            title="複製這台相機（含方位/FOV/距離/高度/俯角/型號）"
          >
            ⧉ 複製相機
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
        <PanelField label="轉向" hint="微調或朝向底圖中心">
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            <button type="button" style={NUDGE_BTN} title="逆時針 15°"
              onClick={() => handleField('azimuth', wrapAzimuth(rawAz - 15))}>↺ 15°</button>
            <button type="button" style={NUDGE_BTN} title="順時針 15°"
              onClick={() => handleField('azimuth', wrapAzimuth(rawAz + 15))}>15° ↻</button>
            <button type="button" style={NUDGE_BTN} title="朝向底圖中心"
              onClick={() => {
                if (!floor?.imageWidth) return
                const deg = Math.atan2(floor.imageHeight / 2 - camera.y, floor.imageWidth / 2 - camera.x) * 180 / Math.PI
                handleField('azimuth', wrapAzimuth(Math.round(deg)))
              }}>◎ 對準中心</button>
          </span>
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
        <PanelField label="常用高度" hint="一鍵套用">
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {HEIGHT_PRESETS.map((h) => {
              const active = Math.abs((camera.z ?? 2.5) - h.m) < 0.01
              return (
                <button
                  key={h.m}
                  type="button"
                  onClick={() => handleField('z', h.m)}
                  title={h.title}
                  style={{
                    padding: '2px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 11,
                    border: `1px solid ${active ? '#10b981' : 'rgba(255,255,255,0.18)'}`,
                    background: active ? 'rgba(16,185,129,0.18)' : 'transparent',
                    color: active ? '#10b981' : '#94a3b8', fontWeight: 600,
                  }}
                >
                  {h.m}m
                </button>
              )
            })}
          </span>
        </PanelField>
      </PanelSection>
    </PanelShell>
  )
}

export default CameraPanel
