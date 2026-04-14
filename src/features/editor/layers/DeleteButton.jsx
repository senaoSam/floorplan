import React from 'react'
import { Group, Circle, Line } from 'react-konva'

function DeleteButton({ x, y, scale = 1, onClick }) {
  const s = scale
  const r = 10 * s

  return (
    <Group
      x={x}
      y={y}
      onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'pointer' }}
      onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default' }}
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
