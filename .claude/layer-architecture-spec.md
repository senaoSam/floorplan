# Konva Layer 架構 — 設計規格

> 三輪設計討論收斂版本，2026-05-25。
> 對應問題：SW + Tray + 50AP 場景下，畫布內拖曳 AP / Switch / Tray 卡頓。
> 落地依據：本 spec + `.claude/task.md` 對應 Phase。

---

## 1. 問題定位

### 1.1 觀察到的現象

| 場景 | 拖曳 AP / SW / Tray 體感 |
|---|---|
| Tray + 10AP | 順 |
| SW + 10AP | 順 |
| SW + Tray + 10AP | 順 |
| **SW + Tray + 50AP** | **卡** |

畫布外操作（hover 熱圖 legend、切 panel、開進度等）任何場景都順。

### 1.2 根因

所有可互動的向量物件目前全部掛在 `src/features/editor/Editor2D.jsx` 行 1710–1947 的同一個 `<Layer>`：

```
ScopeLayer / FloorHoleLayer / WallLayer / CableTrayLayer (base) /
SwitchLayer / RiserLayer / APLayer / CableLayer /
CableTrayLayer (overlay) / ScaleLayer / CropLayer
```

Konva 在 `dragmove` 是 **per-layer batchDraw** —— 拖任何節點都會把整層 canvas 重畫一遍。

對應卡頓場景：
- `Tray + 10AP`：`accessSwitches.length === 0` → `computeRoutes` 全部 unroutable →
  `CableLayer.jsx:87` 的 early return（`routes.size === 0 && switchLinks.size === 0`）讓 CableLayer 完全不產生 Konva 節點。順。
- `SW + 10AP`：每條 fallback Manhattan 路線只有 3 點 / 2 段 / 少數 Circle，總節點數小。順。
- `SW + Tray + 10AP`：只有 10 條 tray-route，總節點 < 100。順。
- `SW + Tray + 50AP`：50 條 tray-route，每條多 waypoint + drop legs + 端點 Circle，估 500–1000 個 cable Konva 節點，跟 50 個 AP marker / Tray polygon 同層，每幀 batchDraw 都全部 repaint。卡。

### 1.3 次要放大因子

`CableTrayLayer.jsx:602-619` 的 `onTranslate` / `onVertexDragMove` 每個 dragmove tick 都直接寫 `updateTray` 到 store，造成：

1. `traysByFloor` 變動 → `CableLayer.jsx:64-85` 的 `useMemo` 每幀重跑 `computeRoutes`（Dijkstra × 50 AP）。
2. `useFocusedDevices.js:29` 同樣每幀重跑。
3. 整層 React reconcile 跟著走。

此問題跟 layer 拆分**正交**：layer 拆完拖 Tray 還是會卡，因為 cable 那層真的有資料變動觸發 repaint。所以必須一起修。

---

## 2. 目標架構

### 2.1 分層原則

按重要性排：

1. **拖曳區域要小** —— Konva 以 layer 為 batchDraw 單位，常被拖的東西要單獨一層。
2. **衍生 / 唯讀的東西獨立放** —— `listening={false}` 的純視覺層成本低（跳過 hit graph），收益高（隔絕重畫）。
3. **互動頻率分檔** —— 靜態 / 偶爾編輯 / 頻繁拖曳 / 短暫繪製中。
4. **層數預算 6–8** —— Konva 官方建議 3–5，現代硬體 + `listening:false` 撐到 7–8 還合理；主產品要整合進 React 17 環境，要顧到低階機器。
5. **z-order 仍需手動維護** —— Layer 是堆疊順序，視覺要對到產品需求。

### 2.2 八層配置

