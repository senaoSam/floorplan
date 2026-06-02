# Perf Baseline

> ⚠️ **架構脈絡（2026-06-02 補）**：本檔 §1 ~「After 26-2 P3a」段是 **Phase 20 / Konva 時代**的量測
> （react-konva `src/features/editor/layers/APLayer.jsx`，**該檔已於 Phase 25 全面汰換、不存在**）。
> 這些 before/after 數據保留作歷史紀錄與決策脈絡，**不是當前架構的基準**。
> **當前架構（Phase 25 PixiJS hybrid）的效能基準看 §31-12（1000 AP 壓測）與 §32-C/§32-E（cable 增量 + vector 渲染）。**
> 26-3 原列「補記 Phase 20 bench」——數據其實當時已完整記在下方各 After 段，本次僅補這段脈絡警示即收尾。

---

## Phase 20 Task 26-1（Konva 時代，歷史紀錄）

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

---

## After 26-2 P3a — APLayer imperative Konva（2026-05-24）

**結論：click commit time 5800 ms → 563 ms（×10）。addAP / slider 沒救 — 真兇是 HM shader + Konva canvas paint，不是 react-konva。所有互動 100% 行為一致。**

### 觸發 P3a 的證據

使用者真實測試感受「150 AP 卡 + hover 過一下才有反應」，給的 DevTools trace 顯示：
- 一個 **5845 ms 的 `FireAnimationFrame` 任務沒 yield**
- stack: React commit → react-konva `applyNodeProps` → Konva `setAttrs` × 150 markers × ~10 nodes = ~1500 個 imperative setAttr
- 觸發者：click → `_endDragAfter` → React 重新 render

P1+P2+P3b+P3c 救不到這條（都不是 react-konva commit 的鍋）。

### 改動 — `src/features/editor/layers/APLayer.jsx`（700 行重寫）

- **`buildApGroup(ap, st, callbacksRef)`** — 純 imperative，回傳一個 `Konva.Group` 已掛好所有 9 個子節點 + 4 個事件 listener。Sub-nodes 存在 `g._nodes` 供 diff 查詢。
- **`updateApGroup(g, nextAp, nextSt)`** — 比對 `g._ap / g._st` vs `nextAp / nextSt`，只觸碰實際有差異的屬性。座標 / draggable / hit radius / focus halo / directional fan / custom polygon / axis line / body / arrow / name label / info pill — 每個都分別判斷。
- **APLayer 主體** — 還是 React component，只 render 一個 `<Group ref>` 給 react-konva 當錨點，其他全部丟到 imperative 處理：
  - `useAPStore.subscribe(...)` 直接訂閱 store，apsByFloor 變化 → `syncFromStore()`，**不走 React render**
  - 「layer-wide flags」（selection / focused / showAPInfo / capability ...）用 useEffect 監控，變化時也 syncFromStore
  - hover 完全 imperative（`hoveredIdRef`），不再走 React useState
  - 4 個事件（click / mouseenter+leave / drag / contextmenu）綁在 g 上，listener 透過 `callbacksRef.current` 取最新 closure

### 視覺驗收
8 場景 pixelmatch `0 / 4,650,888` 全 pass — `.playwright-mcp/perf-after-p3a/` vs `.playwright-mcp/perf-before/`。

### 互動 regression（MCP 真實觸發）

| 互動 | 5 AP | 150 AP |
|---|---|---|
| 左鍵 click → select | ✅ APPanel mount 顯示 AP-01 | ✅ 顯示 Stress-0001 |
| Hover invert（mouseenter）| ✅ 像素改變、leave 復原 | — |
| 右鍵 → context menu | ✅ 顯示「重新命名 / 選取 / 刪除」| — |
| Drag → store update | ✅ AP 座標改了 +30, +20 | ✅ |

4/4 互動全 pass。

### 數字（150 AP / HM ON，3-5 樣本中位數）

| 指標 | DevTools trace（你錄的）| After P3a | Δ |
|---|---|---|---|
| **Click → commit** | **5800 ms** rAF | **563 ms** | **-93% / ×10.3 🎯** |

