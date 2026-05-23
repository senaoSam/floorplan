import React from 'react'
import { useScopeStore } from '@/store/useScopeStore'
import { useEditorStore } from '@/store/useEditorStore'
import { PanelShell, PanelHeader, PanelSection, PanelField } from './_shared/PanelShell'
import { Button } from './_shared/PanelControls'
import './_shared/shared.sass'

const TYPE_OPTIONS = [
  { value: 'in',  label: 'In-Scope',     color: '#2ed573' },
  { value: 'out', label: 'Out-of-Scope', color: '#ff4757' },
]

function ScopePanel({ floorId, zoneId }) {
  const zone        = useScopeStore((s) => (s.scopesByFloor[floorId] ?? []).find((z) => z.id === zoneId))
  const updateScope = useScopeStore((s) => s.updateScope)
  const removeScope = useScopeStore((s) => s.removeScope)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  if (!zone) return null

  const handleDelete = () => {
    removeScope(floorId, zoneId)
    clearSelected()
  }

  const current = TYPE_OPTIONS.find((o) => o.value === zone.type) ?? TYPE_OPTIONS[0]

  return (
    <PanelShell accent="scope">
      <PanelHeader
        title={zone.name ?? '範圍'}
        meta={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: current.color }} />
          {current.label}
        </span>}
        onDelete={handleDelete}
      />

      <PanelSection title="類型">
        <div style={{ display: 'flex', gap: 6 }}>
          {TYPE_OPTIONS.map((o) => (
            <Button
              key={o.value}
              variant={zone.type === o.value ? 'primary' : 'default'}
              onClick={() => updateScope(floorId, zoneId, { type: o.value })}
              className="pnl-btn--block"
            >
              {o.label}
            </Button>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="幾何">
        <PanelField label="頂點數">
          {zone.points.length / 2}
        </PanelField>
      </PanelSection>
    </PanelShell>
  )
}

export default ScopePanel
