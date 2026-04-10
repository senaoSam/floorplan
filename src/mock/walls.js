import { MATERIALS } from '@/constants/materials'

// Mock 牆體資料（對應 floor-1）
export const mockWalls = {
  'floor-1': [
    {
      id: 'wall-1',
      startX: 100, startY: 100,
      endX: 400,   endY: 100,
      material: MATERIALS.CONCRETE,
      topHeight: 3.0,
      bottomHeight: 0,
    },
    {
      id: 'wall-2',
      startX: 400, startY: 100,
      endX: 400,   endY: 350,
      material: MATERIALS.CONCRETE,
      topHeight: 3.0,
      bottomHeight: 0,
    },
    {
      id: 'wall-3',
      startX: 100, startY: 100,
      endX: 100,   endY: 350,
      material: MATERIALS.CONCRETE,
      topHeight: 3.0,
      bottomHeight: 0,
    },
    {
      id: 'wall-4',
      startX: 100, startY: 350,
      endX: 400,   endY: 350,
      material: MATERIALS.CONCRETE,
      topHeight: 3.0,
      bottomHeight: 0,
    },
  ],
}
