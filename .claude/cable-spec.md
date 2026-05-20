# Cable Tray / Cable Riser — 設計規格

> 對應 Phase 7（網路基礎設施）/ Layer 11–12 的工作依據。
> 三輪設計討論收斂版本，2026-05-15。
> 參考來源：Hamina Network Planner 官方 docs（`docs.hamina.com/planner/simulation/switching-and-cabling` 等）。

---

## 1. 功能定位

Cable Tray / Cable Riser 是「**在 Switch+AP 邏輯連線之上疊加的物理走線層**」。

層級結構：

```
Layer A：純邏輯（Switch、IDF、MDF 放置；PoE 預算；port 數）
   ↓
Layer B：自動邏輯連線（AP→最近 Switch，預設 Manhattan 直角線，+20% slack）
   ↓
Layer C：Cable Tray / Riser（覆寫 Layer B：磁吸後改沿 tray 走、修正線長餘量）
   ↓
Layer D：Switch-to-Switch、BOM、redundancy 模擬
```

Cable Tray 不是「另一種 AP→Switch 連線方式」，而是**讓已存在的邏輯線改沿物理路徑走**。

---

## 2. 資料模型

### useCableStore（新建 Zustand store）

```js
{
  // Switch / IDF / MDF 等 endpoint（也可拆成 useSwitchStore）
  switchesByFloor: {
    [floorId]: [
      {
        id: 'sw_xxx',
        x, y,                    // canvas 座標（image px）
        model: 'POE-24-port',
        portCount: 24,
        poeBudget: 370,          // watts
        kind: 'switch' | 'idf' | 'mdf' | 'router',
      },
    ],
  },

  // Cable Tray（polyline，每樓層獨立）
  traysByFloor: {
    [floorId]: [
      {
        id: 'tray_xxx',
        points: [{x, y}, ...],   // 折線
        magnetDistance: 100,     // canvas px，吸附半徑
      },
    ],
  },

  // Cable Riser（跨樓層，全域）
  risers: [
    {
      id: 'riser_xxx',
      x, y,                      // 跨樓層共用 canvas 座標
      floorIds: [f1, f2, ...],   // 連接哪些樓層
      magnetDistance: 100,       // canvas px
    },
  ],

  // 全域 slack 參數（可設定）
  slackTray: 0.10,
  slackDirect: 0.20,
  slackRiserVertical: 0.00,      // 0% 或 5%
}
```

### Endpoint 定義

通用名詞，**所有「需要被連線」的設備**：

- AP（`useAPStore`）
- Switch / IDF / MDF / Router（`switchesByFloor`）
- 未來：IPCam、Gateway、IoT sensor、Desk phone

統一介面：`{ id, floorId, x, y, mountHeight }`。

---

## 3. 單位約定

所有 graph edge weight 一律用 **meters**。

- Canvas px → meters：用 `useFloorStore.floors[floorId].metersPerPx`（由 DRAW_SCALE 校正）
- Riser 垂直邊：用 `floor.elevation` 直接相減（已是 meters，不需換算）
- AP Z drop：用 `(ceiling_height - AP.mountHeight)`（meters，不加 slack）

---

## 4. Stage 1 — Snap（設備吸附到 tray）

對每個 endpoint P 找最近的 tray foot point。

**關鍵不對稱規則**（極重要，否則會 debug 到崩潰）：

| 物件類型 | magnet 範圍內有多條 tray 時 | 為什麼 |
|---|---|---|
| **AP / Camera / 單 port 終端** | **只接最近一條** | 否則 endpoint 變隱形 junction，把不該連的 tray 接起來 |
| **Switch / IDF / MDF / Router**（17-3 修正）| **接所有 magnet 內 tray** | switch 物理上就是多 port hub；同 riser 邏輯 |
| **Riser** | **接所有 magnet 內 tray segment** | 它本來就是 hub，多接是正確行為 |
| **Tray-tray** | **只在「幾何相交」時共用 nodeId** | 不能因為座標巧合 dedupe；共線重疊不自動合併（MVP 出 warning） |

> 17-3 修正記錄：原 MVP spec 把 switch 跟 AP 同等對待（「endpoint 只接最近」）。實際使用發現這對 switch 反直覺 — switch 物理上就是多 port hub，跨多條 tray 接線是它的正常工作模式。改成跟 riser 一樣 hub-style snap。

`closest_point_on_polyline(P, T)`：對 T 的每個 segment 算 perpendicular foot，foot 超出 segment 端點時 clamp，回傳全 polyline 最近的 foot + chainage。

---

## 5. Stage 2 — Build Graph（10 步驟）

