import React, { useMemo, useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore, CAPACITY_PROFILES, getCapacityProfile } from '@/store/useCableStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useWallStore } from '@/store/useWallStore'
import { useScopeStore } from '@/store/useScopeStore'
import { getCachedRoutes } from '@/features/cable/routesCache'
import { computeTrayBOM } from '@/features/cable/computeTrayBOM'
import { computeTrayCableLoads, computeTrayFill } from '@/features/cable/computeTrayFill'
import Icon from '@/components/Icon/Icon'
import './CableSummaryPanel.sass'

// Collapsible section: clicking the label row folds its body away. `warn`
// tints the label; `count` appends a badge count. Mirrors StatsDashboard's
// Section so both summary panels fold the same way.
function Section({ label, warn, open, onToggle, children }) {
  return (
    <section className="cable-summary__section">
      <button
        type="button"
        className={`cable-summary__section-toggle${warn ? ' cable-summary__section-toggle--warn' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className={`cable-summary__section-arrow${open ? '' : ' cable-summary__section-arrow--collapsed'}`}>
          <Icon name="chevronDown" size={9} />
        </span>
        <span className={`cable-summary__label${warn ? ' cable-summary__label--warn' : ''}`}>{label}</span>
      </button>
      {open && children}
    </section>
  )
}

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
  const capacityProfile    = useCableStore((s) => s.capacityProfile)
  const customCapacity     = useCableStore((s) => s.customCapacity)
  const setCapacityProfile = useCableStore((s) => s.setCapacityProfile)
  const setCustomCapacity  = useCableStore((s) => s.setCustomCapacity)
  const wasteFactor        = useCableStore((s) => s.wasteFactor)
  const setWasteFactor     = useCableStore((s) => s.setWasteFactor)

  // 20-1 Tray Planning BOM — fittings & length estimate. Re-computes when
  // tray points / waste factor change.
  const trayBOM = useMemo(
    () => computeTrayBOM({ floors, traysByFloor, wasteFactor }),
    [floors, traysByFloor, wasteFactor],
  )

  // PDF planning report. Async because each floor's snapshot waits for React to
  // commit the floor switch, so the status string doubles as the busy flag
  // (non-null ⇒ a run is in flight ⇒ the button is disabled).
  const [exportStatus, setExportStatus] = useState(null)
  const handleExportPdf = async () => {
    if (exportStatus) return
    setExportStatus('準備中...')
    try {
      const { buildPlanningPdf, triggerPdfDownload } =
        await import('@/features/cable/exportPlanningPdf')
      const blob = await buildPlanningPdf({
        floors,
        apsByFloor,
        // Walls / scopes / regulatoryDomain are read at click time instead of
        // subscribed: they only matter to the report, and subscribing would
        // re-render this panel on every wall edit for no visible benefit.
        wallsByFloor: useWallStore.getState().wallsByFloor,
        scopesByFloor: useScopeStore.getState().scopesByFloor,
        switchesByFloor,
        traysByFloor,
        risers,
        wasteFactor,
        capacityProfile,
        customCapacity,
        regulatoryDomain: useEditorStore.getState().regulatoryDomain,
        setActiveFloor,
        getActiveFloorId: () => useFloorStore.getState().activeFloorId,
        onProgress: setExportStatus,
      })
      const stamp = new Date().toISOString().slice(0, 10)
      triggerPdfDownload(blob, `floorplan-report-${stamp}.pdf`)
    } catch (err) {
      console.error('PDF export failed:', err)
      setExportStatus('失敗 — 請看 console')
      setTimeout(() => setExportStatus(null), 2500)
      return
    }
    setExportStatus(null)
  }

  const [collapsed, setCollapsed] = useState(true)
  // Per-section collapse (same pattern as StatsDashboard). Defaults fold the
  // advanced / repeat-slicing sections (per-floor, tier split, length brackets)
  // so the core rows (route status, BOM, tray planning, bottlenecks) read
  // first. Route status is always visible; it is not a collapsible section.
  const [collapsedSections, setCollapsedSections] = useState(
    () => new Set(['perFloor', 'tier', 'length', 'unroutList']),
  )
  const isOpen = (key) => !collapsedSections.has(key)
  const toggleSection = (key) => setCollapsedSections((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const stats = useMemo(() => {
    const { routes, switchLinks, warnings } = getCachedRoutes({ floors, apsByFloor, switchesByFloor, traysByFloor, risers })
    let totalApM = 0
    let totalS2sM = 0
    const byStatus = { tray: 0, 'fallback-manhattan': 0, unroutable: 0 }
    const byFloor  = new Map()   // floorId → { totalM, apCount }
    const unroutable = []
    // 14-3 BOM buckets: cableType (copper vs fiber) and length brackets
    // <30 / 30-89 / 90+ m. AP cables default to copper (drops are short).
    // 29-5 add per-tier breakdown (backbone / distribution / access).
    const bom = {
      apToSwitch: 0,
      s2s:        { copper: 0, fiber: 0 },
      byLength:   { short: 0, mid: 0, long: 0 },        // total metres
      counts:     { short: 0, mid: 0, long: 0 },        // number of cables
      byTier:     {
        backbone:     { totalM: 0, copper: 0, fiber: 0, count: 0 },
        distribution: { totalM: 0, copper: 0, fiber: 0, count: 0 },
        access:       { totalM: 0, copper: 0, fiber: 0, count: 0 },
      },
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

    // S2S links — separate from AP cables, tracked per cableType + tier.
    for (const link of switchLinks.values()) {
      if (link.cableM == null) continue
      totalS2sM += link.cableM
      bom.s2s[link.cableType] = (bom.s2s[link.cableType] ?? 0) + link.cableM
      const b = bucketLen(link.cableM)
      bom.byLength[b] += link.cableM
      bom.counts[b]   += 1
      // 29-5 per-tier accumulation
      const tier = link.tier ?? 'access'
      const slot = bom.byTier[tier] ?? bom.byTier.access
      slot.totalM += link.cableM
      slot.count  += 1
      if (link.cableType === 'fiber') slot.fiber += link.cableM
      else if (link.cableType === 'copper') slot.copper += link.cableM
    }

    // 20-2 容量瓶頸 — score every tray by fill ratio, surface the non-OK
    // ones so the user can spot bottlenecks without clicking through each
    // tray. Sorted descending so the worst offender is first.
    const trayLoads = computeTrayCableLoads({ routes, switchLinks, traysByFloor })
    const profile = getCapacityProfile(capacityProfile, customCapacity)
    const bottlenecks = []
    for (const f of floors) {
      const trays = traysByFloor[f.id] ?? []
      for (const tray of trays) {
        const load = trayLoads.get(`${f.id}|${tray.id}`) ?? { count: 0, copperCount: 0, fiberCount: 0 }
        const fill = computeTrayFill({ tray, load, profile })
        if (fill.status === 'ok') continue
        bottlenecks.push({
          floorId:    f.id,
          floorName:  f.name ?? f.id,
          trayId:     tray.id,
          trayName:   tray.name ?? tray.id,
          fillRatio:  fill.fillRatio,
          status:     fill.status,
          statusLabel: fill.statusLabel,
          statusColor: fill.statusColor,
          count:      fill.count,
        })
      }
    }
    bottlenecks.sort((a, b) => b.fillRatio - a.fillRatio)

    return {
      totalM: totalApM + totalS2sM,
      totalApM, totalS2sM,
      byStatus, byFloor, unroutable, warnings,
      totalAP: routes.size, totalS2s: switchLinks.size,
      bom,
      bottlenecks,
    }
  }, [floors, apsByFloor, switchesByFloor, traysByFloor, risers, capacityProfile, customCapacity])

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

  const handleNavigateTray = (trayId, floorId) => {
    setActiveFloor(floorId)
    setSelected(trayId, 'cable_tray')
  }

  // Order per-floor rows highest-floor-first, matching the SidebarLeft list and
  // the 3D floor selector. floors[0] sits on the ground (see floorStacking), so
  // a higher array index = a higher floor → sort by index descending. (The old
  // code sorted by a non-existent `f.elevation`, which was always undefined and
  // effectively left rows in floors[] order = lowest-first, i.e. reversed.)
  const sortedFloorEntries = [...stats.byFloor.entries()].sort((a, b) => {
    const ia = floors.findIndex((f) => f.id === a[0])
    const ib = floors.findIndex((f) => f.id === b[0])
    return ib - ia
  })

  return (
    <div className="cable-summary">
      <div className="cable-summary__header" onClick={() => setCollapsed((v) => !v)}>
        <span className="cable-summary__icon">🔌</span>
        <span className="cable-summary__title">線纜總結</span>
        <span className="cable-summary__total">{stats.totalM.toFixed(1)} m</span>
        <span className={`cable-summary__arrow${collapsed ? ' cable-summary__arrow--collapsed' : ''}`}><Icon name="chevronDown" size={11} /></span>
      </div>
      {!collapsed && (
        <div className="cable-summary__body">
          {/* Route status — always visible. The unroutable row expands to the
              AP list inline (merged from the old standalone "無法接線" section
              so the count and its detail live in one place). */}
          <section className="cable-summary__section">
            <p className="cable-summary__label">路由狀態（{stats.totalAP} AP）</p>
            <div className="cable-summary__row">
              <span>沿線槽</span>
              <span>{stats.byStatus.tray}</span>
            </div>
            <div className="cable-summary__row">
              <span>直角走線（未沿線槽）</span>
              <span>{stats.byStatus['fallback-manhattan']}</span>
            </div>
            {stats.byStatus.unroutable > 0 && (
              <>
                <div
                  className="cable-summary__row cable-summary__row--warn cable-summary__row--clickable"
                  onClick={() => toggleSection('unroutList')}
                  title="展開／收合無法接線的 AP"
                >
                  <span>
                    <span className={`cable-summary__section-arrow${isOpen('unroutList') ? '' : ' cable-summary__section-arrow--collapsed'}`}>
                      <Icon name="chevronDown" size={9} />
                    </span>
                    ⚠ 無法接線
                  </span>
                  <span>{stats.byStatus.unroutable}</span>
                </div>
                {isOpen('unroutList') && stats.unroutable.map((u) => (
                  <div
                    key={u.apId}
                    className="cable-summary__row cable-summary__row--clickable cable-summary__row--sub"
                    onClick={() => handleNavigateAP(u.apId, u.floorId)}
                    title="點擊跳到該 AP"
                  >
                    <span>　{u.apName}</span>
                    <span className="cable-summary__sub">
                      {floors.find((f) => f.id === u.floorId)?.name ?? u.floorId}
                    </span>
                  </div>
                ))}
              </>
            )}
          </section>

          {sortedFloorEntries.length > 0 && (
            <Section label="每樓纜線" open={isOpen('perFloor')} onToggle={() => toggleSection('perFloor')}>
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
            </Section>
          )}

          {/* 14-3 BOM breakdown — only show when there's something to summarise.
              Core section, default open. */}
          {(stats.totalApM > 0 || stats.totalS2sM > 0) && (
            <Section label="BOM 分類" open={isOpen('bom')} onToggle={() => toggleSection('bom')}>
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
            </Section>
          )}

          {/* 29-5 BOM by tier — backbone / distribution / access (per spec §5).
              Only shown when there's at least one S2S link (i.e. an IDF /
              MDF / Router is in the topology), otherwise it adds noise to
              the AP-only case. Default collapsed (advanced, overlaps BOM S2S). */}
          {stats.totalS2s > 0 && (
            <Section label="階層細分 (Backbone / Distribution / Access)" open={isOpen('tier')} onToggle={() => toggleSection('tier')}>
              {[
                { tier: 'backbone',     label: 'Backbone',     desc: 'MDF↔Router / IDF↔MDF' },
                { tier: 'distribution', label: 'Distribution', desc: 'Access↔IDF' },
                { tier: 'access',       label: 'Access (S2S)', desc: '其他 switch↔switch' },
              ].map(({ tier, label, desc }) => {
                const s = stats.bom.byTier[tier]
                if (!s || s.totalM <= 0) return null
                return (
                  <React.Fragment key={tier}>
                    <div className="cable-summary__row">
                      <span>
                        {label}
                        <span className="cable-summary__sub">（{desc}）</span>
                      </span>
                      <span>
                        {s.totalM.toFixed(1)} m
                        <span className="cable-summary__sub">（{s.count}）</span>
                      </span>
                    </div>
                    {(s.copper > 0 || s.fiber > 0) && (
                      <div className="cable-summary__row cable-summary__row--sub">
                        <span>　介質</span>
                        <span>
                          {s.copper > 0 && <>Copper {s.copper.toFixed(1)} m</>}
                          {s.copper > 0 && s.fiber > 0 && <>　</>}
                          {s.fiber > 0 && <>Fiber {s.fiber.toFixed(1)} m</>}
                        </span>
                      </div>
                    )}
                  </React.Fragment>
                )
              })}
            </Section>
          )}

          {(stats.bom.counts.short + stats.bom.counts.mid + stats.bom.counts.long) > 0 && (
            <Section label="長度級距" open={isOpen('length')} onToggle={() => toggleSection('length')}>
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
            </Section>
          )}

          {/* 20-1 Tray Planning BOM — physical tray order estimate (length
              + fittings count). Explicitly framed as planning, not final BOM. */}
          {trayBOM.totalLengthM > 0 && (
            <Section label="Tray Planning BOM" open={isOpen('trayBOM')} onToggle={() => toggleSection('trayBOM')}>
              <div className="cable-summary__row">
                <span>總長</span>
                <span>{trayBOM.totalLengthM.toFixed(1)} m</span>
              </div>
              <div className="cable-summary__row">
                <span className="cable-summary__waste-edit">
                  ＋餘料係數
                  <input
                    type="number"
                    min="1.00"
                    max="2.00"
                    step="0.01"
                    className="cable-summary__num"
                    value={wasteFactor}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (!isNaN(v) && v >= 1.0 && v <= 2.0) setWasteFactor(v)
                    }}
                  />
                  ×
                </span>
                <span>{trayBOM.totalLengthWithWasteM.toFixed(1)} m</span>
              </div>
              <div className="cable-summary__row">
                <span>接頭 (L / T / 跨)</span>
                <span>{trayBOM.lfits} / {trayBOM.tjoints} / {trayBOM.crosses}</span>
              </div>
              {trayBOM.perFloor.length > 1 && (
                <details className="cable-summary__details">
                  <summary>每樓線槽</summary>
                  {trayBOM.perFloor.map((pf) => (
                    <div key={pf.floorId} className="cable-summary__row cable-summary__row--sub">
                      <span>{pf.name}</span>
                      <span>
                        {pf.lengthM.toFixed(1)} m
                        <span className="cable-summary__sub">
                          （{pf.lfits}L / {pf.tjoints}T / {pf.crosses}×）
                        </span>
                      </span>
                    </div>
                  ))}
                </details>
              )}
              <p className="cable-summary__hint">
                Planning estimate — 不含吊桿、餘料裁切細節，僅供下單參考
              </p>
            </Section>
          )}

          {/* 20-2 容量瓶頸 — building-wide ranked list of trays in warn / full /
              exceed state. Click a row to jump to that tray. Hidden when no
              tray exceeds the OK threshold (most projects start clean). */}
          {stats.bottlenecks.length > 0 && (
            <Section label={`容量瓶頸（${stats.bottlenecks.length}）`} warn open={isOpen('bottlenecks')} onToggle={() => toggleSection('bottlenecks')}>
              {stats.bottlenecks.map((b) => (
                <div
                  key={`${b.floorId}|${b.trayId}`}
                  className="cable-summary__row cable-summary__row--clickable"
                  onClick={() => handleNavigateTray(b.trayId, b.floorId)}
                  title="點擊跳到該 Tray"
                >
                  <span>
                    <span
                      className="cable-summary__badge"
                      style={{ background: b.statusColor }}
                    >
                      {b.statusLabel}
                    </span>
                    {b.trayName}
                  </span>
                  <span>
                    {(b.fillRatio * 100).toFixed(0)}%
                    <span className="cable-summary__sub">
                      {b.floorName}　{b.count} 條
                    </span>
                  </span>
                </div>
              ))}
            </Section>
          )}

          {/* 19-4 capacity profile picker — drives per-tray fill ratio warnings. */}
          <section className="cable-summary__section">
            <p className="cable-summary__label">容量規則 (Capacity profile)</p>
            <select
              className="cable-summary__select"
              value={capacityProfile}
              onChange={(e) => setCapacityProfile(e.target.value)}
            >
              {CAPACITY_PROFILES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            {capacityProfile === 'custom' && (
              <div className="cable-summary__custom-rows">
                <div className="cable-summary__row">
                  <span>注意 ≥</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    className="cable-summary__num"
                    value={Math.round((customCapacity.warnRatio ?? 0.25) * 100)}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (!isNaN(v)) setCustomCapacity({ warnRatio: v / 100 })
                    }}
                  />
                  <span>%</span>
                </div>
                <div className="cable-summary__row">
                  <span>滿載 ≥</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    className="cable-summary__num"
                    value={Math.round((customCapacity.fullRatio ?? 0.40) * 100)}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (!isNaN(v)) setCustomCapacity({ fullRatio: v / 100 })
                    }}
                  />
                  <span>%</span>
                </div>
              </div>
            )}
            <p className="cable-summary__hint">
              不是工程法規檢查 — 由設計方依公司 / 業主慣例選用
            </p>
          </section>

          {stats.warnings.length > 0 && (
            <Section label={`⚠ Graph 警告（${stats.warnings.length}）`} warn open={isOpen('warnings')} onToggle={() => toggleSection('warnings')}>
              {stats.warnings.map((w, i) => (
                <div key={i} className="cable-summary__warning" title={w}>
                  {w}
                </div>
              ))}
            </Section>
          )}

          <section className="cable-summary__section">
            <button
              type="button"
              className="cable-summary__export"
              disabled={!!exportStatus}
              onClick={handleExportPdf}
              title="輸出多頁 PDF：封面 / RF 涵蓋率與達標判定 / 每層平面圖快照 / AP 線纜表 / 線槽 BOM / 警告"
            >
              {exportStatus ?? '📄 匯出規劃報告 PDF'}
            </button>
          </section>
        </div>
      )}
    </div>
  )
}

export default CableSummaryPanel