| # | Layer | listening | 內容 | 何時 repaint |
|---|---|---|---|---|
| 1 | Background + FloorImage | false（mode 切換時開） | 深色底 + 樓層圖（含 align refs） | 換樓 / align / viewport |
| 2 | Heatmap | false | 熱圖 canvas | AP / wall / scope drag overlay（已實作） |
| 3 | Structural | true | Wall / Scope / FloorHole / RefWall / RefVector | 編輯這幾類時 |
| 4 | Trays | true | Tray body / magnet / base hit | 編輯 tray 時 |
| 5 | **Cables (derived)** | **false** | CableLayer 全部 Lines/Circles + focus halo + drop legs | route 資料真的變了才重畫 |
| 6 | Devices | true | AP / Switch / Riser | 拖任一裝置 |
| 7 | Visual overlays + Marquee | false（多數） | snap halo / draft preview / badge / unroutable / draftAnchor / marquee Rect | 繪製中 / hover snap / 框選中 |
| 8 | Interactive handles | true | Tray vertex / segment handles / Scale draw / Crop draw / 未來 transformer | 處理中 |

### 2.3 各層拆分理由

**L1 Background + FloorImage 合併**：兩者都是 listening=false 的靜態底，沒必要兩張 canvas。合併省一層。Mode 切到 `ALIGN_FLOOR` 或 `EDIT_FLOOR_IMAGE` 時透過 capability 把這層的 listening 動態打開。空白處取消選取交給 Stage onClick 處理。

**L2 Heatmap**：已實作獨立層（`HeatmapLayer.jsx:568`），現狀保留。`listening=false` 已設。

**L3 Structural**：Wall / Scope / FloorHole 是「畫一次擺著」的物件，編輯頻率低，跟 Devices 拆開避免被連累。RefWall / RefVector 跟它們同性質歸一層。

**L4 Trays（單獨一層，不混 Devices）**：Tray 有 body drag / segment 點選 / vertex drag / context menu，互動面複雜且節點數量比 AP marker 多，混進 Devices 會彼此拖累。獨立一層讓 Tray 操作只動自己。

**L5 Cables（最重要的一拆）**：CableLayer 本來就 `listening={false}`（`CableLayer.jsx:93`），搬出去零副作用。拆出後拖 AP / SW / Tray 都不會碰到這層的 canvas（前提是 dragmove 不寫 store —— 見 L4 與 §3 step 2 配套）。

**L6 Devices**：AP / Switch / Riser 是頻繁拖曳的，集中一層讓 batchDraw 範圍可預期。拆開後此層只有 ~50 AP marker + 幾個 SW / Riser，repaint 便宜。

**L7 Visual overlays + Marquee**：snap halo、DraftTray、unroutable badge、draftAnchor、focus halo（暫不從 L5 拆）、marquee Rect 都是 `listening=false` 的視覺裝飾。合併一層減少層數。Marquee 跟 drawing mode 互斥（不會同時出現），共層不互相影響 batchDraw。

**L8 Interactive handles**：Tray 被選取後的 vertex / segment handles、Scale draw、Crop draw、未來可能的 transformer 都需要 `listening=true`。拆出來讓「正在編輯中的 widget」獨立 repaint，不會干擾 L4 的 tray base。

---

## 3. 落地順序

| step | 動作 | 解決什麼 | 動工估計 |
|---|---|---|---|
| **1** | **CableLayer 拆獨立 Layer + `listening=false`** | **立即解 SW+Tray+50AP 拖 AP/SW 卡頓** | 5 行 |
| **2** | **Tray dragmove 改寫 `useDragOverlayStore`，dragend 才 commit `updateTray`** | **解拖 Tray 卡頓** | 30 行 |
| 3 | Structural / Trays / Devices 分三層 | 為更多裝置類型擴張舖路 | 1 小時 |
| 4 | Overlay 拆 visual overlay / interactive handles 兩層（marquee 併入 visual） | 繪製中事件流更乾淨 | 1 小時 |
| 5 | FloorImage 預設 `listening=false`，Stage onClick 處理 deselect | 小整理 | 15 分鐘 |
| 6 | （延後）DragLayer | 量測 Devices layer 仍慢才做 | — |
| 7 | （延後）Cable focus halo 拆出 L5 | 未來改成 hover 觸發才需要 | — |

