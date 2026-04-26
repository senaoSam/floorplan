// 牆體材質與衰減係數
//   dbLoss — 2.4 GHz 標稱單次穿透衰減（dB）。HM-F8 之後改為頻率函數的 anchor：
//            wallLossDb(f_GHz) = dbLoss * (f_GHz / 2.4) ** lossB
//            這樣 2.4 GHz 場景數值不變，5/6 GHz 隨 ITU-R P.2040-3 frequency 指數放大。
//   lossB  — 頻率指數，取自 ITU-R P.2040-3 表 3 的 attenuation coefficient b 欄位。
//            metal 維持寬頻高損失（lossB ≈ 0），其餘材質 b∈[0.27, 1.99]。
//   itu    — ITU-R P.2040-3 Table 3 介電/導電率係數，供反射時推 Fresnel 複數係數
//            eta' = a * f_GHz^b        (相對介電常數實部)
//            sigma = c * f_GHz^d (S/m) (導電率)
//            metal: true 視為完美導體 (Gamma -> -1)
export const MATERIALS = {
  GLASS: {
    id: 'glass',
    label: '玻璃',
    dbLoss: 2,
    lossB: 0.27,
    color: '#48c9b0',   // 青綠
    itu: { a: 6.31, b: 0, c: 0.0036, d: 1.3394 },
  },
  DRYWALL: {
    id: 'drywall',
    label: '輕隔間 (石膏板)',
    dbLoss: 3,
    lossB: 1.62,
    color: '#f39c12',   // 琥珀橘
    itu: { a: 2.73, b: 0, c: 0.0085, d: 0.9395 },
  },
  WOOD: {
    id: 'wood',
    label: '木板',
    dbLoss: 4,
    lossB: 1.04,
    color: '#a04000',   // 深棕
    itu: { a: 1.99, b: 0, c: 0.0047, d: 1.0718 },
  },
  BRICK: {
    id: 'brick',
    label: '磚牆',
    dbLoss: 8,
    lossB: 1.21,
    color: '#cb4335',   // 磚紅
    itu: { a: 3.91, b: 0, c: 0.0238, d: 0.16 },
  },
  CONCRETE: {
    id: 'concrete',
    label: '混凝土',
    dbLoss: 12,
    lossB: 1.99,
    color: '#2e86c1',   // 藍灰
    itu: { a: 5.24, b: 0, c: 0.0462, d: 0.7822 },
  },
  METAL: {
    id: 'metal',
    label: '金屬',
    dbLoss: 20,
    lossB: 0,
    color: '#6c3483',   // 深紫
    itu: { metal: true },
  },
}

// HM-F8: per-AP centre frequency → per-material wall-loss dB.
// Anchored at 2.4 GHz so legacy scenes don't shift; scales with ITU-R P.2040-3
// frequency exponent for 5/6 GHz physical realism (+2-3 dB typical).
const FREQ_ANCHOR_GHZ = 2.4
export function wallLossDb(material, fGhz) {
  if (!material) return 8
  const base = material.dbLoss ?? 8
  const b = material.lossB ?? 0
  if (b === 0 || !fGhz || fGhz <= 0) return base
  return base * Math.pow(fGhz / FREQ_ANCHOR_GHZ, b)
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
