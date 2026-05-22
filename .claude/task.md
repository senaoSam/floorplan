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

---

## Phase 10 — Cable 進階：S2S / BOM 分類 / 3D

> 把 cable 從「能算 AP→switch 線長」推進到「能算整棟網路 + 拿來訂料 + 3D 視覺化」。
> 對應 cable-spec.md §10「延後項目」。

### Layer 14 — Switch-to-switch + BOM 分類

| #     | 狀態 | Task                                                                              |
| ----- | ---- | --------------------------------------------------------------------------------- |
| 14-1  | ✅   | Switch uplink 屬性 + UI（指定上層 switch / IDF / MDF target、線材偏好）             |
| 14-2  | ✅   | Switch-to-switch routing（用既有 tray/riser graph 算 S2S 線，新 render layer）       |
| 14-3  | ✅   | BOM 分類顯示（AP-link vs S2S、copper vs fiber、長度級距 <30/30-90/>90m）            |

**14-1 細節**
- Switch model 增加 `uplinkTo: switchId | null`（null = 頂層，不上連）
- Switch model 增加 `cableType: 'auto' | 'copper' | 'fiber'`（auto = 依距離自動決定）
- SwitchPanel UI：下拉選擇 uplink target（列出建築裡所有其他 switch）+ cable type 選擇
- 預設規則：'switch' → 找最近的 'idf'，'idf' → 找最近的 'mdf'，'mdf' → null（頂層）

**14-2 細節**
- 對每個有 `uplinkTo` 的 switch，用 `buildBuildingGraph` 跑 Dijkstra（source = 該 switch 的 endpoint node、target = uplinkTo 的 endpoint node）
- 找不到路 → fallback Manhattan（限同樓層）；同樓層不在也 → unroutable
- 新增 SwitchLinkLayer（或合併進 CableLayer）渲染 S2S 線
- 視覺：實線、不同顏色（例如紫或深青）區分 AP-link 線

**14-3 細節**
- CableSummaryPanel 加 BOM 分類 section：
  - AP-to-Switch 總長 / Switch-to-Switch 總長
  - Copper 總長 / Fiber 總長（>90m 自動 fiber，可被 cableType 覆寫）
  - 長度級距：<30m / 30-90m / >90m 各幾條
- per-IDF 用量列表（可選）

### Layer 15 — 3D Cable 視覺化

| #     | 狀態 | Task                                                                              |
| ----- | ---- | --------------------------------------------------------------------------------- |
| 15-1  | ✅   | Tray 3D 渲染（沿 polyline 在天花板高度畫長方體 / cylinder）                          |
| 15-2  | ✅   | Cable 3D 渲染（AP↔SW / S2S 路徑在 3D；對齊 2D 的虛線/實線/dash 樣式）                |
| 15-3  | ✅   | Switch / IDF / MDF / Router 3D chassis（深灰本體 + 前面板 kind 色 LED 條）            |

**15-1 細節**
- 每條 tray 的 polyline 沿 ceiling height (`floor.elevation + floor.floorHeight - 0.1`) 渲染
- 視覺：藍色細長方體或 cylinder（半徑 5 cm），對應 2D tray 顏色
- 掛在 FloorStack 內（per-floor，不跨樓層）
- Riser 已有 3D 圓柱（12-3a 做了），不重複

---

## Phase 11 — Cable UX Polish

> 跑過幾輪 demo 後發現 tray 單線跟其他線視覺易混淆、selection 沒帶 routing 上下文。

### Layer 17 — Cable 視覺 + 選取上下文

| #     | 狀態 | Task                                                                              |
| ----- | ---- | --------------------------------------------------------------------------------- |
| 17-1  | ✅   | Tray 通道風格視覺（border + 虛線中線 + 半透明 body）                                 |
| 17-2  | ✅   | 選取裝置 highlight 連線 + device halo（點 AP → cable + dest switch；點 SW → 所有 cable + AP + S2S peer）|
| 17-3  | ✅   | Switch 視為 hub（spec §4 例外）：snap 到 magnet 內所有 tray，不再只挑最近               |
| 17-4  | ✅   | Switch snap 視覺提示（chassis 角落狀態 dot + 未連到 warning + 已 snap 顯示 foot drop）  |

