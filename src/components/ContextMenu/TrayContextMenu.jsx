import React, { useEffect, useRef, useState } from 'react'
import { TRAY_SYSTEMS } from '@/store/useCableStore'
import './TrayContextMenu.sass'

// 20-4 Right-click context menu for a Cable Tray.
// Actions: Rename / Split here / Extend from this end / Merge with neighbor /
// Convert system › / Delete.
//
// "Split here" only enables when the click landed on a segment (not on the
// extension of an endpoint). "Extend" / "Merge" only enable when the click
// landed near an endpoint — extending from the middle would be ambiguous,
// and merging requires another tray's endpoint coinciding with this one.
//
// Positioning: caller passes screen-space (x, y); menu pins its top-left
// there and clamps inward if it would overflow the viewport.
function TrayContextMenu({
  x, y, trayName, hitContext, mergeCandidate,
  onRename, onSplit, onExtend, onMerge, onConvert, onDelete, onClose,
}) {
  const menuRef = useRef(null)
  const renameInputRef = useRef(null)
  const [pos, setPos] = useState({ x, y })
  const [submenu, setSubmenu] = useState(null) // 'convert' | null
  // Inline rename view replaces the menu items in-place when active. Avoids
  // window.prompt (jarring browser chrome) and avoids a separate modal layer.
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(trayName ?? '')

  // Re-clamp position once the menu has its measured size, so the visual
  // top-left stays inside the viewport even when the menu would otherwise
  // hang off the right / bottom edge.
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

  // Dismiss on outside click + Esc. Click on a menu item still fires through
  // because that item calls onClose itself after running its action.
  // When the inline rename view is active, Esc cancels the rename (drops back
  // to the menu) instead of closing — gives the user a chance to back out
  // without losing the rest of the menu's actions.
  useEffect(() => {
    const onDocDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose?.()
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (renaming) { setRenaming(false); return }
      onClose?.()
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, renaming])

  // Auto-focus + select the rename input when the rename view opens so the
  // user can immediately type a replacement name.
  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renaming])

  const canSplit  = hitContext?.kind === 'segment'
  const canEndpoint = hitContext?.kind === 'endpoint'
  const canMerge  = canEndpoint && !!mergeCandidate

  const fire = (fn) => () => { fn?.(); onClose?.() }

  const commitRename = () => {
    const v = renameValue.trim()
    if (v.length === 0 || v === trayName) { onClose?.(); return }
    onRename?.(v)
    onClose?.()
  }

  return (
    <div
      ref={menuRef}
      className="tray-ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="tray-ctx-menu__header">
        <span className="tray-ctx-menu__title">{trayName}</span>
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
              // Stop Esc/Enter from leaking up — the document-level handler
              // would otherwise close the menu before commit/cancel fires.
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
      <button
        className="tray-ctx-menu__item"
        onClick={() => { setRenameValue(trayName ?? ''); setRenaming(true) }}
      >
        <span className="tray-ctx-menu__label">重新命名</span>
        <span className="tray-ctx-menu__shortcut">F2</span>
      </button>

      <div className="tray-ctx-menu__divider" />

      <button
        className={`tray-ctx-menu__item ${canSplit ? '' : 'tray-ctx-menu__item--disabled'}`}
        disabled={!canSplit}
        title={canSplit ? '在點擊處將 tray 切成兩段（共用 vertex）' : '在線段中段點右鍵才能切割'}
        onClick={canSplit ? fire(onSplit) : undefined}
      >
        <span className="tray-ctx-menu__label">在此切割</span>
      </button>
      <button
        className={`tray-ctx-menu__item ${canEndpoint ? '' : 'tray-ctx-menu__item--disabled'}`}
        disabled={!canEndpoint}
        title={canEndpoint ? '從這個端點開始畫一條延伸的新 tray（共用端點 xy → graph 自動連通）' : '在端點附近右鍵才能延伸'}
        onClick={canEndpoint ? fire(onExtend) : undefined}
      >
        <span className="tray-ctx-menu__label">從此端延伸</span>
      </button>
      <button
        className={`tray-ctx-menu__item ${canMerge ? '' : 'tray-ctx-menu__item--disabled'}`}
        disabled={!canMerge}
        title={
          canMerge
            ? `合併到 ${mergeCandidate?.name ?? mergeCandidate?.id}（共用端點）`
            : canEndpoint ? '此端點沒有恰好一條 tray 可合併' : '在端點附近右鍵才能合併'
        }
        onClick={canMerge ? fire(onMerge) : undefined}
      >
        <span className="tray-ctx-menu__label">
          合併相鄰 tray
          {canMerge && (
            <span className="tray-ctx-menu__hint">
              → {mergeCandidate?.name ?? mergeCandidate?.id}
            </span>
          )}
        </span>
      </button>

      <div className="tray-ctx-menu__divider" />

      {/* Convert system — expandable sub-row. Click toggles the inline list of
          system options; selecting one fires onConvert(systemValue). Inline
          rather than flyout to keep positioning simple inside the parent menu. */}
      <button
        className="tray-ctx-menu__item tray-ctx-menu__item--has-sub"
        onClick={() => setSubmenu((s) => (s === 'convert' ? null : 'convert'))}
      >
        <span className="tray-ctx-menu__label">轉換系統</span>
        <span className="tray-ctx-menu__caret">{submenu === 'convert' ? '▾' : '▸'}</span>
      </button>
      {submenu === 'convert' && (
        <div className="tray-ctx-menu__sub">
          {TRAY_SYSTEMS.map((s) => (
            <button
              key={s.value}
              className="tray-ctx-menu__item tray-ctx-menu__item--sub"
              onClick={fire(() => onConvert?.(s.value))}
            >
              <span className="tray-ctx-menu__swatch" style={{ background: s.color }} />
              <span className="tray-ctx-menu__label">{s.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="tray-ctx-menu__divider" />

      <button
        className="tray-ctx-menu__item tray-ctx-menu__item--danger"
        onClick={fire(onDelete)}
      >
        <span className="tray-ctx-menu__label">刪除</span>
        <span className="tray-ctx-menu__shortcut">Del</span>
      </button>
      </>
      )}
    </div>
  )
}

export default TrayContextMenu
