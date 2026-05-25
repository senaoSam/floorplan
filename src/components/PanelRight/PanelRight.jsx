import React from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import APPanel from './APPanel'
import SwitchPanel from './SwitchPanel'
import CableTrayPanel from './CableTrayPanel'
import WallPanel from './WallPanel'
import './PanelRight.sass'

function PanelRight() {
  const selectedId = useEditorStore((s) => s.selectedId)
  const selectedType = useEditorStore((s) => s.selectedType)
  const selectedItems = useEditorStore((s) => s.selectedItems)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)

  const isBatch = selectedItems.length > 1
  const hasSelection = !!selectedId || isBatch
  const isOpen = hasSelection

  let body = null
  if (!isBatch && activeFloorId) {
    switch (selectedType) {
      case 'ap':
        body = <APPanel floorId={activeFloorId} apId={selectedId} />; break
      case 'switch':
        body = <SwitchPanel floorId={activeFloorId} swId={selectedId} />; break
      case 'cable_tray':
        body = <CableTrayPanel floorId={activeFloorId} trayId={selectedId} />; break
      case 'wall':
        body = <WallPanel floorId={activeFloorId} wallId={selectedId} />; break
      default: body = null
    }
  }

  return (
    <aside className={`panel-right${isOpen ? ' panel-right--open' : ''}`}>
      {body}
      {!body && hasSelection && (
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
