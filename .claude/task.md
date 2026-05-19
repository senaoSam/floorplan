# Floorplan Planner — 任務進度

> 設計依據：`.claude/cable-spec.md`
> Progress panel 同步：`src/components/ProgressPanel/ProgressPanel.jsx`

---

## Phase 7 — 網路基礎設施（Cable）

### Layer 11 — Switch & 邏輯連線（base layer）

| #    | 狀態 | Task                                                                                       |
| ---- | ---- | ------------------------------------------------------------------------------------------ |
| 11-1 | ✅   | Switch / IDF / MDF 放置與屬性面板（port 數、PoE budget、kind）                              |
| 11-2 | ✅   | AP↔Switch 預設 Manhattan 連線（+20% slack + Z_drop，same-floor 限制；無 switch → unroutable）|
| 11-3 | ✅   | PoE 預算 + port 容量 over-capacity warning（不進 routing）                                  |

**11-1 細節**
- 新增 `useCableStore` 的 `switchesByFloor`（或拆 `useSwitchStore`）
- Endpoint 統一介面：`{ id, floorId, x, y, mountHeight, kind }`，kind ∈ `switch | idf | mdf | router`
- 屬性面板：`model`、`portCount`、`poeBudget`、`kind`
- SwitchLayer（Konva）：在 APLayer 下、CableTrayLayer 上

**11-2 細節**
- 對每個 AP 找 `sameFloorSwitches`
- 線長：`(|Δx| + |Δy|) × metersPerPx × 1.20 + Z_drop(AP)`
- `Z_drop(AP) = ceiling_height - AP.mountHeight`（不加 slack）
- 同樓層沒 switch → `routeStatus = 'unroutable'`（紅色驚嘆號）
- CableLayer（新增）：實線/虛線/紅色三態

**11-3 細節**
- 每個 switch：`sum(connected_AP.poeWattage)` vs `poeBudget`
- 每個 switch：`count(connected_AP)` vs `portCount`
- 超標：屬性面板顯示 warning，但不影響 routing 結果

---

### Layer 12 — Cable Tray / Riser

| #     | 狀態 | Task                                                                                                              |
| ----- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| 12-1  | ✅   | Cable Tray polyline 繪製 + magnet 半徑視覺化                                                                       |
| 12-2a | ✅   | Graph builder Steps 1-7（endpoint snap 只挑最近 tray + tray intersection + chainage sort）                          |
| 12-2b | ✅   | Stage 3 routing（Dijkstra + connected component + same-floor fallback + unroutable 標記）                          |
| 12-2c | ✅   | 線長計算（chainage-based）+ CableLayer 渲染（tray / fallback / unroutable 三態）                                    |
| 12-2d | ✅   | Tray 端點 exact-coincidence merge（同 xy 視為共用 nodeId，不走 epsilon）                                            |
| 12-3a | ✅   | Cable Riser 點 + magnet（跨樓層共用 xy + floorIds）                                                                |
| 12-3b | ✅   | Riser graph 整合（Steps 6/9/10：snap 多 tray + 相鄰樓層垂直邊）                                                     |
| 12-4  | ⏸️   | **延後**：Hybrid routing（走一段 tray 再 Manhattan 收尾）。理由：需要 multi-source Dijkstra + virtual Manhattan edge，圖會炸；MVP 嚴格版 fallback 全 Manhattan |

**12-1 細節**
- DRAW_CABLE_TRAY editor mode（類似 DRAW_WALL）
- Tray 資料：`{ id, points: [{x,y}], magnetDistance: 100 }`
- 渲染：tray polyline 實線 + magnet 範圍半透明圓形/膠囊狀
- 編輯模式才顯示 magnet，瀏覽模式可選擇是否顯示

**12-2a 細節**（spec.md §5 Steps 1-7）
- Step 1：所有 endpoint → graph node
- Step 2：所有 riser@floor → graph node（12-3a 後生效）
- Step 3：每條 tray 的 vertices → anchors
- Step 4：tray-tray segment intersection → 共用 cross node（**只有幾何相交才共用**；共線重疊只 warning）
- Step 5：endpoint snap **只挑最近一條 tray**（否則 endpoint 變隱形 bridge）
- Step 6：riser snap **可接所有 magnet 內 tray**（riser 是 hub）
- Step 7：每條 tray 的 anchors 依 **chainage** 排序，相鄰切邊；weight 用 `abs(B.chain - A.chain)`，**不用 euclidean**

**12-2b 細節**（spec.md §6）
- Union-find 算 connected components
- Graph 內可達 switch → Dijkstra 找最短
- 不可達 → fallback Manhattan（限 same floor）
- 同樓層也無 switch → `unroutable`

