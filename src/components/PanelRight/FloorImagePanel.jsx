import React, { useCallback } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import './FloorImagePanel.sass'

function FloorImagePanel({ floorId }) {
  const floor = useFloorStore((s) => s.floors.find((f) => f.id === floorId))
  const updateFloor = useFloorStore((s) => s.updateFloor)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  const rotation = floor?.rotation ?? 0

  const setRotation = useCallback((deg) => {
    // normalize to 0..359
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

      <button className="floor-image-panel__close" onClick={clearSelected}>
        關閉面板
      </button>
    </div>
  )
}

export default FloorImagePanel
