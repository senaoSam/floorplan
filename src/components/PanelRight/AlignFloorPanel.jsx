import React, { useCallback, useEffect } from 'react'
import { useFloorStore, getAlignAnchorId } from '@/store/useFloorStore'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { getFloorColor } from '@/utils/floorColor'
import './AlignFloorPanel.sass'

// Right-panel UI for ALIGN_FLOOR mode. Ported 1:1 from oldSrc
// PanelRight/AlignFloorPanel.jsx — same fields, same actions, same
// "完成" button to exit back to SELECT.
function AlignFloorPanel({ floorId }) {
  const floor               = useFloorStore((s) => s.floors.find((f) => f.id === floorId))
  const floors              = useFloorStore((s) => s.floors)
  const anchorFloorId       = useFloorStore(getAlignAnchorId)
  const setAlignTransform   = useFloorStore((s) => s.setAlignTransform)
  const resetAlignTransform = useFloorStore((s) => s.resetAlignTransform)
  const setEditorMode       = useEditorStore((s) => s.setEditorMode)
  const clearSelected       = useEditorStore((s) => s.clearSelected)
  const alignRefFloors      = useEditorStore((s) => s.alignRefFloors)
  const alignRefOpacity     = useEditorStore((s) => s.alignRefOpacity)
  const setAlignRefFloors   = useEditorStore((s) => s.setAlignRefFloors)
  const toggleAlignRefFloor = useEditorStore((s) => s.toggleAlignRefFloor)
  const setAlignRefOpacity  = useEditorStore((s) => s.setAlignRefOpacity)

  // Seed reference list on first entry to align mode: default to all
  // other floors visible.
  useEffect(() => {
    if (alignRefFloors === null) {
      setAlignRefFloors(floors.filter((f) => f.id !== floorId).map((f) => f.id))
    }
  }, [alignRefFloors, floors, floorId, setAlignRefFloors])

  const onExit = useCallback(() => {
    setEditorMode(EDITOR_MODE.SELECT)
    clearSelected()
  }, [setEditorMode, clearSelected])

  if (!floor) return null

  const ox = floor.alignOffsetX ?? 0
  const oy = floor.alignOffsetY ?? 0
  const s  = floor.alignScale   ?? 1
  const r  = floor.alignRotation ?? 0

  const otherFloors = floors.filter((f) => f.id !== floorId)
  const refIds = alignRefFloors ?? []

  const patch = (p) => setAlignTransform(floorId, p)

  // Alignment is defined in meter space — floors participating without a
  // calibrated scale fall back to raw-px overlay sizing, which can misstate
  // relative building size when image resolutions differ.
  const uncalibrated = [floor, ...otherFloors.filter((f) => refIds.includes(f.id))]
    .filter((f) => !f.scale)

  // Offset sliders cover the whole image regardless of resolution — a fixed
  // ±1000 px range only spans a fraction of a large scan.
  const offsetRange = Math.max(1000, Math.round(Math.max(floor.imageWidth ?? 0, floor.imageHeight ?? 0)))

  return (
    <div className="align-floor-panel">
      <div className="align-floor-panel__header">
        <span className="align-floor-panel__title">樓層對齊</span>
        <span className="align-floor-panel__meta">{floor.name}</span>
      </div>

      <div className="align-floor-panel__intro">
        調整本樓層相對於其他樓層的位置。勾選參考樓層以半透明疊影顯示輔助對齊。
        左鍵拖曳畫布移動本樓層；右鍵拖曳（或空白鍵＋左鍵、滑鼠中鍵）平移視角。
      </div>

      {floorId === anchorFloorId && (
        <div className="align-floor-panel__warn">
          📌 本樓層是對齊基準：其他樓層都以它為參考，移動它會讓整棟一起偏移。建議按「完成」離開，改對齊其他樓層。
        </div>
      )}

      {uncalibrated.length > 0 && (
        <div className="align-floor-panel__warn">
          ⚠️ {uncalibrated.map((f) => f.name).join('、')} 尚未校正比例尺：疊影以原始像素大小顯示，可能與實際比例不符。建議先用比例尺工具校正各樓層，不同解析度的圖會自動等大，通常只需位移＋旋轉即可對齊。
        </div>
      )}

      {/* 參考樓層疊影 */}
      <section className="align-floor-panel__section">
        <p className="align-floor-panel__label">參考樓層疊影</p>
        {otherFloors.length === 0 ? (
          <div className="align-floor-panel__hint">（無其他樓層可疊影對照）</div>
        ) : (
          <>
            <div className="align-floor-panel__ref-list">
              {otherFloors.map((f) => {
                const idx = floors.findIndex((x) => x.id === f.id)
                const color = getFloorColor(idx)
                return (
                  <label key={f.id} className="align-floor-panel__ref-item">
                    <input
                      type="checkbox"
                      checked={refIds.includes(f.id)}
                      onChange={() => toggleAlignRefFloor(f.id)}
                    />
                    <span className="align-floor-panel__ref-swatch" style={{ background: color }} />
                    <span>
                      {f.name}
                      {f.id === anchorFloorId && (
                        <span className="align-floor-panel__ref-anchor" title="對齊基準樓層">📌</span>
                      )}
                    </span>
                  </label>
                )
              })}
            </div>
            <div className="align-floor-panel__row">
              <span className="align-floor-panel__axis">不透明度</span>
              <input
                type="number"
                className="align-floor-panel__num"
                value={alignRefOpacity.toFixed(2)}
                min={0.05}
                max={1}
                step={0.05}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v)) setAlignRefOpacity(Math.max(0.05, Math.min(1, v)))
                }}
              />
              <input
                type="range"
                className="align-floor-panel__slider"
                value={alignRefOpacity}
                min={0.05} max={1} step={0.05}
                onChange={(e) => setAlignRefOpacity(parseFloat(e.target.value))}
              />
            </div>

            {refIds.length > 0 && (
              // [REF-OVERLAY-TYPE] adding a new overlayed object type → also
              // update the legend here and the refOverlay layer renderer.
              <div className="align-floor-panel__legend">
                <div className="align-floor-panel__legend-title">疊影元素</div>
                <div className="align-floor-panel__legend-grid">
                  <span className="align-floor-panel__legend-swatch align-floor-panel__legend-swatch--image" />
                  <span>平面圖</span>
                  <span className="align-floor-panel__legend-swatch align-floor-panel__legend-swatch--wall" />
                  <span>牆體（實線）</span>
                  <span className="align-floor-panel__legend-swatch align-floor-panel__legend-swatch--scope" />
                  <span>範圍（虛線）</span>
                  <span className="align-floor-panel__legend-swatch align-floor-panel__legend-swatch--hole" />
                  <span>中庭（實線框）</span>
                  <span className="align-floor-panel__legend-swatch align-floor-panel__legend-swatch--ap" />
                  <span>AP（圈點）</span>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* 偏移 */}
      <section className="align-floor-panel__section">
        <p className="align-floor-panel__label">偏移量（canvas px）</p>
        <div className="align-floor-panel__row">
          <span className="align-floor-panel__axis">X</span>
          <input
            type="number"
            className="align-floor-panel__num"
            value={Math.round(ox)}
            step={1}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) patch({ alignOffsetX: v }) }}
          />
          <input
            type="range"
            className="align-floor-panel__slider"
            value={ox}
            min={-offsetRange} max={offsetRange} step={1}
            onChange={(e) => patch({ alignOffsetX: parseFloat(e.target.value) })}
          />
        </div>
        <div className="align-floor-panel__row">
          <span className="align-floor-panel__axis">Y</span>
          <input
            type="number"
            className="align-floor-panel__num"
            value={Math.round(oy)}
            step={1}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) patch({ alignOffsetY: v }) }}
          />
          <input
            type="range"
            className="align-floor-panel__slider"
            value={oy}
            min={-offsetRange} max={offsetRange} step={1}
            onChange={(e) => patch({ alignOffsetY: parseFloat(e.target.value) })}
          />
        </div>
      </section>

      {/* 縮放 */}
      <section className="align-floor-panel__section">
        <p className="align-floor-panel__label">縮放倍率</p>
        <div className="align-floor-panel__row">
          <input
            type="number"
            className="align-floor-panel__num"
            value={s.toFixed(3)}
            step={0.01}
            min={0.1}
            max={5}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) patch({ alignScale: Math.max(0.1, Math.min(5, v)) }) }}
          />
          <input
            type="range"
            className="align-floor-panel__slider"
            value={s}
            min={0.25} max={4} step={0.01}
            onChange={(e) => patch({ alignScale: parseFloat(e.target.value) })}
          />
        </div>
        <div className="align-floor-panel__hint">
          已校正比例尺的樓層通常維持 1（僅用於修正圖紙本身的比例誤差）
        </div>
      </section>

      {/* 旋轉 */}
      <section className="align-floor-panel__section">
        <p className="align-floor-panel__label">旋轉角度</p>
        <div className="align-floor-panel__row">
          <input
            type="number"
            className="align-floor-panel__num"
            value={Math.round(r * 100) / 100}
            step={0.1}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) patch({ alignRotation: v }) }}
          />
          <span className="align-floor-panel__unit">°</span>
          <input
            type="range"
            className="align-floor-panel__slider"
            value={r}
            min={-180} max={180} step={0.1}
            onChange={(e) => patch({ alignRotation: parseFloat(e.target.value) })}
          />
        </div>
      </section>

      <div className="align-floor-panel__actions">
        <button className="align-floor-panel__btn align-floor-panel__btn--ghost" onClick={() => resetAlignTransform(floorId)}>
          重置
        </button>
        <button className="align-floor-panel__btn align-floor-panel__btn--primary" onClick={onExit}>
          完成
        </button>
      </div>
    </div>
  )
}

export default AlignFloorPanel
