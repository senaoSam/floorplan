import React from 'react'
import { showUiToast } from '@/store/useUiToastStore'
import './shared.sass'

// 24-3 Canonical right-panel layout primitives.
//
// Every per-type panel (Wall / AP / Switch / …) should compose itself from
// these primitives instead of writing its own header / section / field
// markup. This keeps:
//   - spacing consistent (padding / borders / gaps)
//   - label typography consistent (size / weight / casing)
//   - delete-button placement consistent
//   - accent colour wiring centralised (24-5 will theme by group)
//
// `accent` ∈ 'wall' | 'ap' | 'cable' | 'measure' | 'meta' | undefined
// Picks the group's accent colour. CSS resolves the actual hex value
// (so themes can be retuned in one place — see shared.sass `--panel-accent`).
//
// Usage:
//
//   <PanelShell accent="ap">
//     <PanelHeader title="AP-01" onDelete={…} />
//     <PanelSection title="識別">
//       <PanelField label="名稱">…</PanelField>
//     </PanelSection>
//     <PanelSection title="幾何">…</PanelSection>
//     …
//   </PanelShell>
//
// PanelShell intentionally does NOT scroll on its own — the parent
// `.panel-right` already scrolls. Nested scrolling here would double-scroll
// and trap wheel events.

export function PanelShell({ accent, children, className = '' }) {
  return (
    <div className={`pnl pnl--${accent ?? 'neutral'} ${className}`.trim()}>
      {children}
    </div>
  )
}

// Top header: name on the left, optional meta line, optional delete on the
// right. `onDelete` is rendered as the canonical 「刪除」 button — keep
// destructive actions consistent across panels.
export function PanelHeader({ title, meta, onDelete, deleteLabel = '刪除' }) {
  // Unified delete policy (ui-spec §2.4): single-object deletes are instant
  // but always leave an undo-hint toast so the action never feels lossy.
  const handleDelete = () => {
    onDelete()
    showUiToast(
      deleteLabel === '刪除'
        ? `已刪除「${title}」（Ctrl+Z 可復原）`
        : `已${deleteLabel}`,
    )
  }
  return (
    <header className="pnl__header">
      <div className="pnl__header-text">
        <div className="pnl__title">{title}</div>
        {meta != null && <div className="pnl__meta">{meta}</div>}
      </div>
      {onDelete && (
        <button
          type="button"
          className="pnl__delete"
          onClick={handleDelete}
        >
          {deleteLabel}
        </button>
      )}
    </header>
  )
}

// One titled, bordered section. `title` is rendered in the panel's standard
// section-label style. `disabled` greys it out + blocks pointer events (used
// for "coming soon" features without removing the box).
export function PanelSection({ title, disabled = false, comingSoon = false, children }) {
  return (
    <section className={`pnl__section${disabled ? ' pnl__section--disabled' : ''}`}>
      {title && (
        <h3 className="pnl__section-title">
          {title}
          {comingSoon && <span className="pnl__coming">即將推出</span>}
        </h3>
      )}
      <div className="pnl__section-body">{children}</div>
    </section>
  )
}

// A single labelled row. `label` left, value (children) right. Use this for
// simple read-only or single-input rows. For free-form layouts (e.g. a grid
// of buttons), drop the wrapper and put markup directly inside the section.
export function PanelField({ label, hint, children }) {
  return (
    <div className="pnl__field">
      {label && (
        <div className="pnl__field-label">
          {label}
          {hint && <span className="pnl__field-hint">{hint}</span>}
        </div>
      )}
      <div className="pnl__field-value">{children}</div>
    </div>
  )
}

// Empty / placeholder state when nothing is selected. Centralised so the
// "未選取" message reads identically across panels.
export function PanelEmpty({ children = '未選取任何物件' }) {
  return <div className="pnl__empty">{children}</div>
}

export default PanelShell
