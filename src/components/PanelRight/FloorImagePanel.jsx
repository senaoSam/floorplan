import React, { useCallback } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { MATERIAL_LIST, FLOOR_SLAB_DEFAULT_DB, DEFAULT_FLOOR_SLAB_MATERIAL_ID, DEFAULT_FLOOR_SLAB_DB } from '@/constants/materials'
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

  const handleInputChange = useCallback((e) => {
    const val = parseFloat(e.target.value)
    if (!isNaN(val)) setRotation(val)
  }, [setRotation])

  const handleInputBlur = useCallback((e) => {
    const val = parseFloat(e.target.value)
    if (isNaN(val)) updateFloor(floorId, { rotation: 0 })
  }, [floorId, updateFloor])

  const handleOpacityChange = useCallback((e) => {
    const val = parseFloat(e.target.value)
    if (!isNaN(val)) updateFloor(floorId, { opacity: Math.min(1, Math.max(0, val)) })
  }, [floorId, updateFloor])

  if (!floor) return null

  return (
    <div className="floor-image-panel">
      <div className="floor-image-panel__header">
        <span className="floor-image-panel__title">平面圖屬性</span>
        <span className="floor-image-panel__meta">{floor.name}</span>
      </div>

      {/* 旋轉控制 */}
      <section className="floor-image-panel__section">
        <p className="floor-image-panel__label">旋轉角度</p>

        {/* 90° 快速按鈕 */}
        <div className="floor-image-panel__rotate-buttons">
          <button
            className="floor-image-panel__rotate-btn"
            onClick={() => setRotation(rotation - 90)}
            title="逆時針 90°"
          >
            ↺ −90°
          </button>
          <button
            className="floor-image-panel__rotate-btn"
            onClick={() => setRotation(rotation + 90)}
            title="順時針 90°"
          >
            ↻ +90°
          </button>
        </div>

        {/* 自由角度輸入 */}
        <div className="floor-image-panel__angle-row">
          <input
            type="number"
            className="floor-image-panel__angle-input"
            value={rotation}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            min={0}
            max={359}
            step={1}
          />
          <span className="floor-image-panel__angle-unit">°</span>
          <input
            type="range"
            className="floor-image-panel__angle-slider"
            value={rotation}
            onChange={handleInputChange}
            min={0}
            max={359}
            step={1}
          />
        </div>

        {/* 預設角度快捷 */}
        <div className="floor-image-panel__presets">
          {[0, 90, 180, 270].map((deg) => (
            <button
              key={deg}
              className={`floor-image-panel__preset-btn${rotation === deg ? ' floor-image-panel__preset-btn--active' : ''}`}
              onClick={() => setRotation(deg)}
            >
              {deg}°
            </button>
          ))}
        </div>
      </section>

      {/* 透明度控制 */}
      <section className="floor-image-panel__section">
        <p className="floor-image-panel__label">透明度</p>
        <div className="floor-image-panel__opacity-row">
          <input
            type="range"
            className="floor-image-panel__angle-slider"
            value={opacity}
            onChange={handleOpacityChange}
            min={0}
            max={1}
            step={0.05}
          />
          <span className="floor-image-panel__opacity-value">{Math.round(opacity * 100)}%</span>
        </div>
        <div className="floor-image-panel__presets">
          {[0.25, 0.5, 0.75, 1].map((val) => (
            <button
              key={val}
              className={`floor-image-panel__preset-btn${opacity === val ? ' floor-image-panel__preset-btn--active' : ''}`}
              onClick={() => updateFloor(floorId, { opacity: val })}
            >
              {Math.round(val * 100)}%
            </button>
          ))}
        </div>
      </section>

      {/* 裁切控制 */}
      <section className="floor-image-panel__section">
        <p className="floor-image-panel__label">裁切區域</p>
        {floor.cropX != null ? (
          <>
            <div className="floor-image-panel__crop-info">
              <span>X: {Math.round(floor.cropX)}</span>
              <span>Y: {Math.round(floor.cropY)}</span>
              <span>W: {Math.round(floor.cropWidth)}</span>
              <span>H: {Math.round(floor.cropHeight)}</span>
            </div>
            <div className="floor-image-panel__rotate-buttons">
              <button
                className={`floor-image-panel__rotate-btn${editorMode === EDITOR_MODE.CROP_IMAGE ? ' floor-image-panel__rotate-btn--active' : ''}`}
                onClick={() => setEditorMode(EDITOR_MODE.CROP_IMAGE)}
              >
                重新裁切
              </button>
              <button
                className="floor-image-panel__rotate-btn"
                onClick={() => updateFloor(floorId, { cropX: null, cropY: null, cropWidth: null, cropHeight: null })}
              >
                清除裁切
              </button>
            </div>
          </>
        ) : (
          <button
            className={`floor-image-panel__rotate-btn floor-image-panel__rotate-btn--full${editorMode === EDITOR_MODE.CROP_IMAGE ? ' floor-image-panel__rotate-btn--active' : ''}`}
            onClick={() => setEditorMode(EDITOR_MODE.CROP_IMAGE)}
          >
            ✂ 開始裁切
          </button>
        )}
      </section>

      {/* 樓板衰減（影響跨樓層訊號穿透，熱圖實作於 9-3b） */}
      <section className="floor-image-panel__section">
        <p className="floor-image-panel__label">樓板衰減</p>
        <div className="floor-image-panel__slab-row">
          <select
            className="floor-image-panel__slab-select"
            value={floor.floorSlabMaterialId ?? DEFAULT_FLOOR_SLAB_MATERIAL_ID}
            onChange={(e) => {
              const matId = e.target.value
              updateFloor(floorId, {
                floorSlabMaterialId: matId,
                floorSlabAttenuationDb: FLOOR_SLAB_DEFAULT_DB[matId] ?? DEFAULT_FLOOR_SLAB_DB,
              })
            }}
          >
            {MATERIAL_LIST.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <input
            type="number"
            className="floor-image-panel__slab-db"
            value={floor.floorSlabAttenuationDb ?? DEFAULT_FLOOR_SLAB_DB}
            min={0}
            max={60}
            step={0.5}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (!isNaN(v)) updateFloor(floorId, { floorSlabAttenuationDb: Math.max(0, Math.min(60, v)) })
            }}
          />
          <span className="floor-image-panel__slab-unit">dB</span>
        </div>
        <p className="floor-image-panel__slab-hint">跨樓層訊號每穿透本樓層樓板會衰減此 dB 值（9-3b 納入熱圖計算）</p>
      </section>

      <button className="floor-image-panel__close" onClick={clearSelected}>
        關閉面板
      </button>
    </div>
  )
}

export default FloorImagePanel
