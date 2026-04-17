import React from 'react'
import { Group, Circle, Line } from 'react-konva'
import { useAPStore } from '@/store/useAPStore'
import { useScopeStore } from '@/store/useScopeStore'
import { useFloorHoleStore } from '@/store/useFloorHoleStore'

// Read-only tinted outlines of a reference floor's vector objects (AP / Scope /
// Floor Hole) for align mode. Rendered inside the floor's align-transformed
// Layer so they move with the reference image/walls.
//
// ⚠ [REF-OVERLAY-TYPE] 擴充點：新增可疊影的物件類型（IPCam / Switch / Gateway /
// Cable Tray 等）時，同步處理以下三處：
//   1. 這個檔案：新增對應的 store subscribe + tinted 輪廓渲染
//   2. AlignFloorPanel.jsx：legend 區加一列（swatch + 文字）
//   3. AlignFloorPanel.sass：對應 legend swatch 樣式
// 參考現有的 AP / Scope / Floor Hole 三類實作。
function RefVectorLayer({ floorId, color, opacity = 1 }) {
  const aps        = useAPStore((s) => s.apsByFloor[floorId] ?? [])
  const scopes     = useScopeStore((s) => s.scopesByFloor[floorId] ?? [])
  const floorHoles = useFloorHoleStore((s) => s.floorHolesByFloor[floorId] ?? [])

  if (aps.length === 0 && scopes.length === 0 && floorHoles.length === 0) return null

  return (
    <Group listening={false} opacity={opacity}>
      {/* Scope polygons — dashed outline */}
      {scopes.map((sc) => (
        <Line
          key={sc.id}
          points={sc.points}
          stroke={color}
          strokeWidth={1.5}
          dash={[6, 4]}
          closed
          listening={false}
        />
      ))}

      {/* Floor hole polygons — solid outline */}
      {floorHoles.map((h) => (
        <Line
          key={h.id}
          points={h.points}
          stroke={color}
          strokeWidth={1.5}
          closed
          listening={false}
        />
      ))}

      {/* APs — small ring + center dot */}
      {aps.map((ap) => (
        <Group key={ap.id} listening={false}>
          <Circle
            x={ap.x}
            y={ap.y}
            radius={8}
            stroke={color}
            strokeWidth={1.5}
            listening={false}
          />
          <Circle
            x={ap.x}
            y={ap.y}
            radius={2.5}
            fill={color}
            listening={false}
          />
        </Group>
      ))}
    </Group>
  )
}

export default RefVectorLayer
