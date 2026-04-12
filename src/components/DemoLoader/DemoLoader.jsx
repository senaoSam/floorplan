import React, { useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import './DemoLoader.sass'

const DEMO_SRC = import.meta.env.BASE_URL + 'test-floorplan.png'

function DemoLoader() {
  const [loading, setLoading] = useState(false)
  const floors             = useFloorStore((s) => s.floors)
  const importFloorFromUrl = useFloorStore((s) => s.importFloorFromUrl)

  const alreadyLoaded = floors.some((f) => f.name === 'Demo')

  const handleLoad = async () => {
    if (loading || alreadyLoaded) return
    setLoading(true)
    try {
      const img = new window.Image()
      img.onload = () => {
        importFloorFromUrl(DEMO_SRC, img.naturalWidth, img.naturalHeight, 'Demo')
        setLoading(false)
      }
      img.onerror = () => setLoading(false)
      img.src = DEMO_SRC
    } catch {
      setLoading(false)
    }
  }

  return (
    <button
      className={`demo-loader${alreadyLoaded ? ' demo-loader--loaded' : ''}`}
      onClick={handleLoad}
      disabled={loading || alreadyLoaded}
      title={alreadyLoaded ? 'Demo 平面圖已載入' : '載入 Demo 平面圖'}
    >
      {loading ? '⏳' : alreadyLoaded ? '✅' : '🗺'}
      <span>{loading ? '載入中…' : alreadyLoaded ? 'Demo 已載入' : '載入 Demo 平面圖'}</span>
    </button>
  )
}

export default DemoLoader
