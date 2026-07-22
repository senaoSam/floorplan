import React, { useState } from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useWallStore } from '@/store/useWallStore'
import { useAPStore } from '@/store/useAPStore'
import { useHeatmapStore } from '@/store/useHeatmapStore'
import { useCableStore, DEFAULT_TRAY } from '@/store/useCableStore'
import { useCameraStore } from '@/store/useCameraStore'
import { useEditorStore } from '@/store/useEditorStore'
import { floorplanFromLines } from '@/utils/floorplanFromLines'
import { greedyChannelAssign } from '@/utils/autoChannelPlan'
import { generateId } from '@/utils/id'
import { DEFAULT_AP_MODEL_ID, getDefaultTxPower } from '@/constants/apModels'
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
// Second switch (idf) so the stats topology view has more than one uplink.
const DEMO_IDF_NORM = { x: 560 / 685, y: 320 / 511 }

// Camera seed (Phase 34): four cameras, one per floor corner, each aimed at
// the floor centre (azimuth computed from its own corner). Inset keeps the
// markers off the canvas edge.
const DEMO_CAMERA_CORNER_INSET = 0.06
const DEMO_CAMERA_FOV_DEG = 100
const DEMO_CAMERA_RANGE_M = 14
// Shallow tilt: corner units watch the whole floor (long reach, small blind
// ring right at the corner is fine).
const DEMO_CAMERA_TILT_DEG = 20

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

// Per-AP band mix for the demo so a fresh load already exercises the multi-band
// tooling (heatmap band filter + off-band dimming). Index-aligned with
// DEMO_AP_POSITIONS_NORM; channel is assigned per band by greedyChannelAssign
// below, so only the band + width matter here.
const DEMO_AP_BANDS = [2.4, 6, 5, 5, 6]

function buildDemoAPs(canvasWidth, canvasHeight, regulatoryDomain) {
  const aps = DEMO_AP_POSITIONS_NORM.map((p, i) => {
    const band = DEMO_AP_BANDS[i] ?? 5
    return {
      id: generateId('ap'),
      name: `AP-${String(i + 1).padStart(2, '0')}`,
      x: p.x * canvasWidth,
      y: p.y * canvasHeight,
      z: 2.4,
      txPower: getDefaultTxPower(band),
      frequency: band,
      channel: 36,
      channelWidth: DEFAULT_CHANNEL_WIDTH[band] ?? 20,
      antennaMode: 'omni',
      azimuth: 0,
      beamwidth: 60,
      patternId: null,
      mountType: 'ceiling',
      modelId: DEFAULT_AP_MODEL_ID,
      color: '#4fc3f7',
      // Demo: pin AP-03 offline so the stats view always shows an offline unit
      // (grey 離線 badge + ring + an alert). Real cloud status overrides this.
      ...(i === 2 ? { mockStatus: 'offline' } : {}),
    }
  })
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
      const accessSwId = generateId('sw')
      const idfSwId = generateId('sw')
      setSwitches(floor.id, [
        {
          id: accessSwId,
          name: nextSwitchName('switch'),
          x: DEMO_SWITCH_NORM.x * W,
          y: DEMO_SWITCH_NORM.y * H,
          kind: 'switch',
          mountHeight: 0.5,
          model: 'POE-24-port',
          portCount: 24,
          poeBudget: 370,
          uplinkTo: idfSwId,
          cableType: 'auto',
        },
        {
          id: idfSwId,
          name: nextSwitchName('idf'),
          x: DEMO_IDF_NORM.x * W,
          y: DEMO_IDF_NORM.y * H,
          kind: 'idf',
          mountHeight: 0.5,
          model: 'Catalyst 9300-48S',
          portCount: 48,
          poeBudget: 740,
          uplinkTo: null,
          cableType: 'fiber',
        },
      ])

      // Camera-mode seed — one camera per corner, aimed at the centre.
      // addCamera (not setCameras) so the global CAM-XX counter advances and
      // the user's own cameras continue the numbering.
      const cams = useCameraStore.getState()
      const inset = DEMO_CAMERA_CORNER_INSET
      const corners = [
        { x: W * inset,       y: H * inset },
        { x: W * (1 - inset), y: H * inset },
        { x: W * inset,       y: H * (1 - inset) },
        { x: W * (1 - inset), y: H * (1 - inset) },
      ]
      for (const c of corners) {
        const azimuth = Math.round(
          ((Math.atan2(H / 2 - c.y, W / 2 - c.x) * 180 / Math.PI) + 360) % 360,
        )
        // No calibration by default — like Verkada, calibration is a deliberate
        // manual step. Uncalibrated cameras show their tracks in plain floor
        // coordinates (the projection pipeline leaves them untouched); only a
        // manually-calibrated camera re-projects its tracks through its matrix.
        cams.addCamera(floor.id, {
          id: generateId('cam'),
          name: cams.nextCameraName(),
          x: c.x,
          y: c.y,
          z: 2.5,
          azimuth,
          tiltDeg: DEMO_CAMERA_TILT_DEG,
          fovDeg: DEMO_CAMERA_FOV_DEG,
          rangeM: DEMO_CAMERA_RANGE_M,
        })
      }

      // Unplaced-pool seed (Verkada "Add Cameras") — two spare cameras not yet
      // on the plan, so the Device List's 尚未放置 section has something to drop.
      for (let i = 0; i < 2; i++) {
        cams.addUnplacedCamera({
          id: generateId('cam'),
          name: cams.nextCameraName(),
          z: 2.5,
          azimuth: 0,
          tiltDeg: DEMO_CAMERA_TILT_DEG,
          fovDeg: DEMO_CAMERA_FOV_DEG,
          rangeM: DEMO_CAMERA_RANGE_M,
        })
      }

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
