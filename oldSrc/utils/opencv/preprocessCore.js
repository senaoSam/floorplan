// Pure preprocessing logic, callable from main thread or Web Worker.
// Caller must ensure `cv` (OpenCV.js module) is initialized before invoking.
//
// Pipeline: src ImageData -> grayscale -> Gaussian blur -> Otsu -> (invert)
//   walls become white, background black.
//
// Returns { binaryImageData, width, height, whitePixels } so it can cross
// postMessage without leaking Mat handles. All Mats are deleted before return.

function arena() {
  const mats = []
  return {
    track(m) { mats.push(m); return m },
    release() {
      for (const m of mats) { try { m.delete() } catch (_) {} }
      mats.length = 0
    },
  }
}

// Run preprocess on an ImageData. Returns ImageData of the binary result
// (RGBA, white = wall candidate) plus stats.
export function preprocessImageData(cv, imageData, options = {}) {
  const { blurKernel = 3, invert = true } = options
  const a = arena()
  try {
    const src = a.track(cv.matFromImageData(imageData))
    const gray = a.track(new cv.Mat())
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)

    const blurred = a.track(new cv.Mat())
    const ks = new cv.Size(blurKernel, blurKernel)
    cv.GaussianBlur(gray, blurred, ks, 0, 0, cv.BORDER_DEFAULT)

    const thresh = a.track(new cv.Mat())
    const flag = invert
      ? cv.THRESH_BINARY_INV + cv.THRESH_OTSU
      : cv.THRESH_BINARY + cv.THRESH_OTSU
    cv.threshold(blurred, thresh, 0, 255, flag)

    let whitePixels = 0
    for (let i = 0; i < thresh.data.length; i++) {
      if (thresh.data[i] === 255) whitePixels++
    }

    const rgba = a.track(new cv.Mat())
    cv.cvtColor(thresh, rgba, cv.COLOR_GRAY2RGBA)

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
    a.release()
  }
}
