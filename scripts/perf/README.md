# Phase 20 — perf screenshot baseline tooling

兩個檔案，搭配 Playwright MCP 操作流程：

| 檔 | 用途 |
|---|---|
| `bench-harness.js` | 注入瀏覽器的腳本（透過 `browser_evaluate` 載入）。安裝 `window.__bench`，內含 8 個截圖場景。 |
| `diff.mjs` | Node 比對腳本（pixelmatch + pngjs）。對兩個資料夾跑 per-scenario pixel diff，輸出 table。 |

## 截圖場景

| key | 內容 |
|---|---|
| 01-blank | 開頁面、demo 沒載 |
| 02-demo-5ap | Demo 載完、無選取 |
| 03-demo-5ap-selected | Demo 5 AP、選第一顆 |
| 04-stress-50ap | StressLoader 50 AP |
| 05-stress-150ap | StressLoader 150 AP |
| 06-stress-300ap | StressLoader 300 AP |
| 07-stress-300ap-hm-off | 300 AP、HM 關（驗 P2 不會壞 HM-off 路徑）|
| 08-stress-300ap-selected | 300 AP、選第一顆 AP |

## 工作流

### 1. 建 before baseline（優化前）

```
1. 啟 dev server (pnpm dev) → http://localhost:5173/floorplan/
2. MCP 操作：
   a. browser_navigate → /floorplan/
   b. browser_evaluate → 把 bench-harness.js 的內容貼進去
   c. 對每個 scenario：
      - browser_evaluate → const r = await window.__bench.run('XX'); return r.dataUrl
      - 把 base64 寫成 PNG 存到 .playwright-mcp/perf-before/XX.png
3. 完成後 8 張 PNG 應該都在 .playwright-mcp/perf-before/
```

### 2. 動優化（P1 / P2 / P3）

### 3. 跑 after 截圖

跟 step 1 一樣，但存到 `.playwright-mcp/perf-after-p1/` 等。

### 4. 比對

```
node scripts/perf/diff.mjs .playwright-mcp/perf-before .playwright-mcp/perf-after-p1 \
  --out .playwright-mcp/perf-diff-p1
```

### 5. 驗收

- AP marker / wall / cable / overlay 場景：**diff = 0**
- Heatmap 場景：≤ 0.1% 容忍（GL 浮點）；超過要 audit 是否 shader code path 漂了
- 任何 SIZE-MISMATCH 都要 fix（通常是 DPR 或 viewport reset 沒乾淨）

## 已知限制

### 選取場景（03 / 08）目前無效

`selectFirstAp()` / `clearSelection()` 走 `await import('/floorplan/src/store/useEditorStore.js')` 拿 store handle 改 selectedId — 實測 store handle 是**新 module instance**（不同於 React 樹用的那一份），所以 selectedId 改了沒進 React 渲染。結果：

- `02-demo-5ap` 與 `03-demo-5ap-selected` 在 PNG byte level 完全一樣
- `06-stress-300ap` 與 `08-stress-300ap-selected` 也是

**對 perf 優化驗收影響：無**。改 P1/P2/P3 不會動到「沒選取」的視覺；before/after 的 03/08 都會是 no-op 同一張圖。可以放心比對。

**真要修**：把 selection 改用 Konva 的 `_fire('click', ...)` 觸發 Editor2D 的 onClick 鏈（會走 React tree 用的 store instance）。等需要驗 selection-only 優化（例如 17-2 focus halo）時再補。

## 故障排除

- `no stage`：頁面還沒載完。`browser_evaluate` 前先 `await new Promise(r => setTimeout(r, 1000))`。
- 兩次 baseline 自己跟自己對也有 diff：通常是 heatmap 還沒穩定。`bench-harness.waitForStable()` 已經內建。
- StressLoader 按鈕點不到：sidebar 收起時 class 不同。Harness 抓 `.stress-loader__btn`，兩種狀態都有。
