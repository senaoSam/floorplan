import React, { useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useCableStore, DEFAULT_TRAY } from '@/store/useCableStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useEditorStore } from '@/store/useEditorStore'
import { useWarmupStore } from '@/store/useWarmupStore'
import { floorplanFromLines } from '@/utils/floorplanFromLines'
import { greedyChannelAssign } from '@/utils/autoChannelPlan'
import { generateId } from '@/utils/id'
import { DEFAULT_AP_MODEL_ID } from '@/constants/apModels'
import { DEFAULT_CHANNEL_WIDTH } from '@/constants/channelWidths'
import './DemoLoader.sass'

const IMG_SRC  = import.meta.env.BASE_URL + 'sample-walls/example3.png'
const SRC_IMG  = import.meta.env.BASE_URL + 'source.png'
const JSON_SRC = import.meta.env.BASE_URL + 'source.json'
const BASE_NAME = 'Demo'

function nextDemoName(floors) {
  const taken = new Set(floors.map((f) => f.name))
  if (!taken.has(BASE_NAME)) return BASE_NAME
  let n = 2
  while (taken.has(`${BASE_NAME}-${n}`)) n++
  return `${BASE_NAME}-${n}`
}

// Hand-picked centres (in example3.png pixel space, 685x511) of the five
// largest rooms in the floor plan: double garage, family living, gourmet
// kitchen, home theatre, master suite.
const DEMO_AP_POSITIONS_NORM = [
  { x:  85 / 685, y: 360 / 511 }, // double garage
  { x: 415 / 685, y: 175 / 511 }, // family living
  { x: 510 / 685, y: 250 / 511 }, // gourmet kitchen
  { x: 410 / 685, y: 400 / 511 }, // home theatre
  { x: 615 / 685, y: 400 / 511 }, // master suite
]

// Cable seed (13-3): single horizontal tray cutting through the middle of
// the house, magnet 150 px so all five room-centre APs land inside its
// capsule. Switch sits on the tray so its snap distance is zero, leaving
// AP cable lengths the only meaningful variable. xy normalised to
// example3.png (685x511) and scaled to the actual canvas at load time.
const DEMO_TRAY_PTS_NORM = [
  { x:  50 / 685, y: 320 / 511 },
  { x: 640 / 685, y: 320 / 511 },
]
const DEMO_TRAY_MAGNET_PX = 150
const DEMO_SWITCH_NORM = { x: 300 / 685, y: 320 / 511 }

function buildDemoAPs(canvasWidth, canvasHeight, regulatoryDomain) {
  const aps = DEMO_AP_POSITIONS_NORM.map((p, i) => ({
    id: generateId('ap'),
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
    name: `AP-${String(i + 1).padStart(2, '0')}`,
    color: '#4fc3f7',
  }))
  const assignments = greedyChannelAssign(aps, regulatoryDomain)
  return aps.map((ap) => {
    const picked = assignments.get(ap.id)
    return picked ? { ...ap, channel: picked.channel } : ap
  })
}

function DemoLoader() {
  const [loading, setLoading] = useState(false)
  const floors             = useFloorStore((s) => s.floors)
  const importFloorFromUrl = useFloorStore((s) => s.importFloorFromUrl)
  const setWalls           = useWallStore((s) => s.setWalls)
  const setAPs             = useAPStore((s) => s.setAPs)
  const setSwitches        = useCableStore((s) => s.setSwitches)
  const addTray            = useCableStore((s) => s.addTray)
  const nextSwitchName     = useCableStore((s) => s.nextSwitchName)
  const nextTrayName       = useCableStore((s) => s.nextTrayName)
  const setHeatmapEnabled  = useHeatmapStore((s) => s.setEnabled)
  const regulatoryDomain   = useEditorStore((s) => s.regulatoryDomain)
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
      // them to fit `example3.png` so they land inside the canvas.
      const scale = img.naturalWidth / srcImg.naturalWidth

      const pxPerM = img.naturalWidth / 30
      const floor = importFloorFromUrl(
        IMG_SRC,
        img.naturalWidth,
        img.naturalHeight,
        nextDemoName(floors),
        pxPerM,
      )

      const lines = (Array.isArray(json) ? json : json.lines ?? []).map((l) => ({
        ...l,
        x1: l.x1 * scale, y1: l.y1 * scale,
        x2: l.x2 * scale, y2: l.y2 * scale,
      }))
      const { walls } = floorplanFromLines(lines)
      setWalls(floor.id, walls)
      setAPs(floor.id, buildDemoAPs(img.naturalWidth, img.naturalHeight, regulatoryDomain))

      // Cable seed: one tray + one switch, sized to the actual canvas.
      const W = img.naturalWidth, H = img.naturalHeight
      // addTray (not setTrays) so the global tray counter auto-bumps —
      // user-drawn trays after Demo then continue from TRAY-02 onwards.
      addTray(floor.id, {
        id: generateId('tray'),
        name: nextTrayName(),
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

  const busy = loading || warmingUp
  const label = warmingUp ? '初始化熱力圖引擎…' : loading ? '載入中…' : '載入 Demo 平面圖'
  const sidebarCollapsed = useEditorStore((s) => s.sidebarCollapsed)

  return (
    <button
      className={`demo-loader${sidebarCollapsed ? ' demo-loader--compact' : ''}`}
      onClick={handleLoad}
      disabled={busy}
      title={sidebarCollapsed ? label : (warmingUp ? '熱力圖引擎初始化中，請稍候' : '再次點擊可新增另一個 Demo 樓層')}
    >
      {busy ? <span className="demo-loader__spinner" /> : '🗺'}
      {!sidebarCollapsed && <span>{label}</span>}
    </button>
  )
}

export default DemoLoader