```python
# ===== Step 1：建立所有 endpoint node =====
for each endpoint P:
    addNode({ kind: 'endpoint', floorId: P.floorId, xy: P.xy, ref: P })

# ===== Step 2：建立所有 riser@floor node =====
for each riser R:
    for each F in R.floorIds:
        addNode({ kind: 'riser@floor', floorId: F, xy: R.xy, ref: R })

# ===== Step 3：每條 tray 初始化 anchors（原始 vertices）=====
for each tray T:
    T.anchors = []
    for i, v in enumerate(T.points):
        nodeId = addNode({ kind: 'tray-vertex', xy: v })
        T.anchors.append({ chain: cumLen[i], nodeId, kind: 'vertex' })

# ===== Step 4：tray-tray intersection（只在幾何相交時共用 nodeId）=====
for each unordered pair (T, T') on same floor:
    for each segment-segment intersection X:
        crossNodeId = addNode({ kind: 'tray-cross', xy: X })
        T.anchors.append({ chain: chainage_on(T, X), nodeId: crossNodeId, kind: 'cross' })
        T'.anchors.append({ chain: chainage_on(T', X), nodeId: crossNodeId, kind: 'cross' })
    # 共線重疊 → 不自動合併，issue warning（MVP）

# ===== Step 5：endpoint snap — 只挑最近一條 tray =====
for each endpoint P:
    best = null
    for each tray T on P.floorId:
        foot, d = closest_point_on_polyline(P.xy, T)
        if d <= T.magnetDistance and (best is null or d < best.d):
            best = { tray: T, foot, d, chain }
    if best:
        footNodeId = addNode({ kind: 'endpoint-foot', xy: best.foot })
        best.tray.anchors.append({ chain: best.chain, nodeId: footNodeId, kind: 'endpoint-foot' })
        P.snapInfo = { footNodeId, dropPx: best.d }
    else:
        P.snapInfo = null   # 走 fallback

# ===== Step 6：riser snap — 接所有 magnet 範圍內的 tray segment =====
for each riser R, for each F in R.floorIds:
    R.floorSnaps[F] = []
    for each tray T on floor F:
        foot, d = closest_point_on_polyline(R.xy, T)
        if d <= R.magnetDistance:
            footNodeId = addNode({ kind: 'riser-foot', xy: foot })
            T.anchors.append({ chain, nodeId: footNodeId, kind: 'riser-foot' })
            R.floorSnaps[F].append({ footNodeId, dropPx: d })

# ===== Step 7：每條 tray anchors 依 chainage 排序、相鄰切邊 =====
for each tray T:
    T.anchors.sort(by chain)
    for i in 0 .. len(T.anchors) - 2:
        A, B = T.anchors[i], T.anchors[i+1]
        # 用 chainage 差，不要用 euclidean（防 dedupe 後算錯）
        weight_m = abs(B.chain - A.chain) × metersPerPx[T.floorId] × (1 + slackTray)
        addEdge(A.nodeId, B.nodeId, weight_m, kind: 'tray')

# ===== Step 8：endpoint drop edges =====
for each endpoint P with P.snapInfo:
    weight_m = P.snapInfo.dropPx × metersPerPx[P.floorId] × (1 + slackDirect)
    addEdge(P.nodeId, P.snapInfo.footNodeId, weight_m, kind: 'drop')

# ===== Step 9：riser drop edges =====
for each riser R, for each F:
    for each { footNodeId, dropPx } in R.floorSnaps[F]:
        weight_m = dropPx × metersPerPx[F] × (1 + slackDirect)
        addEdge(R@F.nodeId, footNodeId, weight_m, kind: 'riser-drop')

# ===== Step 10：riser vertical edges（只連相鄰樓層）=====
for each riser R:
    sortedFloors = sort(R.floorIds, by floor.elevation)
    for i in 0 .. len(sortedFloors) - 2:
        F1, F2 = sortedFloors[i], sortedFloors[i+1]
        dz_m = abs(F2.elevation - F1.elevation)
        weight_m = dz_m × (1 + slackRiserVertical)
        addEdge(R@F1.nodeId, R@F2.nodeId, weight_m, kind: 'riser-vertical')
```

---

## 6. Stage 3 — Route（每個 endpoint 找 switch）

**MVP 嚴格版**：不做 hybrid（走一段 tray、再 off-tray 收尾）。

