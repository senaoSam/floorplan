import React from 'react'
import { Layer, Line, Circle } from 'react-konva'
import { useWallStore } from '@/store/useWallStore'

function WallLayer({ floorId, drawStart, mousePos, selectedWallId, onWallClick }) {
  const walls = useWallStore((s) => s.wallsByFloor[floorId] ?? [])

  return (
    <Layer>
      {/* 已完成的牆體 */}
      {walls.map((wall) => {
        const isSelected = wall.id === selectedWallId
        return (
          <Line
            key={wall.id}
            points={[wall.startX, wall.startY, wall.endX, wall.endY]}
            stroke={isSelected ? '#e74c3c' : wall.material.color}
            strokeWidth={isSelected ? 5 : 3}
            lineCap="round"
            hitStrokeWidth={12}
            onClick={(e) => { e.cancelBubble = true; onWallClick?.(wall.id) }}
          />
        )
      })}

      {/* 繪製中的 ghost 線：黑色外框 + 亮色內線，確保在淺/深背景都清晰 */}
      {drawStart && mousePos && (
        <>
          <Line
            points={[drawStart.x, drawStart.y, mousePos.x, mousePos.y]}
            stroke="#000"
            strokeWidth={4}
            dash={[8, 5]}
            opacity={0.5}
            listening={false}
          />
          <Line
            points={[drawStart.x, drawStart.y, mousePos.x, mousePos.y]}
            stroke="#00e5ff"
            strokeWidth={2}
            dash={[8, 5]}
            listening={false}
          />
        </>
      )}

      {/* 繪製中的起點 */}
      {drawStart && (
        <>
          <Circle x={drawStart.x} y={drawStart.y} radius={7} fill="#000" opacity={0.4} />
          <Circle x={drawStart.x} y={drawStart.y} radius={5} fill="#00e5ff" />
        </>
      )}
    </Layer>
  )
}

export default WallLayer
