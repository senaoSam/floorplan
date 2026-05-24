import React, { useState } from 'react'
import { Group, Circle, Arc, Line, Text, Rect } from 'react-konva'
import { useAPStore } from '@/store/useAPStore'
import { useEditorStore } from '@/store/useEditorStore'
import { getPatternById, DEFAULT_PATTERN_ID } from '@/constants/antennaPatterns'
import { useFocusedDevices } from '@/features/editor/useFocusedDevices'

// 17-2: indigo halo wrapped around devices related to the current selection.
const FOCUS_HALO = '#818cf8'

// Normalize azimuth to [0, 360) and beamwidth to [10, 180].
const wrapAzimuth = (v) => (((v % 360) + 360) % 360)
const clampBeamwidth = (v) => Math.max(10, Math.min(180, v))

// Build polygon points for a custom antenna pattern, scaled to given outer radius.
// minDb caps the smallest visible gain; samples index 0 points +x (azimuth-relative).
function patternPolygonPoints(pattern, outerR, azimuthRad, minDb = -30) {
  const samples = pattern.samples
  const n = samples.length
  const pts = []
  for (let i = 0; i < n; i++) {
    const db = Math.max(samples[i], minDb)
    const r = ((db - minDb) / -minDb) * outerR
    const ang = azimuthRad + i * (2 * Math.PI / n)
    pts.push(r * Math.cos(ang), r * Math.sin(ang))
  }
  return pts
}

// 依頻段給顏色
const FREQ_COLOR = {
  2.4: '#f39c12',
  5:   '#4fc3f7',
  6:   '#a855f7',
}

const FREQ_LABEL = {
  2.4: '2.4G',
  5:   '5G',
  6:   '6G',
}

function APMarker({ ap, isSelected, isHovered, isFocused, onHover, isDraggable, allowHover, allowCmdHover, allowAnyHover, allowClick, allowContextMenu, onClick, onContextMenu, onMoved, onDragMove, isDrawingActive, showAPInfo, inverseScale, setHoverCursor }) {
  const color = FREQ_COLOR[ap.frequency] ?? '#4fc3f7'
  const ringColor = isSelected ? '#e74c3c' : color
  const s = inverseScale

  const isDirectional = ap.antennaMode === 'directional'
  const isCustom      = ap.antennaMode === 'custom'
  const isOriented    = isDirectional || isCustom
  const azimuth       = wrapAzimuth(ap.azimuth ?? 0)
  const beamwidth     = clampBeamwidth(ap.beamwidth ?? 60)
  // Konva Arc: rotation 0° points to +x (right), sweeps clockwise for positive angle.
  // Our azimuth uses the same convention → center axis = azimuth, arc starts at azimuth - beamwidth/2.
  const arcStart = azimuth - beamwidth / 2
  const axisRad  = azimuth * Math.PI / 180
  const axisLen  = 32 * s
  const customPattern = isCustom ? getPatternById(ap.patternId ?? DEFAULT_PATTERN_ID) : null
  const customPts     = isCustom ? patternPolygonPoints(customPattern, 34 * s, axisRad) : null

  return (
    <Group
      x={ap.x}
      y={ap.y}
      draggable={isDraggable}
      onMouseEnter={() => {
        if (isDraggable) setHoverCursor?.('grab')
        if (allowAnyHover) onHover(ap.id)
      }}
      onMouseLeave={() => { setHoverCursor?.(null); onHover(null) }}
      onClick={(e) => {
        if (e.evt.button !== 0) return
        if (!allowClick) return
        e.cancelBubble = true
        onClick?.(ap.id, e)
      }}
      onContextMenu={(e) => {
        if (!allowContextMenu) return
        e.evt.preventDefault?.()
        e.cancelBubble = true
        onContextMenu?.(ap.id, e)
      }}
      onDragStart={(e) => { e.cancelBubble = true; onClick?.(ap.id, e) }}
      onDragMove={(e) => {
        e.cancelBubble = true
        onDragMove?.(ap.id, e.target.x(), e.target.y())
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true
        onMoved(ap.id, e.target.x(), e.target.y())
      }}
    >
      {/* 透明 hit circle — 唯一接收滑鼠事件的子元素，其餘全部 listening={false} */}
      <Circle radius={14 * inverseScale} fill="transparent" />
      {/* 17-2 focus halo — drawn first so the AP icon sits on top of it. */}
      {isFocused && (
        <Circle
          radius={15 * s}
          stroke={FOCUS_HALO}
          strokeWidth={3 * s}
          opacity={0.85}
          listening={false}
        />
      )}
      {/* 23-3f hover = full colour invert (per user spec). Was a faint outer
          ring; that proved invisible against the busy heatmap. Inverting the
          main circle's fill/stroke is loud enough to spot at a glance and
          works for both strong (SELECT) and weak (any other mode) hover. The
          actual recolour happens on the Circle / arrow markers below by
          reading `isHovered && !isSelected`. */}
      {/* 定向覆蓋扇形（僅指示方向與波瓣寬度，不代表真實距離） */}
      {isDirectional && (
        <>
          <Arc
            innerRadius={17 * s}
            outerRadius={36 * s}
            angle={beamwidth}
            rotation={arcStart}
            fill={color}
            opacity={isSelected ? 0.35 : (isHovered ? 0.28 : 0.18)}
            listening={false}
          />
          {isSelected && (
            <Arc
              innerRadius={35 * s}
              outerRadius={36 * s}
              angle={beamwidth}
              rotation={arcStart}
              stroke={color}
              strokeWidth={1 * s}
              dash={[3 * s, 3 * s]}
              listening={false}
            />
          )}
        </>
      )}
      {/* 自訂 pattern：極座標輪廓（位於外環外側，朝 azimuth 旋轉） */}
      {isCustom && customPts && (
        <Line
          points={customPts}
          closed
          fill={color}
          opacity={isSelected ? 0.35 : (isHovered ? 0.28 : 0.2)}
          stroke={color}
          strokeWidth={(isSelected ? 1.2 : 0.8) * s}
          listening={false}
        />
      )}
      {/* 方位中軸指示線（directional / custom 共用） */}
      {isOriented && (
        <Line
          points={[0, 0, Math.cos(axisRad) * axisLen, Math.sin(axisRad) * axisLen]}
          stroke={isSelected ? '#e74c3c' : color}
          strokeWidth={(isSelected ? 2 : 1.2) * s}
          opacity={0.85}
          listening={false}
        />
      )}
      {/* 圓形主體 — 外圍藍、裡面白（sample 風格，radius 10）。
          Hover (非 selected) → 反白：fill 變深藍、stroke 變白。 */}
      <Circle
        radius={10 * s}
        fill={(isHovered && !isSelected) ? '#1e3a8a' : '#ffffff'}
        stroke={isSelected ? '#e74c3c' : (isHovered && !isSelected) ? '#ffffff' : '#1e3a8a'}
        strokeWidth={(isSelected ? 3 : isHovered ? 2.5 : 2) * s}
        listening={false}
      />
      {/* 方位指示：directional / custom 用箭頭；hover 反白時箭頭也跟著反白 */}
      {isOriented && (() => {
        const iconCol = (isHovered && !isSelected) ? '#ffffff' : '#1e3a8a'
        return (
          <Group rotation={azimuth} listening={false}>
            <Line
              points={[-4 * s, 0, 4 * s, 0]}
              stroke={iconCol}
              strokeWidth={1.5 * s}
              lineCap="round"
            />
            <Line
              points={[7 * s, 0, 3 * s, -3 * s, 3 * s, 3 * s]}
              closed
              fill={iconCol}
            />
          </Group>
        )
      })()}
      {/* 名稱標籤（icon 上方） */}
      <Text
        text={ap.name}
        fontSize={11 * s}
        fill="#fff"
        align="center"
        offsetX={22 * s}
        offsetY={25 * s}
        width={44 * s}
        shadowColor="#000"
        shadowBlur={4}
        shadowOpacity={0.9}
        shadowOffsetX={0}
        shadowOffsetY={0}
        listening={false}
      />
      {/* AP 資訊標籤 */}
      {showAPInfo && (
        <Group y={19 * s} offsetX={40 * s} listening={false}>
          <Rect
            width={80 * s}
            height={44 * s}
            fill="rgba(0,0,0,0.75)"
            cornerRadius={4 * s}
          />
          <Text
            text={`${ap.name}\n${FREQ_LABEL[ap.frequency] || ap.frequency + 'G'} CH${ap.channel}/${ap.channelWidth ?? 20}\n${ap.txPower} dBm`}
            fontSize={11 * s}
            fill="#fff"
            x={0}
            y={4 * s}
            width={80 * s}
            align="center"
            lineHeight={1.3}
          />
        </Group>
      )}
    </Group>
  )
}

