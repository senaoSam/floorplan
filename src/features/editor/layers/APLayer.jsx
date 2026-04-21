import React, { useState } from 'react'
import { Group, Circle, Arc, Line, Text, Rect } from 'react-konva'
import DeleteButton from './DeleteButton'
import { useAPStore } from '@/store/useAPStore'
import { useEditorStore } from '@/store/useEditorStore'
import { getPatternById, DEFAULT_PATTERN_ID } from '@/constants/antennaPatterns'

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

function APMarker({ ap, isSelected, isHovered, onHover, isDraggable, onClick, onMoved, onDragMove, isDrawingActive, onRightMouseDown, showAPInfo, inverseScale, onDelete, setHoverCursor }) {
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
      onMouseEnter={() => { setHoverCursor?.('grab'); onHover(ap.id) }}
      onMouseLeave={() => { setHoverCursor?.(null); onHover(null) }}
      onClick={(e) => { e.cancelBubble = true; onClick(ap.id, e) }}
      onContextMenu={(e) => {
        e.evt.preventDefault()
        e.cancelBubble = true
        onClick(ap.id, e)
      }}
      onMouseDown={(e) => {
        if (e.evt.button === 2) {
          e.cancelBubble = true
          onRightMouseDown?.(e.currentTarget)
        }
      }}
      onDragStart={(e) => { e.cancelBubble = true; onClick(ap.id, e) }}
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
      {/* 圓形主體 — 外圍藍、裡面白（sample 風格，radius 10） */}
      <Circle
        radius={10 * s}
        fill="#ffffff"
        stroke={isSelected ? '#e74c3c' : isHovered ? '#1e3a8a' : '#1e3a8a'}
        strokeWidth={(isSelected ? 3 : isHovered ? 2.5 : 2) * s}
        listening={false}
      />
      {/* 方位指示：directional / custom 用箭頭；omni 無內部圖示（保持全白） */}
      {isOriented && (
        <Group rotation={azimuth} listening={false}>
          <Line
            points={[-4 * s, 0, 4 * s, 0]}
            stroke="#1e3a8a"
            strokeWidth={1.5 * s}
            lineCap="round"
          />
          <Line
            points={[7 * s, 0, 3 * s, -3 * s, 3 * s, 3 * s]}
            closed
            fill="#1e3a8a"
          />
        </Group>
      )}
      {/* 快速刪除按鈕 */}
      {isHovered && onDelete && (
        <DeleteButton
          x={9 * s}
          y={-9 * s}
          scale={s}
          onClick={() => onDelete(ap.id)}
          setHoverCursor={setHoverCursor}
        />
      )}
      {/* 名稱標籤 */}
      <Text
        text={ap.name}
        fontSize={11 * s}
        fill="#fff"
        align="center"
        offsetX={22 * s}
        offsetY={-16 * s}
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

function APLayer({ floorId, selectedAPId, selectedItems = [], onAPClick, onAPDragMove, onAPDragEnd, isDrawingActive, onRightMouseDown, viewportScale, onDelete, setHoverCursor, dimmed }) {
  const aps        = useAPStore((s) => s.apsByFloor[floorId] ?? [])
  const updateAP   = useAPStore((s) => s.updateAP)
  const showAPInfo = useEditorStore((s) => s.showAPInfo)
  const inverseScale = 1 / viewportScale
  const [hoveredId, setHoveredId] = useState(null)
  const batchSelectedIds = selectedItems.length > 1 ? new Set(selectedItems.filter((it) => it.type === 'ap').map((it) => it.id)) : null

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
          onHover={setHoveredId}
          isDraggable
          onClick={onAPClick}
          onMoved={handleMoved}
          onDragMove={onAPDragMove}
          isDrawingActive={isDrawingActive}
          onRightMouseDown={onRightMouseDown}
          showAPInfo={showAPInfo}
          inverseScale={inverseScale}
          onDelete={onDelete}
          setHoverCursor={setHoverCursor}
        />
      ))}
    </Group>
  )
}

export default APLayer
