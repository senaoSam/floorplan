import React, { useState } from 'react'
import { Group, Circle, Arc, Text, Rect } from 'react-konva'
import { useAPStore } from '@/store/useAPStore'
import { useEditorStore } from '@/store/useEditorStore'

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

function APMarker({ ap, isSelected, isHovered, onHover, isDraggable, onClick, onMoved, onDragMove, isDrawingActive, onRightMouseDown, showAPInfo, inverseScale }) {
  const color = FREQ_COLOR[ap.frequency] ?? '#4fc3f7'
  const ringColor = isSelected ? '#e74c3c' : color
  const hoverMul = isHovered && !isSelected ? 1.3 : 1
  const s = inverseScale * hoverMul

  return (
    <Group
      x={ap.x}
      y={ap.y}
      draggable={isDraggable}
      onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'move'; onHover(ap.id) }}
      onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; onHover(null) }}
      onClick={(e) => { e.cancelBubble = true; onClick(ap.id) }}
      onContextMenu={(e) => {
        e.evt.preventDefault()
        e.cancelBubble = true
        onClick(ap.id)
      }}
      onMouseDown={(e) => {
        if (e.evt.button === 2) {
          e.cancelBubble = true
          onRightMouseDown?.(e.currentTarget)
        }
      }}
      onDragStart={(e) => { e.cancelBubble = true; onClick(ap.id) }}
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
      {/* WiFi 弧形（由外到內三層） */}
      {[14, 9, 4].map((r, i) => (
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
      ))}
      {/* 中心點 */}
      <Circle radius={3 * s} fill={color} offsetY={2.5 * s} />
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

function APLayer({ floorId, selectedAPId, onAPClick, onAPDragMove, onAPDragEnd, isDrawingActive, onRightMouseDown, viewportScale }) {
  const aps        = useAPStore((s) => s.apsByFloor[floorId] ?? [])
  const updateAP   = useAPStore((s) => s.updateAP)
  const showAPInfo = useEditorStore((s) => s.showAPInfo)
  const inverseScale = 1 / viewportScale
  const [hoveredId, setHoveredId] = useState(null)

  const handleMoved = (id, x, y) => {
    updateAP(floorId, id, { x, y })
    onAPDragEnd?.()
  }

  return (
    <Group>
      {aps.map((ap) => (
        <APMarker
          key={ap.id}
          ap={ap}
          isSelected={ap.id === selectedAPId}
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
        />
      ))}
    </Group>
  )
}

export default APLayer
