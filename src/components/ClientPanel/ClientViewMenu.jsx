import React, { useEffect, useRef, useState } from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useClientViewStore } from '@/store/useClientViewStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import '@/components/ContextMenu/TrayContextMenu.sass'

// Lightweight right-click menu for CLIENT_VIEW only — manual-connect / unlock.
// Separate from the generic object context menu (which stays suppressed in this
// mode). Reuses TrayContextMenu.sass so it looks like every other menu.
//
// Driven by useClientViewStore.cvMenu ({ screenX, screenY, apId }), which
// clientViewBinder sets on right-click. apId is the AP under the cursor (null =
// empty space). Items:
//   - right-click an AP, not already locked to it → 手動連接此 AP
//   - currently locked → 解除手動連接（回自動）
// "Manual" is a designer what-if — real devices can't pick an AP — so the
// header notes it's not real roaming behaviour.

function ClientViewMenuInner({ menu }) {
  const menuRef = useRef(null)
  const [pos, setPos] = useState({ x: menu.screenX, y: menu.screenY })
  const closeCvMenu = useClientViewStore((s) => s.closeCvMenu)
  const lockedApId = useClientViewStore((s) => s.lockedApId)
  const setLockedApId = useClientViewStore((s) => s.setLockedApId)
  const singleApAreaId = useClientViewStore((s) => s.singleApAreaId)
  const setSingleApAreaId = useClientViewStore((s) => s.setSingleApAreaId)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const apsByFloor = useAPStore((s) => s.apsByFloor)

  // Clamp into viewport once measured.
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const pad = 4
    setPos({
      x: Math.max(pad, Math.min(menu.screenX, window.innerWidth - rect.width - pad)),
      y: Math.max(pad, Math.min(menu.screenY, window.innerHeight - rect.height - pad)),
    })
  }, [menu.screenX, menu.screenY])

  // Outside-click (left button only) + Esc dismiss. rAF-deferred attach so the
  // opening right-click's own mousedown doesn't immediately close it.
  useEffect(() => {
    let raf = 0
    const onDown = (e) => {
      // Clicks inside the menu: keep open. Clicks on the canvas (left OR right):
      // let clientViewBinder handle them — it closes the menu without moving the
      // client, and avoids a race where closing here first lets the binder treat
      // the same click as a fresh placement. Only close here for clicks on OTHER
      // chrome (panel / toolbar / etc.).
      if (menuRef.current && menuRef.current.contains(e.target)) return
      if (e.target instanceof HTMLCanvasElement) return
      closeCvMenu()
    }
    const onKey = (e) => { if (e.key === 'Escape') closeCvMenu() }
    raf = requestAnimationFrame(() => {
      window.addEventListener('mousedown', onDown)
      window.addEventListener('keydown', onKey)
    })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [closeCvMenu])

  const ap = menu.apId
    ? (apsByFloor[activeFloorId] ?? []).find((a) => a.id === menu.apId)
    : null
  const apName = ap?.name ?? menu.apId

  const items = []
  if (ap && lockedApId !== ap.id) {
    // Disable connect when the AP can't be reached from the client's current
    // position (binder pre-computed apReachable: false), or no client placed
    // yet (clientPlaced false). Show why so the user isn't left guessing.
    const noClient = menu.clientPlaced === false
    const unreachable = menu.apReachable === false
    const disabled = noClient || unreachable
    const hint = noClient ? '請先在平面圖放置 client'
      : unreachable ? '此位置訊號太弱，無法連線'
      : undefined
    items.push({
      id: 'lock',
      label: `手動連接 ${apName}`,
      disabled,
      hint,
      onClick: () => setLockedApId(ap.id),
    })
  }
  if (lockedApId != null) {
    items.push({
      id: 'unlock',
      label: '解除手動連接（回自動）',
      onClick: () => setLockedApId(null),
    })
  }
  // Single-AP coverage outline. On an AP that's currently the manually-shown
  // one → "hide range"; on any other AP → "show this AP's range" (replaces the
  // current single outline, since only one shows at a time).
  if (ap) {
    if (singleApAreaId === ap.id) {
      items.push({
        id: 'hideArea',
        label: `隱藏 ${apName} 範圍`,
        onClick: () => setSingleApAreaId(null),
      })
    } else {
      items.push({
        id: 'showArea',
        label: `顯示 ${apName} 範圍`,
        onClick: () => setSingleApAreaId(ap.id),
      })
    }
  } else if (singleApAreaId != null) {
    // Right-clicked empty space but a manual outline is active → offer to clear.
    items.push({
      id: 'hideAreaEmpty',
      label: '隱藏單台 AP 範圍',
      onClick: () => setSingleApAreaId(null),
    })
  }
  // Nothing actionable (right-clicked empty space with no active lock).
  if (items.length === 0) {
    items.push({ id: 'none', label: '（在 AP 上按右鍵可手動連接）', disabled: true })
  }

  const run = (item) => {
    if (item.disabled) return
    item.onClick?.()
    closeCvMenu()
  }

  return (
    <div
      ref={menuRef}
      className="tray-ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="tray-ctx-menu__header">
        <span className="tray-ctx-menu__title">
          {lockedApId ? `🔒 已鎖定 ${(apsByFloor[activeFloorId] ?? []).find((a) => a.id === lockedApId)?.name ?? lockedApId}` : '手動連線（非真實漫遊）'}
        </span>
      </div>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`tray-ctx-menu__item${item.disabled ? ' tray-ctx-menu__item--disabled' : ''}`}
          disabled={item.disabled}
          onClick={() => run(item)}
        >
          <span className="tray-ctx-menu__label">{item.label}</span>
          {item.hint && <span className="tray-ctx-menu__hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  )
}

// Mount wrapper — only render in CLIENT_VIEW with an open menu.
export default function ClientViewMenuMount() {
  const editorMode = useEditorStore((s) => s.editorMode)
  const cvMenu = useClientViewStore((s) => s.cvMenu)
  if (editorMode !== EDITOR_MODE.CLIENT_VIEW || !cvMenu) return null
  return <ClientViewMenuInner menu={cvMenu} />
}
