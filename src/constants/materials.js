// 牆體材質與衰減係數
//   dbLoss — 典型穿透衰減（dB）；作為 wall / opening / floor slab 的共用基準值
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
    color: '#f39c12',   // 琥珀橘
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
    color: '#2e86c1',   // 藍灰
  },
  METAL: {
    id: 'metal',
    label: '金屬',
    dbLoss: 20,
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

// 樓板（ceiling / slab）預設衰減值 (dB)
// 直接沿用牆體材質的 dbLoss，維持全系統材質 dB 一致；使用者若需更高衰減可手動調整。
export const FLOOR_SLAB_DEFAULT_DB = Object.fromEntries(
  MATERIAL_LIST.map((m) => [m.id, m.dbLoss]),
)

export const DEFAULT_FLOOR_SLAB_MATERIAL_ID = 'concrete'
export const DEFAULT_FLOOR_SLAB_DB = FLOOR_SLAB_DEFAULT_DB[DEFAULT_FLOOR_SLAB_MATERIAL_ID]