**Step 1 + Step 2 是解卡頓的最小集合**；step 3–5 是為未來擴張舖路，可分批做。

### 3.1 Step 1 細節

`Editor2D.jsx:1904-1906` 的 `<CableLayer>` 從共用 `<Layer>` 內搬出來，包進獨立 `<Layer listening={false}>`。注意：

- z-order：CableLayer 原本在 APLayer 之上（線會蓋住 AP 末端）。拆層後新 Layer 要放在 Devices Layer 之**上**才能維持。但 AP body 蓋住 cable drop leg 末端是可接受的視覺（drop leg 收進 AP），所以也可以放 Devices 之**下**，由使用者最終決定。
- CableLayer 內 `<Group listening={false}>` 包裹可以拿掉（整層已 listening=false）。

### 3.2 Step 2 細節

Tray 兩種拖曳行為都要改：

**Body drag**（`CableTrayLayer.jsx:316-329` 的 `onDragMove`）：
- 目前：每 tick 計算 incDx / incDy → `onTranslate(dx, dy)` → `updateTray` 寫 store。
- 改後：每 tick 累計 totalDx / totalDy 到 `useDragOverlayStore.setTray({ id, dx, dy })`。
- dragend：把最終 dx/dy 加到 tray.points 上、`updateTray` 一次 commit、清掉 overlay。

**Vertex drag**（`CableTrayLayer.jsx:613-619` 的 `onVertexDragMove`）：
- 目前：每 tick 改 vertex 位置 → `updateTray` 寫 store + 計算 snap target。
- 改後：每 tick 寫 `useDragOverlayStore.setTrayVertex({ trayId, vertexIdx, x, y })` + snap target 仍即時顯示。
- dragend：commit 到 store。

`useDragOverlayStore` 需要擴充：

```js
{
  ap: null,
  sw: null,
  wall: null,
  scope: null,
  hole: null,
  tray: null,         // 新增: { id, dx, dy }
  trayVertex: null,   // 新增: { trayId, vertexIdx, x, y }
}
```

CableLayer 跟 useFocusedDevices 的 useMemo 視情況訂閱 overlay；通常拖 Tray 時不需要 cable 跟手（拖完 commit 一次就好），跟現有 AP/SW 行為一致（cable 在 AP/SW drag 中也不跟手）。Tray 本身的視覺更新由 TrayPolyline 直接吃 overlay 渲染暫時位置。

---

## 4. 不做的事 / 延後決定

### 4.1 DragLayer 模式（延後）

Konva 的 DragLayer 模式：dragstart 把節點 `moveTo()` 到專屬層，dragend 再搬回。

**為什麼延後**：
- react-konva 的 fiber 樹跟著 parent 走，硬搬會被 unmount + remount。必須用 imperative `Konva.Node.moveTo()` 處理，並在 dragstart / dragend 維護絕對座標一致（避免「跳一下」）。
- Step 1 完成後 Devices layer 只剩 ~50 AP + 幾個 SW，repaint 本來就便宜。
- DragLayer 是「再優化」工具，**先量測 Devices layer 仍慢再加**。

### 4.2 Cable focus halo 拆出 L5（延後）

`CableLayer.jsx:312-336` 的 `HighlightBand`（focus halo）目前跟 cable lines 同層。

**為什麼延後**：
- 目前 focus halo 是 click-once 觸發（`selectedId` 變動），低頻事件，跟 cable 本體同層完全沒問題。
- 拆出的場景是「hover 觸發 focus halo」這種高頻變化。目前 `useFocusedDevices.js:14` 吃的是 `selectedId`，不是 hover。
- **未來若改成 hover focus，那時再拆**。現在拆是預先優化。

### 4.3 Tray 拖曳時 cable 跟手（Phase 24 不做，Phase 26 重新評估）

