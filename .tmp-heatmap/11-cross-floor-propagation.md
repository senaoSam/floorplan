# 11. 跨樓層信號傳播與樓層幾何

本文件整理 NPv1 如何處理多樓層 / 特殊樓板幾何（抬高、斜坡、洞）。
證據來自 `hamina.wasm` strings dump 與 `07-graphql-schema.md` 的 `HeatmapSettings`。

---

## 1. 兩個相關但不同的概念

| 概念 | 物件 / 設定 | 處理方式 |
|---|---|---|
| **樓板穿透** | `HeatmapSettings.floorAttenuation` + `Floor.floorThickness` | 射線跨越樓層時累加 dB |
| **樓板形狀** | `RaisedFloorZone` / `SlopedFloor` / `HoleInFloorZone` | 修改射線在特定區域的幾何 |
| **樓層啟用** | `HeatmapSettings.fullBuildingPropagation` | 開關跨樓層計算 |

關鍵：**不是 3D 射線追蹤**。所有計算都在 2D grid，只是「路徑穿越樓層」時加衰減。

---

## 2. 核心 wasm API

### 2.1 樓層基本屬性

```cpp
setFloorHeight(mapId, height)           // 單層淨高（m）
setFloorThickness(mapId, thickness)     // 樓板厚度（m）
setFloorIndex(mapId, index)             // 第幾層（整數）
setFloorAlignmentX(mapId, alignmentX)   // 多樓層對齊 X 偏移
setFloorAlignmentY(mapId, alignmentY)   // 多樓層對齊 Y 偏移
setEffectiveFloorHeight(mapId, ...)     // 考慮抬高 / 洞之後的有效高度
```

### 2.2 特殊幾何 Zone

```cpp
addRaisedFloorZone(...)     // 抬高區域（如舞台、閣樓平台）
appendRaisedFloorZone(...)
addSlopedFloorZone(...)     // 斜坡 / 樓梯（斜率三係數）
appendSlopedFloorZone(...)
setHoleInFloorZones(...)    // 樓板開洞（天井、中庭、挑高大廳）
holeInFloorZones             // getter
```

### 2.3 射線 vs 樓層查詢

```cpp
getRayFloorIntersection(mapID, rayStart, rayEnd)
    // 傳入 3D 射線，傳回與樓板的交點清單
    // 用於計算射線穿越幾層、經過幾塊樓板
minimumFloorHeightInRectangle(mapID, point, size)
    // 矩形區域內樓板最低高度（RaisedFloor 納入考量）
getFloorHeightDeltaAtPoint(point)
    // 特定點的有效高度差（考慮 Raised / Sloped）
```

### 2.4 每層 heatmap 結果欄位

```cpp
floorRssiDBm       // 特定樓層的 RSSI 結果
floorSnrDB
floorSinrDB
floorRsrpDBm       // 蜂窩用
staticNoiseFloor   // ← 注意此 floor 是「底噪」非樓板
wifiNoiseFloor
```

---

## 3. 計算流程（推測 + 證據交叉）

### 3.1 `fullBuildingPropagation = false`（單樓層）

1. 取目前樓層的 Wall + Zone + grid
2. 跑單層 2D DPM → RSSI per cell
3. 不處理 `floorAttenuation`

### 3.2 `fullBuildingPropagation = true`（跨樓層）

1. 對每個**目標樓層 grid cell** $(x, y, z_{target})$
2. 對每個 AP $(x_{ap}, y_{ap}, z_{ap})$：
   - 計算 3D 直線路徑 $(x_{ap}, y_{ap}, z_{ap}) \to (x, y, z_{target})$
   - 呼叫 `getRayFloorIntersection` 取得路徑穿越樓板數量 $n_{floor}$
   - 計算水平路徑上的牆穿透損耗 $\sum wall_{dB}$（沿用 2D 演算法）
   - 總路徑損耗：
     $$PL = FSPL(d_{3D}) + \sum wall_{dB} + n_{floor} \cdot floorAttenuation$$
3. `HoleInFloorZone` 命中的射線段 **不加** floorAttenuation（洞沒樓板）
4. 取所有 AP 中 max RSSI

