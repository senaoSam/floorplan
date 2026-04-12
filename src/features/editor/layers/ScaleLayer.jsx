import React from 'react'
import { Group, Line, Circle, Text, Rect } from 'react-konva'

const COLOR = '#f1c40f'

function ScaleLayer({ pt1, pt2, mousePos }) {
  const endPt = pt2 ?? mousePos
  const dash  = pt2 ? [] : [6, 4]

  const pixelDist = pt1 && endPt
    ? Math.round(Math.hypot(endPt.x - pt1.x, endPt.y - pt1.y))
    : 0

  const midX = pt1 && endPt ? (pt1.x + endPt.x) / 2 : 0
  const midY = pt1 && endPt ? (pt1.y + endPt.y) / 2 - 18 : 0

  return (
    <Group>
      {/* 量測線：黑色外框 + 黃色內線 */}
      {pt1 && endPt && (
        <>
          <Line
            points={[pt1.x, pt1.y, endPt.x, endPt.y]}
            stroke="#000"
            strokeWidth={4}
            dash={dash}
            opacity={0.45}
            listening={false}
          />
          <Line
            points={[pt1.x, pt1.y, endPt.x, endPt.y]}
            stroke={COLOR}
            strokeWidth={2}
            dash={dash}
            listening={false}
          />
        </>
      )}

      {/* 端點 */}
      {pt1 && (
        <>
          <Circle x={pt1.x} y={pt1.y} radius={7} fill="#000" opacity={0.3} />
          <Circle x={pt1.x} y={pt1.y} radius={5} fill={COLOR} />
        </>
      )}
      {pt2 && (
        <>
          <Circle x={pt2.x} y={pt2.y} radius={7} fill="#000" opacity={0.3} />
          <Circle x={pt2.x} y={pt2.y} radius={5} fill={COLOR} />
        </>
      )}

      {/* 距離 label：黑底白字確保可讀 */}
      {pt1 && endPt && pixelDist > 0 && (
        <>
          <Rect
            x={midX - 34} y={midY - 9}
            width={68}    height={18}
            fill="#000"   opacity={0.55}
            cornerRadius={4}
            listening={false}
          />
          <Text
            x={midX - 34} y={midY - 9}
            width={68}    height={18}
            text={`${pixelDist} px`}
            fontSize={11}
            fill={COLOR}
            align="center"
            verticalAlign="middle"
            listening={false}
          />
        </>
      )}
    </Group>
  )
}

export default ScaleLayer