**Phase 24 決策**：cable 線在裝置拖曳中**凍結**，dragend 後 snap 到新位置。AP / SW drag 已是此行為，Phase 24 step 2 讓 Tray drag 也走同樣模式。

**但這是降規格的妥協**。Hamina 實測能做到 100+ AP + 多 SW + 多 Tray 拖曳時 cable 即時跟手且順暢。差距在兩個結構性的點：

1. **渲染後端**：Hamina 推測是純 Canvas / WebGL。每幀更新 = mutate buffer + 一次 draw call，零 React reconciliation。我們的 cable 走 react-konva，每幀 fiber walk + setAttrs × N nodes 是主要成本。
2. **Routing 演算法**：Hamina 推測是增量 routing —— 拖一顆 AP 只重算這顆 AP 的單源 Dijkstra；拖 tray body 只平移 edge 座標，graph topology 不變。我們的 `computeRoutes` 每幀**從零重建整張 graph + 跑 N×Dijkstra**，O(N_AP × (|V| + |E|) log |V|)。

**Phase 24 凍結方案的位置**：是一個能 ship 的妥協，不是最終解。Phase 25/26 之後重新評估解凍。

### 4.4 Real-time cable follow — 決策樹（Phase 25 完成後重評）

Phase 25（純 Konva）完成後**先量測 `computeRoutes` 在 50 / 150 / 300 AP 情境下的單次 wall-clock 時間**，再依照結果走分支：

```
Phase 25 完成 → 量測 computeRoutes wall-clock @ 50 AP
                ├─ < 5 ms/frame  → 路線 D：解凍 cable，每 dragmove tick 直接重算 + 重畫
                │                  零額外工程，達 Hamina 級 real-time follow
                ├─ 5–16 ms       → 路線 B：WebGL cable rendering（沿用 heatmap pattern）
                │                  Routing 算法不動，只把畫的成本降到接近零
                │                  工程估 1–3 天
                └─ > 16 ms       → 路線 C：增量 routing（dirty / incremental Dijkstra）
                                   + 視情況再加 WebGL cable
                                   工程估 3–7 天 + 1–3 天
```

**決策依據**：
- 16 ms 是 60fps 預算。Routing 跑得贏這個就還有空間給 paint。
- 5 ms 是「即使有其他開銷（heatmap recompute、Konva paint、event handling）也仍有餘裕」的舒適區間。
- 純 Konva 後 react-konva commit 成本歸零，`computeRoutes` 本身的 dijkstra × N 是否會成為瓶頸**目前無法預測**，必須實測才知道。

**為什麼這個決定不在 Phase 24 / Phase 25 做**：
- Phase 24（layer 拆 + Tray drag overlay）解掉的是「**操作不卡**」這個臨床問題。即使 cable 凍結，使用者操作體感是順的。
- Phase 25（純 Konva）動的是渲染後端，跟 routing 算法正交。但純 Konva 後 routing 的 wall-clock 才有意義 —— 現在量到的 routing time 混合了 react-konva 開銷。
- 在沒量測前選 B / C 都是預先優化。先做 Phase 25 → 量 → 看到底瓶頸在哪 → 對症下藥。

**WebGL cable rendering 實作備忘**（路線 B 走時）：
- 沿用 `src/features/heatmap/heatmapGL.js` 的 pattern：WebGL2 canvas → `Konva.Image` 掛在 cable layer
- 需自寫的 shader：粗線（gl.LINES 不支援，要展三角形 strip）、dash pattern（fragment 沿線距離）、多色（per-vertex color attribute）、AA（smoothstep 邊緣）、focus halo（multi-pass）
- 端點圓 / vertex marker 量少可留 Konva 原生 Circle
- Hit-testing 不需要（cable layer 本來就 `listening=false`）

