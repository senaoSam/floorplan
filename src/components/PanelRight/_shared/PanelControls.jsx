import React, { useRef, useEffect } from 'react'
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
  // 53-G10 (P1-11): Escape reverts to the value the field had when it gained
  // focus, then blurs. These inputs write straight through to the store on every
  // keystroke, so clearing one with Delete (the gesture F2 invites) committed an
  // empty name immediately and Escape did nothing — verified: an AP went to ""
  // and stayed there. A blur guard already substitutes a fallback name (52-D9),
  // but that replaces the name rather than restoring the one the user had.
  const revertRef = useRef(value)
  const focusedRef = useRef(false)

  // Track the last committed value while unfocused: `autoFocus` can mount the
  // input already focused, so onFocus is not guaranteed to run first.
  useEffect(() => {
    if (!focusedRef.current) revertRef.current = value
  }, [value])

  const handleFocus = () => { focusedRef.current = true; revertRef.current = value }
  const handleBlur = (e) => { focusedRef.current = false; onBlur?.(e) }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      const revertTo = revertRef.current
      if (revertTo !== value) onChange?.(revertTo ?? '')
      // Blur AFTER the reverted value has been committed. Callers may attach an
      // onBlur guard that substitutes a fallback when the field is empty (52-D9
      // does exactly that for names); blurring synchronously here let that guard
      // observe the still-empty value and mint a NEW name (AP-01 -> AP-06)
      // instead of the restore the user asked for.
      const el = e.currentTarget
      focusedRef.current = false
      setTimeout(() => el.blur(), 0)
      return
    }
    onKeyDown?.(e)
  }

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
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
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
