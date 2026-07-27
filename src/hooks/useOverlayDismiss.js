import { useRef, useCallback } from 'react'

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
