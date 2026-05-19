import React, { useState } from 'react'
import { Group, Rect, Text, Line } from 'react-konva'
import DeleteButton from './DeleteButton'
import { useCableStore, getSwitchKindColor } from '@/store/useCableStore'
import { useFocusedDevices } from '@/features/editor/useFocusedDevices'

// 17-2: indigo halo wrapped around devices related to the current selection.
const FOCUS_HALO = '#818cf8'

// Switch icon = small rounded chassis with port indicators on the bottom edge.
// Kind colour drives stroke + label background so switch / IDF / MDF / router
// stay visually distinguishable without needing to read text.
const KIND_LABEL = {
  switch: 'SW',
  idf:    'IDF',
  mdf:    'MDF',
  router: 'RTR',
}

function SwitchMarker({ sw, isSelected, isHovered, isFocused, onHover, isDraggable, onClick, onMoved, onDragMove, onRightMouseDown, inverseScale, onDelete, setHoverCursor }) {
  const s = inverseScale
  const color = getSwitchKindColor(sw.kind)
  const strokeColor = isSelected ? '#e74c3c' : color
  const w = 30 * s
  const h = 18 * s

  return (
    <Group
      x={sw.x}
      y={sw.y}
      draggable={isDraggable}
      onMouseEnter={() => { setHoverCursor?.('grab'); onHover(sw.id) }}
      onMouseLeave={() => { setHoverCursor?.(null); onHover(null) }}
      onClick={(e) => { e.cancelBubble = true; onClick(sw.id, e) }}
      onContextMenu={(e) => {
        e.evt.preventDefault()
        e.cancelBubble = true
        onClick(sw.id, e)
      }}
      onMouseDown={(e) => {
        if (e.evt.button === 2) {
          e.cancelBubble = true
          onRightMouseDown?.(e.currentTarget)
        }
      }}
      onDragStart={(e) => { e.cancelBubble = true; onClick(sw.id, e) }}
      onDragMove={(e) => {
        e.cancelBubble = true
        onDragMove?.(sw.id, e.target.x(), e.target.y())
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true
        onMoved(sw.id, e.target.x(), e.target.y())
      }}
    >
      {/* 17-2 focus halo — drawn first so chassis sits on top of it. */}
      {isFocused && (
        <Rect
          x={-w / 2 - 4 * s}
          y={-h / 2 - 4 * s}
          width={w + 8 * s}
          height={h + 8 * s}
          cornerRadius={5 * s}
          stroke={FOCUS_HALO}
          strokeWidth={3 * s}
          opacity={0.85}
          listening={false}
        />
      )}
      {/* Chassis */}
      <Rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        cornerRadius={3 * s}
        fill="#1f2937"
        stroke={strokeColor}
        strokeWidth={(isSelected ? 2.5 : isHovered ? 2 : 1.5) * s}
      />
      {/* Port row (visual only) */}
      {Array.from({ length: 8 }).map((_, i) => (
        <Rect
          key={i}
          x={-w / 2 + (3 + i * 3) * s}
          y={h / 2 - 4 * s}
          width={2 * s}
          height={2 * s}
          fill={color}
          listening={false}
        />
      ))}
      {/* PoE badge */}
      {sw.poeBudget > 0 && (
        <Line
          points={[-w / 2 + 3 * s, -h / 2 + 4 * s, -w / 2 + 7 * s, -h / 2 + 4 * s]}
          stroke="#facc15"
          strokeWidth={1.5 * s}
          listening={false}
        />
      )}
      {/* Kind label inside chassis */}
      <Text
        text={KIND_LABEL[sw.kind] ?? 'SW'}
        fontSize={9 * s}
        fontStyle="bold"
        fill="#fff"
        align="center"
        x={-w / 2}
        y={-h / 2 + 3 * s}
        width={w}
        listening={false}
      />
      {/* Name label above */}
      <Text
        text={sw.name}
        fontSize={11 * s}
        fill="#fff"
        align="center"
        offsetX={30 * s}
        offsetY={h / 2 + 14 * s}
        width={60 * s}
        shadowColor="#000"
        shadowBlur={4}
        shadowOpacity={0.9}
        listening={false}
      />
      {/* Quick delete */}
      {isHovered && onDelete && (
        <DeleteButton
          x={w / 2}
          y={-h / 2}
          scale={s}
          onClick={() => onDelete(sw.id)}
          setHoverCursor={setHoverCursor}
        />
      )}
    </Group>
  )
}

function SwitchLayer({ floorId, selectedSwitchId, selectedItems = [], onSwitchClick, onSwitchDragMove, onSwitchDragEnd, onRightMouseDown, viewportScale, onDelete, setHoverCursor, dimmed }) {
  const switches      = useCableStore((s) => s.switchesByFloor[floorId] ?? [])
  const updateSwitch  = useCableStore((s) => s.updateSwitch)
  const inverseScale  = 1 / (viewportScale || 1)
  const [hoveredId, setHoveredId] = useState(null)
  const batchSelectedIds = selectedItems.length > 1 ? new Set(selectedItems.filter((it) => it.type === 'switch').map((it) => it.id)) : null
  const focused = useFocusedDevices()

  const handleMoved = (id, x, y) => {
    updateSwitch(floorId, id, { x, y })
    onSwitchDragEnd?.()
  }

  return (
    <Group opacity={dimmed ? 0.2 : 1}>
      {switches.map((sw) => (
        <SwitchMarker
          key={sw.id}
          sw={sw}
          isSelected={sw.id === selectedSwitchId || (batchSelectedIds?.has(sw.id) ?? false)}
          isHovered={sw.id === hoveredId}
          isFocused={focused.switches.has(sw.id)}
          onHover={setHoveredId}
          isDraggable
          onClick={onSwitchClick}
          onMoved={handleMoved}
          onDragMove={onSwitchDragMove}
          onRightMouseDown={onRightMouseDown}
          inverseScale={inverseScale}
          onDelete={onDelete}
          setHoverCursor={setHoverCursor}
        />
      ))}
    </Group>
  )
}

export default SwitchLayer
