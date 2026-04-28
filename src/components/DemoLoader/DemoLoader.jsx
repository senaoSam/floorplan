import React, { useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useWarmupStore } from '@/store/useWarmupStore'
import { buildDemoSampleObjects } from '@/mock/demoSampleScenario'
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
  const setWalls           = useWallStore((s) => s.setWalls)
  const setAPs             = useAPStore((s) => s.setAPs)
  const setHeatmapEnabled  = useHeatmapStore((s) => s.setEnabled)
  const warmingUp          = useWarmupStore((s) => s.warmingUp)

  const handleLoad = async () => {
    if (loading || warmingUp) return
    setLoading(true)
    try {
      const img = new window.Image()
      img.onload = () => {
        // Treat the whole Demo image as a 30 x 18 m office so the heatmap grid
        // count stays modest and dragging is smooth.
        const pxPerM = img.naturalWidth / 30
        const floor = importFloorFromUrl(DEMO_SRC, img.naturalWidth, img.naturalHeight, nextDemoName(floors), pxPerM)
        // Seed this new Demo floor with the canned scenario: walls + 2 APs at
        // (4,4) / (4,14) m, mapped 1:1 via px/m scale.
        const { walls, aps } = buildDemoSampleObjects(pxPerM)
        setWalls(floor.id, walls)
        setAPs(floor.id, aps)
        setHeatmapEnabled(true)
        setLoading(false)
      }
      img.onerror = () => setLoading(false)
      img.src = DEMO_SRC
    } catch {
      setLoading(false)
    }
  }

  const busy = loading || warmingUp
  const label = warmingUp ? '初始化熱力圖引擎…' : loading ? '載入中…' : '載入 Demo 平面圖'

  return (
    <button
      className="demo-loader"
      onClick={handleLoad}
      disabled={busy}
      title={warmingUp ? '熱力圖引擎初始化中，請稍候' : '再次點擊可新增另一個 Demo 樓層'}
    >
      {busy ? <span className="demo-loader__spinner" /> : '🗺'}
      <span>{label}</span>
    </button>
  )
}

export default DemoLoader
