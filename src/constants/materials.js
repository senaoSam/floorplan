// 牆體材質與衰減係數 (dB)
export const MATERIALS = {
  GLASS: {
    id: 'glass',
    label: '玻璃',
    dbLoss: 2,
    color: '#48c9b0',   // 青綠
  },
  DRYWALL: {
    id: 'drywall',
    label: '輕隔間 (石膏板)',
    dbLoss: 3,
    color: '#f39c12',   // 琥珀橘（淺色背景也清楚）
  },
  WOOD: {
    id: 'wood',
    label: '木板',
    dbLoss: 4,
    color: '#a04000',   // 深棕
  },
  BRICK: {
    id: 'brick',
    label: '磚牆',
    dbLoss: 8,
    color: '#cb4335',   // 磚紅
  },
  CONCRETE: {
    id: 'concrete',
    label: '混凝土',
    dbLoss: 12,
    color: '#2e86c1',   // 藍灰（與金屬明顯不同）
  },
  METAL: {
    id: 'metal',
    label: '金屬',
    dbLoss: 20,
    color: '#6c3483',   // 深紫（最高衰減，最深色）
  },
}

// 依 dB 由小到大排序
export const MATERIAL_LIST = Object.values(MATERIALS).sort((a, b) => a.dbLoss - b.dbLoss)