### 3.3 `RaisedFloorZone` 的影響

抬高區域（如舞台）有獨立的 `effectiveFloorHeight`：
- 若 AP 或 client 落在 raised zone 內，計算時用抬高後的高度
- 射線穿越 raised zone 的「階梯邊緣」時，可能多穿一塊樓板

### 3.4 `SlopedFloor` 的影響

斜坡 zone 的樓板高度非固定，用三係數線性近似 $h(x,y) = a \cdot x + b \cdot y + c$。
射線穿越斜坡區 → 需要線性插值計算實際高度差，而非用平層近似。

---

## 4. 2D 投影 vs 真 3D 的差別

| 情境 | 2D 投影（NPv1 做法） | 真 3D ray tracing |
|---|---|---|
| 同樓層穿一面牆 | ✅ 等價 | 等價 |
| 跨樓層直下 | ✅ 等價（只累加 floorAttenuation） | 等價 |
| 跨樓層斜向 | ⚠️ 誤差：水平距離 ≠ 3D 距離 | 正確 |
| 樓層高 10m + client 1.5m | ⚠️ 不處理「高於 client 高度」的物件 | 正確 |
| 斜天花板 / 拱頂 | ❌ 無法建模 | 正確 |
| 電梯井 / 管道間 | ⚠️ 得用 HoleInFloor 湊 | 自然處理 |

---

## 5. 對新版設計的建議

### 5.1 V1（重建 NPv1 行為）

- 採用 **2D grid × N floors** 模型
- 每 floor 獨立算完後，以 `fullBuildingPropagation` 旗標決定要否加跨層貢獻
- 實作最小集：`floorHeight`, `floorThickness`, `floorAttenuation`
- `HoleInFloorZone` 先支援（常用於中庭、挑高大廳）

### 5.2 V2 可擴展點（報告給長官）

- **真 3D ray tracing** for 高精度場景（體育館、音樂廳、大型中庭）
  - 成本：計算複雜度提升 10~100x
  - 收益：大挑高、複雜幾何場景預測準確度
- **垂直方向的 `RaisedFloor` 即時視覺化**：目前 UI 2D 難以感受 raised 效果，3D 視圖可幫助除錯
- **樓梯 / 電扶梯獨立物件**：目前用 `SlopedFloor` 近似，但樓梯實際上是多段小平台，精確建模能提高商業空間（百貨公司、地鐵站）準確度

---

## 6. 複現實作 checklist

- [ ] `Floor` 資料結構：`{ id, index, height, thickness, alignmentX, alignmentY, attenuationDB }`
- [ ] `HoleInFloorZone`：polygon
- [ ] `RaisedFloorZone`：polygon + `height` + `attenuationDbPerM`（選配）
- [ ] `SlopedFloor`：polygon + 三係數 `a, b, c`
- [ ] API：`rayFloorIntersection(rayStart, rayEnd) -> [intersection]`
  - 輸入 3D 射線，吐出交點（含樓板 index + 是否 hole）
- [ ] Heatmap 計算迴圈：外層 floor，內層 cell，每 cell 內再對 AP 累加
- [ ] UI：floor 切換器（current floor 高亮，其他 dim）

---

## 7. 證據索引

| 來源 | 證據 |
|---|---|
| hamina.wasm | `HoleInFloorZone`, `HoleInFloorZoneType`, `RaisedFloorZoneENS_`, `appendRaisedFloorZone`, `addSlopedFloorZone` |
| hamina.wasm | `getRayFloorIntersection(mapID, rayStart, rayEnd)` |
| hamina.wasm | `minimumFloorHeightInRectangle`, `getFloorHeightDeltaAtPoint`, `setEffectiveFloorHeight` |
| hamina.wasm | `setFloorHeight`, `setFloorThickness`, `setFloorIndex`, `setFloorAlignmentX/Y` |
| hamina.wasm | `floorRssiDBm`, `floorSnrDB`, `floorSinrDB`, `floorRsrpDBm`（每樓層結果） |
| 07-graphql-schema.md | `HeatmapSettings.fullBuildingPropagation: Boolean` |
| index.js | **無**直接字串 — 所有跨樓層邏輯都在 wasm 內部 |
