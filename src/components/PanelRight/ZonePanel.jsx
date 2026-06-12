import React, { useMemo, useState } from 'react'
import { useCameraStore } from '@/store/useCameraStore'
import { useTrackingStore } from '@/store/useTrackingStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useEditorStore } from '@/store/useEditorStore'
import { computeZoneStats } from '@/features/cameras/analyticsStats'
import { formatClock } from '@/features/cameras/mockTracks'
import { PanelShell, PanelHeader, PanelSection, PanelField } from './_shared/PanelShell'
import { TextInput } from './_shared/PanelControls'
import './_shared/shared.sass'

// Analysis-zone panel (Phase 34-5 ③): entries / unique visitors / average
// dwell / peak hour + an hourly presence histogram, over the shared analysis
// window.

const secLabel = (sec) => sec >= 90 ? `${(sec / 60).toFixed(1)} 分` : `${Math.round(sec)} 秒`

function ZonePanel({ floorId, zoneId }) {
  const zone = useCameraStore((s) => (s.zonesByFloor[floorId] ?? []).find((z) => z.id === zoneId))
  const updateZone = useCameraStore((s) => s.updateZone)
  const removeZone = useCameraStore((s) => s.removeZone)
  const clearSelected = useEditorStore((s) => s.clearSelected)
  const tracks = useTrackingStore((s) => s.tracksByFloor[floorId])
  const fromSec = useTrackingStore((s) => s.occupancyFromSec)
  const toSec = useTrackingStore((s) => s.occupancyToSec)
  const floor = useFloorStore((s) => s.floors.find((f) => f.id === floorId))

  const stats = useMemo(
    () => (zone ? computeZoneStats(zone, tracks ?? [], fromSec, toSec) : null),
    [zone, tracks, fromSec, toSec],
  )
  // Hovered histogram bar → readout line under the chart (native title alone
  // is too subtle — user ask).
  const [hoverBar, setHoverBar] = useState(null)   // { hour, sec } | null

  if (!zone || !stats) return null

  const areaM2 = floor?.scale
    ? Math.abs(zone.w * zone.h) / (floor.scale * floor.scale)
    : null
  const maxHourSec = Math.max(1, ...stats.hourly.map((h) => h.sec))

  return (
    <PanelShell accent="camera">
      <PanelHeader
        title={zone.name}
        meta={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fbbf24' }} />
            分析區域
          </span>
        }
        onDelete={() => { removeZone(floorId, zoneId); clearSelected() }}
      />

      <PanelSection title="識別">
        <PanelField label="名稱">
          <TextInput value={zone.name} onChange={(v) => updateZone(floorId, zoneId, { name: v })} />
        </PanelField>
        {areaM2 != null && (
          <PanelField label="面積">{areaM2.toFixed(1)} m²</PanelField>
        )}
      </PanelSection>

      <PanelSection title={`區域統計（${formatClock(fromSec)}–${formatClock(toSec)}）`}>
        <PanelField label="進入次數">{stats.entries} 次</PanelField>
        <PanelField label="不重複人次">{stats.uniqueTracks} 人</PanelField>
        <PanelField label="平均停留">{secLabel(stats.avgDwellSec)}</PanelField>
        <PanelField label="累積停留">{secLabel(stats.totalSec)}</PanelField>
        <PanelField label="尖峰時段">
          {stats.peakHour != null ? `${stats.peakHour}:00–${stats.peakHour + 1}:00` : '—（無人進入）'}
        </PanelField>
      </PanelSection>

      <PanelSection title="逐時人氣（累積停留秒數）">
        <div
          style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 56, padding: '0 2px' }}
          onMouseLeave={() => setHoverBar(null)}
        >
          {stats.hourly.map((h) => {
            const isHover = hoverBar?.hour === h.hour
            return (
              <div
                key={h.hour}
                onMouseEnter={() => setHoverBar(h)}
                style={{
                  flex: 1,
                  height: '100%',
                  display: 'flex',
                  alignItems: 'flex-end',
                  cursor: 'default',
                  background: isHover ? 'rgba(255, 255, 255, 0.07)' : 'transparent',
                  borderRadius: 2,
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: `${Math.max(2, Math.round((h.sec / maxHourSec) * 100))}%`,
                    background: h.hour === stats.peakHour
                      ? (isHover ? '#fbbf24' : '#f59e0b')
                      : (isHover ? '#34d399' : 'rgba(16, 185, 129, 0.65)'),
                    borderRadius: 2,
                  }}
                />
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', padding: '2px 2px 0' }}>
          <span>{stats.hourly[0]?.hour}時</span>
          <span>{stats.hourly[stats.hourly.length - 1]?.hour}時</span>
        </div>
        <div style={{ marginTop: 6, fontSize: 11, minHeight: 16, color: hoverBar ? '#eaeaea' : '#64748b' }}>
          {hoverBar
            ? `${hoverBar.hour}:00–${hoverBar.hour + 1}:00　累積停留 ${secLabel(hoverBar.sec)}${hoverBar.hour === stats.peakHour ? '（尖峰）' : ''}`
            : '滑過長條查看各時段數值'}
        </div>
      </PanelSection>
    </PanelShell>
  )
}

export default ZonePanel
