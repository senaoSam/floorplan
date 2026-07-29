import React, { useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import './ImageLightbox.sass'

// Full-screen image viewer for inspecting API result images (overlay /
// denoised) at native size. Sits above the modal that opened it.
//
// Click the backdrop or press Escape to close. The image itself scrolls inside
// the frame when it overflows, so clicking it never dismisses the viewer.
export default function ImageLightbox({ open, src, title, onClose }) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
      }
    }
    // Capture phase so the host modal's own Escape handling doesn't close both
    // layers at once.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose])

  const onBackdropMouseDown = useCallback((e) => {
    if (e.target === e.currentTarget) onClose?.()
  }, [onClose])

  if (!open || !src) return null

  return createPortal(
    <div className="image-lightbox" onMouseDown={onBackdropMouseDown}>
      <div className="image-lightbox__bar">
        <span className="image-lightbox__title">{title}</span>
        <div className="image-lightbox__actions">
          <a
            className="image-lightbox__link"
            href={src}
            target="_blank"
            rel="noreferrer"
          >
            新分頁開啟
          </a>
          <button
            type="button"
            className="image-lightbox__close"
            onClick={onClose}
            aria-label="關閉"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="image-lightbox__frame">
        <img className="image-lightbox__img" src={src} alt={title || ''} />
      </div>
      <div className="image-lightbox__hint">點擊背景或按 Esc 關閉</div>
    </div>,
    document.body,
  )
}
