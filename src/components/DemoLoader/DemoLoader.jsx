import React, { useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import './DemoLoader.sass'

const DEMO_SRC = import.meta.env.BASE_URL + 'test-floorplan.png'
const BASE_NAME = 'Demo'

// Pick the first available "Demo", "Demo-2", "Demo-3"… name given the floors already present.
function nextDemoName(floors) {
  const taken = new Set(floors.map((f) => f.name))
  if (!taken.has(BASE_NAME)) return BASE_NAME
  let n = 2
  while (taken.has(`${BASE_NAME}-${n}`)) n++
  return `${BASE_NAME}-${n}`
}

function DemoLoader() {
  const [loading, setLoading] = useState(false)
  const floors             = useFloorStore((s) => s.floors)
  const importFloorFromUrl = useFloorStore((s) => s.importFloorFromUrl)

  const handleLoad = async () => {
    if (loading) return
    setLoading(true)
    try {
      const img = new window.Image()
      img.onload = () => {
        importFloorFromUrl(DEMO_SRC, img.naturalWidth, img.naturalHeight, nextDemoName(floors), 200 / 20)
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
      className="demo-loader"
      onClick={handleLoad}
      disabled={loading}
      title="再次點擊可新增另一個 Demo 樓層"
    >
      {loading ? '⏳' : '🗺'}
      <span>{loading ? '載入中…' : '載入 Demo 平面圖'}</span>
    </button>
  )
}

export default DemoLoader
