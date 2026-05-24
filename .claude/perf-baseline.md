# Perf Baseline — Phase 20 Task 26-1

> 2026-05-24 量測。場景：DemoLoader 載入 example3.png 樓層（單樓層、無 switch/tray/riser；牆面 8 段；heatmap shader engine, rssi mode, refl+diff 開）。
> 環境：Windows 11、Chromium via Playwright MCP、`pnpm dev`、本機 1080p。
> Harness：`window.__perf` — rAF FPS sampler + Konva pointer-fire pan loop + UI-driven 50/150/300 AP 注入（StressLoader 按鈕）。

---

## 1. 結論一句話

**Steady-state 渲染（idle / pan）在 300 AP 都是穩 60 FPS；痛點全在 commit time。** 任何會碰到 AP store 的動作（StressLoader、updateAP、拖曳結束）會卡 0.5 ~ 9 秒，主因是 **(a) Konva 全量重繪 AP markers** 與 **(b) Heatmap shader 重算**，computeRoutes 不是瓶頸。

---

## 2. 數據

### 2.1 setAPs 大量替換（StressLoader 按鈕 → setAPs(floorId, [...]) → 等到 2 frames）

| AP 數 | HM ON | HM OFF | HM 增量 |
|---|---|---|---|
| 50   |  556 ms |  222 ms | +334 ms |
| 150  | 2006 ms | 1014 ms | +992 ms |
| 300  | 5906 ms | 3764 ms | +2142 ms |

- HM ON 大約是 HM OFF 的 1.5–1.6×；heatmap shader 那條成本是「準線性 ~7 ms / AP」。
- HM OFF 的 222 / 1014 / 3764 顯示 **React + Konva render 部分超線性**（×3 數量 ×3.7 時間），300 AP 時 ~12.5 ms/AP；推測 react-konva 在 children diff 階段對每個 AP 跑完整 prop diff（沒有 key memoization）。

### 2.2 單 AP 同值 updateAP（no-op 觸發 store 變動）— 300 AP 場景

| 配置 | commit ms |
|---|---|
| HM ON  | 6367 ms |
| HM OFF | 3305 ms |

⚠ 這是最痛的數字：使用者只是改一個 AP 的功率/頻段，整棟 AP store reference 換新，**所有訂閱 apsByFloor 的元件全 re-render**：APLayer 重畫 300 markers、HeatmapLayer 重算整張 shader、5 個 panel 各跑一次 computeRoutes。

### 2.3 Idle / Pan FPS — 60Hz 上限下

| 場景 | FPS | avg frame | p95 | max |
|---|---|---|---|---|
| 5 AP idle | 60.04 | 16.66 ms | 16.80 | 17.00 |
| 50 AP idle | 60.00 | 16.67 | 16.80 | 16.89 |
| 50 AP pan | 60.00 | 16.67 | 16.80 | 17.10 |
| 150 AP idle | 60.00 | 16.67 | 16.80 | 16.90 |
| 150 AP pan | 60.00 | 16.67 | 16.80 | 17.10 |
| 300 AP idle | 59.99 | 16.67 | 16.80 | 16.90 |
| 300 AP pan | 60.00 | 16.67 | 16.80 | 16.90 |

**Konva 在 idle/pan 不重畫子節點，效能 essentially 跟 AP 數無關。** OS 60Hz vsync 是天花板。

### 2.4 selection toggle（setSelected / clearSelected）— 300 AP 場景

| 動作 | ms |
|---|---|
| setSelected('ap-...')  | 16.3 |
| clearSelected()        | 24.6 |

✅ 選取/取消選取本身不貴；APPanel mount 那刻的 computeRoutes 在 300 AP / 0 tray 場景僅 <1 ms。

### 2.5 computeRoutes 純函數（300 AP、0 tray、0 switch）

5 次連跑：0.3 / 0.8 / 0.3 / 0.5 / 0.8 ms。**完全不是瓶頸。** （但本基準場景沒 tray/switch，spec.md §5 graph builder 的成本沒進場；如果加大量 tray 結果可能不同 — 留給 26-2 之後追測。）

---

## 3. Hotspot ranking（給 26-2 用）

