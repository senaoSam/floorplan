import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import { useViewportStore } from '@/store/useViewportStore'

// Phase 49 — 自動擺位 ghost 預覽層。
// 把 useAutoPlaceStore 的 previewAps 畫成半透明「建議位置」marker：
// 頻段色淡填充圓 + 實線圈 + 中心點 + 名稱標籤。screen-constant 大小
// （1/viewport.scale），照 statsOverlayLayer 的 overlay 模板。
// 熱圖 what-if 由 heatmapAdapter 併入 previewAps 處理，這層只管 marker。
//
// 同時畫 removeApIds 的「即將移除」標記：fresh / fixed 模式套用時會刪掉
// 現有同頻段 AP，只在小卡寫「將移除 N 顆」看不出是誰 —— 在那些 AP 上疊
// 紅環 + 叉叉，套用前就看得見哪幾顆要消失。

const BAND_COLOR = { 2.4: 0xf39c12, 5: 0x4fc3f7, 6: 0xa855f7 }
const REMOVE_COLOR = 0xff4757   // 同 scopesLayer 的 out-scope 紅

const LABEL_STYLE = new TextStyle({
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  fontWeight: '700',
  fill: 0xffffff,
  stroke: { color: 0x0b1220, width: 3 },
})

export function attachGhostAPsLayer({ scene, useAutoPlaceStore, useFloorStore, useAPStore }) {
  const layer = scene.layers.overlays
  const root = new Container()
  root.eventMode = 'none'
  layer.addChild(root)
  const g = new Graphics()
  g.eventMode = 'none'
  root.addChild(g)
  const labelRoot = new Container()
  labelRoot.eventMode = 'none'
  root.addChild(labelRoot)

  // Text pool（同 statsOverlayLayer——每 frame 重建 Text 太貴）。
  const textPool = []
  const getText = (i) => {
    let t = textPool[i]
    if (!t) {
      t = new Text({ text: '', style: LABEL_STYLE })
      t.anchor.set(0.5, 0)
      t.eventMode = 'none'
      labelRoot.addChild(t)
      textPool[i] = t
    }
    return t
  }

  const redraw = () => {
    g.clear()
    const st = useAutoPlaceStore.getState()
    const activeFloorId = useFloorStore.getState().activeFloorId
    const onThisFloor = st.floorId === activeFloorId
    const show = onThisFloor && (st.previewAps.length > 0 || st.removeApIds.length > 0)
    if (!show) {
      for (const t of textPool) t.visible = false
      if (typeof scene.requestRender === 'function') scene.requestRender()
      return
    }
    const vpScale = useViewportStore.getState().scale || 1
    const s = 1 / vpScale

    // 先畫「即將移除」標記，讓新增 ghost 疊在上層（新的比較重要）。
    // 半徑略大於實體 AP body（apsLayer 的 AP_RADIUS = 10）好把它整個圈住。
    if (st.removeApIds.length > 0 && useAPStore) {
      const aps = useAPStore.getState().apsByFloor[activeFloorId] ?? []
      const removeSet = new Set(st.removeApIds)
      const RR = 13 * s
      const arm = 7 * s
      for (const ap of aps) {
        if (!removeSet.has(ap.id)) continue
        g.circle(ap.x, ap.y, RR).fill({ color: REMOVE_COLOR, alpha: 0.18 })
        g.circle(ap.x, ap.y, RR).stroke({ width: 3.5 * s, color: 0x0b1220, alpha: 0.55 })
        g.circle(ap.x, ap.y, RR).stroke({ width: 2 * s, color: REMOVE_COLOR, alpha: 0.95 })
        // 叉叉：與新增 ghost 的「+」成對比
        g.moveTo(ap.x - arm, ap.y - arm).lineTo(ap.x + arm, ap.y + arm)
          .stroke({ width: 2 * s, color: REMOVE_COLOR, alpha: 0.95 })
        g.moveTo(ap.x + arm, ap.y - arm).lineTo(ap.x - arm, ap.y + arm)
          .stroke({ width: 2 * s, color: REMOVE_COLOR, alpha: 0.95 })
      }
    }

    st.previewAps.forEach((ap, i) => {
      const color = BAND_COLOR[ap.frequency] ?? 0x4fc3f7
      const R = 14 * s
      // 淡填充（讀成「建議位置」而非實體 AP）+ 雙圈（深色外描邊撐對比）
      g.circle(ap.x, ap.y, R).fill({ color, alpha: 0.22 })
      g.circle(ap.x, ap.y, R).stroke({ width: 3.5 * s, color: 0x0b1220, alpha: 0.55 })
      g.circle(ap.x, ap.y, R).stroke({ width: 1.8 * s, color, alpha: 0.95 })
      g.circle(ap.x, ap.y, 2.5 * s).fill({ color, alpha: 1 })
      // 「+」記號：跟實體 AP marker 區隔（這是即將新增的）
      const arm = 6 * s
      g.moveTo(ap.x - arm, ap.y).lineTo(ap.x + arm, ap.y)
        .stroke({ width: 1.5 * s, color: 0xffffff, alpha: 0.9 })
      g.moveTo(ap.x, ap.y - arm).lineTo(ap.x, ap.y + arm)
        .stroke({ width: 1.5 * s, color: 0xffffff, alpha: 0.9 })

      const t = getText(i)
      t.visible = true
      t.text = ap.name ?? `AP+${i + 1}`
      t.position.set(ap.x, ap.y + R + 3 * s)
      t.scale.set(s)
    })
    for (let i = st.previewAps.length; i < textPool.length; i++) textPool[i].visible = false

    if (typeof scene.requestRender === 'function') scene.requestRender()
  }

  const unsubPreview = useAutoPlaceStore.subscribe(redraw)
  const unsubFloor = useFloorStore.subscribe(redraw)
  const unsubViewport = useViewportStore.subscribe(redraw)
  // 移除標記畫在現有 AP 的座標上 —— AP 被拖動 / 刪除時要跟著更新。
  const unsubAP = useAPStore ? useAPStore.subscribe(redraw) : null
  redraw()

  return () => {
    unsubPreview()
    unsubFloor()
    unsubViewport()
    unsubAP?.()
    textPool.length = 0
    layer.removeChild(root)
    root.destroy({ children: true })
  }
}