**17-1 細節**
- 既有：tray 是單一一條粗線（2.4px），跟其他線（cable、wall）視覺易混
- 新：把 tray 渲染成「通道」的樣子
  - 兩條 perpendicular-offset 出來的平行 border 線（實線）
  - 中間虛線中線
  - 兩 border 之間的封閉區域用半透明 body 色填
- 寬度視覺上 ~6 px（canvas px 隨 viewport scale 換算）

**17-2 細節**
- CableLayer 讀 selectedId / selectedType
- 選 AP：highlight 該 AP 的 route（cable + 目標 switch 的位置）；其他 cable 變淡（opacity 0.2）
- 選 Switch：highlight 所有 route.switchId === selectedId 的線 + 所有 S2S link 含該 switch 的線；其他線變淡
- 沒選任何裝置：全部正常 opacity

**17-3 細節**
- 原 spec §4「endpoint 只接最近一條」對 switch 來說反直觀 — switch 物理上本來就是多 port hub
- 改 buildGraph Step 5：switch 跟 riser 一樣，snap 到 magnet 內**所有** tray
- 影響：
  - 兩條平行 tray 中間放一個 SW 可以同時做 hub 連通兩條
  - AP 在 magnet 內仍然只接最近一條（AP 概念上是單一終端）
  - 同步更新 cable-spec.md §4 反映新規則

---

## Design Principles（2026-05-20 review 後修正，後續 phase 都遵守）

| 主題 | 原則 |
|---|---|
| **3D = read-only** | Z 軸屬性（mountHeight、kind…）一律在 **2D panel 編輯**；3D 只負責高度視覺化，不開放 3D 拖曳/畫線 |
| **Capacity rule** | tray fill 用 `capacityProfile`（25% planning / 40% warning / custom），**不**寫死「NEC 40%」 |
| **Color legend** | tray 顏色用 **owner / company / discipline standard**，不綁地區法規 |
| **垂直走線只用 Riser** | 跨樓層 / 同樓層垂直需求都靠 Riser 涵蓋；不另外做 vertical tray / conduit 物件（評估後撤回 21-1，理由：Hamina 沒有此物件、實作後 AP/SW 不 snap、dz 不進 BOM，無實際 routing 價值）|
| **BOM = Planning BOM** | 我們算的是 planning estimate（tray 長、彎頭、AP cable），**不是施工 final BOM**（缺廠牌、吊桿、餘料、現場裁切） |
| **Warning ≠ Code violation** | 容量提示寫「exceeds selected fill rule」，不寫「code violation」，除非未來真的整合 Article 392 / TIA-569 / local code profile |

---

## Phase 12 — Tray 編輯能力（P0）

> 目標：tray 不用刪掉重畫，可以反覆 iterate
> Reviewer feedback：「不做這層，系統會從『設計工具』退化成『示意圖工具』」

### Layer 18 — Tray Edit

| #     | 狀態 | Task                                                                              |
| ----- | ---- | --------------------------------------------------------------------------------- |
| 18-1  | ✅   | Vertex edit — 選中 tray 顯示 handles，可拖曳 / 插入 / 刪除 / 從端點延伸 / split segment |
| 18-2  | ✅   | 整條 tray drag 搬位置（保留 vertex 結構、更新 magnet / graph / cable route）           |
| 18-3  | ✅   | Drawing UX — Backspace / Cmd+Z undo last vertex；Shift 鎖 0/45/90°；Enter 完成        |
| 18-4  | ✅   | Tray naming — auto `TRAY-{floor}-{system}-{seq}`、可手動覆寫；warning 顯示用 name 取代 id |
| 18-5  | ✅   | Selected 顯示 vertex handles + segment + 可 snap 的 endpoint                          |

---

## Phase 13 — Tray 工程屬性與診斷

### Layer 19 — Tray Engineering

