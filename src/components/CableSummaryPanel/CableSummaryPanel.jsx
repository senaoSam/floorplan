import React, { useMemo, useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore } from '@/store/useCableStore'
import { computeRoutes } from '@/features/cable/computeRoutes'
import './CableSummaryPanel.sass'

// Slim Phase 25 port — header pill (total cable length, click to expand) +
// per-status counts + per-floor breakdown. BOM cross-section / waste-factor
// / fiber vs copper split / S2S links / CSV+PDF export / warnings panel
// all defer until their respective subsystems return (computeTrayBOM,
// computeTrayFill, exportPlanningBOM/Pdf — they live in oldSrc but aren't
// needed for the visible MVP).

function formatMeters(m) {
  if (!isFinite(m)) return '—'
  if (m >= 100) return `${m.toFixed(0)} m`
  return `${m.toFixed(1)} m`
}

function CableSummaryPanel() {
  const floors          = useFloorStore((s) => s.floors)
  const apsByFloor      = useAPStore((s) => s.apsByFloor)
  const switchesByFloor = useCableStore((s) => s.switchesByFloor)
  const traysByFloor    = useCableStore((s) => s.traysByFloor)
  const risers          = useCableStore((s) => s.risers)

  const [open, setOpen] = useState(false)

  const summary = useMemo(() => {
    if (floors.length === 0) return null
    const { routes } = computeRoutes({
      floors,
      apsByFloor,
      switchesByFloor,
      traysByFloor,
      risers,
    })
    let total = 0
    const byStatus = { tray: 0, 'fallback-manhattan': 0, unroutable: 0 }
    const byFloor = new Map()
    const unroutable = []
    for (const f of floors) {
      const aps = apsByFloor[f.id] ?? []
      let floorTotal = 0
      for (const ap of aps) {
        const r = routes.get(ap.id)
        if (!r) continue
        if (r.routeStatus === 'unroutable') {
          byStatus.unroutable += 1
          unroutable.push({ floorName: f.name, apName: ap.name ?? ap.id })
          continue
        }
        byStatus[r.routeStatus] = (byStatus[r.routeStatus] ?? 0) + 1
        if (isFinite(r.cableM)) {
          total += r.cableM
          floorTotal += r.cableM
        }
      }
      byFloor.set(f.id, { name: f.name, total: floorTotal, apCount: aps.length })
    }
    return { total, byStatus, byFloor, unroutable }
  }, [floors, apsByFloor, switchesByFloor, traysByFloor, risers])

  if (!summary) return null

  return (
    <div className="cable-summary">
      <button
        type="button"
        className="cable-summary__header"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cable-summary__icon">🔌</span>
        <span className="cable-summary__title">線纜總結</span>
        <span className="cable-summary__total">{formatMeters(summary.total)}</span>
        <span className="cable-summary__arrow">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="cable-summary__body">
          <div className="cable-summary__row">
            <span>經由 Tray</span>
            <b>{summary.byStatus.tray}</b>
          </div>
          <div className="cable-summary__row">
            <span>Fallback (Manhattan)</span>
            <b>{summary.byStatus['fallback-manhattan']}</b>
          </div>
          {summary.byStatus.unroutable > 0 && (
            <div className="cable-summary__row cable-summary__row--warn">
              <span>無路徑</span>
              <b>{summary.byStatus.unroutable}</b>
            </div>
          )}
          <div className="cable-summary__divider" />
          {Array.from(summary.byFloor.values()).map((f) => (
            <div className="cable-summary__row" key={f.name}>
              <span>{f.name} ({f.apCount} AP)</span>
              <b>{formatMeters(f.total)}</b>
            </div>
          ))}
          {summary.unroutable.length > 0 && (
            <>
              <div className="cable-summary__divider" />
              <div className="cable-summary__warn-title">無路徑 AP</div>
              {summary.unroutable.map((u, i) => (
                <div className="cable-summary__warn-row" key={i}>
                  {u.floorName} / {u.apName}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default CableSummaryPanel
