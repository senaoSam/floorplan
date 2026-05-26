import React, { useMemo } from 'react'
import { useCableStore, SWITCH_KINDS } from '@/store/useCableStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import './_panel.sass'

const CABLE_TYPE_OPTIONS = [
  { value: 'auto',   label: '自動 Auto' },
  { value: 'copper', label: '銅纜 Copper' },
  { value: 'fiber',  label: '光纖 Fiber' },
]

// Phase 25 SwitchPanel — identification, position, hardware, plus uplink
// + cable-type controls (29-3). uplink dropdown lists every other switch
// in the building so the user can wire the upstream tier manually.

function SwitchPanel({ floorId, swId }) {
  const switches = useCableStore((s) => s.switchesByFloor[floorId] ?? [])
  const switchesByFloor = useCableStore((s) => s.switchesByFloor)
  const floors = useFloorStore((s) => s.floors)
  const updateSwitch = useCableStore((s) => s.updateSwitch)
  const removeSwitch = useCableStore((s) => s.removeSwitch)
  const clearSelected = useEditorStore((s) => s.clearSelected)

  const sw = switches.find((s) => s.id === swId)

  // Uplink dropdown source — every switch in the building except self.
  // Order: same floor first, then other floors. Each entry annotated with
  // floor name so the user can disambiguate identical names across floors.
  const uplinkCandidates = useMemo(() => {
    if (!sw) return []
    const out = []
    const floorById = new Map(floors.map((f) => [f.id, f]))
    const pushFromFloor = (fid) => {
      for (const s of switchesByFloor[fid] ?? []) {
        if (s.id === sw.id) continue
        const f = floorById.get(fid)
        out.push({ id: s.id, label: f ? `${s.name} (${f.name})` : s.name })
      }
    }
    pushFromFloor(floorId)
    for (const f of floors) if (f.id !== floorId) pushFromFloor(f.id)
    return out
  }, [floors, switchesByFloor, floorId, sw])

  if (!sw) return null

  const onPatch = (patch) => updateSwitch(floorId, swId, patch)
  const onDelete = () => {
    removeSwitch(floorId, swId)
    clearSelected()
  }

  return (
    <div className="obj-panel">
      <div className="obj-panel__header">
        <span className="obj-panel__title">{sw.name ?? swId}</span>
        <button type="button" className="obj-panel__delete" onClick={onDelete}>刪除</button>
      </div>

      <section className="obj-panel__section">
        <div className="obj-panel__section-title">識別</div>
        <label className="obj-panel__field">
          <span>名稱</span>
          <input
            type="text"
            value={sw.name ?? ''}
            onChange={(e) => onPatch({ name: e.target.value })}
          />
        </label>
        <label className="obj-panel__field">
          <span>類型</span>
          <select
            value={sw.kind ?? 'switch'}
            onChange={(e) => onPatch({ kind: e.target.value })}
          >
            {SWITCH_KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="obj-panel__section">
        <div className="obj-panel__section-title">位置</div>
        <div className="obj-panel__row">
          <label className="obj-panel__field">
            <span>X (px)</span>
            <input
              type="number"
              step="1"
              value={Math.round(sw.x)}
              onChange={(e) => onPatch({ x: parseFloat(e.target.value) || 0 })}
            />
          </label>
          <label className="obj-panel__field">
            <span>Y (px)</span>
            <input
              type="number"
              step="1"
              value={Math.round(sw.y)}
              onChange={(e) => onPatch({ y: parseFloat(e.target.value) || 0 })}
            />
          </label>
        </div>
        <label className="obj-panel__field">
          <span>安裝高度 (m)</span>
          <input
            type="number"
            step="0.1"
            value={sw.mountHeight ?? 0.5}
            onChange={(e) => onPatch({ mountHeight: parseFloat(e.target.value) || 0 })}
          />
        </label>
      </section>

      <section className="obj-panel__section">
        <div className="obj-panel__section-title">硬體</div>
        <label className="obj-panel__field">
          <span>型號</span>
          <input
            type="text"
            value={sw.model ?? ''}
            onChange={(e) => onPatch({ model: e.target.value })}
          />
        </label>
        <div className="obj-panel__row">
          <label className="obj-panel__field">
            <span>Port 數</span>
            <input
              type="number"
              step="1"
              value={sw.portCount ?? 0}
              onChange={(e) => onPatch({ portCount: parseInt(e.target.value, 10) || 0 })}
            />
          </label>
          <label className="obj-panel__field">
            <span>PoE (W)</span>
            <input
              type="number"
              step="10"
              value={sw.poeBudget ?? 0}
              onChange={(e) => onPatch({ poeBudget: parseFloat(e.target.value) || 0 })}
            />
          </label>
        </div>
      </section>

      <section className="obj-panel__section">
        <div className="obj-panel__section-title">上行 Uplink</div>
        <label className="obj-panel__field">
          <span>連到 (Uplink To)</span>
          <select
            value={sw.uplinkTo ?? ''}
            onChange={(e) => onPatch({ uplinkTo: e.target.value || null })}
          >
            <option value="">— 無 —</option>
            {uplinkCandidates.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="obj-panel__field">
          <span>線材 Cable Type</span>
          <select
            value={sw.cableType ?? 'auto'}
            onChange={(e) => onPatch({ cableType: e.target.value })}
          >
            {CABLE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <div className="obj-panel__row">
          <label className="obj-panel__field">
            <span>Uplink Port</span>
            <input
              type="text"
              value={sw.uplinkPortType ?? ''}
              onChange={(e) => onPatch({ uplinkPortType: e.target.value })}
            />
          </label>
          <label className="obj-panel__field">
            <span>Uplink 數</span>
            <input
              type="number"
              step="1"
              min="0"
              value={sw.uplinkCount ?? 0}
              onChange={(e) => onPatch({ uplinkCount: parseInt(e.target.value, 10) || 0 })}
            />
          </label>
        </div>
      </section>
    </div>
  )
}

export default SwitchPanel
