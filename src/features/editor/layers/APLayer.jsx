import React, { useState } from 'react'
import { Group, Circle, Arc, Line, Text, Rect } from 'react-konva'
import DeleteButton from './DeleteButton'
import { useAPStore } from '@/store/useAPStore'
import { useEditorStore } from '@/store/useEditorStore'

// Normalize azimuth to [0, 360) and beamwidth to [10, 180].
const wrapAzimuth = (v) => (((v % 360) + 360) % 360)
const clampBeamwidth = (v) => Math.max(10, Math.min(180, v))

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
  const hoverMul = isHovered && !isSelected ? 1.3 : 1
  const s = inverseScale * hoverMul

  const isDirectional = ap.antennaMode === 'directional'
  const azimuth       = wrapAzimuth(ap.azimuth ?? 0)
  const beamwidth     = clampBeamwidth(ap.beamwidth ?? 60)
  // Konva Arc: rotation 0° points to +x (right), sweeps clockwise for positive angle.
  // Our azimuth uses the same convention → center axis = azimuth, arc starts at azimuth - beamwidth/2.
  const arcStart = azimuth - beamwidth / 2
  const axisRad  = azimuth * Math.PI / 180
  const axisLen  = 40 * s

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
      hitFunc={(ctx, shape) => {
        ctx.beginPath()
        ctx.arc(0, 0, 24 * s, 0, Math.PI * 2)
        ctx.closePath()
        shape.fillStrokeShape(shape)
      }}
    >
      {/* 定向覆蓋扇形（僅指示方向與波瓣寬度，不代表真實距離） */}
      {isDirectional && (
        <>
          <Arc
            innerRadius={22 * s}
            outerRadius={45 * s}
            angle={beamwidth}
            rotation={arcStart}
            fill={color}
            opacity={isSelected ? 0.35 : (isHovered ? 0.28 : 0.18)}
            listening={false}
          />
          {isSelected && (
            <Arc
              innerRadius={44 * s}
              outerRadius={45 * s}
              angle={beamwidth}
              rotation={arcStart}
              stroke={color}
              strokeWidth={1 * s}
              dash={[3 * s, 3 * s]}
              listening={false}
            />
          )}
          {/* 方位中軸指示線 */}
          <Line
            points={[0, 0, Math.cos(axisRad) * axisLen, Math.sin(axisRad) * axisLen]}
            stroke={isSelected ? '#e74c3c' : color}
            strokeWidth={(isSelected ? 2 : 1.2) * s}
            opacity={0.85}
            listening={false}
          />
        </>
      )}
      {/* hover 光暈 */}
      {isHovered && !isSelected && (
        <Circle
          radius={28 * s}
          fill="rgba(255,255,255,0.12)"
          stroke="#fff"
          strokeWidth={1.5 * s}
          opacity={0.6}
          listening={false}
        />
      )}
      {/* 外環 */}
      <Circle
        radius={20 * s}
        fill="rgba(0,0,0,0.35)"
        stroke={isHovered && !isSelected ? '#fff' : ringColor}
        strokeWidth={(isSelected || isHovered ? 3.5 : 2.5) * s}
      />
      {/* 中央圖示：omni → WiFi 三層弧；directional → 方位箭頭 */}
      {!isDirectional ? (
        [14, 9, 4].map((r, i) => (
          <Arc
            key={r}
            innerRadius={(r - 2) * s}
            outerRadius={r * s}
            angle={180}
            rotation={-180}
            fill={color}
            opacity={1 - i * 0.2}
            offsetY={2.5 * s}
          />
        ))
      ) : (
        <Group rotation={azimuth}>
          {/* 箭身 */}
          <Line
            points={[-8 * s, 0, 8 * s, 0]}
            stroke={color}
            strokeWidth={2.5 * s}
            lineCap="round"
          />
          {/* 箭頭 */}
          <Line
            points={[14 * s, 0, 6 * s, -5 * s, 6 * s, 5 * s]}
            closed
            fill={color}
          />
        </Group>
      )}
      {/* 中心點 */}
      <Circle radius={3 * s} fill={color} offsetY={isDirectional ? 0 : 2.5 * s} />
      {/* 快速刪除按鈕 */}
      {isHovered && onDelete && (
        <DeleteButton
          x={16 * s}
          y={-16 * s}
          scale={s}
          onClick={() => onDelete(ap.id)}
          setHoverCursor={setHoverCursor}
        />
      )}
      {/* 名稱標籤 */}
      <Text
        text={ap.name}
        fontSize={13 * s}
        fill="#fff"
        align="center"
        offsetX={26 * s}
        offsetY={-28 * s}
        width={52 * s}
        shadowColor="#000"
        shadowBlur={4}
        shadowOpacity={0.9}
        shadowOffsetX={0}
        shadowOffsetY={0}
      />
      {/* AP 資訊標籤 */}
      {showAPInfo && (
        <Group y={24 * s} offsetX={40 * s}>
          <Rect
            width={80 * s}
            height={44 * s}
            fill="rgba(0,0,0,0.75)"
            cornerRadius={4 * s}
          />
          <Text
            text={`${ap.name}\n${FREQ_LABEL[ap.frequency] || ap.frequency + 'G'} CH${ap.channel}\n${ap.txPower} dBm`}
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
