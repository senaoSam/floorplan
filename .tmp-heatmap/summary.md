# NPv1 wasm + index.js 補充分析

## 1. 2D vs 3D 計算

### 結論：**2D 核心計算 + 3D 可視化層**

NPv1 不執行 3D RF 計算或體素化射線追蹤。所有 heatmap 計算都是 2D grid（所有點固定在 clientHeightMeters 平面）。

#### 1.1 視覺化層面的 3D

**證據**：
- index.js：enable3D 4 次、is3D 2 次、raisedHeatmap 3 次、raisedFloor 4 次
- 07-graphql-schema.md：HeatmapSettings.raisedHeatmap: Boolean（第 199 行）
- 04-heatmap-pipeline.md：raisedHeatmap 說明（第 196-205 行）

當 raisedHeatmap = true：heatmap 從 2D 平面「拉」成 3D 曲面（視覺效果），曲面高度代表 RSSI 強度。純渲染差異。

UI 狀態：buildingViewMode（推測 "2d"|"3d"），enable3D 參數（視圖切換，未直接用於 RF 計算）

#### 1.2 建築 3D 結構

NPv1 儲存的 3D 樓層資訊（但不用於 heatmap 計算）：
- Wall.topEdge/bottomEdge（高度範圍）
- AttenuatingZone.topAltitude/bottomAltitude
- RaisedFloorZone、SlopedFloor、HoleInFloorZone（特殊 3D 區域）
- floorHeight、floorThickness、floorAttenuation（樓層穿透衰減）

#### 1.3 跨樓層計算

HeatmapSettings.fullBuildingPropagation 啟用時，跨樓層信號仍是 2D 投影，只是路徑跨越樓層時額外加 floorAttenuation 衰減。

**結論：無 3D RF 計算，只有 2D + 可視化層**

---

## 2. 非 Heatmap 物件（Walls / Zones / APs）

### 2.1 物件清單（11 大類）

| 物件 | 用途 | 編輯方式 | 3D 高度 |
|---|---|---|---|
| Wall | 擋牆、穿透損耗 | 線段：start/end 端點 | 是：topEdge/bottomEdge |
| WallType | 材料定義 | 全局類型庫 | 是 |
| AttenuatingZone | 區域內衰減 | 多邊形繪製 | 是：topAltitude/bottomAltitude |
| AttenuatingZoneType | 區域類型 | 全局類型庫 | 是 |
| AttenuatingField | 手繪連續衰減 | 自由多邊形 | 否（2D） |
| RaisedFloorZone | 抬高樓板 | 多邊形+高度 | 是：height |
| SlopedFloor | 斜坡、樓梯 | 多邊形+斜率 | 是：斜率三係數 |
| HoleInFloorZone | 樓層洞（天井） | 多邊形 | 否 |
| ScopeZone | Heatmap 邊界 | 多邊形 | 否 |
| CapacityZone | 客戶端密度區 | 多邊形 | 是 |
| AccessPoint | 基站、發射器 | 點：x/y+3 方向角 | 是：height+az/el/roll |

### 2.2 資料結構

**Wall**：
```graphql
type Wall {
  id: ID!
  start: { id, x, y }
  end: { id, x, y }
  materialId: ID!
}
```

**WallType**：attenuation@refFreq, width(m), topEdge/bottomEdge, iturModel_a/b/c/d, isConductor, color

**AttenuatingZone**：typeId, area(Polygon)

**RaisedFloorZone/SlopedFloor**：area, height/slope, attenuationDbPerM

### 2.3 操作互動

**推測的互動流程**：
1. 牆編輯：線段端點拖拉 → 可視化回饋 → 鬆開時 mutation → heatmap 即時重算
2. Zone 繪製：多邊形工具 → 頂點可調整 → 儲存
3. AP 移動：拖拉圓點 → 方向角可旋轉
4. 類型管理：WallType/ZoneType 在全局 library

**預期特性**：
- 吸附(snap)：牆端點吸附到 grid/相鄰牆（5~10cm）
- 對齐(align)：多面牆可對齐成直線
- 即時重算：拖拉時降低精度視窗化；放開後全域高精度（參考：08-implementation-guide.md 第 48 行）

