import React from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import WallPanel from './WallPanel'
import APPanel from './APPanel'
import ScopePanel from './ScopePanel'
import FloorHolePanel from './FloorHolePanel'
import FloorImagePanel from './FloorImagePanel'
import AlignFloorPanel from './AlignFloorPanel'
import BatchPanel from './BatchPanel'
import './PanelRight.sass'

function PanelRight() {
  const selectedId     = useEditorStore((s) => s.selectedId)
  const selectedType   = useEditorStore((s) => s.selectedType)
  const selectedItems  = useEditorStore((s) => s.selectedItems)
  const panelCollapsed = useEditorStore((s) => s.panelCollapsed)
  const activeFloorId  = useFloorStore((s) => s.activeFloorId)

  const isBatch = selectedItems.length > 1
  const isOpen  = (!!selectedId || isBatch) && !panelCollapsed

  return (
    <aside className={`panel-right${isOpen ? ' panel-right--open' : ''}`}>
      {isBatch && activeFloorId && (
        <BatchPanel />
      )}
      {/* [SELECTABLE-TYPE] 新增可選取物件類型 → 在此加一個單選面板分支 */}
      {!isBatch && selectedType === 'wall' && activeFloorId && (
        <WallPanel floorId={activeFloorId} wallId={selectedId} />
      )}
      {!isBatch && selectedType === 'ap' && activeFloorId && (
        <APPanel floorId={activeFloorId} apId={selectedId} />
      )}
      {!isBatch && selectedType === 'scope' && activeFloorId && (
        <ScopePanel floorId={activeFloorId} zoneId={selectedId} />
      )}
      {!isBatch && selectedType === 'floor_hole' && activeFloorId && (
        <FloorHolePanel floorId={activeFloorId} holeId={selectedId} />
      )}
      {!isBatch && selectedType === 'floor_image' && activeFloorId && (
        <FloorImagePanel floorId={activeFloorId} />
      )}
      {!isBatch && selectedType === 'floor_align' && activeFloorId && (
        <AlignFloorPanel floorId={activeFloorId} />
      )}
    </aside>
  )
}

export default PanelRight
