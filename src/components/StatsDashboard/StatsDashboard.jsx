import React, { useMemo, useState, useEffect, useRef } from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useWallStore } from '@/store/useWallStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useCableStore } from '@/store/useCableStore'
import { useHoverStore } from '@/store/useHoverStore'
import { useStatsTimeStore, STATS_SPEEDS } from '@/store/useStatsTimeStore'
import { getSnapshot, getTimeSeries } from '@/features/stats/statsSource'
import Icon from '@/components/Icon/Icon'
import './StatsDashboard.sass'

// Live network statistics dashboard (Phase 43, B-domain). Aggregates the whole
// floor's AP / switch / client snapshot into KPI tiles, load / PoE rankings, a
// client band distribution, an alert list, a client MAC drill-down and a switch
// topology mini-view. Read-only view mode (STATS). All numbers come from
// statsSource.getSnapshot — the adapter that will later point at the real cloud.
//
// The snapshot's `ts` drives the diurnal client curve; we take a stable "now"
// per mount (Date.now is fine here — it's display state, not persisted) so the
// dashboard reads as a live moment without re-rolling every render.

// Frequency-band colors — fixed per entity (spec / project convention), never
// cycled: 2.4 orange, 5 blue, 6 purple.
const BAND_COLOR = { '2.4': '#f39c12', '5': '#4fc3f7', '6': '#a855f7' }
const BAND_LABEL = { '2.4': '2.4G', '5': '5G', '6': '6G' }

const SEV_ICON = { critical: '⛔', warning: '⚠', info: 'ℹ' }

// Clock label for a ts, weekday-aware ("週三 15:00").
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
function fmtClock(ts) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `週${WEEKDAYS[d.getDay()]} ${hh}:${mm}`
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className={`stats-dash__kpi${tone ? ` stats-dash__kpi--${tone}` : ''}`}>
      <span className="stats-dash__kpi-value">{value}</span>
      <span className="stats-dash__kpi-label">{label}</span>
      {sub != null && <span className="stats-dash__kpi-sub">{sub}</span>}
    </div>
  )
}

// Per-section collapse wrapper. Clicking the title row folds the body away.
// `right` renders an extra control on the title row (e.g. the gap-overlay
// toggle) that keeps working without toggling the collapse. `open` is the
// current expanded state; `onToggle` flips it in the parent's collapse set.
function Section({ title, open, onToggle, right, children }) {
  return (
    <section className="stats-dash__section">
      <div className="stats-dash__section-head">
        <button
          type="button"
          className="stats-dash__section-toggle"
          onClick={onToggle}
          aria-expanded={open}
        >
          <span className={`stats-dash__section-arrow${open ? '' : ' stats-dash__section-arrow--collapsed'}`}>
            <Icon name="chevronDown" size={10} />
          </span>
          <span className="stats-dash__section-title">{title}</span>
        </button>
        {right}
      </div>
      {open && children}
    </section>
  )
}

