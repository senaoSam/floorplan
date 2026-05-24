import React, { useState } from 'react'
import { useEditorStore } from '@/store/useEditorStore'
import Icon from '@/components/Icon/Icon'
import './LayerToggle.sass'

// Layer visibility panel — Phase 24 redesign.
//   - Accordion: 3 groups (structure / wireless / cable); collapsed by default.
//   - Each group's items show a unified eye / eye-off icon for state.
//   - Wireless and Cable groups have a master toggle + sub-toggles
//     (AP by band, Switch by kind). Subs are gated by the master: when the
//     master is off, subs render dimmed but still independently toggleable.
//   - Sub-items use an indent + small connector glyph for visual hierarchy.

// Plain layer keys backed by a boolean in useEditorStore.
const STRUCTURE_ITEMS = [
  { key: 'showFloorImage', label: '平面圖' },
  { key: 'showWalls',      label: '牆體' },
  { key: 'showFloorHoles', label: '中庭' },
  { key: 'showScopes',     label: '範圍' },
]

const CABLE_NON_SWITCH_ITEMS = [
  { key: 'showCableTrays', label: '線槽' },
  { key: 'showRisers',     label: 'Riser' },
  { key: 'showCables',     label: '線纜' },
]

// AP sub-bands (gated by showAPs).
const AP_BANDS = [
  { band: 2.4, label: '2.4 GHz' },
  { band: 5,   label: '5 GHz'   },
  { band: 6,   label: '6 GHz'   },
]

// Switch sub-kinds (gated by showSwitches). 'switch' is the access-layer
// default kind; using the same label as the master would be confusing, so
// the master is labelled "全部 Switch" and this sub stays "Switch".
const SWITCH_KINDS_UI = [
  { kind: 'switch', label: 'Switch' },
  { kind: 'idf',    label: 'IDF'    },
  { kind: 'mdf',    label: 'MDF'    },
  { kind: 'router', label: 'Router' },
]

function VisibilityRow({ visible, label, onClick, indent = false, dim = false }) {
  return (
    <button
      type="button"
      className={
        'layer-toggle__row' +
        (indent ? ' layer-toggle__row--indent' : '') +
        (!visible ? ' layer-toggle__row--off' : '') +
        (dim ? ' layer-toggle__row--dim' : '')
      }
      onClick={onClick}
    >
      <Icon name={visible ? 'eye' : 'eyeOff'} size={15} />
      <span className="layer-toggle__row-label">{label}</span>
    </button>
  )
}

function GroupHeader({ open, label, onClick }) {
  return (
    <button
      type="button"
      className="layer-toggle__group-header"
      onClick={onClick}
      aria-expanded={open}
    >
      <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
      <span className="layer-toggle__group-label">{label}</span>
    </button>
  )
}

function LayerToggle() {
  const toggleLayer     = useEditorStore((s) => s.toggleLayer)
  const toggleAPBand    = useEditorStore((s) => s.toggleAPBand)
  const toggleSwitchKind = useEditorStore((s) => s.toggleSwitchKind)
  // Subscribe to the slice of state this panel renders. One selector keeps
  // re-render to "any layer flag changed" which is fine — the panel is small.
  const s = useEditorStore((st) => ({
    showFloorImage: st.showFloorImage,
    showWalls:      st.showWalls,
    showFloorHoles: st.showFloorHoles,
    showScopes:     st.showScopes,
    showAPs:        st.showAPs,
    showAPInfo:     st.showAPInfo,
    showAPBand:     st.showAPBand,
    showSwitches:   st.showSwitches,
    showSwitchKind: st.showSwitchKind,
    showCableTrays: st.showCableTrays,
    showRisers:     st.showRisers,
    showCables:     st.showCables,
  }))

  const [panelOpen,   setPanelOpen]   = useState(false)
  // Groups collapsed by default per spec.
  const [openGroups, setOpenGroups] = useState({
    structure: false,
    wireless:  false,
    cable:     false,
  })
  const toggleGroup = (id) => setOpenGroups((g) => ({ ...g, [id]: !g[id] }))

  return (
    <div className="layer-toggle">
      <button
        type="button"
        className="layer-toggle__header"
        onClick={() => setPanelOpen((v) => !v)}
        aria-expanded={panelOpen}
      >
        <Icon name="eye" size={16} />
        <span className="layer-toggle__title">圖層</span>
        <Icon name={panelOpen ? 'chevronDown' : 'chevronRight'} size={14} />
      </button>

      {panelOpen && (
        <div className="layer-toggle__body">

          {/* ── 平面 / 結構 ───────────────────────────────── */}
          <GroupHeader open={openGroups.structure} label="平面 / 結構"
            onClick={() => toggleGroup('structure')} />
          {openGroups.structure && (
            <div className="layer-toggle__group-body">
              {STRUCTURE_ITEMS.map((it) => (
                <VisibilityRow
                  key={it.key}
                  visible={s[it.key]}
                  label={it.label}
                  onClick={() => toggleLayer(it.key)}
                />
              ))}
            </div>
          )}

          {/* ── 無線 AP ─────────────────────────────────── */}
          <GroupHeader open={openGroups.wireless} label="無線 AP"
            onClick={() => toggleGroup('wireless')} />
          {openGroups.wireless && (
            <div className="layer-toggle__group-body">
              <VisibilityRow
                visible={s.showAPs}
                label="全部 AP"
                onClick={() => toggleLayer('showAPs')}
              />
              {AP_BANDS.map((b) => (
                <VisibilityRow
                  key={b.band}
                  visible={s.showAPBand[b.band]}
                  label={b.label}
                  indent
                  dim={!s.showAPs}
                  onClick={() => toggleAPBand(b.band)}
                />
              ))}
              <VisibilityRow
                visible={s.showAPInfo}
                label="AP 資訊"
                onClick={() => toggleLayer('showAPInfo')}
              />
            </div>
          )}

          {/* ── 網路布線 ────────────────────────────────── */}
          <GroupHeader open={openGroups.cable} label="網路布線"
            onClick={() => toggleGroup('cable')} />
          {openGroups.cable && (
            <div className="layer-toggle__group-body">
              <VisibilityRow
                visible={s.showSwitches}
                label="全部 Switch"
                onClick={() => toggleLayer('showSwitches')}
              />
              {SWITCH_KINDS_UI.map((k) => (
                <VisibilityRow
                  key={k.kind}
                  visible={s.showSwitchKind[k.kind]}
                  label={k.label}
                  indent
                  dim={!s.showSwitches}
                  onClick={() => toggleSwitchKind(k.kind)}
                />
              ))}
              {CABLE_NON_SWITCH_ITEMS.map((it) => (
                <VisibilityRow
                  key={it.key}
                  visible={s[it.key]}
                  label={it.label}
                  onClick={() => toggleLayer(it.key)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default LayerToggle
