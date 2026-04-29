// OpenCV.js lazy loader.
// Loads /floorplan/vendor/opencv/opencv.js on first call, returns the cv module
// once `onRuntimeInitialized` fires. Subsequent calls return the cached promise.

const SCRIPT_URL = `${import.meta.env.BASE_URL}vendor/opencv/opencv.js`

let loadPromise = null

export function loadOpenCV() {
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('loadOpenCV must be called in a browser context'))
      return
    }

    if (window.cv && window.cv.Mat) {
      resolve(window.cv)
      return
    }

    // OpenCV.js looks for a global `Module` with onRuntimeInitialized.
    // We set it before injecting the script.
    const existing = document.querySelector(`script[data-opencv-loader="1"]`)
    if (existing) {
      existing.addEventListener('load', waitForRuntime)
      existing.addEventListener('error', () => reject(new Error('OpenCV.js script failed to load')))
      return
    }

    const script = document.createElement('script')
    script.async = true
    script.src = SCRIPT_URL
    script.dataset.opencvLoader = '1'
    script.addEventListener('load', waitForRuntime)
    script.addEventListener('error', () => {
      loadPromise = null
      reject(new Error(`OpenCV.js failed to load from ${SCRIPT_URL}`))
    })
    document.head.appendChild(script)

    function waitForRuntime() {
      const cv = window.cv
      if (!cv) {
        reject(new Error('window.cv missing after script load'))
        return
      }
      // Two flavors of the OpenCV.js build exist: one resolves a Promise,
      // the other fires onRuntimeInitialized. Handle both.
      if (typeof cv.then === 'function') {
        cv.then((resolved) => {
          window.cv = resolved
          resolve(resolved)
        }).catch(reject)
        return
      }
      if (cv.Mat) {
        resolve(cv)
        return
      }
      cv.onRuntimeInitialized = () => resolve(window.cv)
    }
  })

  return loadPromise
}

export function isOpenCVReady() {
  return typeof window !== 'undefined' && !!window.cv && !!window.cv.Mat
}
