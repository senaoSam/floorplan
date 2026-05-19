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
    const { routes, switchLinks, warnings } = computeRoutes({ floors, apsByFloor, switchesByFloor, traysByFloor, risers })
    let totalApM = 0
    let totalS2sM = 0
    const byStatus = { tray: 0, 'fallback-manhattan': 0, unroutable: 0 }
    const byFloor  = new Map()   // floorId → { totalM, apCount }
    const unroutable = []
    // 14-3 BOM buckets: cableType (copper vs fiber) and length brackets
    // <30 / 30-89 / 90+ m. AP cables default to copper (drops are short).
    const bom = {
      apToSwitch: 0,
      s2s:        { copper: 0, fiber: 0 },
      byLength:   { short: 0, mid: 0, long: 0 },        // total metres
      counts:     { short: 0, mid: 0, long: 0 },        // number of cables
    }
    const bucketLen = (m) => m < 30 ? 'short' : m < 90 ? 'mid' : 'long'

    for (const r of routes.values()) {
      byStatus[r.routeStatus] = (byStatus[r.routeStatus] ?? 0) + 1
      const fid = r.homeFloorId
      if (!byFloor.has(fid)) byFloor.set(fid, { totalM: 0, apCount: 0 })
      const f = byFloor.get(fid)
      f.apCount++
      if (r.cableM != null) {
        f.totalM += r.cableM
        totalApM += r.cableM
        bom.apToSwitch += r.cableM
        const b = bucketLen(r.cableM)
        bom.byLength[b] += r.cableM
        bom.counts[b]   += 1
      }
      if (r.routeStatus === 'unroutable') {
        const ap = (apsByFloor[fid] ?? []).find((a) => a.id === r.apId)
        unroutable.push({ apId: r.apId, apName: ap?.name ?? r.apId, floorId: fid })
      }
    }

    // S2S links — separate from AP cables, tracked per cableType.
    for (const link of switchLinks.values()) {
      if (link.cableM == null) continue
      totalS2sM += link.cableM
      bom.s2s[link.cableType] = (bom.s2s[link.cableType] ?? 0) + link.cableM
      const b = bucketLen(link.cableM)
      bom.byLength[b] += link.cableM
      bom.counts[b]   += 1
    }

    return {
      totalM: totalApM + totalS2sM,
      totalApM, totalS2sM,
      byStatus, byFloor, unroutable, warnings,
      totalAP: routes.size, totalS2s: switchLinks.size,
      bom,
    }
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

          {/* 14-3 BOM breakdown — only show when there's something to summarise. */}
          {(stats.totalApM > 0 || stats.totalS2sM > 0) && (
            <section className="cable-summary__section">
              <p className="cable-summary__label">BOM 分類</p>
              <div className="cable-summary__row">
                <span>AP → Switch</span>
                <span>{stats.totalApM.toFixed(1)} m<span className="cable-summary__sub">（{stats.totalAP}）</span></span>
              </div>
              {stats.totalS2s > 0 && (
                <>
                  <div className="cable-summary__row">
                    <span>Switch → Switch</span>
                    <span>{stats.totalS2sM.toFixed(1)} m<span className="cable-summary__sub">（{stats.totalS2s}）</span></span>
                  </div>
                  {stats.bom.s2s.copper > 0 && (
                    <div className="cable-summary__row cable-summary__row--sub">
                      <span>　Copper</span><span>{stats.bom.s2s.copper.toFixed(1)} m</span>
                    </div>
                  )}
                  {stats.bom.s2s.fiber > 0 && (
                    <div className="cable-summary__row cable-summary__row--sub">
                      <span>　Fiber</span><span>{stats.bom.s2s.fiber.toFixed(1)} m</span>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {(stats.bom.counts.short + stats.bom.counts.mid + stats.bom.counts.long) > 0 && (
            <section className="cable-summary__section">
              <p className="cable-summary__label">長度級距</p>
              <div className="cable-summary__row">
                <span>&lt; 30 m</span>
                <span>{stats.bom.byLength.short.toFixed(1)} m<span className="cable-summary__sub">（{stats.bom.counts.short}）</span></span>
              </div>
              <div className="cable-summary__row">
                <span>30 – 89 m</span>
                <span>{stats.bom.byLength.mid.toFixed(1)} m<span className="cable-summary__sub">（{stats.bom.counts.mid}）</span></span>
              </div>
              <div className="cable-summary__row">
                <span>&ge; 90 m<span className="cable-summary__sub">（需 fiber）</span></span>
                <span>{stats.bom.byLength.long.toFixed(1)} m<span className="cable-summary__sub">（{stats.bom.counts.long}）</span></span>
              </div>
            </section>
          )}

          {stats.warnings.length > 0 && (
            <section className="cable-summary__section">
              <p className="cable-summary__label cable-summary__label--warn">
                ⚠ Graph 警告（{stats.warnings.length}）
              </p>
              {stats.warnings.map((w, i) => (
                <div key={i} className="cable-summary__warning" title={w}>
                  {w}
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
