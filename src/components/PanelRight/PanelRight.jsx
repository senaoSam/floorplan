import React from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import WallPanel from './WallPanel'
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
    </aside>
  )
}

export default PanelRight
