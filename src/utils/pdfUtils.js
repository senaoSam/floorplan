import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url
).href

async function renderPageToBlob(page, renderScale) {
  const viewport = page.getViewport({ scale: renderScale })
  const offscreen = document.createElement('canvas')
  offscreen.width  = viewport.width
  offscreen.height = viewport.height
  await page.render({ canvasContext: offscreen.getContext('2d'), viewport }).promise
  const blob = await new Promise((resolve) =>
    offscreen.toBlob(resolve, 'image/png')
  )
  return {
    blob,
    width:  Math.round(viewport.width  / renderScale),
    height: Math.round(viewport.height / renderScale),
  }
}

/**
 * 渲染 PDF 單頁
 */
export async function renderPdfPageToBlob(arrayBuffer, pageNumber = 1, renderScale = 2) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const page = await pdf.getPage(pageNumber)
  const result = await renderPageToBlob(page, renderScale)
  return { ...result, pageCount: pdf.numPages }
}

/**
 * 渲染 PDF 全部頁面，回傳陣列
 * @returns {{ pages: Array<{blob, width, height, pageNumber}>, pageCount: number }}
 */
export async function renderAllPdfPages(arrayBuffer, renderScale = 2) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pages = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const result = await renderPageToBlob(page, renderScale)
    pages.push({ ...result, pageNumber: i })
  }

  return { pages, pageCount: pdf.numPages }
}
