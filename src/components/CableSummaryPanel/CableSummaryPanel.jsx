import React, { useMemo, useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore } from '@/store/useCableStore'
import { useEditorStore } from '@/store/useEditorStore'
import { computeRoutes } from '@/features/cable/computeRoutes'
import './CableSummaryPanel.sass'

// Building-wide cable BOM + per-route-status counts + unroutable list.
// Mirrors HeatmapControl's bottom-left placement; auto-hides until the user
// has placed at least one switch / tray / riser (i.e. the cable system is
// active), so it doesn't clutter the canvas during pure-AP planning.
function CableSummaryPanel() {
  const floors          = useFloorStore((s) => s.floors)
  const setActiveFloor  = useFloorStore((s) => s.setActiveFloor)
  const apsByFloor      = useAPStore((s) => s.apsByFloor)
  const switchesByFloor = useCableStore((s) => s.switchesByFloor)
  const traysByFloor    = useCableStore((s) => s.traysByFloor)
  const risers          = useCableStore((s) => s.risers)
  const setSelected     = useEditorStore((s) => s.setSelected)

  const [collapsed, setCollapsed] = useState(true)

  const stats = useMemo(() => {
    const routes = computeRoutes({ floors, apsByFloor, switchesByFloor, traysByFloor, risers })
    let totalM = 0
    const byStatus = { tray: 0, 'fallback-manhattan': 0, unroutable: 0 }
    const byFloor  = new Map()   // floorId → { totalM, apCount }
    const unroutable = []
    for (const r of routes.values()) {
      byStatus[r.routeStatus] = (byStatus[r.routeStatus] ?? 0) + 1
      const fid = r.homeFloorId
      if (!byFloor.has(fid)) byFloor.set(fid, { totalM: 0, apCount: 0 })
      const f = byFloor.get(fid)
      f.apCount++
      if (r.cableM != null) {
        f.totalM += r.cableM
        totalM   += r.cableM
      }
      if (r.routeStatus === 'unroutable') {
        const ap = (apsByFloor[fid] ?? []).find((a) => a.id === r.apId)
        unroutable.push({ apId: r.apId, apName: ap?.name ?? r.apId, floorId: fid })
      }
    }
    return { totalM, byStatus, byFloor, unroutable, totalAP: routes.size }
  }, [floors, apsByFloor, switchesByFloor, traysByFloor, risers])

  // Hide the panel until the user actually has a cable system to summarise.
  const hasCableSystem =
    Object.values(switchesByFloor).some((list) => (list ?? []).length > 0) ||
    Object.values(traysByFloor).some((list)    => (list ?? []).length > 0) ||
    risers.length > 0
  if (!hasCableSystem) return null

  const handleNavigateAP = (apId, floorId) => {
    setActiveFloor(floorId)
    setSelected(apId, 'ap')
  }

  const sortedFloorEntries = [...stats.byFloor.entries()].sort((a, b) => {
    const ea = floors.find((f) => f.id === a[0])?.elevation ?? 0
    const eb = floors.find((f) => f.id === b[0])?.elevation ?? 0
    return ea - eb
  })

  return (
    <div className="cable-summary">
      <div className="cable-summary__header" onClick={() => setCollapsed((v) => !v)}>
        <span className="cable-summary__icon">🔌</span>
        <span className="cable-summary__title">線纜總結</span>
        <span className="cable-summary__total">{stats.totalM.toFixed(1)} m</span>
        <span className={`cable-summary__arrow${collapsed ? ' cable-summary__arrow--collapsed' : ''}`}>▾</span>
      </div>
      {!collapsed && (
        <div className="cable-summary__body">
          <section className="cable-summary__section">
            <p className="cable-summary__label">路由狀態（{stats.totalAP} AP）</p>
            <div className="cable-summary__row">
              <span>沿 Tray</span>
              <span>{stats.byStatus.tray}</span>
            </div>
            <div className="cable-summary__row">
              <span>Manhattan fallback</span>
              <span>{stats.byStatus['fallback-manhattan']}</span>
            </div>
            {stats.byStatus.unroutable > 0 && (
              <div className="cable-summary__row cable-summary__row--warn">
                <span>Unroutable</span>
                <span>{stats.byStatus.unroutable}</span>
              </div>
            )}
          </section>

          {sortedFloorEntries.length > 0 && (
            <section className="cable-summary__section">
              <p className="cable-summary__label">每樓層</p>
              {sortedFloorEntries.map(([fid, info]) => {
                const f = floors.find((fl) => fl.id === fid)
                return (
                  <div key={fid} className="cable-summary__row">
                    <span>{f?.name ?? fid}</span>
                    <span>
                      {info.totalM.toFixed(1)} m
                      <span className="cable-summary__sub">（{info.apCount} AP）</span>
                    </span>
                  </div>
                )
              })}
            </section>
          )}

          {stats.unroutable.length > 0 && (
            <section className="cable-summary__section">
              <p className="cable-summary__label cable-summary__label--warn">
                ⚠ 無法接線（{stats.unroutable.length}）
              </p>
              {stats.unroutable.map((u) => (
                <div
                  key={u.apId}
                  className="cable-summary__row cable-summary__row--clickable"
                  onClick={() => handleNavigateAP(u.apId, u.floorId)}
                  title="點擊跳到該 AP"
                >
                  <span>{u.apName}</span>
                  <span className="cable-summary__sub">
                    {floors.find((f) => f.id === u.floorId)?.name ?? u.floorId}
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  )
}

export default CableSummaryPanel
