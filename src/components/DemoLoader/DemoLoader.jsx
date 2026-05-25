import React, { useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import './DemoLoader.sass'

const DEMO_IMG_SRC = import.meta.env.BASE_URL + 'sample-walls/example3.png'
const DEMO_BASE_NAME = 'Demo'

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function nextDemoName(floors) {
  const taken = new Set(floors.map((f) => f.name))
  if (!taken.has(DEMO_BASE_NAME)) return DEMO_BASE_NAME
  let n = 2
  while (taken.has(`${DEMO_BASE_NAME}-${n}`)) n++
  return `${DEMO_BASE_NAME}-${n}`
}

function DemoLoader() {
  const floors = useFloorStore((s) => s.floors)
  const importFloorFromUrl = useFloorStore((s) => s.importFloorFromUrl)
  const [loading, setLoading] = useState(false)

  const handleLoad = async () => {
    if (loading) return
    setLoading(true)
    try {
      const img = await loadImage(DEMO_IMG_SRC)
      const pxPerM = img.naturalWidth / 30
      importFloorFromUrl(
        DEMO_IMG_SRC,
        img.naturalWidth,
        img.naturalHeight,
        nextDemoName(floors),
        pxPerM,
      )
    } catch (e) {
      console.error('[DemoLoader] load failed', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      className="demo-loader"
      onClick={handleLoad}
      disabled={loading}
      title="再次點擊可新增另一個 Demo 樓層"
    >
      {loading ? '載入中…' : '🗺 載入 Demo 平面圖'}
    </button>
  )
}

export default DemoLoader
