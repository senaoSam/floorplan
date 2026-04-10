// 牆體材質與衰減係數 (dB)
export const MATERIALS = {
  CONCRETE: {
    id: 'concrete',
    label: '混凝土',
    dbLoss: 12,
    color: '#7f8c8d',
  },
  BRICK: {
    id: 'brick',
    label: '磚牆',
    dbLoss: 8,
    color: '#c0392b',
  },
  DRYWALL: {
    id: 'drywall',
    label: '輕隔間 (石膏板)',
    dbLoss: 3,
    color: '#ecf0f1',
  },
  GLASS: {
    id: 'glass',
    label: '玻璃',
    dbLoss: 2,
    color: '#74b9ff',
  },
  WOOD: {
    id: 'wood',
    label: '木板',
    dbLoss: 4,
    color: '#e17055',
  },
  METAL: {
    id: 'metal',
    label: '金屬',
    dbLoss: 20,
    color: '#636e72',
  },
}

export const MATERIAL_LIST = Object.values(MATERIALS)
