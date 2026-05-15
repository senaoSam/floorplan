import { create } from 'zustand'

// Holds the latest Gemini cleaned-image preview URL produced by AIWallsModal.
// Lives outside the modal so the user can reopen the preview after closing the
// modal, to compare AI-detected walls against the cleaned image.
export const useAIPreviewStore = create((set, get) => ({
  geminiPreviewUrl: null,

  setGeminiPreview: (url) => {
    const prev = get().geminiPreviewUrl
    if (prev && prev !== url) URL.revokeObjectURL(prev)
    set({ geminiPreviewUrl: url })
  },

  clearGeminiPreview: () => {
    const prev = get().geminiPreviewUrl
    if (prev) URL.revokeObjectURL(prev)
    set({ geminiPreviewUrl: null })
  },
}))
