import React, { useCallback } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import './AlignFloorPanel.sass'

function AlignFloorPanel({ floorId }) {
  const floor               = useFloorStore((s) => s.floors.find((f) => f.id === floorId))
  const floors              = useFloorStore((s) => s.floors)
  const setAlignTransform   = useFloorStore((s) => s.setAlignTransform)
  const resetAlignTransform = useFloorStore((s) => s.resetAlignTransform)
  const setEditorMode       = useEditorStore((s) => s.setEditorMode)
  const clearSelected       = useEditorStore((s) => s.clearSelected)

  const onExit = useCallback(() => {
    setEditorMode(EDITOR_MODE.SELECT)
    clearSelected()
  }, [setEditorMode, clearSelected])

  if (!floor) return null

  const ox = floor.alignOffsetX ?? 0
  const oy = floor.alignOffsetY ?? 0
  const s  = floor.alignScale   ?? 1
  const r  = floor.alignRotation ?? 0

  const idx         = floors.findIndex((f) => f.id === floorId)
  const refFloor    = idx > 0 ? floors[idx - 1] : (floors.length > 1 ? floors[idx + 1] : null)
  const refFloorHint = refFloor ? `${refFloor.name}（半透明疊影）` : '（無其他樓層可疊影對照）'

  const patch = (p) => setAlignTransform(floorId, p)

  return (
    <div className="align-floor-panel">
      <div className="align-floor-panel__header">
        <span className="align-floor-panel__title">樓層對齊</span>
        <span className="align-floor-panel__meta">{floor.name}</span>
      </div>

      <div className="align-floor-panel__intro">
        調整本樓層相對於其他樓層的位置。參考樓層：{refFloorHint}
      </div>

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
            min={-1000} max={1000} step={1}
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
            min={-1000} max={1000} step={1}
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
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) patch({ alignScale: v }) }}
          />
          <input
            type="range"
            className="align-floor-panel__slider"
            value={s}
            min={0.25} max={4} step={0.01}
            onChange={(e) => patch({ alignScale: parseFloat(e.target.value) })}
          />
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