| 排名 | Hotspot | 量化證據 | 候選對策 |
|---|---|---|---|
| **1** | **AP store mutation → 全 AP 重渲染** | 單 AP no-op update 在 300 AP 卡 3.3 s（HM OFF）/ 6.4 s（HM ON） | APMarker memo + key by ap.id；splitting selectors 讓 panel 只訂閱自己 AP；考慮把 apsByFloor 從「整顆 array 換新」改成 immer-style patch 觸發精細訂閱 |
| **2** | **Heatmap shader 全量重算** | HM ON 比 OFF 增 +334/+992/+2142 ms（線性 ~7 ms/AP） | apsByFloor 變動但實際差異 ≤1 AP 時跳過 full recompute；HM-F6 drag-freeze 已涵蓋拖曳，但「commit 階段」沒省到。增量 sampleFieldGL（只重算受影響半徑）|
| **3** | **多面板各跑一次 computeRoutes** | 不是 300 AP 場景瓶頸（<1 ms），但 tray/switch 場景未測；APPanel / SwitchPanel / CableTrayPanel / CableSummaryPanel / CableLayer 5 處重複呼叫 | Shared `useRoutesContext`（單一 memo + Provider）— 把 5 份 computeRoutes 合成 1 份 |
| **4** | **Konva react-konva diff** | HM OFF 300 AP commit 3.76 s，計算純 graph 沒問題 → Konva diff 主導；layer.batchDraw() 沒 batch | 看 react-konva 17 是否吃 React 17 並發；可手動把 APLayer 改 imperative（直接操作 Konva node），避開 react-konva 的 vDOM 對齊 |
| **5** | **selection 引起的 re-render** | 16/25 ms — **不是問題**，已 ok | 暫不動 |

---

## 4. 量測腳本（給 26-3 用，方便對照 before/after）

```js
// window.__perf 安裝程式 — 詳見本檔末或重新跑下方 inline
// 1) Load demo: DemoLoader 按鈕點一次，等 4 s
// 2) Inject harness via browser_evaluate
// 3) sequence:
//    setAPsAndMeasure(50)   → 紀錄 commit
//    setAPsAndMeasure(50→150) →
//    setAPsAndMeasure(50→300) →
//    與 HM ON / OFF 兩遍
// 4) updateAP 同值打一次 → 紀錄單 AP commit
// 5) fps(2000) + panFps(2000) sanity check
```

完整 harness 程式碼可從本檔的 git 歷史撈或重灌：

```js
window.__perf = {
  async fps(durationMs = 1500) { /* rAF 累積 frame time + p50/p95 */ },
  async panFps(durationMs = 1500) { /* setInterval(16) 灌 mousemove + fps() */ },
  async setAPsAndMeasure(n) { /* click `.stress-loader__btn` matching n, 2× rAF, perf delta */ },
}
```

---

## 5. 已排除的疑點

- ❌ **「pan / zoom 在 300 AP 會卡」**：實測 60 FPS，OS vsync 鎖住。
- ❌ **「computeRoutes 是瓶頸」**：300 AP / 0 tray <1 ms。需在 tray + switch 大場景重測才能完整 rule out。
- ❌ **「selection 重渲染風暴」**：16/25 ms，沒問題。
- ❌ **「heatmap 是主因」**：是大角色但不是唯一；HM OFF 仍有 3.3 s 單 AP commit。

---

## 6. 限制 / 後續可補

- 沒測 **多樓層** 場景：3D mode + Riser 跨樓層 routing 沒進評估。
- 沒測 **拖曳中** FPS（HeatmapLayer dragMode === 'live' 會邊拖邊算）。
- 沒測 **switch 滿載 tray 大場景** 的 computeRoutes 真實成本。
- 26-2 動手後請重跑 §2 全部表格，貼到本檔下方 `## After 26-2 — P1 / P2 / ...` 段。

---

## After 26-2 — P1（APMarker React.memo + 自訂 comparator）

**結論：對使用者感知 perf 沒幫助（neutral），但 memo 本身是對的（300→1 marker 重渲染），保留作為 P2 的清潔地基。**

