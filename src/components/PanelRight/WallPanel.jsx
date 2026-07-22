import React, { useCallback } from 'react'
import { useWallStore } from '@/store/useWallStore'
import { useEditorStore } from '@/store/useEditorStore'
import { MATERIAL_LIST, OPENING_TYPES, getMaterialById } from '@/constants/materials'
import { PanelShell, PanelHeader, PanelSection, PanelField } from './_shared/PanelShell'
import { NumberInput, Select, Button } from './_shared/PanelControls'
import './_shared/shared.sass'
import './WallPanel.sass'

// Wall property panel — Identity / Material / Geometry / Openings.
// The materials list and openings rows are bespoke layouts; everything else
// uses the shared primitives.
function WallPanel({ floorId, wallId }) {
  // 直接訂閱 wall 資料，store 更新時才會觸發 re-render
  const wall       = useWallStore((s) => (s.wallsByFloor[floorId] ?? []).find((w) => w.id === wallId))
  const updateWall = useWallStore((s) => s.updateWall)
  const removeWall = useWallStore((s) => s.removeWall)
  const updateOpening = useWallStore((s) => s.updateOpening)
  const removeOpening = useWallStore((s) => s.removeOpening)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  const handleMaterial = useCallback((mat) => {
    updateWall(floorId, wallId, { material: mat })
  }, [floorId, wallId, updateWall])

  // 47-11 — per-wall custom dB override (2.4 GHz anchor). Clearing the input
  // (NaN) removes the override; material lossB / reflection / color stay.
  const handleCustomDb = useCallback((v) => {
    if (isNaN(v)) { updateWall(floorId, wallId, { customDb: null }); return }
    if (v >= 0) updateWall(floorId, wallId, { customDb: v })
  }, [floorId, wallId, updateWall])

  const handleHeight = useCallback((field, value) => {
    if (!isNaN(value) && value >= 0) updateWall(floorId, wallId, { [field]: value })
  }, [floorId, wallId, updateWall])

  const handleDelete = () => {
    removeWall(floorId, wallId)
    clearSelected()
  }

  if (!wall) return null

  const len = Math.hypot(wall.endX - wall.startX, wall.endY - wall.startY).toFixed(1)

  return (
    <PanelShell accent="wall">
      <PanelHeader
        title={wall.name ?? '牆體屬性'}
        meta={`長度 ${len} px`}
        onDelete={handleDelete}
      />

      <PanelSection title="材質">
        <div className="wall-panel__materials">
          {MATERIAL_LIST.map((mat) => {
            const isActive = wall.material.id === mat.id
            return (
              <button
                key={mat.id}
                className={`wall-panel__mat-btn${isActive ? ' wall-panel__mat-btn--active' : ''}`}
                onClick={() => handleMaterial(mat)}
                title={`${mat.label}（${mat.dbLoss} dB）`}
              >
                <span
                  className="wall-panel__mat-color"
                  style={{ background: mat.color }}
                />
                <span className="wall-panel__mat-name">{mat.label}</span>
                <span className="wall-panel__mat-db">{mat.dbLoss} dB</span>
              </button>
            )
          })}
        </div>
        <PanelField
          label="自訂衰減"
          hint={wall.customDb != null
            ? `覆寫中：${wall.material.label} ${wall.material.dbLoss} dB → ${wall.customDb} dB（@2.4GHz）`
            : '留空＝用材質值；輸入即覆寫此面牆 @2.4GHz 衰減'}
        >
          <NumberInput
            value={wall.customDb ?? null}
            min={0}
            step={1}
            unit="dB"
            width={70}
            placeholder={String(wall.material.dbLoss)}
            onChange={handleCustomDb}
          />
        </PanelField>
      </PanelSection>

      <PanelSection title="高度">
        <PanelField label="頂部">
          <NumberInput
            value={wall.topHeight}
            min={0}
            step={0.1}
            unit="m"
            width={70}
            onChange={(v) => handleHeight('topHeight', v)}
          />
        </PanelField>
        <PanelField label="底部">
          <NumberInput
            value={wall.bottomHeight}
            min={0}
            step={0.1}
            unit="m"
            width={70}
            onChange={(v) => handleHeight('bottomHeight', v)}
          />
        </PanelField>
      </PanelSection>

      {(wall.openings ?? []).length > 0 && (
        <PanelSection title="門窗">
          <div className="wall-panel__openings">
            {wall.openings.map((op) => {
              const ot = OPENING_TYPES[op.type === 'window' ? 'WINDOW' : 'DOOR']
              const handleFracChange = (field, raw) => {
                if (isNaN(raw)) return
                const frac = Math.max(0, Math.min(100, raw)) / 100
                const newStart = field === 'startFrac' ? frac : op.startFrac
                const newEnd   = field === 'endFrac'   ? frac : op.endFrac
                if (newStart >= newEnd) return
                // Skip if it would overlap another opening on the same wall.
                const others = wall.openings.filter((o) => o.id !== op.id)
                const overlaps = others.some((o) => newStart < o.endFrac && newEnd > o.startFrac)
                if (overlaps) return
                updateOpening(floorId, wallId, op.id, { [field]: frac })
              }
              const handleTypeToggle = () => {
                const newType = op.type === 'door' ? 'window' : 'door'
                const newOt = OPENING_TYPES[newType === 'window' ? 'WINDOW' : 'DOOR']
                const defaultMat = getMaterialById(newOt.defaultMaterial)
                updateOpening(floorId, wallId, op.id, { type: newType, material: defaultMat })
              }
              return (
                <div key={op.id} className="wall-panel__opening-item">
                  <button
                    className="wall-panel__opening-type-btn"
                    style={{ background: ot.color }}
                    onClick={handleTypeToggle}
                    title={`點擊切換為${op.type === 'door' ? '窗' : '門'}`}
                  >
                    {ot.label}
                  </button>
                  <Select
                    value={op.material?.id ?? ''}
                    onChange={(matId) => updateOpening(floorId, wallId, op.id, { material: getMaterialById(matId) })}
                    options={MATERIAL_LIST.map((m) => ({ value: m.id, label: `${m.label} (${m.dbLoss} dB)` }))}
                    className="wall-panel__opening-mat-select"
                  />
                  <div className="wall-panel__opening-inputs">
                    <NumberInput
                      value={Math.round(op.startFrac * 100)}
                      min={0}
                      max={100}
                      step={1}
                      width={42}
                      onChange={(v) => handleFracChange('startFrac', v)}
                    />
                    <span className="wall-panel__opening-sep">~</span>
                    <NumberInput
                      value={Math.round(op.endFrac * 100)}
                      min={0}
                      max={100}
                      step={1}
                      width={42}
                      onChange={(v) => handleFracChange('endFrac', v)}
                    />
                    <span className="wall-panel__opening-pct">%</span>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => removeOpening(floorId, wallId, op.id)}
                    className="wall-panel__opening-del"
                  >
                    ×
                  </Button>
                </div>
              )
            })}
          </div>
        </PanelSection>
      )}
    </PanelShell>
  )
}

export default WallPanel