| #     | 狀態 | Task                                                                              |
| ----- | ---- | --------------------------------------------------------------------------------- |
| 19-1  | ✅   | Tray kind（ladder / wire basket / solid / conduit / PVC）+ width × depth + material   |
| 19-2  | ✅   | mountHeight per-tray（2D 編輯，3D 視覺跟著；presets: ceiling / wall / under raised floor / custom）|
| 19-3  | ✅   | System 屬性（Data / Power / Fire / Backbone / Mixed）+ owner color legend            |
| 19-4  | ✅   | capacityProfile + per-tray fill ratio 計算 + 三段 warning（OK / 注意 / 滿載 / 超出）   |
| 19-5  | ✅   | CableTrayPanel 升級為 health panel（Identity / Load / Path / Issues 四段）             |

---

## Phase 14 — Planning BOM + 施工前檢查

### Layer 20 — Planning BOM

| #     | 狀態 | Task                                                                              |
| ----- | ---- | --------------------------------------------------------------------------------- |
| 20-1  | ✅   | Tray Planning BOM — 總長、彎頭/T 接數、跨接位置、餘料係數（明確標 Planning，非 final BOM） |
| 20-2  | ✅   | Per-tray AP/cable 列表 + 容量瓶頸列表                                                 |
| 20-3  | ✅   | Drawing snap 增強 — snap to wall / parallel wall / angle lock                       |
| 20-4  | ✅   | Right-click context menu — rename / split / extend / merge / convert / delete |

---

## Phase 15 — 進階拓撲

### Layer 21 — Advanced Topology

| #     | 狀態 | Task                                                                              |
| ----- | ---- | --------------------------------------------------------------------------------- |
| 21-2  | ⬜   | Zone box / consolidation point — trunk → zone → short drop 拓撲                      |
| 21-3  | ⬜   | Routing 支援 zone box（home-run vs via zone box 兩種路徑可選） + capacity warning   |

> 21-1 Vertical tray / conduit 已撤回 — Hamina 並無此物件、Riser 已涵蓋跨樓層垂直走線需求；conduit 純當「同樓層垂直 pathway」實作後沒有實際 routing 價值（AP/SW 不 snap、dz 不進 BOM），決定不做。

---

## Phase 16 — CAD Handoff

### Layer 22 — Export

| #     | 狀態 | Task                                                                              |
| ----- | ---- | --------------------------------------------------------------------------------- |
| 22-1  | ⬜   | CSV Planning BOM export（per-AP cable / tray length / fill ratio）                  |
| 22-2  | ⬜   | PDF report（平面圖 + 統計表 + warnings）                                              |
| 22-3  | ⬜   | SVG / PNG plan view export                                                          |
| 22-4  | ⬜   | DXF export（DWG 視需求再評估）                                                       |

---

## Phase 17 — Mode Interaction Cleanup（UX 紀律）

> Reviewer pain：「不同 mode 卻有多種可操作混合，大鍋炒」
> 例：tray mode 下 hover 牆還是會跑出端點 handle + X delete badge，因為 WallLayer 只擋 `isDoorWindowMode`，其他 N 個繪製模式各自漏掉。
> 每個 Layer 用一堆 ad-hoc `if (isXMode)` 各自決定 hover / drag / handle / X / cursor，沒有單一真實來源。
> 目標：把「每個 mode 允許什麼互動」變成 spec 級的規範，再讓 Layer 從同一來源讀。

### Layer 23 — Mode capability matrix + 左右鍵分工

> 設計依據：`.claude/mode-matrix.md`
> 核心 UX 規則：**左鍵 = 操作物件本身（select / drag / 落點）**；**右鍵 = 對物件下指令（開 context menu）**；**hover = 純視覺 affordance，不顯示動作按鈕**

