import React from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import WallPanel from './WallPanel'
import APPanel from './APPanel'
import ScopePanel from './ScopePanel'
import FloorHolePanel from './FloorHolePanel'
import './PanelRight.sass'

function PanelRight() {
  const selectedId   = useEditorStore((s) => s.selectedId)
  const selectedType = useEditorStore((s) => s.selectedType)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)

  const isOpen = !!selectedId

  return (
    <aside className={`panel-right${isOpen ? ' panel-right--open' : ''}`}>
      {selectedType === 'wall' && activeFloorId && (
        <WallPanel floorId={activeFloorId} wallId={selectedId} />
      )}
      {selectedType === 'ap' && activeFloorId && (
        <APPanel floorId={activeFloorId} apId={selectedId} />
      )}
      {selectedType === 'scope' && activeFloorId && (
        <ScopePanel floorId={activeFloorId} zoneId={selectedId} />
      )}
      {selectedType === 'floor_hole' && activeFloorId && (
        <FloorHolePanel floorId={activeFloorId} holeId={selectedId} />
      )}
    </aside>
  )
}

export default PanelRight
