import React from 'react'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import { PanelShell, PanelHeader, PanelSection, PanelField } from './_shared/PanelShell'
import { Select } from './_shared/PanelControls'
import './_shared/shared.sass'

function FloorHolePanel({ floorId, holeId }) {
  const hole        = useFloorHoleStore((s) => (s.floorHolesByFloor[floorId] ?? []).find((h) => h.id === holeId))
  const removeFloorHole = useFloorHoleStore((s) => s.removeFloorHole)
  const updateFloorHole = useFloorHoleStore((s) => s.updateFloorHole)
  const floors          = useFloorStore((s) => s.floors)
  const clearSelected   = useEditorStore((s) => s.clearSelected)

  if (!hole) return null

  const handleDelete = () => {
    removeFloorHole(floorId, holeId)
    clearSelected()
  }

  const bottomId = hole.bottomFloorId ?? floorId
  const topId    = hole.topFloorId    ?? floorId

  const fIdx = (id) => floors.findIndex((f) => f.id === id)
  const ownIdx    = fIdx(floorId)
  const bottomIdx = fIdx(bottomId)
  const topIdx    = fIdx(topId)

  // Keep ordering sane: bottom must not exceed top. Re-adjust the other end
  // when the user picks a value that would invert the range.
  const setBottom = (id) => {
    const newBottomIdx = fIdx(id)
    const newTopId = newBottomIdx > topIdx ? id : topId
    updateFloorHole(floorId, holeId, { bottomFloorId: id, topFloorId: newTopId })
  }
  const setTop = (id) => {
    const newTopIdx = fIdx(id)
    const newBottomId = newTopIdx < bottomIdx ? id : bottomId
    updateFloorHole(floorId, holeId, { topFloorId: id, bottomFloorId: newBottomId })
  }

  const spanCount = Math.abs(topIdx - bottomIdx) + 1
  const floorOptions = floors.map((f) => ({ value: f.id, label: f.name ?? f.id }))

  return (
    <PanelShell accent="floor_hole">
      <PanelHeader
        title={hole.name ?? 'Floor Hole'}
        meta="中庭區域，信號可跨樓層穿透"
        onDelete={handleDelete}
      />

      <PanelSection title="幾何">
        <PanelField label="頂點數">{hole.points.length / 2}</PanelField>
      </PanelSection>

      <PanelSection title="垂直延伸範圍">
        <PanelField label="底" hint={`底層所在樓層`}>
          <Select value={bottomId} onChange={setBottom} options={floorOptions} />
        </PanelField>
        <PanelField label="頂" hint={`頂層所在樓層`}>
          <Select value={topId} onChange={setTop} options={floorOptions} />
        </PanelField>
        <div style={{ fontSize: 11, color: 'var(--text-secondary, #94a3b8)' }}>
          {spanCount <= 1
            ? '僅本樓層生效'
            : `貫穿 ${spanCount} 層（此層 = ${floors[ownIdx]?.name ?? ''}）`}
        </div>
      </PanelSection>
    </PanelShell>
  )
}

export default FloorHolePanel
