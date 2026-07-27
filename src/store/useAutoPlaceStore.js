import { create } from 'zustand'

// Phase 49 — 自動擺位 ghost 預覽 store。
// AutoPlaceModal 把規劃結果（完整 AP 物件形狀、畫布 px 座標）放進來；
// ghostAPsLayer 畫半透明 marker、heatmapAdapter 把它們併入場計算（what-if 熱圖）。
// 套用或取消時 clear。
//
// removeApIds：fresh / fixed 模式套用時會被移除的現有同頻段 AP。
// 只在小卡寫「將移除 N 顆」看不出是誰 —— ghostAPsLayer 會在這些 AP 上
// 疊紅色叉叉標記，讓使用者在套用前就看得到哪幾顆要消失。
export const useAutoPlaceStore = create((set) => ({
  floorId: null,
  previewAps: [],
  removeApIds: [],

  setPreview: (floorId, aps, removeApIds = []) =>
    set({ floorId, previewAps: aps, removeApIds }),
  clearPreview: () => set({ floorId: null, previewAps: [], removeApIds: [] }),
}))
