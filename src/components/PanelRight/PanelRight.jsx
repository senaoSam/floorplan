import React from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import APPanel from './APPanel'
import './PanelRight.sass'

// Selection-driven right rail. Each type wires its own panel; selected
// types without a panel yet (wall / switch / tray / scope / hole / …)
// show a placeholder until those land in later bundles.
function PanelRight() {
  const selectedId = useEditorStore((s) => s.selectedId)
  const selectedType = useEditorStore((s) => s.selectedType)
  const selectedItems = useEditorStore((s) => s.selectedItems)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)

  const isBatch = selectedItems.length > 1
  const hasSelection = !!selectedId || isBatch
  const isOpen = hasSelection

  return (
    <aside className={`panel-right${isOpen ? ' panel-right--open' : ''}`}>
      {!isBatch && selectedType === 'ap' && activeFloorId && (
        <APPanel floorId={activeFloorId} apId={selectedId} />
      )}
      {((!isBatch && selectedType && selectedType !== 'ap') || isBatch) && (
        <div className="panel-right__placeholder">
          <div className="panel-right__placeholder-title">
            {isBatch ? '批次選取' : selectedType}
          </div>
          <div className="panel-right__placeholder-hint">
            屬性面板將在 Phase 25 後段隨各 Layer 互動補回
          </div>
        </div>
      )}
    </aside>
  )
}

export default PanelRight
