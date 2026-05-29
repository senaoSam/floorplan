import React, { useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useCableStore, DEFAULT_TRAY } from '@/store/useCableStore'
import { useEditorStore } from '@/store/useEditorStore'
import { floorplanFromLines } from '@/utils/floorplanFromLines'
import { greedyChannelAssign } from '@/utils/autoChannelPlan'
import { generateId } from '@/utils/id'
import { DEFAULT_AP_MODEL_ID } from '@/constants/apModels'
import { DEFAULT_CHANNEL_WIDTH } from '@/constants/channelWidths'
import Icon from '@/components/Icon/Icon'
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

// Cable seed (13-3 demo) — one horizontal tray cutting through the middle of
// the house with a switch landed on top. All five AP centres sit inside the
// tray's magnet capsule so every drop routes via the tray.
const DEMO_TRAY_PTS_NORM = [
  { x:  50 / 685, y: 320 / 511 },
  { x: 640 / 685, y: 320 / 511 },
]
const DEMO_TRAY_MAGNET_PX = 150
const DEMO_SWITCH_NORM = { x: 300 / 685, y: 320 / 511 }

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

function buildDemoAPs(canvasWidth, canvasHeight, regulatoryDomain) {
  const aps = DEMO_AP_POSITIONS_NORM.map((p, i) => ({
    id: generateId('ap'),
    name: `AP-${String(i + 1).padStart(2, '0')}`,
    x: p.x * canvasWidth,
    y: p.y * canvasHeight,
    z: 2.4,
    txPower: 20,
    frequency: 5,
    channel: 36,
    channelWidth: DEFAULT_CHANNEL_WIDTH[5],
    antennaMode: 'omni',
    azimuth: 0,
    beamwidth: 60,
    patternId: null,
    mountType: 'ceiling',
    modelId: DEFAULT_AP_MODEL_ID,
    color: '#4fc3f7',
  }))
  const assignments = greedyChannelAssign(aps, regulatoryDomain)
  return aps.map((ap) => {
    const picked = assignments.get(ap.id)
    return picked ? { ...ap, channel: picked.channel } : ap
  })
}

function DemoLoader() {
  const floors             = useFloorStore((s) => s.floors)
  const importFloorFromUrl = useFloorStore((s) => s.importFloorFromUrl)
  const setWalls           = useWallStore((s) => s.setWalls)
  const setAPs             = useAPStore((s) => s.setAPs)
  const setHeatmapEnabled  = useHeatmapStore((s) => s.setEnabled)
  const setSwitches        = useCableStore((s) => s.setSwitches)
  const addTray            = useCableStore((s) => s.addTray)
  const nextSwitchName     = useCableStore((s) => s.nextSwitchName)
  const nextTrayName       = useCableStore((s) => s.nextTrayName)
  const regulatoryDomain   = useEditorStore((s) => s.regulatoryDomain)
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
      setAPs(floor.id, buildDemoAPs(img.naturalWidth, img.naturalHeight, regulatoryDomain))

      const W = img.naturalWidth, H = img.naturalHeight
      addTray(floor.id, {
        id: generateId('tray'),
        name: nextTrayName({ floor }),
        points: DEMO_TRAY_PTS_NORM.map((p) => ({ x: p.x * W, y: p.y * H })),
        magnetDistance: DEMO_TRAY_MAGNET_PX,
        ...DEFAULT_TRAY,
      })
      setSwitches(floor.id, [{
        id: generateId('sw'),
        name: nextSwitchName('switch'),
        x: DEMO_SWITCH_NORM.x * W,
        y: DEMO_SWITCH_NORM.y * H,
        kind: 'switch',
        mountHeight: 0.5,
        model: 'POE-24-port',
        portCount: 24,
        poeBudget: 370,
        uplinkTo: null,
        cableType: 'auto',
      }])

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
      {loading ? (
        <span className="demo-loader__spinner" />
      ) : (
        <Icon name="aiWalls" size={14} />
      )}
      <span>{loading ? '載入中…' : '載入 Demo 平面圖'}</span>
    </button>
  )
}

export default DemoLoader
