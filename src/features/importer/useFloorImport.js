import { useCallback } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useFloorImportStore } from '@/store/useFloorImportStore'
import { renderPdfPageToBlob, renderAllPdfPages } from '@/utils/pdfUtils'
import { showUiToast } from '@/store/useUiToastStore'
import { isCadFile, fetchCadBackground } from './cadImport'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg']

// Shared floor-import logic used by DropZone and SidebarLeft's "+" button.
// Handles PNG/JPG/PDF (single or multi-page) and DXF/DWG (rendered by the
// backend) and drives a loading message.
export function useFloorImport() {
  // Shared store, not local state: the canvas overlay shows the same message.
  // Writes are no longer gated on "still mounted" — DropZone unmounts the
  // moment its import adds the first floor, and skipping the final clear
  // would leave the overlay up forever.
  const loadingMsg    = useFloorImportStore((s) => s.loadingMsg)
  const setLoadingMsg = useFloorImportStore((s) => s.setLoadingMsg)

  const importImageFloor     = useFloorStore((s) => s.importImageFloor)
  const importMultipleFloors = useFloorStore((s) => s.importMultipleFloors)
  const updateFloor          = useFloorStore((s) => s.updateFloor)

  const processFile = useCallback(async (file) => {
    if (!file) return

    if (isCadFile(file)) {
      // The browser can't parse CAD, so the backend renders the background.
      // The backend's own message (422, missing input) is more useful than
      // the generic "corrupt or unsupported" toast below, so surface it.
      try {
        const { blob, width, height } = await fetchCadBackground(file, setLoadingMsg)
        const floor = importImageFloor(blob, width, height)
        // Keep the source so AI walls can send the CAD itself, not a raster.
        updateFloor(floor.id, { cadFile: file })
      } catch (err) {
        console.error('CAD 匯入失敗', err)
        showUiToast(`「${file.name}」匯入失敗：${err?.message || err}`)
      } finally {
        setLoadingMsg(null)
      }
      return
    }

    try {
      if (IMAGE_TYPES.includes(file.type)) {
        setLoadingMsg('載入圖片中…')
        // 52-C5: three defects lived in these four lines.
        //  1. No onerror — a corrupt PNG never fired onload, so 「載入圖片中…」
        //     stayed up forever and isLoading blocked every later import.
        //  2. This object URL only existed to measure naturalWidth/Height and
        //     was never revoked; useFloorStore mints a SECOND one for the same
        //     File (that one is revoked when the floor is deleted), so each
        //     import leaked exactly one blob.
        //  3. Failures only reached console.error — no user-visible feedback.
        const probeUrl = URL.createObjectURL(file)
        try {
          const { width, height } = await new Promise((resolve, reject) => {
            const img = new window.Image()
            img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
            img.onerror = () => reject(new Error('image decode failed'))
            img.src = probeUrl
          })
          importImageFloor(file, width, height)
        } finally {
          URL.revokeObjectURL(probeUrl)
        }
        setLoadingMsg(null)

      } else if (file.type === 'application/pdf') {
        setLoadingMsg('解析 PDF…')
        const arrayBuffer = await file.arrayBuffer()

        const { pageCount } = await renderPdfPageToBlob(arrayBuffer.slice(0), 1)

        if (pageCount === 1) {
          const { blob, width, height } = await renderPdfPageToBlob(arrayBuffer, 1)
          importImageFloor(blob, width, height)
        } else {
          setLoadingMsg(`渲染 PDF（共 ${pageCount} 頁）…`)
          const { pages } = await renderAllPdfPages(arrayBuffer)
          importMultipleFloors(pages)
        }
        setLoadingMsg(null)
      }
    } catch (err) {
      console.error('匯入失敗', err)
      // 52-C5: the loading message clears either way, so without a toast the
      // UI just silently returned to empty and the user assumed nothing
      // happened. Name the file — with multi-file drops it matters which.
      showUiToast(`「${file.name}」匯入失敗：檔案可能已損毀或格式不支援`)
    } finally {
      setLoadingMsg(null)
    }
  }, [importImageFloor, importMultipleFloors, updateFloor, setLoadingMsg])

  return { processFile, loadingMsg, isLoading: loadingMsg !== null }
}
