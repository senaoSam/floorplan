import { useRef, useCallback, useEffect } from 'react'

// Overlay 背景關閉：要求 mousedown 與 mouseup「都」發生在 overlay 本身。
//
// 為什麼不能只用 onClick：click 事件的 target 是 mousedown 與 mouseup 的
// **共同祖先**。使用者在 modal 內按住（例如拖曳反白輸入框文字），滑到
// overlay 上才放開 —— 這時 click 派發到 overlay，被誤判成「點擊背景」，
// modal 就關掉了，選取的文字也跟著消失。反向（overlay 按下、modal 內放開）
// 同樣會誤觸發。
//
// 正解是記住 mousedown 的落點，只有「按下」與「放開」都在 overlay 上
// 才算一次背景點擊 —— 這也是原生 <dialog> 與各家 UI library 的行為。
//
// 用法（overlay 與內層 modal 都不用再 stopPropagation）：
//   const dismiss = useOverlayDismiss(disabled ? null : onClose)
//   <div className="…-overlay" {...dismiss}>
//     <div className="…-modal">…</div>
//   </div>
//
// 傳 null / undefined 代表停用（例如執行中不可關閉），回傳的 handler 為
// undefined，React 不會掛上監聽。
export function useOverlayDismiss(onDismiss) {
  const downOnSelfRef = useRef(false)

  // 53-G10 (23l): Escape also dismisses. Six of the eight overlays using this
  // hook had no Escape handling at all (verified on LiveViewModal: Esc left it
  // open), so每個 caller 各自補一次只會再漏一次 —— 併進 hook 讓整族一次修好。
  // `disabled` 的 caller 傳 null，這裡就不掛監聽（執行中不可關閉的語意保留）。
  // ConfirmDialog / ScaleDialog 自己也處理 Escape，重複呼叫同一個 onDismiss
  // 是幂等的（都只是關閉），不會有副作用。
  useEffect(() => {
    if (!onDismiss) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      // 讓輸入框先吃掉 Esc（IME 組字中取消、清空搜尋框等原生行為）。
      const t = e.target
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return
      e.preventDefault()
      onDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onDismiss])

  const onMouseDown = useCallback((e) => {
    // e.target === e.currentTarget 表示按在 overlay 自己身上，不是子孫節點。
    // 只認左鍵：右鍵會開系統選單，中鍵貼上，都不該關閉 modal。
    downOnSelfRef.current = e.target === e.currentTarget && e.button === 0
  }, [])

  const onMouseUp = useCallback((e) => {
    const downOnSelf = downOnSelfRef.current
    downOnSelfRef.current = false
    if (!downOnSelf) return
    if (e.target !== e.currentTarget) return
    if (e.button !== 0) return
    onDismiss?.()
  }, [onDismiss])

  if (!onDismiss) return {}
  return { onMouseDown, onMouseUp }
}