| #     | 狀態 | Task                                                                                       |
| ----- | ---- | ------------------------------------------------------------------------------------------ |
| 23-1  | ✅   | Audit + 文件化（`.claude/mode-matrix.md`）：14 mode × 9 互動表面矩陣 + 8 個 gap                |
| 23-2a | ✅   | Data 補洞：Wall / Scope / FloorHole 加 `name` 欄位 + auto-naming（`WALL-{floor}-{seq}` 等），補齊 right-click menu 第一條「重新命名」需要 |
| 23-2b | ✅   | `src/features/editor/modeCapabilities.js`：`getModeCapability(mode)` 回傳 9 flag — `allowSelectClick / allowSelectHover / allowDragExisting / showHandles / showMagnet / cursor / allowContextMenu / dimOthers`（已移除 `showQuickDelete`，刪除動作改進 context menu）|
| 23-2c | ✅   | `useEditorStore.contextMenu` slice：`{ targetType, targetId, screenX, screenY } \| null` + `openContextMenu / closeContextMenu` |
| 23-2d | ✅   | 共用 `<ObjectContextMenu>` 框架：對齊 `TrayContextMenu.jsx` 樣式（HTML overlay、inline rename、子選單、外部 click / Esc / 切樓層 / 換 mode 自動關），吃 `items: [{ label, icon?, disabled?, onClick, submenu? }]` |
| 23-3a | ✅   | Refactor 8 Layer：拔掉散落 `isXMode`；改 consult `getModeCapability(mode)`；移除 hover `<DeleteButton>`；hover cursor 覆蓋只在 `allowDragExisting \|\| allowSelectClick` 為真時觸發 |
| 23-3b | ✅   | Editor2D `onContextMenu` dispatcher：draft active → cancel；可開選單時 → `openContextMenu(...)`，**不動 selection**；其他 → no-op |
| 23-3c | ✅   | 七個物件 context menu items（最小版：重新命名 + 刪除）：Wall / AP / Switch / Riser / Scope / FloorHole / FloorImage |
| 23-3d | ✅   | Playwright MCP 真實滑鼠驗證：7 物件 × right-click → 選單正確開；非 SELECT mode → 不開選單；全 mode hover → 0 DeleteButton；end-to-end rename / delete 動作正常 |
| 23-3e | ✅   | 左右鍵完全分離：右鍵 dispatcher 拿掉 `setSelected(...)`；menu `onDelete` 只在「被刪物件 = 當前選取」時才 `clearSelected()`；Tray 的 `onSplit` / `onDelete` 同步調整 |

**為什麼分這麼細**
- 23-2 全部是抽象層 / 共用基礎建設，先一次到位
- 23-3a / 23-3b / 23-3c 各 Layer 改動範圍清楚分群，方便逐步 review
- 23-3d 用 MCP 滑鼠事件驗證（不單純 store 注入），確認左右鍵分工真的落地

**Capability flag 對照表（給 23-2b 用）**

| flag | SELECT | DOOR_WINDOW | DRAW_CABLE_TRAY | 其他 draw / place | PAN / MARQUEE / ALIGN |
|---|---|---|---|---|---|
| allowSelectClick | ✓ | wall only（pick host） | – | – | – |
| allowSelectHover | ✓ | wall only | tray/cable snap-only | – | – |
| allowDragExisting | ✓ | – | – | – | – |
| showHandles | ✓ | – | – | – | – |
| showMagnet | selected/hover only | n/a | all trays | PLACE_SWITCH: all trays; PLACE_RISER: all risers | – |
| allowContextMenu | ✓ | – | – | – | – |
| dimOthers | – | non-wall dim | non-cable dim | dim non-target type | – |

**Open question 已決（依 mode-matrix.md §7 推論）**
- Q1 MARQUEE 點物件 = no-op（drag 才框選）
- Q2 ALIGN_FLOOR 不允許物件互動
- Q3 CROP_IMAGE 不允許物件互動
- Q4 DRAW_CABLE_TRAY 下 hover switch/riser 不顯示 snap halo（維持現狀）
- Q5 dimOthers 對非目標類型 opacity 0.4

---

## Phase 18 — UI/UX 釐清與分群

