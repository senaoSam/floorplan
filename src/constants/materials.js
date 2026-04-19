// 牆體材質與衰減係數
// PHY-2: 對齊 .tmp-heatmap §1.2 ITU-R P.2040-3 規格
//   refAttDb     — 使用者輸入「在 refFreqMHz 下此牆 = X dB」(.tmp §1.3 註解)
//   refFreqMHz   — 對應參考頻率
//   a, b, c, d   — ITU-R P.2040-3 §1.2 表格四參數（複介電常數頻率關係）
//   isConductor  — 金屬旗標（true = 不做頻率外推）
//
// 各頻段實際 dB 由 utils/ituR2040.js wallAttAtFreq() 用 (a,b,c,d) 即時外推。
// 既有 freqFactor 欄位已被 ITU-R 取代並移除。
export const MATERIALS = {
  GLASS: {
    id: 'glass',
    label: '玻璃',
    refAttDb: 2,
    refFreqMHz: 2400,
    a: 6.27, b: 0, c: 0.0043, d: 1.1925,
    isConductor: false,
    color: '#48c9b0',   // 青綠
  },
  DRYWALL: {
    id: 'drywall',
    label: '輕隔間 (石膏板)',
    refAttDb: 3,
    refFreqMHz: 2400,
    a: 2.94, b: 0, c: 0.0116, d: 0.7076,
    isConductor: false,
    color: '#f39c12',   // 琥珀橘
  },
  WOOD: {
    id: 'wood',
    label: '木板',
    refAttDb: 4,
    refFreqMHz: 2400,
    a: 1.99, b: 0, c: 0.0047, d: 1.0718,
    isConductor: false,
    color: '#a04000',   // 深棕
  },
  BRICK: {
    id: 'brick',
    label: '磚牆',
    refAttDb: 8,
    refFreqMHz: 2400,
    a: 3.75, b: 0, c: 0.038, d: 0,
    isConductor: false,
    color: '#cb4335',   // 磚紅
  },
  CONCRETE: {
    id: 'concrete',
    label: '混凝土',
    refAttDb: 12,
    refFreqMHz: 2400,
    a: 5.31, b: 0, c: 0.0326, d: 0.8095,
    isConductor: false,
    color: '#2e86c1',   // 藍灰
  },
  METAL: {
    id: 'metal',
    label: '金屬',
    refAttDb: 20,
    refFreqMHz: 2400,
    a: 1, b: 0, c: 1e7, d: 0,
    isConductor: true,
    color: '#6c3483',   // 深紫
  },
}

// 向後相容：仍提供 dbLoss 給未經 ITU 計算的程式碼路徑（如 cache key）
for (const m of Object.values(MATERIALS)) {
  m.dbLoss = m.refAttDb
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