| 指標 | Baseline | After P1+P2+P3b+P3c | After P3a | 從 baseline 的 Δ |
|---|---|---|---|---|
| 150 AP 單 AP no-op updateAP | 1784 ms | 1784 ms | 806 ms | -55% ✅ |
| 150 AP slider 一格 | 1784 ms | 1784 ms | ~1819 ms | 同 ⚠ |
| 150 AP addAP | 950 ms | 950 ms | 2489 ms（HM ON）/ 681 ms（HM OFF）| HM ON 變慢 ⚠ |

### 沒救到的原因

`addAP` 在 150 AP / HM ON 之所以變慢 ~1.5 s，longtask 分布顯示主要 1770 ms 落在 **HM shader recompute** + **Konva `Layer.batchDraw()` 重畫 151 個 marker 到 canvas**。

- P2 fingerprint 抓不住 addAP（新 AP 進場 → fingerprint 必定變）
- Konva `batchDraw` 在 imperative 跟 react-konva 都一樣 O(N) — 每個 node 的 2D context drawCall 是固定成本
- 我的 imperative diff 路徑 ~10-20 ms / 整層，不是瓶頸

**HM OFF 下 addAP 從 baseline 418 ms → 681 ms** 是 ~260 ms 的 regression — 這個是 P3a 的「layer-flag effect 觸發 syncFromStore 全掃」+ 沒做 incremental 的代價。可以後續優化但不是現在優先。

### 為什麼 click 大勝、addAP 沒勝

click 路徑：
1. setSelected 觸發 → 改 selectedId
2. 之前：React commit → 150 markers props 都重新 set（isSelected 算每一顆）→ react-konva commitWork × 1500 nodes → **5800 ms**
3. 現在：useEffect 偵測 selectedAPId 變 → syncFromStore → 每個 group 走 updateApGroup → 大多無變化，只有目標那顆改 stroke / fill → **<1 s**

addAP 路徑：
1. addAP 觸發 → apsByFloor 新增一筆
2. P3a 砍掉了 react-konva 那條（贏 ~200 ms）
3. 但 HM shader / CableLayer routing / Konva 整層 paint 全部都跟著動 — 這幾條 P3a 沒碰

### 沒做的 follow-up

- HM shader 增量更新（新 AP 加進來，只算這顆對既有 grid 的增量）— 工程大、HM-F4 規格也支援
- CableLayer 增量更新（只算新 AP 的 route，舊的 routes cache）— 中等
- Konva `Layer.batchDraw` 改 `Layer.draw()` 用 dirty rect — Konva 8 支援度未驗

這些都不在這次 26-2 範圍。

---

## 32-0 — computeRoutes wall-clock baseline（PixiJS 時代，2026-05-29）

**動機**：使用者回報「多 AP + SW + tray 即時拖曳很卡」。Phase 25 已換 PixiJS，
[cablesLayer.js](src/features/cables/cablesLayer.js) 拖曳時**解凍 cable**（每 pointermove 重算），
不再是 Konva 時代的 P3b 凍結。要確認瓶頸是 routing 計算還是畫線。

**結論：瓶頸是 `computeRoutes`，不是畫虛線。** 拖曳一個物件 → `useDragOverlayStore` 變 →
`cablesLayer.rebuild()` → `computeRoutes(整棟建築)` → `buildBuildingGraph` 重建整張圖 +
**每個 AP 各跑一次 Dijkstra**。1000 AP × 1 tray = **94 ms/call**，遠超 16.7ms/frame 預算。

### 量測方法

`scripts/bench-routing.mjs`（純函數 bench，`npx vite-node scripts/bench-routing.mjs`）。
合成單樓層場景：N AP 網格 + M 條水平 tray（magnet 400px）+ switch grid（每 250 AP 一個）。
矩陣 AP ∈ {50,150,300,500,1000} × tray ∈ {0,1,5,10}。

### 數據（ms / computeRoutes call）

| AP | 0 tray | 1 tray | 5 tray | 10 tray |
|----|--------|--------|--------|---------|
| 50   | 0.14 | 0.47  | 0.43  | 0.51  |
| 150  | 0.29 | 0.69  | 1.02  | 1.00  |
| 300  | 0.38 | 9.15  | 3.04  | 3.05  |
| 500  | 0.84 | 21.39 | 9.15  | 8.13  |
| 1000 | 1.08 | **94.44** | 42.32 | 38.53 |

