import { useRef, useEffect, useCallback, useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { renderPdfPageToBlob, renderAllPdfPages } from '@/utils/pdfUtils'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg']

// Shared floor-import logic used by DropZone and SidebarLeft's "+" button.
// Handles PNG/JPG/PDF (single or multi-page) and drives a loading message.
export function useFloorImport() {
  const isMountedRef = useRef(true)
  const [loadingMsg, setLoadingMsg] = useState(null)

  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  const importImageFloor     = useFloorStore((s) => s.importImageFloor)
  const importMultipleFloors = useFloorStore((s) => s.importMultipleFloors)

  const processFile = useCallback(async (file) => {
    if (!file) return

    try {
      if (IMAGE_TYPES.includes(file.type)) {
        setLoadingMsg('載入圖片中…')
        const img = new window.Image()
        img.onload = () => {
          importImageFloor(file, img.naturalWidth, img.naturalHeight)
          if (isMountedRef.current) setLoadingMsg(null)
        }
        img.src = URL.createObjectURL(file)

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
        if (isMountedRef.current) setLoadingMsg(null)
      }
    } catch (err) {
      console.error('匯入失敗', err)
      if (isMountedRef.current) setLoadingMsg(null)
    }
  }, [importImageFloor, importMultipleFloors])

  return { processFile, loadingMsg, isLoading: loadingMsg !== null }
}