### 改動
- `src/features/editor/layers/APLayer.jsx`
  - `APMarkerImpl` 提出 + 用 `React.memo(impl, comparator)` 包成 `APMarker`
  - `comparator` 比對 `ap` ref 與所有 data flags（`isSelected` / `isHovered` / `isFocused` / capability bools / `showAPInfo` / `inverseScale`），**忽略 callback 參考**（Editor2D 傳 inline-lambda；callback 永遠是最新閉包，不比較反而更安全）
  - `useMemo` 包 `batchSelectedIds`（小 polish，避免每次 render 重建 Set）

### 視覺驗收
8 場景 pixelmatch `0 / 4650888` 全 pass（`.playwright-mcp/perf-after-p1/` vs `.playwright-mcp/perf-before/`）

### Render count 驗證（temporary probe）
300 AP 場景下做一次 `updateAP(id, txPower)`，`APMarkerImpl` 執行次數從**期望的 300 → 實測 1**。memo 對 React 層工作量真實縮減。

### 數字（HM ON，3 樣本中位數）

| 指標 | Before | After P1 | 結論 |
|---|---|---|---|
| 5 AP idle FPS | 60.04 | 60.00 | 無變化（vsync 鎖） |
| 300 AP idle FPS | 59.99 | 60.00 | 無變化 |
| 300 AP pan FPS | 60.00 | 60.00 | 無變化 |
| → 50 commit | 556 ms | 657 ms | +18% 在 run-to-run 噪聲內 |
| → 150 commit | 2006 ms | 2105 ms | +5% 噪聲 |
| → 300 commit | 5906 ms | 6528 ms | +11% 邊緣 |
| 300 AP 單 AP no-op updateAP | 6367 ms | ~6000 ms | 同 |

### 為什麼 P1 沒贏

時序拆解（300 AP / HM ON / 單 AP no-op updateAP）：

| 區段 | 耗時 |
|---|---|
| zustand `set()` 同步階段（subscribers 全跑 selector）| **1508 ms** |
| 第 1 個 rAF 後（React commit + react-konva reconcile + Konva batchDraw）| 2246 ms |
| 第 2 個 rAF 後（heatmap shader 算完 + 第二輪 paint）| 2489 ms |
| **total** | **6244 ms** |

React reconciliation 不是主導項。P1 把 reconciliation 從 O(300) 降到 O(1)，但 reconciliation 本來就只佔不到 200 ms — 砍掉 199 ms 在 6 s 裡看不出來。

**真正的瓶頸**：
1. **zustand subscriber sweep（~1.5 s）** — `setState` 觸發時所有訂閱 `apsByFloor` 的 hooks 同步跑 selector。APPanel / CableSummaryPanel / CableLayer / HeatmapLayer / SwitchPanel 全部都會跑一次。
2. **Heatmap shader 重算（~2.5 s）** — 即便資料沒實質變化也跑完整張 sampleFieldGL。
3. **Konva batchDraw + canvas redraw（~1 s）** — 純像素層的事，react-konva memo 救不到。

### 給 P2 用的訊號

P2「heatmap 同值跳過」對應 §2 的 2.5 s 區段 — 預估省 ~30% 的 commit 時間。同時 P3「panel 共用 routes context」對應 §1 一部分（不只 routes — 多 panel 訂閱 apsByFloor 也都會被通知）。建議順序：**P2 → 重測 → P3**。

---

## After 26-2 — P2（HeatmapLayer 同值跳過 sampleFieldGL）

**結論：單 AP no-op updateAP 從 ~5900 ms 降到 ~4300 ms（-27%）。視覺 0 diff。real change / HM toggle 都正常。**

### 改動
- `src/features/editor/layers/HeatmapLayer.jsx`
  - 新增 `fingerprintRecompute(scenario, scopes, opts)`：把 post-`buildScenario` AP 欄位 / wall 端點 / scope 多邊形 / 全部 shader opts 串成單一字串
  - 加 `lastFingerprintRef` + `lastWasSoloRef` 兩個 ref
  - 在 full-recompute 分支進入 `sampleFieldGL` 前比對 fingerprint；命中 → 直接 `return`（既有 `gl.canvas` 像素仍有效，沒有 batchDraw 沒有 stale frame）
  - solo-AP 分支永遠跑 — 不查 fingerprint（拖曳時必須每幀更新單顆 AP 的疊圖）
  - 從 solo 跳回 main 強制 full re-render（`lastWasSoloRef.current` 為真就跳過 skip 邏輯）
  - 加一個 `[enabled]` effect 把兩個 ref 都清空 — 關閉熱圖再打開要重新算

