import React from 'react'
import { Group, Circle, Line } from 'react-konva'

// `leaveCursor` controls what to restore when the pointer leaves the button.
// Default 'move' matches AP / Wall / Scope (all draggable). Pass 'pointer' for
// non-draggable objects (e.g. Cable Tray) so the cursor doesn't lie.
function DeleteButton({ x, y, scale = 1, onClick, setHoverCursor, leaveCursor = 'move' }) {
  const s = scale
  const r = 10 * s

  return (
    <Group
      x={x}
      y={y}
      onMouseEnter={() => { setHoverCursor?.('pointer') }}
      onMouseLeave={() => { setHoverCursor?.(leaveCursor) }}
      onClick={(e) => {
        e.cancelBubble = true
        onClick()
      }}
    >
      {/* 背景陰影 */}
      <Circle radius={r + 1} fill="#000" opacity={0.3} listening={false} />
      {/* 紅色圓底 */}
      <Circle radius={r} fill="#e74c3c" stroke="#fff" strokeWidth={1.5 * s} />
      {/* X 叉叉 */}
      <Line
        points={[-4 * s, -4 * s, 4 * s, 4 * s]}
        stroke="#fff"
        strokeWidth={2.5 * s}
        lineCap="round"
        listening={false}
      />
      <Line
        points={[4 * s, -4 * s, -4 * s, 4 * s]}
        stroke="#fff"
        strokeWidth={2.5 * s}
        lineCap="round"
        listening={false}
      />
    </Group>
  )
}

export default DeleteButton