> Reviewer pain：「功能版面偏陽春，沒有 domain 分群」
> 例：Switch / Cable Tray / Riser 概念上同一個 group（網路布線），但 toolbar 並排在牆/AP 之間；牆 / 門窗 / 中庭也是結構類，分散擺。
> Right panel 每個 type 自己長一套，feature 漂移嚴重（同樣是「健康狀態」section，CableTrayPanel vs SwitchPanel 表現不一致）。
> 目標：把功能依 domain 分群，視覺層級先講清楚，再把 panel 框架共用化。

### Layer 24 — Function grouping & panel scaffold

| #    | 狀態 | Task                                                                                       |
| ---- | ---- | ------------------------------------------------------------------------------------------ |
| 24-1 | ✅   | Group 分類定案（7 群實作版：操作 / 結構 / 無線 / 網路布線 / 標註 / 編輯 / 輔助），詳見 commit 訊息 |
| 24-2 | ✅   | Toolbar 重新佈局：搬到畫布上方中央的浮動 panel、icon-only（SVG，無 emoji）、群之間細直線 separator、hover 顯示中文 tooltip（透過 React portal 避開 transform containing block） |
| 24-3 | ⬜   | Right panel 框架共用化：同 group 共用容器 + 標準 section 骨架（Identity / Geometry / Properties / Health / Issues） |
| 24-4 | ⬜   | Active mode 視覺指示：canvas 頂部 mode badge（例 "🔌 網路布線 / 線槽繪製"），減少使用者迷失       |
| 24-5 | ⬜   | Color / icon legend 一張表整理（每 group 主色 + sub-type 變化），確保 toolbar / panel / canvas 三處用色一致 |

**24-1 Group 對照表**

物件群（畫布上有實體 → 跟著 right panel）

| Group | 成員 | 備註 |
|---|---|---|
| **結構** | Wall / Door+Window / FloorHole / FloorImage | 建物本體 |
| **無線規劃** | AP / Scope | Scope 是 RF heatmap 評估區，跟 AP 一起 |
| **網路布線** | Switch / Cable Tray / Riser / *(未來: Cable Path edit)* | 有線基礎建設 |
| **標註與測量** | Scale / *(未來: Dimension / Note / Text)* | 目前單薄但會擴 |

功能群（操作 / 顯示 / 分析 → toolbar / sidebar / overlay）

| Group | 成員 | 擺放建議 |
|---|---|---|
| **操作工具** | Select / Marquee / Pan | Toolbar 最左（mode-agnostic） |
| **編輯動作** | Undo / Redo / Batch delete | Toolbar 右側或 floating |
| **檢視** | 2D/3D switch / LayerToggle / 全樓層 toggle | Toolbar 右 + 浮動 panel |
| **分析輸出** | HeatmapControl / CableSummary / DevicePlanning（auto 頻道/功率）/ *(未來: CSV/PDF/DXF export)* | Canvas 浮動 panel（左下/右下） |
| **樓層管理** | SidebarLeft floor list / 新增樓層 / Crop / AlignFloor | Sidebar 左 |
| **輔助/Dev** | AI 牆 / DemoLoader / StressLoader / RegulatorySelector | Toolbar 末端 + canvas 角落 |

**邊界判定**
- Crop → 樓層管理（對象是 floor，不是物件）
- AlignFloor → 樓層管理（floor-level meta）
- Scope → 無線規劃（驅動 RF 計算，不是純標註）
- AI 牆 → 輔助/Dev（行為是匯入/自動辨識，不直接放在「結構」群）

**先後**
- 24-1 是設計決策（要先跟使用者敲定分群），其他步驟才動 code
- 24-2 / 24-3 可平行
- 24-4 / 24-5 是 polish，最後做

---

## 既有延後項目歸位

| ID | 狀態 | 原因 |
|---|---|---|
| 12-4 Hybrid routing | ⏸️ | 17-3 switch hub 落地後痛點變少，繼續延後 |
| 15-2 Cable 3D polylines | ✅ | 19-2 把 tray 高度做成 per-tray 後順手補完；對齊 2D 樣式（虛實線）+ 新加 15-3 SwitchLayer3D |
| 17-4 Snap 視覺提示 | ✅ | 20-1 期間實際出現「snap 但無 AP 流量」與「未 snap」視覺不可分的痛點，補完 |
