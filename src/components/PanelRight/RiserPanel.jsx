import React from 'react'
import { useCableStore, DEFAULT_RISER_MAGNET_PX } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import { PanelShell, PanelHeader, PanelSection, PanelField } from './_shared/PanelShell'
import { NumberInput, Checkbox } from './_shared/PanelControls'
import './_shared/shared.sass'

// Riser editing — floorIds is the core knob: the user picks which floors the
// riser actually serves. xy is global, so editing xy here would apply across
// every floor in floorIds. We surface it read-only (drag on canvas to move).
function RiserPanel({ riserId }) {
  const riser         = useCableStore((s) => s.risers.find((r) => r.id === riserId))
  const updateRiser   = useCableStore((s) => s.updateRiser)
  const removeRiser   = useCableStore((s) => s.removeRiser)
  const floors        = useFloorStore((s) => s.floors)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  if (!riser) return null

  const handleDelete = () => {
    removeRiser(riserId)
    clearSelected()
  }

  const handleToggleFloor = (floorId) => {
    const current = riser.floorIds ?? []
    const next = current.includes(floorId)
      ? current.filter((id) => id !== floorId)
      : [...current, floorId]
    updateRiser(riserId, { floorIds: next })
  }

  const magnet = riser.magnetDistance ?? DEFAULT_RISER_MAGNET_PX
  const sortedFloors = [...floors].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0))
  const floorSet = new Set(riser.floorIds ?? [])

  return (
    <PanelShell accent="cable_riser">
      <PanelHeader title={riser.name} onDelete={handleDelete} />

      <PanelSection title="幾何">
        <PanelField label="X (canvas px)">{Math.round(riser.x)}</PanelField>
        <PanelField label="Y (canvas px)">{Math.round(riser.y)}</PanelField>
        <div style={{ fontSize: 11, color: 'var(--text-secondary, #94a3b8)' }}>
          拖曳 riser 圖示可移動；xy 跨樓層共用
        </div>
      </PanelSection>

      <PanelSection title="跨越樓層">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {sortedFloors.map((f) => (
            <Checkbox
              key={f.id}
              checked={floorSet.has(f.id)}
              onChange={() => handleToggleFloor(f.id)}
              label={
                f.elevation != null
                  ? `${f.name ?? f.id}（${f.elevation.toFixed(1)} m）`
                  : (f.name ?? f.id)
              }
            />
          ))}
        </div>
        {floorSet.size === 0 ? (
          <div style={{ fontSize: 11, color: '#ef4444' }}>
            ⚠ 沒有選擇任何樓層 → riser 在 2D 不會顯示
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-secondary, #94a3b8)' }}>
            共 {floorSet.size} 層
          </div>
        )}
      </PanelSection>

      <PanelSection title="磁吸設定">
        <PanelField label="磁吸範圍">
          <NumberInput
            value={magnet}
            min={1}
            step={10}
            unit="px"
            width={80}
            onChange={(v) => { if (!isNaN(v) && v >= 1) updateRiser(riserId, { magnetDistance: v }) }}
          />
        </PanelField>
        <div style={{ fontSize: 11, color: 'var(--text-secondary, #94a3b8)' }}>
          Riser 是 hub：每樓層所有 magnet 內 tray 都會接過去（12-3b graph 用）
        </div>
      </PanelSection>
    </PanelShell>
  )
}

export default RiserPanel