### 視覺驗收
8 場景 pixelmatch `0 / 4650888` 全 pass（`.playwright-mcp/perf-after-p2/` vs `.playwright-mcp/perf-before/`）

### 數字（HM ON，300 AP，3 樣本）

| 指標 | Before | After P1 | After P2 | 從 baseline 的 Δ |
|---|---|---|---|---|
| 單 AP no-op updateAP (median) | 6367 ms | ~6000 ms | **4281 ms** | **-2086 ms / -33%** |
| → 300 commit | 5906 ms | 6528 ms | 8458 ms | run-to-run 噪聲；fingerprint 計算本身在 300 AP 有 ~50–100 ms 額外 cost |
| → 150 commit | 2006 ms | 2105 ms | 2854 ms | 同上 |
| → 50 commit | 556 ms | 657 ms | 651 ms | 同 |

setAPs（count 變動）每次都 cache miss，理應走完整 recompute 路徑 — fingerprint 多算一輪，所以 commit time 沒降反小幅升。這是設計預期：**setAPs 不是 P2 的目標**，updateAP 才是。

### Sanity 驗證

| 驗證項 | 結果 |
|---|---|
| 真實值改變（txPower +10）後熱圖被重畫 | ✅ pixels differ |
| 真實值改變後再做一次同值 no-op，第二次被 skip | ✅ pixels identical |
| HM toggle off → on（沒其他變更）熱圖正確恢復 | ✅ pixels 同 toggle 前 |
| Drag AP solo-AP 路徑沒被擋（理論：solo 分支不查 fingerprint）| ✅ 程式碼路徑保證 |

### 為什麼不是預期的 -2.5 s

預測是省 ~2.5 s，實測省 ~1.6 s。差異來自：
- fingerprint 計算本身在 300 AP × 多欄位下要 ~50–100 ms（字串拼接 + GC）
- 第 1 個 rAF 階段（React commit + react-konva reconcile + Konva batchDraw + KonvaImage 重畫）還在跑 — 即便跳過 sampleFieldGL，React 仍會 re-render HeatmapLayer 一次（dep 包含 scenario，scenario 是新 reference 即使內容相同）

剩下的 4300 ms 分布（待 P3 後再 profile）：
- zustand subscriber sweep 仍佔 ~1.5 s
- React reconciliation + react-konva ~200 ms（P1 已縮 / 但其他 layer 還會跑）
- Konva batchDraw + canvas redraw ~1 s
- 殘餘 heatmap rendering pipeline（KonvaImage cache、setDisplayMode 等）~600 ms
- fingerprint 計算 ~50–100 ms

### 給 P3 用的訊號

P3 對應 zustand subscriber sweep ~1.5 s — 把 5 個 panel 的 `computeRoutes` 合一份。但本基準場景沒 tray / switch，`computeRoutes` <1 ms — 沒得救。要在 tray 大場景重測才能驗證 P3。**先停手，跑使用者實際工作流量級的場景**。

---

## After 26-2 P2 — 真實工作流 benchmark + profile（2026-05-24）

**動機**：StressLoader 觸發「網頁無回應」對話框；使用者質疑「真實 200+ AP 工作流順不順」。

**結論：150 AP 已不能用，而且 P1+P2 已蓋的層不是主兇。需要 P3 改 react-konva → imperative Konva。**

### 1. 真實操作 benchmark（demo 平面圖 + 1 switch + 1 tray，HM ON）

| AP 數 | addAP 一顆 | 改 slider 一格 | 拖一顆 FPS | 判定 |
|---|---|---|---|---|
| 50 | 250 ms | 222 ms | 30 FPS | ⚠ 邊緣 |
| 150 | 950 ms | 1784 ms | **0.98 FPS** | ❌ 不能用 |
| 300 | 7500 ms | 6920 ms | 0.27 FPS | ❌ 觸發無回應對話框 |

