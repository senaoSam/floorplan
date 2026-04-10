import * as pdfjsLib from 'pdfjs-dist'

// Vite 方式引入 worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url
).href

/**
 * 將 PDF 某頁渲染成 { blob, width, height }
 * @param {ArrayBuffer} arrayBuffer
 * @param {number} pageNumber  從 1 開始
 * @param {number} renderScale  解析度倍數（2 = 2x，畫質較好）
 */
export async function renderPdfPageToBlob(arrayBuffer, pageNumber = 1, renderScale = 2) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const page = await pdf.getPage(pageNumber)

  const viewport = page.getViewport({ scale: renderScale })

  const offscreen = document.createElement('canvas')
  offscreen.width  = viewport.width
  offscreen.height = viewport.height
  const ctx = offscreen.getContext('2d')

  await page.render({ canvasContext: ctx, viewport }).promise

  const blob = await new Promise((resolve) =>
    offscreen.toBlob(resolve, 'image/png')
  )

  return {
    blob,
    width:  Math.round(viewport.width  / renderScale),
    height: Math.round(viewport.height / renderScale),
    pageCount: pdf.numPages,
  }
}
