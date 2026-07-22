// 牆體材質與衰減係數
//   dbLoss — 2.4 GHz 標稱單次穿透衰減（dB）。HM-F8 之後改為頻率函數的 anchor：
//            wallLossDb(f_GHz) = dbLoss * (f_GHz / 2.4) ** lossB
//            這樣 2.4 GHz 場景數值不變，5/6 GHz 隨 ITU-R P.2040-3 frequency 指數放大。
//   lossB  — 頻率指數
//   itu    — ITU-R P.2040-3 Table 3 介電/導電率係數，供反射時推 Fresnel 複數係數
export const MATERIALS = {
  GLASS: {
    id: 'glass',
    label: '玻璃',
    dbLoss: 2,
    lossB: 0.3,
    color: '#48c9b0',
    itu: { a: 6.31, b: 0, c: 0.0036, d: 1.3394 },
  },
  // 47-11 — Low-E（低輻射鍍膜）玻璃：金屬鍍膜讓穿透損耗遠高於一般玻璃
  // （真實量測 25-40dB）。anchor 25dB @2.4G、沿用玻璃頻率指數 0.3 →
  // 5GHz≈31dB、6GHz≈33dB，整段落在實測範圍內。反射用金屬係數——鍍膜的
  // 強反射正是它擋訊號的物理機制（穿透殘量才走 dbLoss）。
  LOW_E_GLASS: {
    id: 'low_e_glass',
    label: 'Low-E 玻璃',
    dbLoss: 25,
    lossB: 0.3,
    color: '#2e86c1',
    itu: { metal: true },
  },
  DRYWALL: {
    id: 'drywall',
    label: '輕隔間 (石膏板)',
    dbLoss: 3,
    lossB: 0.5,
    color: '#f39c12',
    itu: { a: 2.73, b: 0, c: 0.0085, d: 0.9395 },
  },
  WOOD: {
    id: 'wood',
    label: '木板',
    dbLoss: 4,
    lossB: 0.4,
    color: '#a04000',
    itu: { a: 1.99, b: 0, c: 0.0047, d: 1.0718 },
  },
  BRICK: {
    id: 'brick',
    label: '磚牆',
    dbLoss: 8,
    lossB: 0.6,
    color: '#cb4335',
    itu: { a: 3.91, b: 0, c: 0.0238, d: 0.16 },
  },
  CONCRETE: {
    id: 'concrete',
    label: '混凝土',
    dbLoss: 12,
    lossB: 0.6,
    color: '#bdc3c7',
    itu: { a: 5.24, b: 0, c: 0.0462, d: 0.7822 },
  },
  // 47-11 — 20dB 偏低：真實電梯井/機房金屬 >26-40dB，取中間值 30。
  // lossB 維持 0（金屬衰減頻率不敏感）。
  METAL: {
    id: 'metal',
    label: '金屬',
    dbLoss: 30,
    lossB: 0,
    color: '#6c3483',
    itu: { metal: true },
  },
}

const FREQ_ANCHOR_GHZ = 2.4
export function wallLossDb(material, fGhz) {
  if (!material) return 8
  const base = material.dbLoss ?? 8
  const b = material.lossB ?? 0
  if (b === 0 || !fGhz || fGhz <= 0) return base
  return base * Math.pow(fGhz / FREQ_ANCHOR_GHZ, b)
}

export const MATERIAL_LIST = Object.values(MATERIALS).sort((a, b) => a.dbLoss - b.dbLoss)

export const OPENING_TYPES = {
  DOOR: {
    id: 'door',
    label: '門',
    defaultMaterial: 'wood',
    color: '#8B5E3C',
  },
  WINDOW: {
    id: 'window',
    label: '窗',
    defaultMaterial: 'glass',
    color: '#5DADE2',
  },
}

export const OPENING_LIST = Object.values(OPENING_TYPES)

export const getMaterialById = (id) => MATERIAL_LIST.find((m) => m.id === id) ?? MATERIALS.WOOD

export const FLOOR_SLAB_DEFAULT_DB = Object.fromEntries(
  MATERIAL_LIST.map((m) => [m.id, m.dbLoss]),
)

export const DEFAULT_FLOOR_SLAB_MATERIAL_ID = 'concrete'
export const DEFAULT_FLOOR_SLAB_DB = FLOOR_SLAB_DEFAULT_DB[DEFAULT_FLOOR_SLAB_MATERIAL_ID]
