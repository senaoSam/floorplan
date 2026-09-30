import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import './ImageLightbox.sass'

// Full-screen image viewer for inspecting API result images (overlay /
// denoised). Sits above the modal that opened it.
//
// Opens fit-to-frame; clicking the image toggles native 1:1 size, where it
// scrolls inside the frame. Click the backdrop or press Escape to close.
export default function ImageLightbox({ open, src, title, onClose }) {
  const [fit, setFit] = useState(true)

  // Every newly opened image starts fitted.
  useEffect(() => {
    if (open) setFit(true)
  }, [open, src])

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
        <img
          className={`image-lightbox__img image-lightbox__img--${fit ? 'fit' : 'native'}`}
          src={src}
          alt={title || ''}
          onClick={() => setFit((v) => !v)}
        />
      </div>
      <div className="image-lightbox__hint">
        點擊圖片切換{fit ? '原尺寸' : '符合畫面'} · 點擊背景或按 Esc 關閉
      </div>
    </div>,
    document.body,
  )
}