function APLayer({ floorId, selectedAPId, selectedItems = [], onAPClick, onAPContextMenu, onAPDragMove, onAPDragEnd, isDrawingActive, viewportScale, setHoverCursor, dimmed, capability }) {
  const allAPs     = useAPStore((s) => s.apsByFloor[floorId] ?? [])
  const updateAP   = useAPStore((s) => s.updateAP)
  const showAPInfo = useEditorStore((s) => s.showAPInfo)
  const showAPBand = useEditorStore((s) => s.showAPBand)
  // Filter by per-band visibility. APs whose frequency is unknown are kept
  // visible so we don't accidentally hide legacy data.
  const aps = allAPs.filter((ap) => showAPBand[ap.frequency] !== false)
  const inverseScale = 1 / viewportScale
  const [hoveredId, setHoveredId] = useState(null)
  const batchSelectedIds = selectedItems.length > 1 ? new Set(selectedItems.filter((it) => it.type === 'ap').map((it) => it.id)) : null
  const focused = useFocusedDevices()

  const allowDrag = !!capability?.allowDragExisting?.wireless
  const allowClick = !!capability?.allowSelectClick?.wireless
  const allowHover = !!capability?.allowSelectHover?.wireless
  // 23-3f weak hover for command targeting in non-SELECT modes.
  const allowCmdHover = !!capability?.allowCommandHover?.wireless
  const allowAnyHover = allowHover || allowCmdHover
  const allowContextMenu = !!capability?.allowContextMenu

  const handleMoved = (id, x, y) => {
    updateAP(floorId, id, { x, y })
    onAPDragEnd?.()
  }

  return (
    <Group opacity={dimmed ? 0.2 : 1}>
      {aps.map((ap) => (
        <APMarker
          key={ap.id}
          ap={ap}
          isSelected={ap.id === selectedAPId || (batchSelectedIds?.has(ap.id) ?? false)}
          isHovered={ap.id === hoveredId}
          isFocused={focused.aps.has(ap.id)}
          onHover={setHoveredId}
          isDraggable={allowDrag}
          allowHover={allowHover}
          allowCmdHover={allowCmdHover}
          allowAnyHover={allowAnyHover}
          allowClick={allowClick}
          allowContextMenu={allowContextMenu}
          onClick={onAPClick}
          onContextMenu={onAPContextMenu}
          onMoved={handleMoved}
          onDragMove={onAPDragMove}
          isDrawingActive={isDrawingActive}
          showAPInfo={showAPInfo}
          inverseScale={inverseScale}
          setHoverCursor={setHoverCursor}
        />
      ))}
    </Group>
  )
}

export default APLayer
