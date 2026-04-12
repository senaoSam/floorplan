import React from 'react'
import { Group, Circle, Arc, Text } from 'react-konva'
import { useAPStore } from '@/store/useAPStore'

// 依頻段給顏色
const FREQ_COLOR = {
  2.4: '#f39c12',
  5:   '#4fc3f7',
  6:   '#a855f7',
}

function APMarker({ ap, isSelected, isDraggable, onClick, onMoved, onDragMove, isDrawingActive, onRightMouseDown }) {
  const color = FREQ_COLOR[ap.frequency] ?? '#4fc3f7'
  const ringColor = isSelected ? '#e74c3c' : color

  return (
    <Group
      x={ap.x}
      y={ap.y}
      draggable={isDraggable}
      onClick={(e) => { e.cancelBubble = true; onClick(ap.id) }}
      onContextMenu={(e) => {
        e.evt.preventDefault()
        if (isDrawingActive) return
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
        ctx.arc(0, 0, 20, 0, Math.PI * 2)
        ctx.closePath()
        shape.fillStrokeShape(shape)
      }}
    >
      {/* 外環 */}
      <Circle
        radius={16}
        fill="rgba(0,0,0,0.35)"
        stroke={ringColor}
        strokeWidth={isSelected ? 3 : 2}
      />
      {/* WiFi 弧形（由外到內三層） */}
      {[11, 7, 3].map((r, i) => (
        <Arc
          key={r}
          innerRadius={r - 1.5}
          outerRadius={r}
          angle={180}
          rotation={-180}
          fill={color}
          opacity={1 - i * 0.2}
          offsetY={2}
        />
      ))}
      {/* 中心點 */}
      <Circle radius={2.5} fill={color} offsetY={2} />
      {/* 名稱標籤：深色陰影確保淺/深背景都清晰 */}
      <Text
        text={ap.name}
        fontSize={10}
        fill="#fff"
        align="center"
        offsetX={20}
        offsetY={-22}
        width={40}
        shadowColor="#000"
        shadowBlur={4}
        shadowOpacity={0.9}
        shadowOffsetX={0}
        shadowOffsetY={0}
      />
    </Group>
  )
}

function APLayer({ floorId, selectedAPId, onAPClick, onAPDragMove, onAPDragEnd, isDrawingActive, onRightMouseDown }) {
  const aps        = useAPStore((s) => s.apsByFloor[floorId] ?? [])
  const updateAP   = useAPStore((s) => s.updateAP)

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
          isDraggable
          onClick={onAPClick}
          onMoved={handleMoved}
          onDragMove={onAPDragMove}
          isDrawingActive={isDrawingActive}
          onRightMouseDown={onRightMouseDown}
        />
      ))}
    </Group>
  )
}

export default APLayer
