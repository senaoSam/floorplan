import React, { useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { floorplanFromLines } from '@/utils/floorplanFromLines'
import { generateId } from '@/utils/id'
import './DemoLoader.sass'

const DEMO_IMG_SRC  = import.meta.env.BASE_URL + 'sample-walls/example3.png'
const SRC_IMG_SRC   = import.meta.env.BASE_URL + 'source.png'
const SRC_JSON_SRC  = import.meta.env.BASE_URL + 'source.json'
const DEMO_BASE_NAME = 'Demo'

// Hand-picked centres (in example3.png pixel space, 685x511) of the five
// largest rooms in the floor plan.
const DEMO_AP_POSITIONS_NORM = [
  { x:  85 / 685, y: 360 / 511 }, // double garage
  { x: 415 / 685, y: 175 / 511 }, // family living
  { x: 510 / 685, y: 250 / 511 }, // gourmet kitchen
  { x: 410 / 685, y: 400 / 511 }, // home theatre
  { x: 615 / 685, y: 400 / 511 }, // master suite
]

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })

const fetchJson = async (src) => {
  const r = await fetch(src)
  if (!r.ok) throw new Error(`fetch ${src} failed: ${r.status}`)
  return r.json()
}

function nextDemoName(floors) {
  const taken = new Set(floors.map((f) => f.name))
  if (!taken.has(DEMO_BASE_NAME)) return DEMO_BASE_NAME
  let n = 2
  while (taken.has(`${DEMO_BASE_NAME}-${n}`)) n++
  return `${DEMO_BASE_NAME}-${n}`
}

const FIXED_CHANNEL_BY_FREQ = {
  2.4: 1,
  5: 36,
  6: 1,
}

function buildDemoAPs(canvasWidth, canvasHeight) {
  return DEMO_AP_POSITIONS_NORM.map((p, i) => ({
    id: generateId('ap'),
    name: `AP-${String(i + 1).padStart(2, '0')}`,
    x: p.x * canvasWidth,
    y: p.y * canvasHeight,
    z: 2.4,
    txPower: 20,
    frequency: 5,
    channel: FIXED_CHANNEL_BY_FREQ[5],
    channelWidth: 80,
    antennaMode: 'omni',
    azimuth: 0,
    beamwidth: 60,
    patternId: null,
    mountType: 'ceiling',
    modelId: null,
    color: '#4fc3f7',
  }))
}

function DemoLoader() {
  const floors             = useFloorStore((s) => s.floors)
  const importFloorFromUrl = useFloorStore((s) => s.importFloorFromUrl)
  const setWalls           = useWallStore((s) => s.setWalls)
  const setAPs             = useAPStore((s) => s.setAPs)
  const setHeatmapEnabled  = useHeatmapStore((s) => s.setEnabled)
  const [loading, setLoading] = useState(false)

  const handleLoad = async () => {
    if (loading) return
    setLoading(true)
    try {
      const [img, srcImg, json] = await Promise.all([
        loadImage(DEMO_IMG_SRC),
        loadImage(SRC_IMG_SRC),
        fetchJson(SRC_JSON_SRC),
      ])

      // source.json coordinates were authored against source.png. Rescale to
      // fit example3.png so they land inside the canvas.
      const scale = img.naturalWidth / srcImg.naturalWidth
      const lines = (Array.isArray(json) ? json : json.lines ?? []).map((l) => ({
        ...l,
        x1: l.x1 * scale, y1: l.y1 * scale,
        x2: l.x2 * scale, y2: l.y2 * scale,
      }))

      const pxPerM = img.naturalWidth / 30
      const floor = importFloorFromUrl(
        DEMO_IMG_SRC,
        img.naturalWidth,
        img.naturalHeight,
        nextDemoName(floors),
        pxPerM,
      )

      const { walls } = floorplanFromLines(lines)
      setWalls(floor.id, walls)
      setAPs(floor.id, buildDemoAPs(img.naturalWidth, img.naturalHeight))
      setHeatmapEnabled(true)
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
