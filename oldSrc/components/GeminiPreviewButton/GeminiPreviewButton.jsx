import React, { useState } from 'react'
import { useAIPreviewStore } from '@/store/useAIPreviewStore'
import './GeminiPreviewButton.sass'

// Bottom-center floating toggle that shows the most recent Gemini cleaned
// image. Used to compare the AI-detected walls on the canvas against the
// cleaned line drawing the vectorizer worked from. Lives outside AIWallsModal
// so it stays accessible after the modal is closed.

export default function GeminiPreviewButton() {
  const url = useAIPreviewStore((s) => s.geminiPreviewUrl)
  const [open, setOpen] = useState(false)

  if (!url) return null

  return (
    <>
      {open && (
        <div className="gemini-preview-popover" onClick={() => setOpen(false)}>
          <img
            className="gemini-preview-popover__img"
            src={url}
            alt="Gemini cleaned image"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      <button
        className={`gemini-preview-btn${open ? ' gemini-preview-btn--active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="顯示 Gemini 清理過的底圖"
      >
        {open ? '收合 Gemini 圖' : '看 Gemini 圖'}
      </button>
    </>
  )
}
