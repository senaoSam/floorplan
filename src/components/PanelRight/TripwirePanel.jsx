import React, { useMemo } from 'react'
import { useCameraStore } from '@/store/useCameraStore'
import { useTrackingStore } from '@/store/useTrackingStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import { computeTripwireCounts } from '@/features/cameras/analyticsStats'
import { formatClock } from '@/features/cameras/mockTracks'
import { PanelShell, PanelHeader, PanelSection, PanelField } from './_shared/PanelShell'
import { TextInput } from './_shared/PanelControls'
import './_shared/shared.sass'

// Counting-line panel (Phase 34-5 ②). Shows directional crossing counts for
// the shared analysis window (same as the occupancy heatmap's selects).

function TripwirePanel({ floorId, tripwireId }) {
  const tripwire = useCameraStore((s) => (s.tripwiresByFloor[floorId] ?? []).find((t) => t.id === tripwireId))
  const updateTripwire = useCameraStore((s) => s.updateTripwire)
  const removeTripwire = useCameraStore((s) => s.removeTripwire)
  const clearSelected = useEditorStore((s) => s.clearSelected)
  const tracks = useTrackingStore((s) => s.tracksByFloor[floorId])
  const fromSec = useTrackingStore((s) => s.occupancyFromSec)
  const toSec = useTrackingStore((s) => s.occupancyToSec)
  const floor = useFloorStore((s) => s.floors.find((f) => f.id === floorId))

  const counts = useMemo(
    () => (tripwire ? computeTripwireCounts(tripwire, tracks ?? [], fromSec, toSec) : null),
    [tripwire, tracks, fromSec, toSec],
  )

  if (!tripwire) return null

  const lengthM = floor?.scale
    ? Math.hypot(tripwire.x2 - tripwire.x1, tripwire.y2 - tripwire.y1) / floor.scale
    : null

  return (
    <PanelShell accent="camera">
      <PanelHeader
        title={tripwire.name}
        meta={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f472b6' }} />
            計數線
          </span>
        }
        onDelete={() => { removeTripwire(floorId, tripwireId); clearSelected() }}
      />

      <PanelSection title="識別">
        <PanelField label="名稱">
          <TextInput value={tripwire.name} onChange={(v) => updateTripwire(floorId, tripwireId, { name: v })} />
        </PanelField>
        {lengthM != null && (
          <PanelField label="長度">{lengthM.toFixed(1)} m</PanelField>
        )}
      </PanelSection>

      <PanelSection title={`穿越統計（${formatClock(fromSec)}–${formatClock(toSec)}）`}>
        <PanelField label="方向 A">{counts?.forward ?? 0} 人次</PanelField>
        <PanelField label="方向 B">{counts?.backward ?? 0} 人次</PanelField>
        <PanelField label="總計">{(counts?.forward ?? 0) + (counts?.backward ?? 0)} 人次</PanelField>
        <div className="pnl__field" style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>
          兩個方向對應畫布上線中央的兩個箭頭與數字；統計時段跟著 timeline 的熱圖時段設定
        </div>
      </PanelSection>
    </PanelShell>
  )
}

export default TripwirePanel
