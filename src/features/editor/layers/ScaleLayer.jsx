import React from 'react'
import { Layer, Line, Circle, Text } from 'react-konva'

function ScaleLayer({ pt1, pt2, mousePos }) {
  const endPt = pt2 ?? mousePos

  const pixelDist = pt1 && endPt
    ? Math.round(Math.hypot(endPt.x - pt1.x, endPt.y - pt1.y))
    : 0

  const midX = pt1 && endPt ? (pt1.x + endPt.x) / 2 : 0
  const midY = pt1 && endPt ? (pt1.y + endPt.y) / 2 - 14 : 0

  return (
    <Layer>
      {/* 量測線 */}
      {pt1 && endPt && (
        <Line
          points={[pt1.x, pt1.y, endPt.x, endPt.y]}
          stroke="#f1c40f"
          strokeWidth={1.5}
          dash={pt2 ? [] : [6, 4]}
        />
      )}

      {/* 端點 */}
      {pt1 && (
        <Circle x={pt1.x} y={pt1.y} radius={5} fill="#f1c40f" />
      )}
      {pt2 && (
        <Circle x={pt2.x} y={pt2.y} radius={5} fill="#f1c40f" />
      )}

      {/* 像素距離提示 */}
      {pt1 && endPt && pixelDist > 0 && (
        <Text
          x={midX}
          y={midY}
          text={`${pixelDist} px`}
          fontSize={12}
          fill="#f1c40f"
          align="center"
          offsetX={30}
        />
      )}
    </Layer>
  )
}

export default ScaleLayer
