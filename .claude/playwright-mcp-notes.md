# Playwright MCP — 操作本專案的注意事項

> 寫給未來的自己。這些是 2026-04 驗證 PHY-2 時踩過的坑與 workaround。
> 本專案是 React 17 + Konva 8 + Zustand + WebGL2，有幾個 Playwright 特有的陷阱。

## 1. Dev Server 必須先確認

驗證前先跑：

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/floorplan/
```

- 回 200 → 已在跑（使用者通常留著）
- 其他 → 啟動前先 `eval "$(fnm env)" && fnm use`（shell 預設 Node 不對）
- 不要用 `pnpm build` 驗證（CLAUDE.md 禁止）

## 2. Base Path 是 `/floorplan/` 不是 `/`

`vite.config.js` 設 `base='/floorplan/'`。導覽一律用：

```
http://localhost:5173/floorplan/
```

漏掉會拿到 404 或空白頁。

## 3. Konva Stage 不吃原生 DOM MouseEvent

**踩過的坑**：用 `canvas.dispatchEvent(new MouseEvent('click', ...))` 完全沒反應。
Konva 有自己的事件系統（`_pointerPositions` / `setPointersPositions`）。

**正確做法**：

```js
const stage = Konva.stages[0]  // Konva 會自動把 stages 掛到全域
const rect  = stage.content.getBoundingClientRect()

// 單點點擊
stage.setPointersPositions({
  clientX: rect.left + x,
  clientY: rect.top  + y,
})
stage._fire('click', {
  type: 'click',
  target: stage,
  evt: {
    button: 0,           // ⚠ 必須：Editor2D 的 handler 會讀 evt.button
    clientX: rect.left + x,
    clientY: rect.top  + y,
    shiftKey: false, ctrlKey: false, metaKey: false,
  },
})
```

`button` 少帶會噴 `Cannot read properties of undefined (reading 'button')`。

## 4. 座標是 Stage-Local（不是 page client）

`setPointersPositions` 要傳 **clientX/Y**（page 座標），但 Konva Stage 本身處理成「stage container 內的座標」。算法：

```js
const rect = stage.content.getBoundingClientRect()
const clientX = rect.left + stageX  // stageX 是你要的「stage 內」座標
```

別把 toolbar/sidebar 的 offset 混進去。

## 5. Zustand Store 共享 ✅（一個關鍵好消息）

一開始以為 `await import('/floorplan/src/store/useAPStore.js')` 會拿到**新 module instance**（因為絕對路徑 vs 別名），導致改了 store 不影響 React。

**實測結論**：Vite dev server 對同一 URL 的 ESM module 會共享 instance。直接：

```js
const { useAPStore } = await import('/floorplan/src/store/useAPStore.js')
useAPStore.getState().updateAP(floorId, apId, { frequency: 6 })
```

React 會正常 re-render、熱圖會重算。**這是最可靠的場景注入方法**（比模擬滑鼠點擊穩）。

坑在哪：剛載入頁面時 `activeFloorId` 可能是 `null`（demo 還沒載完），別立刻讀。先 click demo 按鈕或 wait，再讀 store。

## 6. 放 AP / 畫牆 的正確順序

若要用 UI 流程（非 store 注入）：

1. Toolbar 點對應模式（📡 AP / ▬ 畫牆）—— **用 `browser_click` 配 ref，這個有效**
2. 透過 Konva `_fire('click', ...)` 在 canvas 落點
3. 畫牆需多次點擊 → 最後用 `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))` 或 `browser_press_key` 結束

`browser_press_key('Escape')` 有時沒聚焦 window 會失效，用 `window.dispatchEvent` 保險。

## 7. 驗證策略優先序

從穩到不穩：

1. **純 JS 單元驗證**：`browser_evaluate` 跑工具函式，對 console log 數字 — 最可靠
2. **Store 注入 + 截圖**：改 store → `browser_take_screenshot` 看視覺變化
3. **UI 模擬點擊**：Konva `_fire` — 最後才用，座標容易抓錯

本專案因為物理公式是重點，多半第 1/2 就夠。

## 8. 截圖比對三頻段差異的最省步驟

```js
// 1. 先確保 demo 載入 + 熱圖開啟（UI 點擊）
// 2. Store 注入兩顆 AP（或用 UI 點擊）
// 3. Store 注入一面牆
// 4. 迴圈改 AP 頻段 + 截圖
for (const f of [2.4, 5, 6]) {
  await page.evaluate(async (freq) => {
    const { useAPStore } = await import('/floorplan/src/store/useAPStore.js')
    const s = useAPStore.getState()
    const fid = Object.keys(s.apsByFloor)[0]
    for (const ap of s.apsByFloor[fid]) {
      s.updateAP(fid, ap.id, { frequency: freq, channel: freq === 2.4 ? 1 : freq === 5 ? 36 : 1 })
    }
  }, f)
  await page.screenshot({ path: `phy-check-${f}g.png` })
}
```

## 9. HMR 副作用

跑 evaluate 時如果 source 有改，Vite 可能 HMR 重載元件 → stage 可能換實例。重跑 `Konva.stages[0]` 取最新。

## 10. Screenshot 路徑

`browser_take_screenshot` 的 `filename` 會存到 `.playwright-mcp/` 底下（相對 repo root）。不需額外處理，直接給檔名即可。

---

## 常見錯誤快查

| 錯誤 | 原因 | 解法 |
|---|---|---|
| Click 沒反應 | 原生 DOM MouseEvent | 用 Konva `_fire` |
| `Cannot read 'button'` | `_fire` 沒傳 `evt.button` | 補 `evt: { button: 0 }` |
| `activeFloorId` null | demo 還沒載 | 先 click demo 按鈕 |
| 404 | 漏 `/floorplan/` base | 補上 |
| store 改了沒效果 | （實測不會發生） | 直接 import 就對 |
