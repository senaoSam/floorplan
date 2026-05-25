import React, { useCallback } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { PanelShell, PanelHeader, PanelSection, PanelField } from './_shared/PanelShell'
import { NumberInput, Button } from './_shared/PanelControls'
import './_shared/shared.sass'
import './FloorImagePanel.sass'

function FloorImagePanel({ floorId }) {
  const floor = useFloorStore((s) => s.floors.find((f) => f.id === floorId))
  const updateFloor = useFloorStore((s) => s.updateFloor)
  const clearSelected = useEditorStore((s) => s.clearSelected)
  const editorMode = useEditorStore((s) => s.editorMode)
  const setEditorMode = useEditorStore((s) => s.setEditorMode)

  const rotation = floor?.rotation ?? 0
  const opacity = floor?.opacity ?? 1

  const setRotation = useCallback((deg) => {
    const normalized = ((deg % 360) + 360) % 360
    updateFloor(floorId, { rotation: normalized })
  }, [floorId, updateFloor])

  const handleOpacityChange = useCallback((val) => {
    if (!isNaN(val)) updateFloor(floorId, { opacity: Math.min(1, Math.max(0, val)) })
  }, [floorId, updateFloor])

  if (!floor) return null

  const isCropping = editorMode === EDITOR_MODE.CROP_IMAGE
  const hasCrop = floor.cropX != null

  return (
    <PanelShell accent="floor_image">
      <PanelHeader title="平面圖屬性" meta={floor.name} />

      {/* 旋轉控制 */}
      <PanelSection title="旋轉角度">
        <div style={{ display: 'flex', gap: 6 }}>
          <Button onClick={() => setRotation(rotation - 90)} className="pnl-btn--block">
            ↺ −90°
          </Button>
          <Button onClick={() => setRotation(rotation + 90)} className="pnl-btn--block">
            ↻ +90°
          </Button>
        </div>

        <div className="floor-image-panel__angle-row">
          <NumberInput
            value={rotation}
            min={0}
            max={359}
            step={1}
            unit="°"
            width={60}
            onChange={(v) => { if (!isNaN(v)) setRotation(v) }}
            onBlur={(e) => {
              if (e.target.value === '' || isNaN(parseFloat(e.target.value))) {
                updateFloor(floorId, { rotation: 0 })
              }
            }}
          />
          <input
            type="range"
            className="floor-image-panel__angle-slider"
            value={rotation}
            onChange={(e) => setRotation(parseFloat(e.target.value))}
            min={0}
            max={359}
            step={1}
          />
        </div>

        <div className="floor-image-panel__presets">
          {[0, 90, 180, 270].map((deg) => (
            <Button
              key={deg}
              variant={rotation === deg ? 'primary' : 'default'}
              onClick={() => setRotation(deg)}
            >
              {deg}°
            </Button>
          ))}
        </div>
      </PanelSection>

      {/* 透明度控制 */}
      <PanelSection title="透明度">
        <div className="floor-image-panel__opacity-row">
          <input
            type="range"
            className="floor-image-panel__angle-slider"
            value={opacity}
            onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
            min={0}
            max={1}
            step={0.05}
          />
          <span className="floor-image-panel__opacity-value">
            {Math.round(opacity * 100)}%
          </span>
        </div>
        <div className="floor-image-panel__presets">
          {[0.25, 0.5, 0.75, 1].map((val) => (
            <Button
              key={val}
              variant={opacity === val ? 'primary' : 'default'}
              onClick={() => updateFloor(floorId, { opacity: val })}
            >
              {Math.round(val * 100)}%
            </Button>
          ))}
        </div>
      </PanelSection>

      {/* 裁切控制 */}
      <PanelSection title="裁切區域">
        {hasCrop ? (
          <>
            <PanelField label="位置">
              X {Math.round(floor.cropX)} · Y {Math.round(floor.cropY)}
            </PanelField>
            <PanelField label="大小">
              W {Math.round(floor.cropWidth)} · H {Math.round(floor.cropHeight)}
            </PanelField>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                variant={isCropping ? 'primary' : 'default'}
                onClick={() => setEditorMode(EDITOR_MODE.CROP_IMAGE)}
                className="pnl-btn--block"
              >
                重新裁切
              </Button>
              <Button
                onClick={() => updateFloor(floorId, {
                  cropX: null, cropY: null, cropWidth: null, cropHeight: null,
                })}
                className="pnl-btn--block"
              >
                清除裁切
              </Button>
            </div>
          </>
        ) : (
          <Button
            variant={isCropping ? 'primary' : 'default'}
            onClick={() => setEditorMode(EDITOR_MODE.CROP_IMAGE)}
            block
          >
            ✂ 開始裁切
          </Button>
        )}
      </PanelSection>

      <PanelSection>
        <Button variant="ghost" onClick={clearSelected} block>
          關閉面板
        </Button>
      </PanelSection>
    </PanelShell>
  )
}

export default FloorImagePanel
