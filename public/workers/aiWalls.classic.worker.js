// 16-3a — AI walls preprocessing worker (CLASSIC mode).
//
// Why classic: ES module workers don't support importScripts, and OpenCV.js
// is a non-module UMD bundle. Evaluating its 10 MB source via eval/Function
// inside an ES worker takes 1-2 minutes (no JIT path). importScripts is the
// fast path. We pay the cost of duplicating the small core logic here so the
// rest of the project's workers can stay ES modules.
//
// Loaded by main thread as:
//   new Worker('/floorplan/workers/aiWalls.classic.worker.js')
// (i.e. served from /public, not bundled by Vite.)
//
// Message protocol — same as the ES variant:
//   in:  { type: 'run', payload: { imageData, options } }
//        { type: 'cancel' }
//   out: { type: 'progress', stage, message }
//        { type: 'done',     result: { binaryImageData, width, height, whitePixels, elapsedMs } | { aborted: true } }
//        { type: 'error',    message }

let cvReady = null
let aborted = false

function loadCV() {
  if (cvReady) return cvReady
  cvReady = (async () => {
    // Set Module.onRuntimeInitialized BEFORE importScripts. The cv thenable
    // path (cv.then(cb)) is unreliable in 4.x — use the standard emscripten
    // hook instead.
    const ready = new Promise((resolve, reject) => {
      self.Module = {
        onRuntimeInitialized: () => resolve(),
        onAbort: (what) => reject(new Error('OpenCV abort: ' + what)),
      }
    })
    importScripts('/floorplan/vendor/opencv/opencv.js')
    await ready
    const cv = self.cv
    if (!cv || !cv.Mat) throw new Error('cv ready fired but cv.Mat missing')
    // CRITICAL: the OpenCV.js Module is itself a thenable in 4.x. Returning
    // it directly from an async function causes the engine to chain through
    // its `then`, which never settles the outer promise — `await loadCV()`
    // would hang forever. Wrap in a plain object to prevent assimilation.
    return { cv }
  })()
  cvReady.catch(() => { cvReady = null })
  return cvReady
}

function preprocessImageData(cv, imageData, options) {
  const blurKernel = (options && options.blurKernel) || 3
  const invert = !options || options.invert !== false
  const mats = []
  const track = (m) => { mats.push(m); return m }

  try {
    const src = track(cv.matFromImageData(imageData))
    const gray = track(new cv.Mat())
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)

    const blurred = track(new cv.Mat())
    cv.GaussianBlur(gray, blurred, new cv.Size(blurKernel, blurKernel), 0, 0, cv.BORDER_DEFAULT)

    const thresh = track(new cv.Mat())
    const flag = invert
      ? cv.THRESH_BINARY_INV + cv.THRESH_OTSU
      : cv.THRESH_BINARY + cv.THRESH_OTSU
    cv.threshold(blurred, thresh, 0, 255, flag)

    // countNonZero uses opencv's SIMD path; orders of magnitude faster than
    // a JS for-loop on multi-MP images.
    const whitePixels = cv.countNonZero(thresh)

    const rgba = track(new cv.Mat())
    cv.cvtColor(thresh, rgba, cv.COLOR_GRAY2RGBA)

    // rgba.data is a view into wasm memory — copy out before the Mat is freed.
    const binaryImageData = new ImageData(
      new Uint8ClampedArray(rgba.data),
      rgba.cols,
      rgba.rows,
    )

    return {
      binaryImageData,
      width: thresh.cols,
      height: thresh.rows,
      whitePixels,
    }
  } finally {
    for (const m of mats) { try { m.delete() } catch (_) {} }
  }
}

self.addEventListener('message', async (e) => {
  const msg = e.data
  if (!msg || !msg.type) return

  if (msg.type === 'cancel') { aborted = true; return }

  if (msg.type === 'run') {
    aborted = false
    try {
      self.postMessage({ type: 'progress', stage: 'loading-opencv', message: 'Loading OpenCV.js…' })
      const { cv } = await loadCV()
      if (aborted) { self.postMessage({ type: 'done', result: { aborted: true } }); return }

      self.postMessage({ type: 'progress', stage: 'processing', message: 'Binarizing…' })
      const t0 = performance.now()
      const out = preprocessImageData(cv, msg.payload.imageData, msg.payload.options)
      const elapsedMs = performance.now() - t0

      self.postMessage(
        { type: 'done', result: Object.assign(out, { elapsedMs }) },
        [out.binaryImageData.data.buffer],
      )
    } catch (err) {
      self.postMessage({ type: 'error', message: (err && err.message) || String(err) })
    }
  }
})