**12-2c 細節**
- 路由結果存 `AP.route`（virtual，每次 store 變動重算）
- CableLayer 三態：
  - `tray` 實線、預設色
  - `fallback-manhattan` 虛線、淡灰
  - `unroutable` 紅色驚嘆號 icon + tooltip

**12-2d 細節**
- 補 spec §10 盲點：「兩條 tray 端點 xy 完全相同」現在會被當成獨立節點，graph 不通
- buildGraph.js Step 3：建立 tray-vertex 時用 `(x,y)` 為 key 查既有 vertex node，若有就 reuse nodeId（嚴格 `===`，**不走 epsilon**）
- 配合 CableTrayLayer 已有的 snap UI（綠色 halo），使用者「故意 snap 到既有 vertex」就會自動連通
- 保留 spec 的「approximate touching 不 merge」原則（差 3 px 還是分離，避免 topology 脆弱）

**12-3a 細節**
- Riser 全域：`{ id, x, y, floorIds: [...], magnetDistance }`
- 跨樓層共用 xy
- 視覺：3D 模式下顯示垂直連桿（依 floor.elevation）

**12-3b 細節**（spec.md §5 Steps 6/9/10）
- Step 6：對每個 `riser@floor` 找該樓層所有 magnet 內 tray，**全部加 foot**
- Step 9：riser@floor ↔ tray foot drop edge（slackDirect）
- Step 10：**只連相鄰樓層**的 riser node（依 floor.elevation 排序，相鄰 i, i+1）；weight = `dz × (1 + slackRiserVertical)`，dz 直接是 meters

---

## 不對稱規則 cheat sheet（spec.md §4）

| 物件類型                       | magnet 範圍內有多條 tray 時 |
| ------------------------------ | ---------------------------- |
| endpoint（AP/Switch/Camera...）| **只接最近一條**             |
| Riser                          | **接所有 magnet 內 tray**    |
| Tray-tray                      | **只在幾何相交時共用 nodeId**|

---

## Slack 表（spec.md §7）

| Edge 類型             | Slack                            |
| --------------------- | -------------------------------- |
| tray edge             | `slackTray = 0.10`               |
| endpoint → tray foot  | `slackDirect = 0.20`             |
| riser → tray foot     | `slackDirect = 0.20`             |
| riser vertical        | `slackRiserVertical = 0.00 ~ 0.05` |
| fallback Manhattan    | `slackDirect = 0.20`             |

AP 終點 Z drop = `(ceiling_height - AP.mountHeight)` × 1.0（無 slack）

---

## Phase 8 — Cable Summary & QA

> Cable 規劃工具的「結果頁」。12-3b 之後 routing 完整可用，但缺一個全局視圖
> 把 routing 結果彙整成 BOM + 暴露 graph builder 已產出的 warnings 給使用者看。

### Layer 13 — Cable Summary / Warnings

| #     | 狀態 | Task                                                                              |
| ----- | ---- | --------------------------------------------------------------------------------- |
| 13-1  | ✅   | CableSummaryPanel — 全建築 BOM（總線長、per-floor、per-routeStatus、unroutable 列表） |
| 13-2  | ✅   | Warnings 顯示 — buildGraph 已產生的 warnings（tray touching、共線重疊）顯示給使用者     |
| 13-3  | ✅   | DemoLoader cable 範例 — 既有 demo 加上 switch + tray + riser 種子資料                  |

**13-1 細節**
- 浮動 panel（類似 LayerToggle / HeatmapControl）放在畫布左下
- 內容：
  - 總線長（公尺）— 全建築總和
  - Per-floor 列表：該樓層線長、AP 數
  - Per-routeStatus 計數：via tray / fallback-manhattan / unroutable
  - Unroutable AP 列表（顯示 AP 名 + 樓層；點擊可跳到該 AP）
- 資料來源：computeRoutes 一次得到所有 route，前端聚合
- 對應 spec §8 Stage 4 — Cost & Render

**13-2 細節**
- buildGraph / buildBuildingGraph 已有 warnings: string[]，但目前無處顯示
- 把 warnings 顯示在 CableSummaryPanel（或獨立區塊）
- 至少包含：tray-tray endpoint touching、共線重疊
- 視覺：warning 圖示 + 訊息列表

**13-3 細節**
- 既有 DemoLoader 只放 5 個 AP + 牆面 + 平面圖
- 加上：1–2 個 switch、1–2 條 tray（範例形狀）、可選 riser（若新增第二樓層 demo）
- 讓使用者一鍵看到完整 cable 系統運作，不用自己手動放