function StatsDashboard() {
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floors        = useFloorStore((s) => s.floors)
  const setActiveFloor = useFloorStore((s) => s.setActiveFloor)
  const setSelected   = useEditorStore((s) => s.setSelected)
  const setHover      = useHoverStore((s) => s.setHover)
  const clearHoverIf  = useHoverStore((s) => s.clearHoverIf)

  const apsByFloor       = useAPStore((s) => s.apsByFloor)
  const wallsByFloor     = useWallStore((s) => s.wallsByFloor)
  const scopesByFloor    = useScopeStore((s) => s.scopesByFloor)
  const switchesByFloor  = useCableStore((s) => s.switchesByFloor)
  const traysByFloor     = useCableStore((s) => s.traysByFloor)
  const risers           = useCableStore((s) => s.risers)

  const [clientQuery, setClientQuery] = useState('')

  // Whole-panel collapse (title bar chevron) — matches CableSummaryPanel /
  // DevicePlanningPanel. Per-section collapse: a set of section keys the user
  // has folded away. Defaults fold the space-hungry / advanced sections
  // (trend, band split, switches, client search) so the maintenance entry
  // (alerts, AP ranking, plan-vs-measured) reads first.
  const [dashCollapsed, setDashCollapsed] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState(
    () => new Set(['timeline', 'bands', 'switches', 'clients']),
  )
  const isOpen = (key) => !collapsedSections.has(key)
  const toggleSection = (key) => setCollapsedSections((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  // Shared timeline (scrubber + overlay read the same store). anchorTs is the
  // live edge; playheadTs is the displayed moment.
  const anchorTs   = useStatsTimeStore((s) => s.anchorTs)
  const playheadTs = useStatsTimeStore((s) => s.playheadTs)
  const rangeHours = useStatsTimeStore((s) => s.rangeHours)
  const playing    = useStatsTimeStore((s) => s.playing)
  const speed      = useStatsTimeStore((s) => s.speed)
  const setPlayhead = useStatsTimeStore((s) => s.setPlayhead)
  const togglePlaying = useStatsTimeStore((s) => s.togglePlaying)
  const setSpeed   = useStatsTimeStore((s) => s.setSpeed)
  const goLive     = useStatsTimeStore((s) => s.goLive)
  const showGapOverlay  = useStatsTimeStore((s) => s.showGapOverlay)
  const gapThresholdDbm = useStatsTimeStore((s) => s.gapThresholdDbm)
  const toggleGapOverlay = useStatsTimeStore((s) => s.toggleGapOverlay)

  // Seed the window once on mount (captures "now" as the live edge).
  useEffect(() => { useStatsTimeStore.getState().initAnchor(Date.now()) }, [])
  // Reset the timeline when the dashboard unmounts (leaving STATS) so a fresh
  // entry re-anchors to a new "now".
  useEffect(() => () => useStatsTimeStore.getState().reset(), [])
  // Clear any lingering hover highlight when leaving the dashboard.
  useEffect(() => () => useHoverStore.getState().setHover(null, null), [])

  // Playback: advance the playhead in real→sim time while playing. rAF, not
  // setInterval, matching camera's trackingBinder. Stops at the live edge.
  const rafRef = useRef(null)
  const lastFrameRef = useRef(null)
  useEffect(() => {
    if (!playing) { lastFrameRef.current = null; return }
    let alive = true
    const tick = (now) => {
      if (!alive) return
      const prev = lastFrameRef.current ?? now
      // Clamp per-frame dt so a dropped/background frame (or a throttled rAF)
      // can't jump the playhead straight to the end — it just plays a bit
      // slower, never skips the window.
      const dtSec = Math.min(0.25, (now - prev) / 1000)
      lastFrameRef.current = now
      const st = useStatsTimeStore.getState()
      const next = (st.playheadTs ?? st.anchorTs) + dtSec * st.speed * 1000
      if (next >= st.anchorTs) { st.goLive() }   // hit live edge → stop
      else st.setPlayhead(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { alive = false; if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [playing])

  const building = useMemo(() => ({
    floors, apsByFloor, wallsByFloor, scopesByFloor, switchesByFloor, traysByFloor, risers,
  }), [floors, apsByFloor, wallsByFloor, scopesByFloor, switchesByFloor, traysByFloor, risers])

  const snap = useMemo(() => {
    if (!activeFloorId || playheadTs == null) return null
    return getSnapshot(building, activeFloorId, { ts: playheadTs })
  }, [building, activeFloorId, playheadTs])

  // Trend series over the window (client count per hour). Recomputes only when
  // the plan or the window edge changes — NOT on every playhead scrub.
  const trend = useMemo(() => {
    if (!activeFloorId || anchorTs == null) return null
    const from = anchorTs - rangeHours * 3600 * 1000
    return getTimeSeries(building, activeFloorId, {
      metric: 'clientCount', range: { from, to: anchorTs }, bucket: 'hour',
    })
  }, [building, activeFloorId, anchorTs, rangeHours])

  if (!snap) {
    return (
      <div className="stats-dash">
        <div className="stats-dash__title">網路統計</div>
        <p className="stats-dash__empty">尚未載入樓層</p>
      </div>
    )
  }

  const { ap, switchStat, client, alerts } = snap

  // Plan-vs-measured gap: clients the plan says are covered (theoretical ≥
  // threshold) but that actually measure below it — promised signal, real
  // dead spot. The overlay marks these on the plan.
  const gapClients = client.list.filter(
    (c) => c.theoreticalRssiDbm != null && c.theoreticalRssiDbm >= gapThresholdDbm && c.rssiDbm < gapThresholdDbm,
  )

  // AP load ranking (by client count, desc).
  const apRanking = [...ap.perAp]
    .filter((a) => a.status === 'online')
    .sort((a, b) => b.clientCount - a.clientCount)
    .slice(0, 6)
  const maxApClients = Math.max(1, ...apRanking.map((a) => a.clientCount))

  // Switch PoE ranking (by used watts, desc).
  const swRanking = [...switchStat.perSwitch]
    .sort((a, b) => b.poeWatts - a.poeWatts)

  // Client band distribution.
  const bandTotal = Math.max(1, client.total)
  const bands = ['2.4', '5', '6']

  const gotoAp = (apId) => {
    if (activeFloorId) setActiveFloor(activeFloorId)
    setSelected(apId, 'ap')
  }
  const gotoSwitch = (swId) => {
    if (activeFloorId) setActiveFloor(activeFloorId)
    setSelected(swId, 'switch')
  }

  const clientMatches = clientQuery.trim()
    ? client.list.filter((c) => c.mac.toLowerCase().includes(clientQuery.trim().toLowerCase()))
    : []

  const apNameById = (id) => ap.perAp.find((a) => a.apId === id)?.name ?? id

  // Trend chart geometry.
  const trendPts = trend?.points ?? []
  const trendMax = Math.max(1, ...trendPts.map((p) => p.value ?? 0))
  const playheadHour = playheadTs != null ? new Date(playheadTs).getHours() : null
  const atLive = anchorTs != null && playheadTs === anchorTs
  const winStart = anchorTs != null ? anchorTs - rangeHours * 3600 * 1000 : 0

  return (
    <div className="stats-dash">
      <div
        className="stats-dash__titlebar stats-dash__titlebar--clickable"
        onClick={() => setDashCollapsed((v) => !v)}
      >
        <span className={`stats-dash__arrow${dashCollapsed ? ' stats-dash__arrow--collapsed' : ''}`}>
          <Icon name="chevronDown" size={11} />
        </span>
        <div className="stats-dash__title">網路統計</div>
        {/* 52-D4: the mock disclosure used to be 10px grey at the very bottom
            while "● 即時" was 11px green at the top — the claim of being live
            outshouted the correction. Devices here are not deployed yet, so a
            reader can mistake seeded telemetry (e.g. the "AP-03 離線" alert)
            for a real outage. Badge it at the same level as the live dot. */}
        <div className="stats-dash__mock-badge" title="示範資料，非實際設備連線；未來接 cloud 真實資料">
          MOCK
        </div>
        <div className={`stats-dash__live${atLive ? ' stats-dash__live--on' : ''}`}>
          {atLive ? '● 即時（mock）' : fmtClock(playheadTs)}
        </div>
      </div>

      {!dashCollapsed && (
      <>
      {/* KPI tiles — always visible when the panel is open (top-level summary) */}
      <div className="stats-dash__kpis">
        <Kpi label="AP 線上" value={`${ap.online}/${ap.total}`} tone={ap.offline > 0 ? 'warn' : 'ok'} />
        <Kpi label="連線裝置" value={client.total} />
        <Kpi label="Switch PoE"
          value={`${switchStat.perSwitch.reduce((s, x) => s + x.poeWatts, 0)}W`}
          sub={`/ ${switchStat.perSwitch.reduce((s, x) => s + (x.poeBudget || 0), 0)}W`} />
        <Kpi label="告警" value={alerts.length} tone={alerts.some((a) => a.severity === 'critical') ? 'crit' : alerts.length ? 'warn' : 'ok'} />
      </div>

      {/* Plan-vs-measured gap (default open) */}
      <Section
        title="規劃 vs 實測"
        open={isOpen('gap')}
        onToggle={() => toggleSection('gap')}
        right={
          <button
            type="button"
            className={`stats-dash__toggle${showGapOverlay ? ' stats-dash__toggle--on' : ''}`}
            onClick={toggleGapOverlay}
            title="在圖上標出「規劃說有訊號、實測卻低於門檻」的落差點"
          >
            {showGapOverlay ? '● 落差已顯示' : '顯示落差'}
          </button>
        }
      >
        <div className="stats-dash__gap-summary">
          <span className={`stats-dash__gap-num${gapClients.length > 0 ? ' stats-dash__gap-num--bad' : ''}`}>
            {gapClients.length}
          </span>
          <span className="stats-dash__gap-label">
            個落差點（規劃 ≥{gapThresholdDbm}dBm 但實測不足）
          </span>
        </div>
        {showGapOverlay && gapClients.length === 0 && (
          <p className="stats-dash__gap-hint">此時段無落差點（連線裝置少時較少見；試拖時間軸到白天尖峰）</p>
        )}
      </Section>

      {/* Alerts (default open) — only shown when there are alerts */}
      {alerts.length > 0 && (
        <Section title={`告警 (${alerts.length})`} open={isOpen('alerts')} onToggle={() => toggleSection('alerts')}>
          <ul className="stats-dash__alerts">
            {alerts.slice(0, 6).map((a) => (
              <li key={a.id}
                className={`stats-dash__alert stats-dash__alert--${a.severity}`}
                onClick={() => (a.kind === 'poe_overload' ? gotoSwitch(a.targetId) : gotoAp(a.targetId))}
                onMouseEnter={() => setHover(a.targetId, a.kind === 'poe_overload' ? 'switch' : 'ap')}
                onMouseLeave={() => clearHoverIf(a.targetId)}
                title="點擊定位到該裝置"
              >
                <span className="stats-dash__alert-icon">{SEV_ICON[a.severity] ?? 'ℹ'}</span>
                <span className="stats-dash__alert-msg">{a.msg}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* AP load ranking (default open) */}
      <Section title="AP 負載排行" open={isOpen('apRank')} onToggle={() => toggleSection('apRank')}>
        <ul className="stats-dash__rank">
          {apRanking.map((a) => (
            <li key={a.apId}
              className="stats-dash__rank-row"
              onClick={() => gotoAp(a.apId)}
              onMouseEnter={() => setHover(a.apId, 'ap')}
              onMouseLeave={() => clearHoverIf(a.apId)}
              title="點擊定位到該 AP"
            >
              <span className="stats-dash__rank-name" title={a.name}>{a.name}</span>
              <span className="stats-dash__rank-bar-track">
                <span className="stats-dash__rank-bar"
                  style={{ width: `${(a.clientCount / maxApClients) * 100}%`, background: BAND_COLOR[String(a.band)] ?? '#4fc3f7' }} />
              </span>
              <b className="stats-dash__rank-val">{a.clientCount}</b>
            </li>
          ))}
          {apRanking.length === 0 && <li className="stats-dash__empty-row">無線上 AP</li>}
        </ul>
      </Section>

      {/* Trend + timeline scrubber (default collapsed — space-hungry) */}
      {anchorTs != null && (
        <Section
          title={`連線裝置趨勢（${rangeHours}h）`}
          open={isOpen('timeline')}
          onToggle={() => toggleSection('timeline')}
          right={!atLive && (
            <button type="button" className="stats-dash__live-btn" onClick={goLive} title="回到即時">
              ⏭ 即時
            </button>
          )}
        >
          <div className="stats-dash__trend">
            {trendPts.map((p, i) => {
              const pct = Math.round(((p.value ?? 0) / trendMax) * 100)
              const isNow = playheadHour != null && new Date(p.ts).getHours() === playheadHour
                && new Date(p.ts).getDate() === new Date(playheadTs).getDate()
              // Hour tick every 6 bars so the user can read that the dip in the
              // middle is overnight (the 24h window wraps past midnight).
              const hr = new Date(p.ts).getHours()
              const showTick = i % 6 === 0
              return (
                <div
                  key={p.ts}
                  className={`stats-dash__trend-col${isNow ? ' stats-dash__trend-col--now' : ''}`}
                  title={`${fmtClock(p.ts)} · ${p.value} 台`}
                  onClick={() => setPlayhead(p.ts)}
                >
                  <div className="stats-dash__trend-track">
                    <div className="stats-dash__trend-bar" style={{ height: `${pct}%` }} />
                  </div>
                  <span className="stats-dash__trend-tick">{showTick ? `${String(hr).padStart(2, '0')}` : ''}</span>
                </div>
              )
            })}
          </div>
          <div className="stats-dash__scrubber">
            <button type="button" className="stats-dash__play" onClick={togglePlaying} title={playing ? '暫停' : '播放'}>
              {playing ? '⏸' : '▶'}
            </button>
            <input
              type="range"
              className="stats-dash__range"
              min={winStart}
              max={anchorTs}
              step={5 * 60 * 1000}
              value={playheadTs ?? anchorTs}
              onChange={(e) => setPlayhead(Number(e.target.value))}
            />
            <div className="stats-dash__speeds">
              {STATS_SPEEDS.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  className={`stats-dash__speed${speed === sp ? ' stats-dash__speed--active' : ''}`}
                  onClick={() => setSpeed(sp)}
                >×{sp}</button>
              ))}
            </div>
          </div>
        </Section>
      )}

      {/* Client band distribution (default collapsed) */}
      <Section title="裝置頻段分布" open={isOpen('bands')} onToggle={() => toggleSection('bands')}>
        <div className="stats-dash__stack" title={`共 ${client.total} 台`}>
          {bands.map((b) => {
            const n = client.byBand[b] ?? 0
            if (n === 0) return null
            return (
              <span key={b} className="stats-dash__stack-seg"
                style={{ width: `${(n / bandTotal) * 100}%`, background: BAND_COLOR[b] }}
                title={`${BAND_LABEL[b]}: ${n} 台`} />
            )
          })}
        </div>
        <div className="stats-dash__legend">
          {bands.map((b) => (
            <span key={b} className="stats-dash__legend-item">
              <span className="stats-dash__legend-dot" style={{ background: BAND_COLOR[b] }} />
              {BAND_LABEL[b]} {client.byBand[b] ?? 0}
            </span>
          ))}
        </div>
      </Section>

      {/* Switch PoE + topology mini-view (default collapsed) */}
      <Section title="Switch / 供電" open={isOpen('switches')} onToggle={() => toggleSection('switches')}>
        <ul className="stats-dash__rank">
          {swRanking.map((s) => {
            const over = s.poeBudget > 0 && s.poeWatts > s.poeBudget
            const pct = s.poeBudget > 0 ? Math.min(100, (s.poeWatts / s.poeBudget) * 100) : 0
            return (
              <li key={s.swId}
                className="stats-dash__sw-row"
                onClick={() => gotoSwitch(s.swId)}
                onMouseEnter={() => setHover(s.swId, 'switch')}
                onMouseLeave={() => clearHoverIf(s.swId)}
                title="點擊定位到該 Switch"
              >
                <div className="stats-dash__sw-head">
                  <span className="stats-dash__rank-name" title={s.name}>{s.name}</span>
                  <b className={`stats-dash__rank-val${over ? ' stats-dash__val--crit' : ''}`}>{s.poeWatts}/{s.poeBudget || '—'}W</b>
                </div>
                <span className="stats-dash__rank-bar-track">
                  <span className={`stats-dash__rank-bar${over ? ' stats-dash__rank-bar--crit' : ''}`}
                    style={{ width: `${pct}%` }} />
                </span>
                <div className="stats-dash__sw-meta">
                  埠 {s.portsUp}/{s.portsTotal}
                  {s.neighbors.length > 0 && (
                    <span className="stats-dash__sw-neighbors">
                      · {s.neighbors.slice(0, 4).map((n) => `P${n.port}→${apNameById(n.deviceId)}`).join('  ')}
                      {s.neighbors.length > 4 ? ` +${s.neighbors.length - 4}` : ''}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
          {swRanking.length === 0 && <li className="stats-dash__empty-row">本樓層無 Switch</li>}
        </ul>
      </Section>

      {/* Client MAC drill-down (default collapsed) */}
      <Section title="裝置查詢" open={isOpen('clients')} onToggle={() => toggleSection('clients')}>
        <input
          className="stats-dash__search"
          type="text"
          placeholder="搜尋 MAC…"
          value={clientQuery}
          onChange={(e) => setClientQuery(e.target.value)}
        />
        {clientQuery.trim() && (
          <ul className="stats-dash__clients">
            {clientMatches.slice(0, 8).map((c) => (
              <li key={c.mac}
                className="stats-dash__client-row"
                onClick={() => gotoAp(c.apId)}
                onMouseEnter={() => setHover(c.apId, 'ap')}
                onMouseLeave={() => clearHoverIf(c.apId)}
                title="點擊定位到所連 AP"
              >
                <span className="stats-dash__client-mac">{c.mac}</span>
                <span className="stats-dash__client-meta">
                  <span className="stats-dash__legend-dot" style={{ background: BAND_COLOR[String(c.band)] }} />
                  {apNameById(c.apId)} · {c.rssiDbm}dBm · {c.linkMbps} Mbps
                </span>
              </li>
            ))}
            {clientMatches.length === 0 && <li className="stats-dash__empty-row">查無裝置</li>}
          </ul>
        )}
      </Section>

      <p className="stats-dash__note">
        本頁所有數值（含告警與「規劃 VS 實測」落差）皆為示範用 mock 資料，
        非實際設備連線 — 未來接 cloud 真實資料。
      </p>
      </>
      )}
    </div>
  )
}

// Mount wrapper — only render inside STATS mode.
export default function StatsDashboardMount() {
  const editorMode = useEditorStore((s) => s.editorMode)
  if (editorMode !== EDITOR_MODE.STATS) return null
  return <StatsDashboard />
}
