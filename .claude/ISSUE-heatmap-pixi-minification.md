# ISSUE — Heatmap PIXI 縮小顯示失真（mipmap 缺失）

> 狀態：**待修**。修完並 MCP 驗證對齊 oldSrc 後，**刪除本檔**。
> 開立：2026-05-29

---

## 症狀

new（PIXI）與 oldSrc（Konva）並排比較熱圖時，**邊緣房間的紅色區塊形狀明顯不同**，
最明顯在 AP-01（左下角房間）、AP-05（右下角房間）：

- oldSrc：紅色區塊飽滿、連續、貼合房間
- new：紅色區塊上方出現凹陷/破碎，範圍看起來縮水

肉眼看是「房間級」差異，不是小鋸齒。

---

## 根因（已用 Playwright MCP 並排兩個 server 徹底驗證）

**不是熱圖計算差異。整條鏈一路 bit-identical：**

| 驗證層 | 結果 |
|---|---|
| 計算程式碼（propagation / propagationGL / sampleField / sampleFieldGL / heatmapGL / buildScenario / modes / materials 數值 / antennaPatterns / rfConstants / frequency） | ✅ 逐字 identical |
| runtime 輸入（floorScale 22.833、5 AP 頻道 36/44/36/40/44、45 面 concrete 牆、gridStep 0.5 / blur 8 / reflections / diffraction / contours） | ✅ identical |
| JS 引擎輸出 RSSI 場（min −105.19 / max −24.55 / mean −52.80 + 6 固定格探針） | ✅ identical |
| Shader 引擎輸出（畫面實際走的路徑）+ padding 12/12/12/12 + size 30×22.38 | ✅ identical |
| **`gl.render` 後的 canvas 像素**（1233×1059，整張 RGBA checksum `258189650`，AP-01 房間垂直線逐像素 RGB） | ✅ **byte-identical** |

→ 連畫出來的那張 heatmap canvas 都 byte-identical。

**差異 100% 在最後一步：把這張 identical canvas 貼到螢幕。**

- new 用 **PIXI.Sprite**（WebGL texture，預設 linear、**沒開 mipmap**）
- oldSrc 用 **Konva.Image**（瀏覽器原生 `drawImage` 縮放）

heatmap canvas 是 1233px 寬，顯示時是**縮小**的（floor 685px + viewport）。
PIXI 沒 mipmap 的 linear minification 在縮小高解析貼圖時會**欠採樣 / aliasing**，
把粗網格（0.5m grid）的紅色區塊邊界取樣到破碎。粗網格 + 大倍率縮小把它放大成房間級視覺差。

heatmapGL 內部已用 Catmull-Rom bicubic 把粗網格平滑成 C1 連續場 —— 那張 canvas 是「對的」，
是 PIXI 顯示它的方式把它弄糊/弄破。**oldSrc（Konva）顯示反而更忠實於底層 canvas。**

---

## 修法

[heatmapAdapter.js](../src/render/heatmapAdapter.js) 給 heatmap 的 texture source 開
**mipmap + linear-mipmap minification**（PIXI v8 `autoGenerateMipmaps` / `scaleMode`），
讓縮小顯示時做正確降採樣。純顯示修正，不動任何物理 / 計算。

## 驗收

修完用 MCP 並排截 AP-01 房間，紅色區塊形狀需對齊 oldSrc。對齊後刪本檔。
（兩個 server：`pnpm dev` 5173 `/floorplan/`、`pnpm dev:oldsrc` 5180 `/floorplan-old/oldsrc.html`；
或單 server 整合後直接 `/floorplan/oldsrc.html`。）
