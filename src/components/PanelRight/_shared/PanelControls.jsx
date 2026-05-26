import React from 'react'
import './shared.sass'

// 24-3 Form primitives for right-panel controls. Wraps the bare HTML form
// elements with consistent sizing / typography / focus state, so panels stop
// reinventing input styles.
//
// All of these accept the same `value` / `onChange` style as native React form
// inputs — onChange receives the typed value (string for text, number for
// numeric, boolean for checkbox), not the event. Cleaner for callers and lets
// us swap inputs out later without touching every panel.
//
// `accent` is opt-out — most controls inherit the panel's accent through CSS,
// so callers rarely need to set it.

// ── Text input ──────────────────────────────────────────────────────────
export function TextInput({
  value, onChange, placeholder, maxLength, disabled, autoFocus, onBlur, onKeyDown,
  className = '',
}) {
  return (
    <input
      type="text"
      className={`pnl-input ${className}`.trim()}
      value={value ?? ''}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={(e) => onChange?.(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  )
}

// ── Number input ────────────────────────────────────────────────────────
// onChange fires with a number (NaN passes through so callers can decide to
// reject). Use `min` / `max` / `step` like a native input. `unit` renders an
// inline suffix (e.g. "m", "dB"). `width` lets the panel set a narrower box
// for tight grids.
export function NumberInput({
  value, onChange, min, max, step = 1, unit, placeholder, disabled, width,
  onBlur, className = '',
}) {
  const style = width ? { width } : undefined
  return (
    <span className={`pnl-number ${className}`.trim()}>
      <input
        type="number"
        className="pnl-number__input"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        style={style}
        onChange={(e) => {
          const raw = e.target.value
          // Forward empty string as NaN so callers can detect "user cleared"
          // separately from "user typed 0". They typically guard isNaN().
          onChange?.(raw === '' ? NaN : parseFloat(raw))
        }}
        onBlur={onBlur}
      />
      {unit && <span className="pnl-number__unit">{unit}</span>}
    </span>
  )
}

// ── Select ──────────────────────────────────────────────────────────────
// `options` is an array of { value, label, swatch? }. `swatch` is an optional
// colour dot rendered to the left of the label (used by material / tray
// system pickers).
export function Select({
  value, onChange, options, disabled, placeholder, className = '',
}) {
  return (
    <select
      className={`pnl-select ${className}`.trim()}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
    >
      {placeholder != null && <option value="" disabled hidden>{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// ── Checkbox ────────────────────────────────────────────────────────────
// Rendered as a labelled row so panels can drop them inside <PanelSection>
// without extra wrapping.
export function Checkbox({ checked, onChange, label, disabled }) {
  return (
    <label className={`pnl-check${disabled ? ' pnl-check--disabled' : ''}`}>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

// ── Button ──────────────────────────────────────────────────────────────
// `variant`: 'default' | 'primary' | 'danger' | 'ghost'
//   primary = accent fill (use for the panel's main CTA)
//   danger  = red (destructive — already covered by PanelHeader's delete, but
//             secondary danger actions live in sections)
//   ghost   = transparent (toolbar-like, e.g. inline icon buttons)
export function Button({
  variant = 'default', onClick, disabled, type = 'button', children, className = '',
  block = false,
}) {
  const cls = [
    'pnl-btn',
    `pnl-btn--${variant}`,
    block ? 'pnl-btn--block' : '',
    className,
  ].filter(Boolean).join(' ')
  return (
    <button
      type={type}
      className={cls}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
