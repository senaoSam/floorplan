import React, { useCallback, useMemo } from 'react'
import { useCableStore, DEFAULT_TRAY, DEFAULT_TRAY_MAGNET_PX, TRAY_MOUNT_PRESETS, TRAY_SYSTEMS, resolveTrayMountHeight, getTraySystem, getCapacityProfile } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useEditorStore } from '@/store/useEditorStore'
import { computeRoutes } from '@/features/cable/computeRoutes'
import { computeTrayCableLoads, computeTrayFill } from '@/features/cable/computeTrayFill'
import './APPanel.sass'

// Polyline length in canvas px → meters via floor scale.
function polylineLengthPx(points) {
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total
}

// 19-5: tray health panel — four groups (Identity / Path / Load / Issues).
// Identity = how this tray is labelled / classified; Path = its physical
// geometry; Load = how busy it is (cable count + fill ratio); Issues = the
// problems the user should react to (graph warnings + capacity warnings).
// The Issues group is hidden when the tray has no problems so an
// uneventful tray stays calm in the UI.
function CableTrayPanel({ floorId, trayId }) {
  const tray             = useCableStore((s) => (s.traysByFloor[floorId] ?? []).find((t) => t.id === trayId))
  const updateTray       = useCableStore((s) => s.updateTray)
  const removeTray       = useCableStore((s) => s.removeTray)
  const floor            = useFloorStore((s) => s.floors.find((f) => f.id === floorId))
  const floors           = useFloorStore((s) => s.floors)
  const apsByFloor       = useAPStore((s) => s.apsByFloor)
  const switchesByFloor  = useCableStore((s) => s.switchesByFloor)
  const traysByFloor     = useCableStore((s) => s.traysByFloor)
  const risers           = useCableStore((s) => s.risers)
  const capacityProfile  = useCableStore((s) => s.capacityProfile)
  const customCapacity   = useCableStore((s) => s.customCapacity)
  const clearSelected    = useEditorStore((s) => s.clearSelected)

  const handleNumber = useCallback((field, raw, { min = 0 } = {}) => {
    const num = parseFloat(raw)
    if (isNaN(num) || num < min) return
    updateTray(floorId, trayId, { [field]: num })
  }, [floorId, trayId, updateTray])

  const handleDelete = () => {
    removeTray(floorId, trayId)
    clearSelected()
  }

  const lengthM = useMemo(() => {
    if (!tray || !floor?.scale) return null
    return polylineLengthPx(tray.points) / floor.scale
  }, [tray, floor])

  // Routing + fill + graph warnings are all derived from the same
  // building-wide compute pass; collapse them into a single memo so we
  // never recompute three times in one render.
  const diagnostics = useMemo(() => {
    if (!tray) return null
    const { routes, switchLinks, warnings } = computeRoutes({ floors, apsByFloor, switchesByFloor, traysByFloor, risers })
    const loads = computeTrayCableLoads({ routes, switchLinks, traysByFloor })
    const load  = loads.get(`${floorId}|${trayId}`) ?? { count: 0, copperCount: 0, fiberCount: 0, occupants: [] }
    const profile = getCapacityProfile(capacityProfile, customCapacity)
    const fill = { ...computeTrayFill({ tray, load, profile }), profile }
    // Filter graph warnings to those that reference THIS tray (by name or
    // id). buildGraph emits warnings like "Trays X and Y touch at endpoint
    // …" — keep only the lines that mention the current tray so the panel
    // doesn't drag in other trays' problems.
    const trayNeedle = tray.name ?? tray.id
    const trayWarnings = (warnings ?? []).filter((w) => w.includes(trayNeedle))
    return { fill, trayWarnings, occupants: load.occupants ?? [] }
  }, [tray, floors, apsByFloor, switchesByFloor, traysByFloor, risers, floorId, trayId, capacityProfile, customCapacity])

  // Flat AP / switch lookup tables, so we can resolve occupant names without
  // re-scanning every floor inside the render loop. Routes can span floors
  // via risers — an AP/switch on this tray's path might live elsewhere.
  const nodeLookup = useMemo(() => {
    const apById = new Map()
    const swById = new Map()
    for (const [, list] of Object.entries(apsByFloor)) {
      for (const a of list ?? []) apById.set(a.id, a)
    }
    for (const [, list] of Object.entries(switchesByFloor)) {
      for (const sw of list ?? []) swById.set(sw.id, sw)
    }
    return { apById, swById }
  }, [apsByFloor, switchesByFloor])

  if (!tray) return null

  const magnet = tray.magnetDistance ?? DEFAULT_TRAY_MAGNET_PX
  const magnetM = floor?.scale ? magnet / floor.scale : null

  const displayName = tray.name ?? tray.id
  const sys = getTraySystem(tray.system)
  const fill = diagnostics?.fill ?? null
  const trayWarnings = diagnostics?.trayWarnings ?? []
  const occupants = diagnostics?.occupants ?? []
  const { apById, swById } = nodeLookup

  // Issues = anything the user might want to act on. Capacity warn / full /
  // exceed each get an entry; graph warnings get one entry each. Empty
  // when the tray is healthy.
  const issues = []
  if (fill && fill.status !== 'ok') {
    const map = {
      warn:   { label: '容量注意',   detail: `填充率 ${(fill.fillRatio * 100).toFixed(1)}% ≥ ${(fill.profile.warnRatio * 100).toFixed(0)}%` },
      full:   { label: '容量滿載',   detail: `填充率 ${(fill.fillRatio * 100).toFixed(1)}% ≥ ${(fill.profile.fullRatio * 100).toFixed(0)}%` },
      exceed: { label: '容量超出',   detail: `填充率 ${(fill.fillRatio * 100).toFixed(1)}% > 100%（cable area > tray area）` },
    }
    const e = map[fill.status]
    if (e) issues.push({ kind: 'capacity', label: e.label, detail: e.detail, color: fill.statusColor })
  }
  for (const w of trayWarnings) {
    issues.push({ kind: 'graph', label: 'Graph 警告', detail: w, color: '#fbbf24' })
  }

  return (
    <div className="ap-panel">
      <div className="ap-panel__header">
        <span className="ap-panel__title">{displayName}</span>
        <span className="ap-panel__dot" style={{ background: sys.color }} />
        <button className="panel-delete-btn" onClick={handleDelete}>刪除</button>
      </div>

      {/* ── Identity ──────────────────────────────────────────────── */}
      <p className="tray-group__title">Identity / 身份</p>

      <section className="ap-panel__section">
        <p className="ap-panel__label">名稱</p>
        <input
          className="ap-panel__input"
          type="text"
          value={tray.name ?? ''}
          placeholder={tray.id}
          onChange={(e) => updateTray(floorId, trayId, { name: e.target.value })}
        />
        <p className="ap-panel__hint">自動命名 TRAY-{`{樓層}`}-{`{序號}`}；可手動覆寫</p>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">系統 / 用途</p>
        <select
          className="ap-panel__input ap-panel__select"
          value={tray.system ?? DEFAULT_TRAY.system}
          onChange={(e) => updateTray(floorId, trayId, { system: e.target.value })}
        >
          {TRAY_SYSTEMS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <div className="tray-system-legend">
          {TRAY_SYSTEMS.map((s) => (
            <span key={s.value} className="tray-system-legend__item">
              <span className="tray-system-legend__swatch" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </section>

      {/* ── Path ──────────────────────────────────────────────────── */}
      <p className="tray-group__title">Path / 路徑</p>

      <section className="ap-panel__section">
        <p className="ap-panel__label">幾何</p>
        <p className="ap-panel__hint">
          {tray.points.length} 個頂點　·
          {lengthM != null ? `${lengthM.toFixed(2)} m` : '需先校正比例尺'}
        </p>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">斷面尺寸</p>
        <div className="ap-panel__number-row">
          <span className="ap-panel__unit">寬</span>
          <input
            className="ap-panel__input ap-panel__input--number tray-dim-input"
            type="number" min="1" step="10"
            value={tray.widthMm ?? DEFAULT_TRAY.widthMm}
            onChange={(e) => handleNumber('widthMm', e.target.value, { min: 1 })}
          />
          <span className="ap-panel__unit">深</span>
          <input
            className="ap-panel__input ap-panel__input--number tray-dim-input"
            type="number" min="1" step="10"
            value={tray.depthMm ?? DEFAULT_TRAY.depthMm}
            onChange={(e) => handleNumber('depthMm', e.target.value, { min: 1 })}
          />
          <span className="ap-panel__unit">mm</span>
        </div>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">安裝高度</p>
        <select
          className="ap-panel__input ap-panel__select"
          value={tray.mountPreset ?? DEFAULT_TRAY.mountPreset}
          onChange={(e) => updateTray(floorId, trayId, { mountPreset: e.target.value })}
        >
          {TRAY_MOUNT_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {(tray.mountPreset ?? DEFAULT_TRAY.mountPreset) === 'custom' && (
          <div className="ap-panel__number-row" style={{ marginTop: 6 }}>
            <input
              className="ap-panel__input ap-panel__input--number"
              type="number" min="0" step="0.1"
              value={tray.mountHeight ?? DEFAULT_TRAY.mountHeight}
              onChange={(e) => handleNumber('mountHeight', e.target.value, { min: 0 })}
            />
            <span className="ap-panel__unit">m</span>
          </div>
        )}
        <p className="ap-panel__hint">
          3D 視覺位於 {resolveTrayMountHeight(tray, floor).toFixed(2)} m
        </p>
      </section>

      <section className="ap-panel__section">
        <p className="ap-panel__label">
          磁吸範圍
          {magnetM != null && (
            <span className="ap-panel__hint-inline">（約 {magnetM.toFixed(2)} m）</span>
          )}
        </p>
        <div className="ap-panel__number-row">
          <input
            className="ap-panel__input ap-panel__input--number tray-dim-input"
            type="number" min="1" step="10"
            value={magnet}
            onChange={(e) => handleNumber('magnetDistance', e.target.value, { min: 1 })}
          />
          <span className="ap-panel__unit">px</span>
        </div>
      </section>

      {/* ── Load ──────────────────────────────────────────────────── */}
      {fill && (
        <>
          <p className="tray-group__title">Load / 負載</p>

          <section className="ap-panel__section">
            <p className="ap-panel__label">
              容量
              <span className="tray-fill-badge" style={{ background: fill.statusColor }}>
                {fill.statusLabel}
              </span>
            </p>
            <div className="ap-panel__number-row tray-fill-row">
              <span className="ap-panel__unit" style={{ minWidth: 56 }}>填充率</span>
              <span style={{ color: fill.statusColor, fontWeight: 600 }}>
                {(fill.fillRatio * 100).toFixed(1)}%
              </span>
              <span className="ap-panel__unit">
                （{fill.cableAreaMm2.toFixed(0)} / {fill.trayAreaMm2.toFixed(0)} mm²）
              </span>
            </div>
            <div className="ap-panel__number-row tray-fill-row">
              <span className="ap-panel__unit" style={{ minWidth: 56 }}>纜線數</span>
              <span style={{ color: '#e5e7eb' }}>{fill.count} 條</span>
              {fill.copperCount > 0 && (
                <span className="ap-panel__unit">　copper {fill.copperCount}</span>
              )}
              {fill.fiberCount > 0 && (
                <span className="ap-panel__unit">　fiber {fill.fiberCount}</span>
              )}
            </div>
            <p className="ap-panel__hint">
              設定值：注意 ≥ {(fill.profile.warnRatio * 100).toFixed(0)}%、
              滿載 ≥ {(fill.profile.fullRatio * 100).toFixed(0)}%、超出 &gt; 100%
            </p>
          </section>
        </>
      )}

      {/* ── 20-2 占用 cable 列表 ───────────────────────────────────
          Lists each AP drop / S2S link that traverses this tray, so users
          can answer "if I remove this tray, which cables break?". Hidden
          when the tray carries nothing (e.g. tray drawn but no AP/switch
          attached yet). */}
      {occupants.length > 0 && (
        <section className="ap-panel__section">
          <p className="ap-panel__label">
            占用 cable
            <span className="ap-panel__hint-inline">（{occupants.length} 條）</span>
          </p>
          <ul className="tray-occupant-list">
            {occupants.map((o, i) => {
              if (o.kind === 'ap') {
                const ap = apById.get(o.apId)
                const sw = o.switchId ? swById.get(o.switchId) : null
                const name = ap?.name ?? o.apId
                const target = sw?.name ?? (o.switchId ?? '—')
                return (
                  <li key={`ap-${o.apId}-${i}`} className="tray-occupant">
                    <span className="tray-occupant__name">{name}</span>
                    <span className="tray-occupant__arrow">→</span>
                    <span className="tray-occupant__name tray-occupant__name--sw">{target}</span>
                    <span className={`tray-occupant__type tray-occupant__type--${o.cableType}`}>
                      {o.cableType}
                    </span>
                    <span className="tray-occupant__len">
                      {o.cableM != null ? `${o.cableM.toFixed(1)} m` : '—'}
                    </span>
                  </li>
                )
              }
              // s2s
              const src = swById.get(o.srcId)
              const tgt = swById.get(o.targetId)
              return (
                <li key={`s2s-${o.srcId}-${o.targetId}-${i}`} className="tray-occupant">
                  <span className="tray-occupant__name tray-occupant__name--sw">
                    {src?.name ?? o.srcId}
                  </span>
                  <span className="tray-occupant__arrow">⇄</span>
                  <span className="tray-occupant__name tray-occupant__name--sw">
                    {tgt?.name ?? o.targetId}
                  </span>
                  <span className={`tray-occupant__type tray-occupant__type--${o.cableType}`}>
                    {o.cableType}
                  </span>
                  <span className="tray-occupant__len">
                    {o.cableM != null ? `${o.cableM.toFixed(1)} m` : '—'}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* ── Issues ─────────────────────────────────────────────────
          Hidden when the tray has no problems, so a healthy tray panel
          ends after Load without an empty placeholder. */}
      {issues.length > 0 && (
        <>
          <p className="tray-group__title tray-group__title--warn">
            Issues / 問題 ({issues.length})
          </p>
          <section className="ap-panel__section">
            <ul className="tray-issue-list">
              {issues.map((it, i) => (
                <li key={i} className="tray-issue" style={{ borderLeftColor: it.color }}>
                  <span className="tray-issue__label" style={{ color: it.color }}>
                    {it.label}
                  </span>
                  <span className="tray-issue__detail">{it.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

export default CableTrayPanel