```python
components = union_find(graph)

for each AP:
    sameFloorSwitches = switches.filter(s => s.floorId === AP.floorId)
    
    # 先嘗試 graph route（含跨樓層 riser）
    if AP in graph:
        reachableSwitches = [s for s in all switches if same_component(AP, s)]
        if reachableSwitches:
            dist, parent = dijkstra(AP)
            bestSwitch = argmin(dist[s] for s in reachableSwitches)
            AP.cable_m = dist[bestSwitch] + Z_drop(AP)
            AP.route = reconstruct_path(parent, AP, bestSwitch)
            AP.routeStatus = 'tray'
            continue
    
    # Fallback：嚴格限制同樓層
    if sameFloorSwitches.length === 0:
        AP.routeStatus = 'unroutable'   # UI 紅色標記
    else:
        bestSwitch = argmin(manhattan_m(AP, s) for s in sameFloorSwitches)
        AP.cable_m = ((|Δx| + |Δy|) × metersPerPx) × (1 + slackDirect) + Z_drop(AP)
        AP.route = L_shape(AP, bestSwitch)
        AP.routeStatus = 'fallback-manhattan'
```

---

## 7. Edge slack 表

| Edge 類型 | Slack | Z 處理 |
|---|---|---|
| tray edge | `slackTray = 0.10` | 無 |
| endpoint → tray foot (drop) | `slackDirect = 0.20` | 無 |
| riser → tray foot | `slackDirect = 0.20` | 無 |
| riser vertical | `slackRiserVertical = 0.00 ~ 0.05` | edge 本身就是 dz (m) |
| fallback Manhattan | `slackDirect = 0.20` | 終點加 `Z_drop(AP)` |

終點 AP 的 Z drop（純垂直，不加 slack）：`(ceiling_height - AP.mountHeight)`

對應 Hamina docs：
- tray-routed：`XY_path × 1.10 + Z`
- off-tray：`(|Δx|+|Δy|) × 1.20 + Z`

---

## 8. Stage 4 — Cost & Render

- **總線長**：`sum(AP.cable_m for all AP)`
- **PoE 預算**：每個 switch `sum(connected_AP.poeWattage)`，超 budget 顯示 warning（不進 routing）
- **Port 容量**：每個 switch `count(connected_AP)`，超 portCount 顯示 warning（不進 routing）
- **BOM**：分類 copper / fiber（依距離或 switch-to-switch 屬性），延後

---

## 9. 視覺化

### 新增 layer（Konva）

```
… 既有 layer …
ScopeLayer
WallLayer
CableTrayLayer    ← 磁吸範圍（半透明圓圈）+ tray polyline
SwitchLayer       ← Switch / IDF / MDF
APLayer
CableLayer        ← Stage 3 路由結果（virtual，每幀重算）
```

### 互動

- **編輯 tray 時**顯示 magnet 半徑圈圈（Hamina release notes 有提這個 bug，必做）
- **endpoint 被 snap 時**：畫一條短虛線從 endpoint 到 foot（drop leg）
- **拖曳 AP 經過 tray 範圍時**：即時 re-snap + cable preview 重畫
- **routeStatus 視覺**：
  - `tray`：實線、預設色
  - `fallback-manhattan`：虛線、淡灰
  - `unroutable`：紅色驚嘆號 + tooltip

---

## 10. MVP 範圍與延後項目

### MVP（Phase 11–12 完整實作）

- [x] 資料模型（store + endpoint 統一介面）
- [x] Stage 1–4 完整流程
- [x] 跨樓層 Riser
- [x] PoE / port 容量 warning（不進 routing）

### 延後（12.4 / 之後）

- **Hybrid routing**：走一段 tray、出 tray 後 Manhattan 收尾到 switch
- **Switch-to-switch cabling**：copper / fiber / SFP module BOM
- **Switch redundancy 模擬**：模擬 switch 斷線對 AP 的影響
- **Capacity-aware routing**：把 port / PoE 容量納入 pathfinding（會變成 constrained assignment problem）
- **共線重疊 tray 自動合併**：MVP 只 warning
- **Tray 端點距離很近但未相交**：MVP 不自動連通，要求使用者畫到相交

---

## 11. 邊界規則 cheat sheet

| 情境 | 行為 |
|---|---|
| AP 不在任何 tray 的 magnet 範圍 | Manhattan fallback（same floor only） |
| AP 同樓層沒有 switch 且 graph 也走不到 | `unroutable`（紅色標記） |
| AP 落在多條 tray magnet 範圍重疊 | 只接最近一條 |
| Riser 落在多條 tray magnet 範圍重疊 | 接所有 magnet 內 tray |
| 兩條 tray 端點距離 5px 但未相交 | **不**自動連通（topology 穩定性） |
| 兩條 tray 共線重疊一段 | Warning，不自動合併 |
| 兩條 tray 真實幾何相交 | 共用 cross node（兩條都 split） |
| Switch 自己也在 tray magnet 範圍 | Snap 進 graph（跟 AP 一樣） |
