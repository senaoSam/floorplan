import { create } from 'zustand'

// Phase 49 — 自動擺位 ghost 預覽 store。
// AutoPlaceModal 把規劃結果（完整 AP 物件形狀、畫布 px 座標）放進來；
// ghostAPsLayer 畫半透明 marker、heatmapAdapter 把它們併入場計算（what-if 熱圖）。
// 套用或取消時 clear。
//
// removeApIds：fresh / fixed 模式套用時會被移除的現有同頻段 AP。
// 只在小卡寫「將移除 N 顆」看不出是誰 —— ghostAPsLayer 會在這些 AP 上
// 疊紅色叉叉標記，讓使用者在套用前就看得到哪幾顆要消失。
//
// enableApIds / enableBand（58-9）：原地保留、但 enableBand 射頻原本關閉的
// 現有 AP —— 套用時重新開啟該射頻。what-if 熱圖視為已開啟，ghostAPsLayer
// 在它們上面畫建議位置 marker。
// enableChannels（58-15）：{ apId: channel } —— 重新開啟的射頻由頻道規劃
// 重新指派的頻道（不沿用關閉時留下的舊頻道）；套用與 what-if 熱圖都要寫入。
export const useAutoPlaceStore = create((set) => ({
  floorId: null,
  previewAps: [],
  removeApIds: [],
  enableApIds: [],
  enableBand: null,
  enableChannels: {},

  setPreview: (floorId, aps, removeApIds = [], enableApIds = [], enableBand = null, enableChannels = {}) =>
    set({ floorId, previewAps: aps, removeApIds, enableApIds, enableBand, enableChannels }),
  clearPreview: () => set({ floorId: null, previewAps: [], removeApIds: [], enableApIds: [], enableBand: null, enableChannels: {} }),
}))