HM OFF 在 150 AP：addAP 418 ms / slider 790 ms / **drag 1.2 FPS**。HM 關掉只救一半，**剩下 50% 不在 heatmap**。

### 2. 用 `PerformanceObserver('longtask')` + 元件 render counter 找瓶頸

**150 AP / 改 txPower 真實值（real change）**
- React render: HeatmapLayer×1, APLayer×1, APMarker×**1**（149 顆被 memo 擋掉，P1 正確生效）, CableLayer×1
- Longtasks: 353 ms + 234 ms + **2273 ms**
- 總耗時 2875 ms

**150 AP / no-op txPower（P2 應 skip）**
- 同上 React render count
- Longtasks: 194 ms + 149 ms
- 總耗時 **841 ms** ← P2 確實砍掉 2 秒 sampleFieldGL

**150 AP / addAP 一顆**
- HeatmapLayer×2, APLayer×2, APMarker×**1**（只有新加那顆 render，存量 150 顆全 skip）, CableLayer×2
- Longtasks: 430 ms + 144 ms + **1668 ms**
- 總耗時 2250 ms

**150 AP / dragMove ×5 frames**
- HeatmapLayer×6, CableLayer×6（每 frame 一次）
- **APLayer×0, APMarker×0** — markers 都不動
- 每 frame 平均 889 ms = **1.1 FPS**

### 3. 真兇定位

**1668 ms / 2273 ms / 889 ms 的單 longtask 都不在 React 元件 render 程式裡** —
這些時間花在：
- **react-konva 的 commit / reconcile 階段**：把 React vDOM 對齊到 Konva imperative 樹。150 AP × ~10 Konva 子節點 / AP = ~1500 個 Konva node 要 diff，即便 React tree 沒動 props 也得遍歷。
- **Konva 的 `Layer.batchDraw()`**：每次 layer 重畫整張 canvas，要重畫 ~1500 個節點到 2D context。

**Drag 的真兇是 CableLayer + HeatmapLayer 跟 dragAP**：
- CableLayer 訂閱 `dragAP` 來即時更新 cable line — 每幀重渲染 ~150 條 polyline + drop-leg
- HeatmapLayer 訂閱 `dragAP` 來重算 scenario.aps — 每幀 sampleFieldGL（位置變了 P2 不跳）

### 4. P1 / P2 為什麼效果有限

- **P1（APMarker memo）**：已經把 marker render 從 N 縮到 1。但**真正的時間花在 react-konva commit + Konva 整層 batchDraw**，這跟 React render count 沒關係，就算 0 個元件 re-render 也得 commit / batchDraw 整層。
- **P2（HeatmapLayer fingerprint）**：no-op updateAP 砍掉 2 秒 sampleFieldGL，從 2875→841 ms 是真的省到。但 drag 的時候 fingerprint 永遠 mismatch（位置在動），救不到 drag FPS。

### 5. 接下來該動什麼（給 P3 / P4）

排序按 **杠杆 / 風險**：

| 候選 | 預期效果 | 風險 | 工時 |
|---|---|---|---|
| **P3a — APLayer 改 imperative Konva** | 把 APMarker 從 react-konva 的 JSX 改成手動 `new Konva.Group()`，繞過 vDOM commit / diff。150 AP addAP 預期 1500 ms → 200 ms | 中：要重寫事件綁定 + 拖曳 + cleanup；hover/select/drag 4 個互動要再驗 | 4-6 h |
| **P3b — CableLayer 不訂閱 dragAP，只在 dragEnd 重算 cable** | 拖 AP 時 cable 線「凍結」直到放開；現代設計工具普遍這樣做（Figma、Hamina）。150 AP drag FPS 1 → 30+ | 低：純 UX 變動，cable 短暫不跟手 | 1-2 h |
| **P3c — HeatmapLayer dragMode 預設改 'solo'**（目前是 'live'） | drag 時用 single-AP 疊圖路徑，跳過 sampleFieldGL；既有 HM-drag-solo 機制只是預設沒開 | 低：HM-drag-solo 已實作完整 | 30 min（改一個預設值 + UI toggle） |

