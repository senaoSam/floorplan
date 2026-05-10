import React, { useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useWarmupStore } from '@/store/useWarmupStore'
import { floorplanFromLines } from '@/utils/floorplanFromLines'
import './SourceLoader.sass'

const IMG_SRC  = import.meta.env.BASE_URL + 'sample-walls/example3.png'
const SRC_IMG  = import.meta.env.BASE_URL + 'source.png'
const JSON_SRC = import.meta.env.BASE_URL + 'source.json'
const BASE_NAME = 'Source'

function nextName(floors) {
  const taken = new Set(floors.map((f) => f.name))
  if (!taken.has(BASE_NAME)) return BASE_NAME
  let n = 2
  while (taken.has(`${BASE_NAME}-${n}`)) n++
  return `${BASE_NAME}-${n}`
}

function SourceLoader() {
  const [loading, setLoading] = useState(false)
  const floors             = useFloorStore((s) => s.floors)
  const importFloorFromUrl = useFloorStore((s) => s.importFloorFromUrl)
  const setWalls           = useWallStore((s) => s.setWalls)
  const setHeatmapEnabled  = useHeatmapStore((s) => s.setEnabled)
  const warmingUp          = useWarmupStore((s) => s.warmingUp)

  const handleLoad = async () => {
    if (loading || warmingUp) return
    setLoading(true)
    try {
      const loadImg = (src) => new Promise((resolve, reject) => {
        const i = new window.Image()
        i.onload = () => resolve(i)
        i.onerror = reject
        i.src = src
      })
      const [img, srcImg, json] = await Promise.all([
        loadImg(IMG_SRC),
        loadImg(SRC_IMG),
        fetch(JSON_SRC).then((r) => {
          if (!r.ok) throw new Error(`fetch source.json failed: ${r.status}`)
          return r.json()
        }),
      ])

      // source.json coordinates were authored against `source.png`. Rescale
      // them to fit `example3.png` so they land inside the canvas. Both axes
      // use the same factor (the X and Y ratios match within ~0.1%, so this
      // is a uniform scale — no aspect distortion).
      const scale = img.naturalWidth / srcImg.naturalWidth

      const pxPerM = img.naturalWidth / 30
      const floor = importFloorFromUrl(
        IMG_SRC,
        img.naturalWidth,
        img.naturalHeight,
        nextName(floors),
        pxPerM,
      )

      const lines = (Array.isArray(json) ? json : json.lines ?? []).map((l) => ({
        ...l,
        x1: l.x1 * scale, y1: l.y1 * scale,
        x2: l.x2 * scale, y2: l.y2 * scale,
      }))
      const { walls } = floorplanFromLines(lines)
      setWalls(floor.id, walls)
      setHeatmapEnabled(true)
    } catch (e) {
      console.error('[SourceLoader] load failed', e)
    } finally {
      setLoading(false)
    }
  }

  const busy = loading || warmingUp
  const label = warmingUp ? '初始化熱力圖引擎…' : loading ? '載入中…' : '載入 Source 平面圖'

  return (
    <button
      className="source-loader"
      onClick={handleLoad}
      disabled={busy}
      title={warmingUp ? '熱力圖引擎初始化中，請稍候' : '從 source.json + example3.png 建立樓層'}
    >
      {busy ? <span className="source-loader__spinner" /> : '🧱'}
      <span>{label}</span>
    </button>
  )
}

export default SourceLoader