### 三個關鍵發現

1. **「1 條 tray」比「10 條」更慢**（1000 AP：94ms vs 38ms）。一條貫穿全場的大 tray 把幾乎
   所有 AP + switch 連進**同一個圖元件**，每個 AP 的 Dijkstra 都在這張巨大連通圖上跑。
   10 條 tray 把 AP 切成小群，單次 Dijkstra 反而更小更快。→ 使用者真實場景（多物件互連）正落在最慢區。
2. **0 tray 永遠很快**（1000 AP 僅 1ms）——無 tray 時走 fallback Manhattan，不跑 Dijkstra。
   證明成本全在 graph + Dijkstra。
3. **`routing.js` 的 Dijkstra 用 `pq.sort()` 劣質 priority queue**（[routing.js:53](src/features/cable/routing.js#L53)）——
   每次 pop 前重排整個 queue，O(E²) 而非 O(E log V)。註解寫「adequate for <1000 nodes」，
   但 1000 AP 的圖節點數遠超 1000 且要跑 1000 次。

### 三個獨立放大因子（按影響排序）

| 因子 | 證據 | 複雜度 |
|---|---|---|
| 1. 每個 AP 都跑完整 Dijkstra | 1000 AP × 1 Dijkstra | O(AP數 × Dijkstra) |
| 2. Dijkstra 劣質 pq.sort queue | routing.js:53 | O(E²) per Dijkstra |
| 3. 每幀重建整張圖 | computeRoutes.js:108 | 固定大成本 |

### 對策（task.md Phase 26）

| 對策 | 預期 | 風險 |
|---|---|---|
| **32-D 拖曳凍結 cable** | 拖曳中不重算，dragend 才算一次 → drag FPS 直接救回 | 低（cable 短暫不跟手，Figma/Hamina 同模式）|
| **32-C 增量 routing** | graph cache + 只重算動到的 AP；保留每幀精確 | 高（topology cache + dirty 追蹤）|
| 旁支：Dijkstra 換真 binary heap | 砍因子 2 | 低，但治標 |

下一步由使用者決定走 32-D（最便宜，最像 Hamina）還是 32-C（保留即時精確跟隨）。

---

## 32-E — cable 畫圖瓶頸量測（32-C 之後，2026-05-30）

**動機**：32-C 解掉 routing 後使用者實測：50AP 順、150 小卡、**300AP 連純 hover/點選任何東西都大卡**；
但刪掉 SW 或 Tray 任一個就全順。要在動手前確認真因（記憶與直覺都指向「單一 Graphics 每幀重送 GPU」）。

### 量測方法

瀏覽器內 `window.__stores` + `window.__pixiApp`（DEV 暴露）。場景：DemoLoader example3
（685×511、scale 22.83 px/m）→ StressLoader 塞 300 AP → 注入 1 switch + 1 條橫貫 tray（magnet 400px）。
用 `app.ticker` 取 frame time、`performance.now()` 包 store mutation 量同步 rebuild 成本。

### 場景規模

| 指標 | 值 |
|---|---|
| 路由數 | 300（全部 `tray` status）|
| 線段數（active floor）| **23,250 段** |
| 實際 stroke draw call（虛線逐段切割後）| **~26,850** |

> 記憶寫的「~8880 段」低估了：一條橫貫 tray 把所有 AP 連進**同一張連通圖**，每顆 AP 的路徑都走過整條 tray polyline（平均 ~78 點/route）。

### 關鍵數據

| 場景 | frame / 耗時 | 結論 |
|---|---|---|
| **Idle（待機）** | **60 FPS（16.67ms）** | ✅ 建好的 Graphics 每幀重畫**很便宜**——「連續 ticker 每幀重送大 Graphics」**不是**瓶頸（推翻原假設）|
| 連續 pointermove over canvas | 56 FPS、p95 29ms | 略降但非「大卡」（合成事件未必觸發 PIXI 完整 hit-test）|
| **點選一顆 AP（select）** | **2,400 – 3,400 ms 凍結** | ❌ `editor` fire → `computeRoutesForDraw` 無 drag → **跑全量 `computeRoutes`**（selection 根本不改 route！）+ 全量重畫 |
| **拖一顆 AP（incremental）** | **100 – 280 ms / pointermove** | ❌ routing 已增量(~1ms)，但**每幀重畫全部 26,850 stroke** + PIXI tessellation/GC |
| 純 routing（full computeRoutes）| 136 – 780 ms | 32-C 已在 drag 時繞開；非 drag 觸發仍全跑 |
| 純畫圖（clear + redraw all）| **~30 – 50 ms** | 32-E 真正畫圖目標 |

### 兩個獨立的畫圖側真因（都不是「每幀重送」）

1. **Select / viewport / 任何非 drag rebuild 都跑全量 `computeRoutes`**（最痛，2-3 秒凍結）。
   已驗證 routing **純粹**於 selection 與 viewport（同 input 兩次結果結構一致）——selection 只改 alpha/highlight、
   viewport 只改線寬/dash 的 `s` 係數，**route 幾何零變動**。`computeRoutesForDraw` 卻在每次非 drag rebuild
   重跑 `computeRoutes(building)`。→ **selection / viewport 路徑應重用 `baseResult` cache，完全不跑 Dijkstra**。
2. **拖曳每幀重畫全部 cable**（~30-50ms draw + GC）。只有 1 條 route 變，卻 `g.clear()` 重畫 26,850 段。
   → **靜動分層**：未動的 route 凍結在 static Graphics（drag 開始畫一次），只重畫動到的那條進 dynamic Graphics。

### 32-E 對策（已實作，2026-05-30）

實作過程又挖出**第三、第四個真因**（量測驅動）：點選 AP 的 2-3 秒**不是 cable 畫圖**，
是 `computeFocusedDevices`（focus halo）+ 右側 panel（APPanel/SwitchPanel）的 useMemo **各自跑全量 computeRoutes**。
原以為「刪 tray → 點選順」證明是畫圖，其實是這些 computeRoutes 只有 tray 在場才貴。最終四個對策：

| 對策 | 做法 | 結果 |
|---|---|---|
| **A. routing cache gate** | cablesLayer `routingDirty` flag：selection/viewport rebuild 重用 baseResult，不跑 Dijkstra | — |
| **B. 拖曳靜動分層** | gStatic（未動 route 凍結）+ gDynamic（只重畫拖到那條）；splitKey 控制 static 只在 drag 目標/資料/viewport 變時重建 | 拖曳 100-280ms → **3-13ms/幀** |
| **C. selection 也走分層 + container alpha dim** | 未選 route 留在 gStatic、用 `gStatic.alpha=0.18` 整層 dim（不再 per-route alpha——畫半透明線慢 ~16×）；選中 route 全亮+band 疊在 gDynamic（occlude 掉 static 裡的同一條）。selection **不重建 gStatic** | cable 選取畫圖 2083ms → **1.7ms** |
| **D. 共享 routes cache** | 新 `routesCache.js`（`getCachedRoutes`，按 store slice identity memoize）。focusedDevices + APPanel + SwitchPanel + CableSummaryPanel + CableTrayPanel 全改用它——同資料只算一次，selection 直接 cache hit | 點選 AP **2083-3400ms → 2-22ms**；點選 SW ~2400ms → **350ms** |

**最終量測（300AP+SW+橫貫tray，瀏覽器 window.__stores/__pixiApp）**

| 操作 | 修前 | 修後 |
|---|---|---|
| Idle FPS | 60 | 60 |
| 點選 AP | 2083–3400ms | **2–22ms** |
| 點選 SW | ~2400ms | **350ms** |
| 拖 AP（per-frame）| 100–280ms | **3–13ms** |
| 拖 AP（drag 第一幀建 static）| — | ~290ms（一次性）|

### 32-E 第二輪 — 軟體渲染（無硬體加速）真因（2026-05-30）

使用者回報：上述 A–D 在**硬體 GPU** 順了，但他**無痕**仍全卡。`chrome://gpu` 顯示
**WebGL/WebGPU 都 "Software only, hardware acceleration unavailable"** → SwiftShader 軟體渲染。
**關鍵體悟：不能假設使用者有硬體加速**（無痕 / 企業政策 / VM / 遠端桌面 / 舊機都可能軟體渲染），
32-E 必須在軟體渲染也跑得動。用 `?renderer=webgl`（scene.js dev override）+ `window.__perf`
（perfProbe.js，frame ms + span 表 + cache hit/miss）量測，推翻先前「idle 60FPS 不需 render-on-demand」結論：

| 真因（軟體渲染放大）| 量到 | 對策 |
|---|---|---|
| PIXI 預設**每秒 render 60 次**（畫面沒變也畫），軟體渲染每次 CPU raster 全場景 | idle 60 render/s | **render-on-demand**：scene.js `app.ticker.stop()` + `requestRender()`（rAF 合併、2 幀預算、resize hook）；FloorplanSystem 把 13 store 一處綁定（rAF 保證在 layer 重畫後）；viewport marquee 補呼叫。idle **60→0 render/s** |
| cable 背景每幀重 raster 72k instruction | hover/drag-move ~120ms/幀 | **cacheAsTexture on gStatic**：烤成一張貼圖，每幀 blit。~120ms → **~9ms**。zoom 重烤保持清晰，dim 用 container alpha 不受影響 |
| drag 放下 commit 重畫全部 300 AP marker | `aps.ap` ~99ms | **apsLayer reconcile 逐 AP identity diff**：只重畫 changed/new AP。99 → **1.6ms** |
| 單顆 AP 變動觸發 focus/panel **全量 computeRoutes** | commit ~400-700ms | **routesCache 增量**（getCachedRoutes：topology 不變 + 少數 AP 變 → 只 routeOneAP 那幾顆）；cablesLayer 同加 `tryIncrementalDirty` |
| 拖曳 commit 觸發 cablesLayer 全量重建 gStatic | dragEnd ~300-500ms | **drag 期間跳過 invalidateStatic**（dragged route 已在 split 處理，其餘 299 未動）；dragEnd 走 `releasing` append |

**最終量測（300AP+SW+橫貫tray）**

| 操作 | 軟體渲染修前 | 修後 |
|---|---|---|
| idle / hover / drag 過程 / select | 全卡 | **全順**（使用者確認）|
| drag 開始 / 結束 | 卡 | 各剩 **~105ms**（單張快取貼圖重烤的固有成本，使用者接受）|

**驗證**：`scripts/test-incremental-routing.mjs` 88/0（routing 未動）；render-on-demand 各互動都重繪（drag/select/pan/hover/heatmap/marquee 皆 >0 render、idle 0、無 stale frame）；
focus highlight band + dim 視覺正確；移動 AP 後 route start 對齊新位；**git stash 前後並排確認「AP 在 tray 外時 SW 吸附 stub 看似孤立」是既有行為、非本次回歸**；0 console error。

**檔案**：scene.js、FloorplanSystem.jsx、viewport.js、cablesLayer.js、apsLayer.js、focusedDevices.js、
routesCache.js(新)、perfProbe.js(新 dev 工具)、APPanel/SwitchPanel/CableSummaryPanel/CableTrayPanel。

> dev 工具：`?renderer=webgl` 強制 WebGL2 重現無硬體加速；`window.__perf.start('x')`→操作→`__perf.report()`。

### 32-E 最終修正（上表的 cacheAsTexture 已被推翻，2026-05-30）

⚠️ **上面那欄「cacheAsTexture on gStatic」已經整個移除**（commit a33dc14）。後續發現它是一串視覺 bug 的元凶，
且根本不必要——量測證實「靜動分層」已讓 gStatic 拖曳時凍結，PIXI 重畫**沒變的** Graphics 是從快取好的幾何批次
直接畫（~1ms），**不會重新 tessellate**；原本的 120ms 是「每幀重建（重 tessellate）」，那已被靜動分層解掉，
cacheAsTexture 多餘。

cacheAsTexture 衍生並修補又最終放棄的 bug（時間順）：
- 選取後 cable 變淡（dim 烤進貼圖）→ c52edea/b52c7e4（祖先鏈 alpha 強制 1 烤）
- 大畫布/縮放下整體模糊變暗（貼圖固定解析度上採樣）→ 60022d5（只重場景才快取）仍不夠
- → **a33dc14 直接移除 cacheAsTexture，cable 全程 vector**（任何尺寸/縮放清晰全亮）。

**最終架構（取代上表）**：vector cable + render-on-demand + 靜動分層 + routesCache 增量 + apsLayer 逐 AP diff。
另修：477887d（SW↔tray snap stub 構不到 tray：world delta × viewport.scale 補正）、
3f9a3f6（focus+拖曳後切選取的殘影：gStatic 排除前景 + focus 納入 splitKey，選取改變即重建 gStatic）。
代價：300AP 點選現在 ~110-200ms（gStatic vector 重建，使用者接受正確優先），仍遠優於 32-E 前 2-3 秒。

**殘影 bug — 已驗證消除（2026-06-01 MCP）**：架構見 memory `project_cable_render_architecture_32e`。
殘影與 renderer（WebGL/WebGPU）無關，是 gStatic/gDynamic 該重建沒重建（splitKey 涵蓋不足）；
3f9a3f6（focus 納入 splitKey + gStatic 排除前景）+ 9a226ec（hasFocus guard 選取存在性）修掉後，
用量化探針驗證 6 高風險情境全 pass。

驗證法（可重跑）：`window.__scene.layers.cables` 三 child = `[staticDim(含 gStatic), gDynamic, badgeDynamic]`。
讀 `g.context.instructions.length`（繪製指令數）+ `staticDim.alpha`。不變量：
- 有單一 focus（selectedId 存在）：`staticDim.alpha === 0.18`（DIM_OPACITY）且 `gDynamic.instructions > 0`
- 無 focus（清選取 / 多選 selectedItems 無單一 selectedId）：`staticDim.alpha === 1` 且 `gDynamic.instructions === 0`
- gStatic instruction 數在反覆 select/drag/clear 後穩定（無 append 路徑堆積洩漏）

10 步序列（cleared→AP→SW→AP→clear→drag-drop→reselect→clear→multi→clear）全 pass：
focus 時 gDynamic 25/107/22/16/18、無 focus 時 gDynamic 恆 0；gStatic 穩定 86~88（demo 5AP/1SW/1tray）。
「選 SW 多條前景」= gStatic 0 / gDynamic 107（所有 route 進前景，無背景雙重 dim）。
「marquee 多選」= alpha 1 / gDynamic 0（乾淨全亮——cablesLayer hasFocus 只認單一 selectedId，
多選不 dim/不高亮，是設計現狀非殘影；oldSrc 多選 cable 強調行為若要對齊另開項目）。

### §31-12 聚焦壓測 — 1000 AP cable 效能（2026-06-01 MCP）

**目的**：用數據判斷 31-5（Cables Mesh + shader）該不該做。**結論：暫緩**（見下）。

**場景**：MCP store 注入 1000 AP（40×25 jitter grid）+ 5 橫貫 tray + 8 switch（1 MDF + 7 IDF），
demo 平面圖 685×511。實際畫出 **gStatic = 29,061 繪製指令**（≈ 規格的 30000 cable segments 量級）。
硬體加速渲染（非強制軟體）。量「每操作的同步 CPU 成本」（performance.now 夾 store action）。

| 操作 | 同步成本 | 16.7ms(60fps) / 33ms(30fps) |
|---|---|---|
| **drag 一顆 AP（連續每幀）** | p50 **5ms** / p95 16ms / max 47 | ✅ 32-E 靜動分層生效（每幀只重畫 gDynamic 一條 route）|
| drag start / end | 5ms / 42ms | ✅ 一次性可接受 |
| select AP / SW（focus 重建 gStatic）| 42–72ms | 🟡 一次性，邊緣 |
| **pan（連續）** | p50 26ms / p95 44ms | ❌ 未達標 |
| **zoom（連續）** | p50 28ms / p95 55ms | ❌ 未達標 |

**瓶頸定位（關圖層一刀切，pan avg）**：
| 場景 | pan avg | pan p95 |
|---|---|---|
| 全圖層 | 182ms | 223ms |
| 關 AP layer | 164ms | 189ms |
| **關 AP + 關 cable** | **21ms** | **25ms** |

→ **cable 是 pan/zoom 主瓶頸（~140ms）**，AP layer（1000 children）次之（~18ms）。
即使 gStatic 是凍結批次，pan/zoom 時 PIXI 仍要對 29k 線段 Graphics 做 transform/重提交，這是 vector 的固有成本。

**為何暫緩 31-5（重啟扳機）**：
- 31-5 原本要解的「drag 30000 段每幀重畫」→ **32-E 已解**（drag-move 5-7ms）。
- 壓測新揭露的 pan/zoom 瓶頸 **只在 1000 AP 才出現**；對標 Hamina，單一平面圖（active floor）真實 AP 數
  通常 20-200，~300 以下已全順（perf-baseline 既有實測）。1000 AP 是規格 headroom 目標，非單層真實需求。
- 與已撤回的 31-4（Wall Mesh+shader）同構：Graphics 撐得到、shader 維護成本高（GLSL/WGSL 雙寫）。
- **重啟條件**：若日後出現「單一平面圖 active floor >500 AP」的真實需求且 pan/zoom 卡頓，再啟 31-5（Mesh+screen-space dash shader），目標把上表 pan/zoom 的 ~140ms cable 成本砍到接近零（GPU 只更新 transform uniform）。

**可重跑**：注入腳本（deterministic seed）+ 量測法見本次 MCP session；場景參數 40×25 AP / 5 tray / 8 SW。

#### 31-9 / 31-10 spatial index — 量測後暫緩（2026-06-01）

hit-test 不是「我們自己跑線性掃描」——`apsLayer.js:150` 每顆 AP 是 `eventMode='static'` + `hitArea=Circle`，
走 **PIXI 原生 `rootBoundary.hitTest`**。量單次 hit-test 成本（batch 200 次除，beat performance.now 粗精度）：

| AP 數 | 單次 hit-test |
|---|---|
| 300 | **26µs**（0.026ms）|
| 1000 | **75µs**（0.075ms）|

線性增長（O(N)，確認 PIXI 逐物件掃），但**量級無關緊要**：1000 AP 仍只 75µs = 60fps 預算（16.7ms）的 0.45%。
hover/click 每互動只做 1 次 hit-test，使用者永遠無感。唯一每幀多次查詢的 marquee 是框內幾何查詢、不走 per-pointer hitTest。
→ **31-9/31-10 spatial index 是過度工程，暫緩**（同 31-5 邏輯：優化佔預算 0.45% 的東西）。重啟扳機同 31-5。

#### 31-11 SDF text — 量測後暫緩（2026-06-01）

1000 AP 下確有 **3000 個 `PIXI.Text`**（每顆 AP 3 個：freq 數字 + 名稱 + info block），命中 task.md「禁大量 PIXI.Text」的點。
但 `showAPInfo` 開/關實測 frame time 幾乎不變（pan 都 ~240ms、idle ~18-22ms）——Text texture render 完即 cache，
pan 不重繪，pan 瓶頸是 cable+marker 不是 text。JS heap 1000 AP = 422MB（極端值，且 JS heap ≠ GPU mem）。
→ **31-11 SDF 對 pan/idle 效能無幫助，暫緩**。SDF 只在「label 頻繁變動」或「極端記憶體」才有意義，單層真實場景碰不到。重啟扳機同 31-5。

#### 31-12 Validation — 縮減為「已記錄基準」

31-12 是驗收動作非功能。31-5/6/9/10/11 全暫緩後無新實作需要完整驗收（8 場景 diff / context-loss 等）。
本 §31-12 即視為已記錄的 1000 AP 基準；完整驗收待真有 ship 需求再啟。

**結論（整個 Phase 25 效能家族）**：31-5/6/9/10/11 全是「1000 AP headroom」優化，實測證明單層真實 AP 量級（~300）
MVP 實作全部達標，瓶頸只在 1000 AP，而單層平面圖到不了 1000。全部暫緩，共用同一重啟扳機。
