// 牆體材質與衰減係數 (dB)
// dbLoss 為 2.4 GHz 基準值，freqFactor 為各頻段乘數
export const MATERIALS = {
  GLASS: {
    id: 'glass',
    label: '玻璃',
    dbLoss: 2,
    freqFactor: { 2.4: 1.0, 5: 1.5, 6: 2.0 },
    color: '#48c9b0',   // 青綠
  },
  DRYWALL: {
    id: 'drywall',
    label: '輕隔間 (石膏板)',
    dbLoss: 3,
    freqFactor: { 2.4: 1.0, 5: 1.3, 6: 1.7 },
    color: '#f39c12',   // 琥珀橘
  },
  WOOD: {
    id: 'wood',
    label: '木板',
    dbLoss: 4,
    freqFactor: { 2.4: 1.0, 5: 1.25, 6: 1.5 },
    color: '#a04000',   // 深棕
  },
  BRICK: {
    id: 'brick',
    label: '磚牆',
    dbLoss: 8,
    freqFactor: { 2.4: 1.0, 5: 1.4, 6: 1.6 },
    color: '#cb4335',   // 磚紅
  },
  CONCRETE: {
    id: 'concrete',
    label: '混凝土',
    dbLoss: 12,
    freqFactor: { 2.4: 1.0, 5: 1.5, 6: 1.8 },
    color: '#2e86c1',   // 藍灰
  },
  METAL: {
    id: 'metal',
    label: '金屬',
    dbLoss: 20,
    freqFactor: { 2.4: 1.0, 5: 1.25, 6: 1.4 },
    color: '#6c3483',   // 深紫
  },
}

// 依 dB 由小到大排序
export const MATERIAL_LIST = Object.values(MATERIALS).sort((a, b) => a.dbLoss - b.dbLoss)

// 門窗類型
export const OPENING_TYPES = {
  DOOR: {
    id: 'door',
    label: '門',
    defaultMaterial: 'wood',     // 預設木板 4dB
    color: '#8B5E3C',            // 棕色
  },
  WINDOW: {
    id: 'window',
    label: '窗',
    defaultMaterial: 'glass',    // 預設玻璃 2dB
    color: '#5DADE2',            // 淺藍
  },
}

export const OPENING_LIST = Object.values(OPENING_TYPES)

// 透過 id 找材質
export const getMaterialById = (id) => MATERIAL_LIST.find((m) => m.id === id) ?? MATERIALS.WOOD