**增量 routing 實作備忘**（路線 C 走時）：
- Graph topology cache：trays + risers 結構（nodes + adjacency）跟 tray/riser 位置解耦；AP/SW 位置變動不重建 graph
- Endpoint snap spatial index：R-tree 或 grid hash，O(log N) 取代 O(N²)
- Per-AP single-source Dijkstra：拖一顆 AP 只重算這顆 AP
- 拖 tray vertex：影響半徑內的 edge weight 更新，受影響 routes 重算
- 拖 tray body（純平移）：所有 edge weight 不變（同條 tray 內部 chainage 不變），只更新 cable polyline 座標，不重跑 Dijkstra

---

## 5. 風險與取捨

### 5.1 層數預算

8 層在現代硬體沒問題。若整合進主產品後在低階機器上發現 compositing 成本太高，最先合併的對象：

- L7 Visual overlays + L8 Interactive handles 合併（兩者都是繪製中才有內容，可共存）。
- L3 Structural 跟 L4 Trays 合併（Trays 編輯頻率不算高）。

### 5.2 z-order 變動

拆完後須確認以下視覺意圖維持：

- Cable drop leg 末端 vs AP body —— 看 L5 在 L6 之上還是之下決定誰蓋誰。
- Tray vertex handles vs AP / SW —— L8 必須在 L6 之上才能維持「選 tray 時 handles 不被裝置遮住」的現有行為（`CableTrayLayer.jsx` overlay 模式的設計意圖）。
- Marquee Rect 在所有可選物件之上 —— L7 在 L6 之上（已滿足）。

### 5.3 FloorImage listening 切換

預設 `listening=false` 後，以下動作需要 Stage onClick 接管：

- 點空白處取消選取（目前透過點 FloorImageLayer 的 Rect 觸發）。
- 點空白處關閉 context menu。

切到 `ALIGN_FLOOR` mode 時要把 listening 改回 true（拖曳對齊功能需要事件）。

### 5.4 imperative 路徑

Marquee 從獨立層併入 L7 後，現有的 `marqueeNodeRef.current.batchDraw()` 路徑要改成指向 L7 的 layer ref。L7 上有其他 React 管理的節點（badge / unroutable）時，imperative batchDraw 只 repaint canvas，不會跑 React reconcile，所以安全。但若未來加入 hover-driven 的 L7 元素（如 hover 顯示距離標尺），marquee 同時拖會雙倍 repaint，那時把 marquee 拆回獨立層。

---

## 6. 驗收標準

實作完 step 1 + 2 後：

- [ ] SW + Tray + 50AP 場景下，拖 AP 流暢（目測 ≥ 30 fps）
- [ ] SW + Tray + 50AP 場景下，拖 Switch 流暢
- [ ] SW + Tray + 50AP 場景下，拖 Tray body 流暢
- [ ] SW + Tray + 50AP 場景下，拖 Tray vertex 流暢
- [ ] 拖曳結束後 cable 線正確 snap 到新位置（commit 行為不變）
- [ ] 既有的 AP / SW dragOverlay 行為不變
- [ ] 框選、繪製 tray、繪製 wall 等操作流程不受影響

實作完 step 3–5 後額外：

- [ ] 同樣 50AP 場景下拖 Wall / Scope 不受 cable / device 數量影響
- [ ] 切 mode（DRAW_WALL / PLACE_AP 等）視覺上無 glitch

---

## 7. 對應的程式碼變更點

| step | 主要檔案 |
|---|---|
| 1 | `src/features/editor/Editor2D.jsx`（行 1710–1947 拆 Layer） |
| 2 | `src/features/editor/layers/CableTrayLayer.jsx`（onTranslate / onVertexDragMove）<br>`src/store/useDragOverlayStore.js`（新增 tray / trayVertex slot） |
| 3 | `src/features/editor/Editor2D.jsx`（Layer 拆三） |
| 4 | `src/features/editor/Editor2D.jsx`（再拆 visual / interactive）<br>各 Layer 元件內視覺 vs handle 分離 |
| 5 | `src/features/editor/layers/FloorImageLayer.jsx`（listening 預設 false）<br>`src/features/editor/Editor2D.jsx`（Stage onClick 接 deselect） |
