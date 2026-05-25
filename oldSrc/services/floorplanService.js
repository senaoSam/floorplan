/**
 * Data Layer — 整合時只需替換這個檔案的實作
 * 目前使用 mock 資料
 */
import { mockFloors } from '@/mock/floors'
import { mockWalls } from '@/mock/walls'
import { mockAPs } from '@/mock/aps'

export const floorplanService = {
  getFloors: () => Promise.resolve(mockFloors),

  getWalls: (floorId) => Promise.resolve(mockWalls[floorId] ?? []),

  getAPs: (floorId) => Promise.resolve(mockAPs[floorId] ?? []),

  // 以下整合時換成實際 API
  saveWall: (floorId, wall) => Promise.resolve(wall),
  saveAP: (floorId, ap) => Promise.resolve(ap),
  deleteWall: (floorId, wallId) => Promise.resolve(),
  deleteAP: (floorId, apId) => Promise.resolve(),
}