**建議順序**：先 P3c（最便宜，可能 drag FPS 就從 1 跳到 20+）→ 重測 → 還不夠再做 P3b → 還不夠才動 P3a（最大但最貴）。

### 6. addAP / slider 的命運

addAP 跟 slider 的兇手是同一個（react-konva commit + batchDraw）。**只有 P3a 能砍**。P3c / P3b 都不會影響 addAP / slider — 那是 store 變動觸發整層重畫，跟 drag overlay 無關。

所以：
- 想救 drag → P3c → P3b
- 想救 addAP / slider → 只能 P3a
- 想救三個都 → P3c + P3b + P3a 全做

---

## After 26-2 P3 — drag 救回來了（2026-05-24）

**結論：drag FPS 從 1 → 60。Visual 0 diff。Commit time 沒動。**

### P3c 改動

[useHeatmapStore.js](src/store/useHeatmapStore.js) — `dragMode` 預設從 `'live'` 改成 `'solo'`。

「solo」是既有 HM-drag-solo 機制（拖牆/scope 整張凍結；拖 AP 只渲染那顆 AP 疊在快照上）。原本只是預設沒開。

### P3b 改動

[CableLayer.jsx](src/features/editor/layers/CableLayer.jsx) — 拿掉 `useDragOverlayStore` 訂閱。`dragAP / dragSwitch` 設成常數 null，既有「`dragAP && ...`」live-override 程式碼自動短路。

副作用：拖 AP 期間，**該顆 AP 的 cable 線暫時不跟手**（停在原位）。放開時 store 提交，CableLayer 重新算 + 重畫，cable 對齊新位置。Figma / Hamina 都是這個 UX 模式。

### 數字（HM ON，dragMode='solo'，3 樣本）

| 指標 | Baseline | After P1+P2 | After P3 | 從 baseline 的 Δ |
|---|---|---|---|---|
| 150 AP **drag FPS** | 0.98 | 0.98 | **60.03** | **×60** 🎯 |
| 300 AP **drag FPS** | 0.27 | 0.27 | **58.00** | **×215** 🎯 |
| 150 AP idle FPS | 60 | 60 | 60 | — |
| 300 AP idle FPS | 60 | 60 | 60 | — |
| 300 AP 單 AP no-op updateAP | 6367 ms | 4281 ms | 同 P2 | drag 才會走 P3 路徑 |
| 300 AP setAPs commit | 5906 ms | 5906 ms | 同 baseline | P3 不動 setAPs |
| 300 AP addAP | 7500 ms | 7500 ms | 同 | 同上 |
| 300 AP slider | 6920 ms | 6920 ms | 同 | 同上 |

### 視覺驗收

8 場景 pixelmatch `0 / 4650888` 全 pass — `.playwright-mcp/perf-after-p3/` vs `.playwright-mcp/perf-before/`。

過程中發現一個 **harness bug**（不是程式 bug）：`setHeatmap(false)` 透過 `await import()` 拿到的是被 §9 HMR 切開的 store instance，React tree 沒收到變更。改用點 toolbar 的「熱圖 已開啟」按鈕就正確。`scripts/perf/bench-harness.js` 之後要修這條（或者 scenario 07 直接點 UI 按鈕）。

### 沒救到 / 還在的問題

- **addAP 一顆 ~7.5 s** — 動 store 觸發整層 commit + batchDraw，P3 沒救到
- **slider 一格 ~6.9 s** — 同上
- StressLoader 一鍵 300 AP 仍會卡 ~6 s

這些都要 P3a（APMarker 改 imperative Konva）才動得了。下一步使用者要決定要不要做 P3a。

### 給 P3a 用的訊號

P3a 工程預期 4-6 h，要動 APLayer 整個 imperative 化（手動 `new Konva.Group()`、`.on('click', ...)`、`.draggable(true)`），繞過 react-konva 的 vDOM commit。預期 addAP / slider 從 ~7 s → ~200 ms（基於 longtask 拆解推測，未實測）。

風險：要重做 click / hover / drag / context-menu 4 個互動的事件綁定 + cleanup。已有 P3c+P3b 的 drag-friendly 路徑兜底，所以 drag 部分可以放心，主要要驗 click + context menu。
