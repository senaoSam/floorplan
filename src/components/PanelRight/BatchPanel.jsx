import React from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { PanelShell, PanelHeader, PanelSection, PanelField } from './_shared/PanelShell'
import './_shared/shared.sass'

// Minimal batch-selection panel — counts selected objects by type. The
// full oldSrc BatchPanel (637 LoC, with per-type bulk-edit forms) is
// deferred until per-store batch-mutation actions land.

function BatchPanel() {
  const selectedItems = useEditorStore((s) => s.selectedItems)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  const counts = selectedItems.reduce((acc, it) => {
    acc[it.type] = (acc[it.type] ?? 0) + 1
    return acc
  }, {})

  return (
    <PanelShell accent="batch">
      <PanelHeader
        title={`批次選取 (${selectedItems.length})`}
        meta="多物件批次"
        onDelete={clearSelected}
        deleteLabel="清除選取"
      />
      <PanelSection title="物件統計">
        {Object.entries(counts).map(([type, n]) => (
          <PanelField key={type} label={type}>
            {n}
          </PanelField>
        ))}
      </PanelSection>
      <PanelSection title="批次操作">
        <div style={{ fontSize: 11, color: 'var(--text-secondary, #94a3b8)' }}>
          批次編輯（材質 / 頻段 / 通道）將在 batch-mutation actions 落地後補回。
        </div>
      </PanelSection>
    </PanelShell>
  )
}

export default BatchPanel