### 2.4 樣式（顏色、粗細、圖示）

- Wall：直線條，顏色=type.color，粗細=type.width
- Zone：填充多邊形，顏色 semi-transparent
- AP：圓點（方向箭頭表示 azimuth/elevation）
- 高度表示：2D 文字註記，3D 視圖 Z 軸渲染

### 2.5 門窗與牆的關係

> **⚠️ 2026-04-19 更正**：本節原結論「NPv1 無 Door/Window」**不正確**。分析 wasm 二進位字串後發現 Door / Window 以 **WallType enum + 預設類型**形式存在，不是獨立物件類別但也不是「完全沒有」。詳見 `10-scene-objects-simplifications.md`。

**正確結論：Door / Window 是 WallType 的子分類，不是獨立物件類別**

**wasm 端證據（hamina.wasm 二進位 strings dump）**：
- `MlWallType` enum 值：`DEFAULT`, `DOOR`, `ELEVATOR`, …（ML / auto-detect 用的分類）
- `AutoWall` struct 的 enum 值：`DOOR`, `ELEVATOR`, `EXTERIOR`, `WINDOW`
- 預設 WallType 名稱字串：`door (wooden)`, `window (tinted)`（作為 material library 預設項目）
- API：`setAutoWalls(mapId, autoWalls)`（把 ML 自動辨識的牆型寫入）

**這是什麼意思？**
- 在**資料模型**上，門 / 窗 / 電梯 / 外牆 **都是 Wall**（線段 start/end + wallTypeId）
- 差別只在 `WallType` 指向哪一個預設項（wooden door ≠ tinted window ≠ concrete wall）
- 每個預設 WallType 有不同 ITU-R P.2040 參數（attenuation、a/b/c/d）
- 如果圖面是從 PDF / DWG 匯入，ML pipeline 會自動把偵測到的線段標為 DOOR / WINDOW / EXTERIOR，再讓使用者確認

**07-graphql-schema.md 為何沒看到？**
- GraphQL schema 只暴露到 `Wall` 與 `WallType`，enum 細節是 **wasm 內部的** ML 分類標籤，不在 public schema
- 所以原分析只看 index.js + GraphQL 會漏掉

**替代方案（沿用原段落）**：
1. 門窗位置用低損耗 WallType（預設即 `door (wooden)` / `window (tinted)`）
2. 不建模（穿透=空氣）
3. floorAttenuation 統一處理樓板/隔間衰減

**為何仍然「不獨立建模」?** 門窗衰減(2-5 dB@2.4G) 遠小於牆(20+ dB)；開/關狀態複雜；客戶端關注平均覆蓋。所以雖然**有** Door/Window WallType，但開關狀態、動態行為**仍然沒有**建模。

---

## 3. 00~09 文件補充建議

### 3.1 現有覆蓋範圍

全部 ✅ 完整：00-overview、01-DPM、02-materials、03-antenna、04-heatmap、05-channel、06-env-learning、07-schema、08-guide；09-evidence 完整但可擴展。

### 3.2 遺漏的主題 — ✅ 已於 2026-04-19 全部補上為 10~14 新檔

**Gap 1：Door/Window 物件說明** ✅ → `10-scene-objects-simplifications.md`
- 重新分析 wasm 證據後**更正**原結論：NPv1 有 DOOR/WINDOW enum（MlWallType / AutoWall），只是不是獨立物件類別

**Gap 2：UI 互動細節 (snap/drag/align/undo)** ✅ → `12-ui-interaction-workflow.md`
- 誠實標註證據強度（確定 vs 推測）

**Gap 3：HoleInFloor/RaisedFloor 幾何計算** ✅ → `11-cross-floor-propagation.md` §2.2
- 含 `getRayFloorIntersection`, `setEffectiveFloorHeight` 等 wasm API

**Gap 4：跨樓層信號計算** ✅ → `11-cross-floor-propagation.md` §3
- `fullBuildingPropagation` on/off 流程對照

**Gap 5：實測 Heatmap (Live Mode)** ✅ → `13-measured-heatmap-fusion.md`
- 三種 heatmap 並存（simulated / measured / live）、AP-to-AP 校正流程、Triangle grid、blending 實際上在「模型層」非像素層

