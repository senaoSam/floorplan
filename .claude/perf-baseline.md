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
- 26-2 動手後請重跑 §2 全部表格，貼到 `.claude/perf-baseline.md` 第二區段並標 `## After 26-2`。
