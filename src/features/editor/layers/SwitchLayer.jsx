import React, { useMemo, useState } from 'react'
import { Group, Rect, Text, Line, Circle } from 'react-konva'
import DeleteButton from './DeleteButton'
import { useCableStore, getSwitchKindColor } from '@/store/useCableStore'
import { useFocusedDevices } from '@/features/editor/useFocusedDevices'
import { computeSwitchSnaps } from '@/features/cable/switchSnapStatus'

// 17-2: indigo halo wrapped around devices related to the current selection.
const FOCUS_HALO = '#818cf8'

// 17-4: snap-status palette. Two visual states a switch can be in:
//   snapped → at least one tray's magnet contains the chassis; small green
//             dot + dashed foot-drop lines to every snap target.
//   loose   → no tray within magnet range; muted dot + warning corner so
//             the user immediately sees the chassis is off-grid (and any
//             AP near it will fall back to Manhattan / unroutable).
const STATUS_SNAPPED_COLOR  = '#22c55e'   // green-500
const STATUS_LOOSE_COLOR    = '#9ca3af'   // gray-400
const STATUS_WARNING_COLOR  = '#ef4444'   // red-500
// Faint cyan dashed line for switch→tray-foot snap indicator. Picked to
// blend with the existing AP→Switch cable cyan without competing with it.
const SNAP_FOOT_COLOR = 'rgba(34, 211, 238, 0.55)'

// Switch icon = small rounded chassis with port indicators on the bottom edge.
// Kind colour drives stroke + label background so switch / IDF / MDF / router
// stay visually distinguishable without needing to read text.
const KIND_LABEL = {
  switch: 'SW',
  idf:    'IDF',
  mdf:    'MDF',
  router: 'RTR',
}

function SwitchMarker({ sw, isSelected, isHovered, isFocused, snapState, onHover, isDraggable, onClick, onMoved, onDragMove, onRightMouseDown, inverseScale, onDelete, setHoverCursor }) {
  const s = inverseScale
  const color = getSwitchKindColor(sw.kind)
  const strokeColor = isSelected ? '#e74c3c' : color
  const w = 30 * s
  const h = 18 * s

  const snapped = snapState?.snapped ?? false
  const drops   = snapState?.drops ?? []
  const statusColor = snapped ? STATUS_SNAPPED_COLOR : STATUS_LOOSE_COLOR

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
      {/* 17-4 snap foot-drops — dashed lines from chassis to every tray foot
          within magnet range. Drawn first (below the chassis) so the chassis
          covers the line entry point. Coords are RELATIVE to the chassis
          Group (which is positioned at sw.x, sw.y), so we subtract the
          chassis origin from each absolute foot xy. */}
      {drops.map((d, i) => (
        <Line
          key={`drop-${i}`}
          points={[0, 0, d.footXy.x - sw.x, d.footXy.y - sw.y]}
          stroke={SNAP_FOOT_COLOR}
          strokeWidth={1.1 * s}
          dash={[5 * s, 4 * s]}
          listening={false}
        />
      ))}
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
      {/* 17-4 snap-status dot — sits at chassis top-right corner. Green = at
          least one tray's magnet contains the chassis; gray = off-grid. */}
      <Circle
        x={w / 2 - 2 * s}
        y={-h / 2 + 2 * s}
        radius={2.8 * s}
        fill={statusColor}
        stroke="#0b0d12"
        strokeWidth={0.8 * s}
        listening={false}
      />
      {/* Unconnected warning — a red ⚠ at the chassis bottom-right when
          there's no snap target at all. Catches "I placed a switch but it
          can't reach the network" at a glance. */}
      {!snapped && (
        <Group x={w / 2 + 1 * s} y={h / 2 - 1 * s} listening={false}>
          <Circle radius={5 * s} fill={STATUS_WARNING_COLOR} stroke="#fff" strokeWidth={0.8 * s} />
          <Text
            text="!"
            fontSize={7 * s}
            fontStyle="bold"
            fill="#fff"
            align="center"
            x={-5 * s}
            y={-4 * s}
            width={10 * s}
          />
        </Group>
      )}
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
  const trays         = useCableStore((s) => s.traysByFloor[floorId] ?? [])
  const updateSwitch  = useCableStore((s) => s.updateSwitch)
  const inverseScale  = 1 / (viewportScale || 1)
  const [hoveredId, setHoveredId] = useState(null)
  const batchSelectedIds = selectedItems.length > 1 ? new Set(selectedItems.filter((it) => it.type === 'switch').map((it) => it.id)) : null
  const focused = useFocusedDevices()

  // 17-4 snap status: independent of routing — purely "is this switch within
  // magnet of at least one tray?" Drives the corner dot + warning + dashed
  // foot lines. Memoised on switches+trays so dragging doesn't recompute on
  // every cursor tick (the drag overlay layer reads the live position separately).
  const snapBySwitch = useMemo(
    () => computeSwitchSnaps(switches, trays),
    [switches, trays],
  )

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
          snapState={snapBySwitch.get(sw.id)}
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
