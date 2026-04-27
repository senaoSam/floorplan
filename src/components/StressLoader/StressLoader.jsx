import React from 'react'
import { useFloorStore } from '@/store/useFloorStore'
import { useAPStore } from '@/store/useAPStore'
import { generateId } from '@/utils/id'
import { DEFAULT_AP_MODEL_ID } from '@/constants/apModels'
import { DEFAULT_CHANNEL_WIDTH } from '@/constants/channelWidths'
import './StressLoader.sass'

const COUNTS = [50, 150, 300]

// Cycle a small 5 GHz channel set so SINR / CCI computations have something
// non-trivial to chew on. 36/40/44/48 are the U-NII-1 20 MHz channels which
// don't overlap one another but APs sharing the same channel will (HM-3
// co-channel SINR aggregation).
const CHANNEL_CYCLE = [36, 40, 44, 48]

function buildGridAPs(floor, count) {
  const scale = floor.scale
  if (!scale || count <= 0) return []
  // Constrain the grid to the bottom half of the plan with a 1 m margin
  // (top edge = vertical center, bottom/left/right = 1 m).
  const marginPx = scale * 1.0
  const innerW = Math.max(1, floor.imageWidth  - 2 * marginPx)
  const innerH = Math.max(1, (floor.imageHeight / 2) - marginPx)
  const originX = marginPx
  const originY = floor.imageHeight / 2
  // Aspect-aware grid: cols × rows ≈ count, cols/rows ≈ innerW/innerH.
  const aspect = innerW / innerH
  const rows = Math.max(1, Math.round(Math.sqrt(count / aspect)))
  const cols = Math.max(1, Math.ceil(count / rows))
  const stepX = innerW / cols
  const stepY = innerH / rows
  const aps = []
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols)
    const c = i % cols
    const x = originX + (c + 0.5) * stepX
    const y = originY + (r + 0.5) * stepY
    aps.push({
      id: generateId('ap'),
      x, y,
      z: 2.4,
      txPower: 20,
      frequency: 5,
      channel: CHANNEL_CYCLE[i % CHANNEL_CYCLE.length],
      channelWidth: DEFAULT_CHANNEL_WIDTH[5],
      antennaMode: 'omni',
      azimuth: 0,
      beamwidth: 60,
      patternId: null,
      mountType: 'ceiling',
      modelId: DEFAULT_AP_MODEL_ID,
      name: `Stress-${String(i + 1).padStart(4, '0')}`,
      color: '#4fc3f7',
    })
  }
  return aps
}

function StressLoader() {
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const floors        = useFloorStore((s) => s.floors)
  const setAPs        = useAPStore((s) => s.setAPs)

  const activeFloor = floors.find((f) => f.id === activeFloorId) ?? null
  const disabled = !activeFloor || !activeFloor.scale

  const handleFill = (count) => {
    if (disabled) return
    const aps = buildGridAPs(activeFloor, count)
    setAPs(activeFloor.id, aps)
  }

  return (
    <div className="stress-loader">
      {COUNTS.map((n) => (
        <button
          key={n}
          type="button"
          className="stress-loader__btn"
          onClick={() => handleFill(n)}
          disabled={disabled}
          title={disabled ? '需先載入有比例尺的樓層' : `把目前樓層塞滿 ${n} 顆 AP（取代既有 AP）`}
        >
          {n} AP
        </button>
      ))}
    </div>
  )
}

export default StressLoader
