import React from 'react'
import { useEditorStore, EDITOR_MODE } from '@/store/useEditorStore'
import { useFloorStore } from '@/store/useFloorStore'
import { useTrackingStore } from '@/store/useTrackingStore'
import { useCameraStore } from '@/store/useCameraStore'
import { DAY_START_SEC, DAY_END_SEC, formatClock, formatClockSec } from '@/features/cameras/mockTracks'
import { regenerateActiveFloorTracks } from '@/features/cameras/trackingBinder'
import './CameraTimelineBar.sass'

// Camera-mode playback bar (Phase 34-2/34-4). One clock drives live motion
// and replay: ▶ plays the simulated day, the slider scrubs it, speed
// chips trade realtime feel for fast review.

const SPEEDS = [1, 10, 60]

const OCCUPANCY_MODES = [
  { value: 'off',     label: '關' },
  { value: 'traffic', label: '人流量' },
  { value: 'dwell',   label: '停留時間' },
  { value: 'flow',    label: '動線' },
]

// Hour boundaries 08:00‥22:00 for the analysis-window selects.
const HOUR_OPTIONS = Array.from(
  { length: (DAY_END_SEC - DAY_START_SEC) / 3600 + 1 },
  (_, i) => DAY_START_SEC + i * 3600,
)

function CameraTimelineBar() {
  const inCameraMode = useEditorStore((s) => s.editorMode === EDITOR_MODE.CAMERA)
  const activeFloorId = useFloorStore((s) => s.activeFloorId)
  const clockSec = useTrackingStore((s) => s.clockSec)
  const playing = useTrackingStore((s) => s.playing)
  const speedX = useTrackingStore((s) => s.speedX)
  const showUndetected = useTrackingStore((s) => s.showUndetected)
  const occupancyMode = useTrackingStore((s) => s.occupancyMode)
  const occupancyFromSec = useTrackingStore((s) => s.occupancyFromSec)
  const occupancyToSec = useTrackingStore((s) => s.occupancyToSec)
  const occupancyLapsePlaying = useTrackingStore((s) => s.occupancyLapsePlaying)
  const setOccupancyMode = useTrackingStore((s) => s.setOccupancyMode)
  const setOccupancyRange = useTrackingStore((s) => s.setOccupancyRange)
  const setOccupancyLapsePlaying = useTrackingStore((s) => s.setOccupancyLapsePlaying)
  const trackCount = useTrackingStore((s) => (s.tracksByFloor[activeFloorId] ?? []).length)
  const setClockSec = useTrackingStore((s) => s.setClockSec)
  const setPlaying = useTrackingStore((s) => s.setPlaying)
  const setSpeedX = useTrackingStore((s) => s.setSpeedX)
  const toggleShowUndetected = useTrackingStore((s) => s.toggleShowUndetected)
  const showBlindSpots = useCameraStore((s) => s.showBlindSpots)
  const toggleShowBlindSpots = useCameraStore((s) => s.toggleShowBlindSpots)
  const showOverlap = useCameraStore((s) => s.showOverlap)
  const toggleShowOverlap = useCameraStore((s) => s.toggleShowOverlap)
  const showTrendPanel = useCameraStore((s) => s.showTrendPanel)
  const toggleShowTrendPanel = useCameraStore((s) => s.toggleShowTrendPanel)
  const clipHeatmapToFov = useCameraStore((s) => s.clipHeatmapToFov)
  const toggleClipHeatmapToFov = useCameraStore((s) => s.toggleClipHeatmapToFov)
  const showCameraList = useCameraStore((s) => s.showCameraList)
  const toggleShowCameraList = useCameraStore((s) => s.toggleShowCameraList)
  const drawTool = useCameraStore((s) => s.drawTool)
  const setDrawTool = useCameraStore((s) => s.setDrawTool)

  if (!inCameraMode || !activeFloorId) return null

  const toggleTool = (tool) => setDrawTool(drawTool === tool ? null : tool)

  return (
    <div className="camera-timeline">
      <div className="camera-timeline__row">
        <button
          type="button"
          className="camera-timeline__play"
          onClick={() => setPlaying(!playing)}
          title={playing ? '暫停' : '播放'}
        >
          {playing ? '⏸' : '▶'}
        </button>

        <span className="camera-timeline__clock">{formatClockSec(clockSec)}</span>

        <input
          type="range"
          className="camera-timeline__scrubber"
          min={DAY_START_SEC}
          max={DAY_END_SEC}
          step={10}
          value={clockSec}
          onChange={(e) => setClockSec(Number(e.target.value))}
          aria-label="時間軸"
        />

        <span className="camera-timeline__range">
          {formatClock(DAY_START_SEC)}–{formatClock(DAY_END_SEC)}
        </span>

        <div className="camera-timeline__speeds">
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              type="button"
              className={`camera-timeline__chip${speedX === sp ? ' camera-timeline__chip--active' : ''}`}
              onClick={() => setSpeedX(sp)}
            >
              {sp}x
            </button>
          ))}
        </div>

        <button
          type="button"
          className="camera-timeline__regen"
          onClick={regenerateActiveFloorTracks}
          title={`重新產生一天的模擬人流（目前 ${trackCount} 條軌跡）`}
        >
          🎲 重新產生
        </button>
      </div>

      <div className="camera-timeline__row">
        <label className="camera-timeline__ghosts" title="灰色 = 目前沒被任何 Camera 拍到的人車；取消勾選就只顯示鏡頭拍得到的目標">
          <input type="checkbox" checked={showUndetected} onChange={toggleShowUndetected} />
          <span>顯示鏡頭外目標</span>
        </label>

        <label className="camera-timeline__ghosts" title="把沒有任何 Camera 看得到的區域加上暗色遮罩（找監視死角）">
          <input type="checkbox" checked={showBlindSpots} onChange={toggleShowBlindSpots} />
          <span>盲區</span>
        </label>

        <label className="camera-timeline__ghosts" title="重疊覆蓋：黃=只有 1 台相機看到（單點故障即盲區），藍綠=2 台以上備援">
          <input type="checkbox" checked={showOverlap} onChange={toggleShowOverlap} />
          <span>重疊</span>
        </label>

        <button
          type="button"
          className={`camera-timeline__chip${showTrendPanel ? ' camera-timeline__chip--active' : ''}`}
          onClick={toggleShowTrendPanel}
          title="顯示整層樓的逐時占用趨勢（全日人/車數、尖峰時段）"
        >
          📊 趨勢
        </button>
        <button
          type="button"
          className={`camera-timeline__chip${showCameraList ? ' camera-timeline__chip--active' : ''}`}
          onClick={toggleShowCameraList}
          title="顯示本樓層相機清單（型號／狀態），點一列選取並置中"
        >
          📋 清單
        </button>

        <span className="camera-timeline__divider" aria-hidden="true" />

        <button
          type="button"
          className={`camera-timeline__chip${drawTool === 'tripwire' ? ' camera-timeline__chip--active' : ''}`}
          onClick={() => toggleTool('tripwire')}
          title="點兩點畫一條計數線，統計穿越人次（分方向）；右鍵或 Esc 取消"
        >
          ＋計數線
        </button>
        <button
          type="button"
          className={`camera-timeline__chip${drawTool === 'zone' ? ' camera-timeline__chip--active' : ''}`}
          onClick={() => toggleTool('zone')}
          title="點兩個對角畫一個分析區域，看進入人次／平均停留／尖峰時段；右鍵或 Esc 取消"
        >
          ＋區域
        </button>

        <span className="camera-timeline__divider" aria-hidden="true" />

        {/* Label + chips share one non-wrapping group so a narrow window
            moves the whole 熱圖 cluster to the next line instead of
            splitting the label from its chips. */}
        <span className="camera-timeline__group">
        <span className="camera-timeline__label">熱圖</span>
        <div className="camera-timeline__speeds">
          {OCCUPANCY_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`camera-timeline__chip${occupancyMode === m.value ? ' camera-timeline__chip--active' : ''}`}
              onClick={() => setOccupancyMode(m.value)}
              title={m.value === 'traffic' ? '每格有多少不同人次經過'
                : m.value === 'dwell' ? '每格累積停留秒數'
                : m.value === 'flow' ? '每格的平均行進方向（箭頭場）'
                : '關閉人流熱圖'}
            >
              {m.label}
            </button>
          ))}
        </div>
        </span>
      </div>

      {/* Heatmap sub-options live on their own third row so the 熱圖 chips
          (second row) and their sub-controls never wrap-split arbitrarily. */}
      {occupancyMode !== 'off' && (
        <div className="camera-timeline__row">
          <span className="camera-timeline__window" title="統計時段（熱圖／計數線／區域共用）">
            <select
              className="camera-timeline__select"
              value={occupancyFromSec}
              onChange={(e) => setOccupancyRange(Number(e.target.value), undefined)}
              aria-label="統計起始時間"
            >
              {HOUR_OPTIONS.filter((h) => h < occupancyToSec).map((h) => (
                <option key={h} value={h}>{formatClock(h)}</option>
              ))}
            </select>
            <span>–</span>
            <select
              className="camera-timeline__select"
              value={occupancyToSec}
              onChange={(e) => setOccupancyRange(undefined, Number(e.target.value))}
              aria-label="統計結束時間"
            >
              {HOUR_OPTIONS.filter((h) => h > occupancyFromSec).map((h) => (
                <option key={h} value={h}>{formatClock(h)}</option>
              ))}
            </select>
            <button
              type="button"
              className={`camera-timeline__chip${occupancyLapsePlaying ? ' camera-timeline__chip--active' : ''}`}
              onClick={() => {
                // Starting the lapse with a full-day window shows no motion —
                // the window already spans everything. Narrow it to 2h first so
                // the sliding hot-spots are immediately visible.
                if (!occupancyLapsePlaying && occupancyToSec - occupancyFromSec > 3 * 3600) {
                  setOccupancyRange(DAY_START_SEC, DAY_START_SEC + 2 * 3600)
                }
                setOccupancyLapsePlaying(!occupancyLapsePlaying)
              }}
              title="時間推移：固定統計時段寬度（自動縮成 2 小時），沿整天自動滑動播放，看活動熱點隨時間演變"
            >
              {occupancyLapsePlaying ? '⏸ 推移' : '⏱ 推移'}
            </button>
            <button
              type="button"
              className={`camera-timeline__chip${clipHeatmapToFov ? ' camera-timeline__chip--active' : ''}`}
              onClick={toggleClipHeatmapToFov}
              title="只在相機 FOV 覆蓋範圍內渲染熱圖（對標 Verkada；僅計線上相機）。關閉則顯示整層原始人流"
            >
              FOV 內
            </button>
          </span>
        </div>
      )}
    </div>
  )
}

export default CameraTimelineBar
