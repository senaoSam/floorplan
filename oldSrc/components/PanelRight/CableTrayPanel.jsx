import React, { useCallback, useMemo } from 'react'
import { useCableStore, DEFAULT_TRAY, DEFAULT_TRAY_MAGNET_PX, TRAY_MOUNT_PRESETS, TRAY_SYSTEMS, resolveTrayMountHeight, getTraySystem, getCapacityProfile } from '@/store/useCableStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { useEditorStore } from '@/store/useEditorStore'
import { computeRoutes } from '@/features/cable/computeRoutes'
import { computeTrayCableLoads, computeTrayFill } from '@/features/cable/computeTrayFill'
import { PanelShell, PanelHeader, PanelSection, PanelField } from './_shared/PanelShell'
import { TextInput, NumberInput, Select } from './_shared/PanelControls'
import './_shared/shared.sass'
import './CableTrayPanel.sass'

// Polyline length in canvas px → meters via floor scale.
function polylineLengthPx(points) {
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total
}

// 19-5 / 24-3: tray health panel — four groups via <PanelSection>.
//   Identity = how this tray is labelled / classified
//   Path     = its physical geometry (vertex count, length, cross-section,
//              mount height, magnet range)
//   Load     = how busy it is (cable count + fill ratio + occupant list)
//   Issues   = capacity warnings + graph warnings the user should act on
// The Issues group is hidden when the tray has no problems — an uneventful
// tray stays calm in the UI.
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

  const handleNumber = useCallback((field, num, { min = 0 } = {}) => {
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

  const diagnostics = useMemo(() => {
    if (!tray) return null
    const { routes, switchLinks, warnings } = computeRoutes({ floors, apsByFloor, switchesByFloor, traysByFloor, risers })
    const loads = computeTrayCableLoads({ routes, switchLinks, traysByFloor })
    const load  = loads.get(`${floorId}|${trayId}`) ?? { count: 0, copperCount: 0, fiberCount: 0, occupants: [] }
    const profile = getCapacityProfile(capacityProfile, customCapacity)
    const fill = { ...computeTrayFill({ tray, load, profile }), profile }
    const trayNeedle = tray.name ?? tray.id
    const trayWarnings = (warnings ?? []).filter((w) => w.includes(trayNeedle))
    return { fill, trayWarnings, occupants: load.occupants ?? [] }
  }, [tray, floors, apsByFloor, switchesByFloor, traysByFloor, risers, floorId, trayId, capacityProfile, customCapacity])

  const nodeLookup = useMemo(() => {
    const apById = new Map()
    const swById = new Map()
    for (const list of Object.values(apsByFloor)) {
      for (const ap of list ?? []) apById.set(ap.id, ap)
    }
    for (const list of Object.values(switchesByFloor)) {
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

  // Issues = capacity + graph warnings, collected in one list so the Issues
  // section renders zero or N entries with consistent styling.
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

  const mountPreset = tray.mountPreset ?? DEFAULT_TRAY.mountPreset

  return (
    <PanelShell accent="cable_tray">
      <PanelHeader
        title={displayName}
        meta={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: sys.color }} />
            Cable Tray
          </span>
        }
        onDelete={handleDelete}
      />

      <PanelSection title="識別">
        <PanelField label="名稱" hint="自動命名 TRAY-{樓層}-{序號}；可手動覆寫">
          <TextInput
            value={tray.name ?? ''}
            placeholder={tray.id}
            onChange={(v) => updateTray(floorId, trayId, { name: v })}
          />
        </PanelField>
        <PanelField label="系統 / 用途">
          <Select
            value={tray.system ?? DEFAULT_TRAY.system}
            onChange={(v) => updateTray(floorId, trayId, { system: v })}
            options={TRAY_SYSTEMS.map((s) => ({ value: s.value, label: s.label }))}
          />
        </PanelField>
        <div className="tray-system-legend">
          {TRAY_SYSTEMS.map((s) => (
            <span key={s.value} className="tray-system-legend__item">
              <span className="tray-system-legend__swatch" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="幾何">
        <PanelField label="路徑">
          <span>
            {tray.points.length} 個頂點 ·
            {lengthM != null ? ` ${lengthM.toFixed(2)} m` : ' 需先校正比例尺'}
          </span>
        </PanelField>
        <PanelField label="斷面尺寸">
          <span className="tray-dim-row">
            <span className="tray-dim-label">寬</span>
            <NumberInput
              value={tray.widthMm ?? DEFAULT_TRAY.widthMm}
              min={1}
              step={10}
              width={70}
              onChange={(v) => handleNumber('widthMm', v, { min: 1 })}
            />
            <span className="tray-dim-label">深</span>
            <NumberInput
              value={tray.depthMm ?? DEFAULT_TRAY.depthMm}
              min={1}
              step={10}
              unit="mm"
              width={70}
              onChange={(v) => handleNumber('depthMm', v, { min: 1 })}
            />
          </span>
        </PanelField>
        <PanelField
          label="安裝高度"
          hint={`3D 視覺位於 ${resolveTrayMountHeight(tray, floor).toFixed(2)} m`}
        >
          <Select
            value={mountPreset}
            onChange={(v) => updateTray(floorId, trayId, { mountPreset: v })}
            options={TRAY_MOUNT_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
          />
        </PanelField>
        {mountPreset === 'custom' && (
          <PanelField label="自訂高度">
            <NumberInput
              value={tray.mountHeight ?? DEFAULT_TRAY.mountHeight}
              min={0}
              step={0.1}
              unit="m"
              width={70}
              onChange={(v) => handleNumber('mountHeight', v, { min: 0 })}
            />
          </PanelField>
        )}
        <PanelField
          label="磁吸範圍"
          hint={magnetM != null ? `約 ${magnetM.toFixed(2)} m` : null}
        >
          <NumberInput
            value={magnet}
            min={1}
            step={10}
            unit="px"
            width={80}
            onChange={(v) => handleNumber('magnetDistance', v, { min: 1 })}
          />
        </PanelField>
      </PanelSection>

      {fill && (
        <PanelSection title="狀態">
          <PanelField label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              容量
              <span className="tray-fill-badge" style={{ background: fill.statusColor }}>
                {fill.statusLabel}
              </span>
            </span>
          }>
            <span style={{ color: fill.statusColor, fontWeight: 600 }}>
              {(fill.fillRatio * 100).toFixed(1)}%
            </span>
            <span className="tray-fill-detail">
              （{fill.cableAreaMm2.toFixed(0)} / {fill.trayAreaMm2.toFixed(0)} mm²）
            </span>
          </PanelField>
          <PanelField label="纜線數">
            <span>{fill.count} 條</span>
            {fill.copperCount > 0 && (
              <span className="tray-fill-detail">　copper {fill.copperCount}</span>
            )}
            {fill.fiberCount > 0 && (
              <span className="tray-fill-detail">　fiber {fill.fiberCount}</span>
            )}
          </PanelField>
          <div className="tray-capacity-hint">
            設定值：注意 ≥ {(fill.profile.warnRatio * 100).toFixed(0)}%、
            滿載 ≥ {(fill.profile.fullRatio * 100).toFixed(0)}%、超出 &gt; 100%
          </div>

          {occupants.length > 0 && (
            <>
              <div className="tray-occupant-header">
                占用 cable
                <span className="tray-occupant-count">（{occupants.length} 條）</span>
              </div>
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
            </>
          )}
        </PanelSection>
      )}

      {issues.length > 0 && (
        <PanelSection title={`警告 (${issues.length})`}>
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
        </PanelSection>
      )}
    </PanelShell>
  )
}

export default CableTrayPanel
