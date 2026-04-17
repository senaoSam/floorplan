import React from 'react'
import { Group, Line } from 'react-konva'
import { useWallStore } from '@/store/useWallStore'

// Read-only tinted wall outlines for a reference floor in align mode.
// Rendered inside the reference floor's align-transformed Layer.
function RefWallLayer({ floorId, color, opacity = 1 }) {
  const walls = useWallStore((s) => s.wallsByFloor[floorId] ?? [])
  if (walls.length === 0) return null
  return (
    <Group listening={false} opacity={opacity}>
      {walls.map((wall) => (
        <Line
          key={wall.id}
          points={[wall.startX, wall.startY, wall.endX, wall.endY]}
          stroke={color}
          strokeWidth={2}
          lineCap="round"
          listening={false}
        />
      ))}
    </Group>
  )
}

export default RefWallLayer