**Gap 6：Performance Tuning** ✅ → `14-performance-tuning.md`
- 8 worker 分工、Viewport vs Static tile、Cancelable、多解析度、ThreadPool 為何不能用

### 3.3 可能需要更新的段落 — ✅ 已於 2026-04-19 全部套用

**08-implementation-guide.md** ✅
- 已於第 1 節後加「關於 3D 的常見誤解」提醒區塊，澄清 `enable3D` / `buildingViewMode` / `raisedHeatmap` 全屬渲染層開關
- 註：summary 原標「第 38 行」為誤判，08 檔並無 `enable3D` 字面關鍵字；修改實際落在第 1 節結尾

**07-graphql-schema.md** ✅
- `buildingViewMode: String` 行已加註解，指明 "2d"|"3d" 只影響 UI、不觸發 heatmap 重算

**04-heatmap-pipeline.md** ✅
- §6 `raisedHeatmap` 補「實現細節」子節，說明 grid 計算不變、僅 vertex shader 抬 z、效能成本 ≈ 0

**01-core-algorithm-dpm.md** ✅
- `visible_edges()` 旁加註解，說明為 2D 視線測試，`topEdge`/`bottomEdge` 不參與判定

**06-env-learning.md** ✅
- `sample_weight()` 範例前加警示區塊，明標 gaussian 參數與係數皆為推測（僅 `*Minus65*` / `*Minus90*` 字串為實證）

**05-channel-optimizer.md** ✅
- `channelWidthAuto*Fitness*` 常數下補「Threshold 預設值」段，建議 0.8 為起點、可調參

### 3.4 建議新增檔案 — ✅ 已於 2026-04-19 全部建立

| 檔名 | 內容摘要 | 狀態 |
|---|---|---|
| 10-scene-objects-simplifications.md | Door/Window 真實狀態（WallType enum）；修正 §2.5 原錯誤結論 | ✅ 已建立 |
| 11-cross-floor-propagation.md | 樓層穿透、特殊樓板幾何計算、`getRayFloorIntersection` | ✅ 已建立 |
| 12-ui-interaction-workflow.md | 編輯流程、snap/drag/align/undo、證據強度分級 | ✅ 已建立 |
| 13-measured-heatmap-fusion.md | Simulated / Measured / Live 三軌、AP-to-AP、Triangle grid | ✅ 已建立 |
| 14-performance-tuning.md | 8 worker、Tile 化、Cancelable、多解析度、效能基準 | ✅ 已建立 |

---

## 4. 核心發現總結

### 沒有的
- ⚠️ 3D RF 計算（無 voxel grid）——**但 `fastRayTracingEnabled` feature flag 預設 true**；詳見 [18-offscreen-canvas-worker.md §7](18-offscreen-canvas-worker.md)。原結論「完全沒有 ray tracing」不正確，應改為「有快速 ray tracing 但沒有體素化」
- ❌ Door/Window 獨立物件類別（**但有 WallType enum 與預設項 `door (wooden)` / `window (tinted)`**；詳見 §2.5 修訂）
- ❌ 門窗開 / 關狀態建模（enum 只是分類標籤，不含動態狀態）
- ❌ 動態 beamforming 仿真（只靜態方向圖）
- ❌ 多層同時 heatmap（跨樓層只是衰減附加）

### 實際有的
- ✅ 2D grid heatmap（clientHeight 平面）
- ✅ 8 種 heatmap 類型（RSSI/SNR/data rate/interference/uplink/channel util/coverage/debug）
- ✅ 11 種場景物件（wall/zone/floor/AP/etc）
- ✅ 3D 可視化（raisedHeatmap、建築預覽）
- ✅ 跨樓層穿透（floorAttenuation）
- ✅ ITU-R P.2040 頻率外推
- ✅ 頻道自動優化（DSATUR）
- ✅ Survey 反推校正（ML 三階段）

### 複現優先序
1. **M1~M2**（2 週）：直射 + 繞射 + 多 AP + Canvas heatmap
2. **M3~M6**（4 週）：ITU-R + Zone + Triangle grid
3. **M7~M8**（3 週）：頻道優化 + Survey learning
