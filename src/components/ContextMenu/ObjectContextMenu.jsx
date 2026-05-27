import React, { useEffect, useRef, useState } from 'react'
import './TrayContextMenu.sass'

// 23-2d Generic right-click object context menu.
//
// Owns: positioning + viewport clamp, inline rename view, outside-click / Esc
// dismissal, sub-menu expansion. Re-uses TrayContextMenu.sass so all object
// menus look the same.
//
// Caller provides:
//   - title: header label (e.g. "AP-01" / "WALL-01F-03")
//   - items: array of { id, label, icon?, shortcut?, danger?, disabled?,
//                       hint?, submenu?, onClick? }
//       submenu: array of same shape — clicking the parent expands inline
//   - onRename(newName): if provided, the menu shows a "重新命名" item that
//                        switches into an inline rename input. Pass `null` to
//                        omit rename (e.g. FloorImage that has no name).
//   - currentName: pre-fill value for rename input
//   - onClose: dismiss callback (always called after any item action)
//
// Right-click on the menu itself is swallowed so the browser native menu
// doesn't pop up over our menu.
function ObjectContextMenu({
  x, y, title, items = [], currentName, onRename, onClose,
}) {
  const menuRef = useRef(null)
  const renameInputRef = useRef(null)
  const [pos, setPos] = useState({ x, y })
  const [expandedSubId, setExpandedSubId] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(currentName ?? '')

  // Re-clamp once measured.
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const pad = 4
    const maxX = window.innerWidth  - rect.width  - pad
    const maxY = window.innerHeight - rect.height - pad
    setPos({
      x: Math.max(pad, Math.min(x, maxX)),
      y: Math.max(pad, Math.min(y, maxY)),
    })
  }, [x, y])

  // Outside click + Esc dismiss. Esc backs out of rename view first.
  //
  // Two-part guard so the listener doesn't close the menu in two race
  // conditions both rooted in the browser's pointerdown → mousedown
  // ordering for the same right-click gesture:
  //
  //   1) `e.button === 2` short-circuit. Right-clicks anywhere (canvas,
  //      another object, even the menu) should never close via the
  //      outside-click path — they are either the gesture that opened
  //      this menu, or a gesture targeting another object whose own
  //      handler will swap our ctx for theirs. Only left clicks outside
  //      the menu DOM should dismiss it.
  //
  //   2) rAF-deferred attach. Belt-and-suspenders for the FIRST open:
  //      even with the button check above, if some browser fires a
  //      `mousedown` with button=0 alongside the right-click (rare —
  //      certain trackpad emulations), the deferral keeps us safe by
  //      not having the listener live during the gesture that opened
  //      the menu in the first place.
  useEffect(() => {
    const onDocDown = (e) => {
      if (e.button === 2) return
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose?.()
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (renaming) { setRenaming(false); return }
      onClose?.()
    }
    let attached = false
    const raf = requestAnimationFrame(() => {
      document.addEventListener('mousedown', onDocDown)
      attached = true
    })
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      if (attached) document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, renaming])

  // Auto-focus rename input when entering rename view.
  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renaming])

  const fire = (fn) => () => { fn?.(); onClose?.() }

  const commitRename = () => {
    const v = renameValue.trim()
    if (v.length === 0 || v === currentName) { onClose?.(); return }
    onRename?.(v)
    onClose?.()
  }

  const renderItem = (item, isSub = false) => {
    if (item.kind === 'divider') {
      return <div key={item.id} className="tray-ctx-menu__divider" />
    }
    const disabled = !!item.disabled
    const hasSub = Array.isArray(item.submenu) && item.submenu.length > 0
    const expanded = expandedSubId === item.id
    return (
      <React.Fragment key={item.id}>
        <button
          className={[
            'tray-ctx-menu__item',
            disabled ? 'tray-ctx-menu__item--disabled' : '',
            item.danger ? 'tray-ctx-menu__item--danger' : '',
            hasSub ? 'tray-ctx-menu__item--has-sub' : '',
            isSub ? 'tray-ctx-menu__item--sub' : '',
          ].filter(Boolean).join(' ')}
          disabled={disabled}
          title={item.hint ?? undefined}
          onClick={
            disabled
              ? undefined
              : hasSub
                ? () => setExpandedSubId(expanded ? null : item.id)
                : fire(item.onClick)
          }
        >
          <span className="tray-ctx-menu__label">
            {item.swatch && (
              <span
                className="tray-ctx-menu__swatch"
                style={{ background: item.swatch }}
              />
            )}
            {item.icon && <span style={{ marginRight: 4 }}>{item.icon}</span>}
            {item.label}
            {item.hintInline && <span className="tray-ctx-menu__hint">{item.hintInline}</span>}
          </span>
          {hasSub && (
            <span className="tray-ctx-menu__caret">{expanded ? '▾' : '▸'}</span>
          )}
          {item.shortcut && (
            <span className="tray-ctx-menu__shortcut">{item.shortcut}</span>
          )}
        </button>
        {hasSub && expanded && (
          <div className="tray-ctx-menu__sub">
            {item.submenu.map((sub) => renderItem(sub, true))}
          </div>
        )}
      </React.Fragment>
    )
  }

  return (
    <div
      ref={menuRef}
      className="tray-ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="object-ctx-menu"
    >
      <div className="tray-ctx-menu__header">
        <span className="tray-ctx-menu__title">{title}</span>
      </div>

      {renaming ? (
        <div className="tray-ctx-menu__rename">
          <input
            ref={renameInputRef}
            className="tray-ctx-menu__rename-input"
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                commitRename()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setRenaming(false)
              }
            }}
            placeholder="輸入新名稱"
            maxLength={64}
          />
          <div className="tray-ctx-menu__rename-actions">
            <button
              className="tray-ctx-menu__rename-btn tray-ctx-menu__rename-btn--cancel"
              onClick={() => setRenaming(false)}
            >
              取消
            </button>
            <button
              className="tray-ctx-menu__rename-btn tray-ctx-menu__rename-btn--confirm"
              onClick={commitRename}
            >
              確認
            </button>
          </div>
        </div>
      ) : (
        <>
          {onRename && (
            <>
              <button
                className="tray-ctx-menu__item"
                onClick={() => { setRenameValue(currentName ?? ''); setRenaming(true) }}
                data-testid="ctx-menu-rename"
              >
                <span className="tray-ctx-menu__label">重新命名</span>
                <span className="tray-ctx-menu__shortcut">F2</span>
              </button>
              {items.length > 0 && <div className="tray-ctx-menu__divider" />}
            </>
          )}
          {items.map((item) => renderItem(item))}
        </>
      )}
    </div>
  )
}

export default ObjectContextMenu
