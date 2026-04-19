# 01. 核心演算法：Dominant Path Model (DPM)

> 對應 wasm 符號：`DominantPathAccelerationStructure`、`DominantPathAccelerationStructureDerivedImpl<OrderIndex>`、`pathLossOnSegment`、`estimatePathLoss`

## 1. DPM 是什麼

Dominant Path Model 是商業室內 RF 規劃軟體（iBwave、Ranplan、Ekahau、NPv1）的主流演算法，介於「純 log-distance（太粗略）」和「射線追蹤（太慢）」之間。

**核心思想**：從 AP 到目標點存在多條可能路徑（直射、繞射、反射）。不窮舉所有路徑，而是找**一條損耗最小的主導路徑 (Dominant Path)** 作為 RSSI 預測值，因為無線訊號是功率相加，最強路徑主導結果。

**為什麼快**：
- 射線追蹤：O(N² × 反射階數)，一個 AP 要追 10⁵~10⁶ 條光線
- DPM：O(可見障礙物數) × 常數；只解一條最佳路徑
- NPv1 用加速結構把路徑搜尋再降一個數量級

## 2. 路徑階數 (Order)

wasm 符號明確使用 `OrderIndex` 模板參數，實例化為 0/1/2：

```cpp
DominantPathAccelerationStructureDerivedImpl<OrderIndex 0>  // 直射 (LOS)
DominantPathAccelerationStructureDerivedImpl<OrderIndex 1>  // 1-次繞射
DominantPathAccelerationStructureDerivedImpl<OrderIndex 2>  // 2-次繞射
```

**階數定義**：
- Order 0：AP 到接收點的**直線段**，穿過所有擋在中間的牆/zone，累加穿透損耗
- Order 1：允許路徑經過**一個繞射點**（牆的端點/角落），走一個折線
- Order 2：允許**兩個繞射點**，最多走兩段折線

**階數越高**：計算成本越貴，但能處理 NLOS（非視距）情境更精確。預設通常是 Order 2。

### 2.1 路徑選擇規則（virtual pseudocode）

```python
def estimate_path_loss(ap_pos, rx_pos, max_order=2):
    best_pl = INFINITY
    # Order 0: 直線
    pl0 = compute_direct_pl(ap_pos, rx_pos)
    best_pl = min(best_pl, pl0)

    # Order 1: 嘗試所有牆端點作為繞射點
    # 註：visible_edges() 是 2D 視線測試（線段交叉）
    #     Wall.topEdge/bottomEdge 在此不參與判定（因為 RF 計算為 2D grid on clientHeightMeters 平面，
    #     不做 3D 高度切片）。高度資訊只用於：(1) 是否落在 client 平面、(2) 跨樓層 floorAttenuation
    for edge_point in visible_edges(ap_pos):
        if edge_point visible from rx_pos:
            pl = (
                compute_direct_pl(ap_pos, edge_point)
                + compute_direct_pl(edge_point, rx_pos)
                + diffraction_loss(angle_at_edge)
            )
            best_pl = min(best_pl, pl)

    # Order 2: 兩個繞射點
    if max_order >= 2:
        for e1, e2 in candidate_edge_pairs(ap_pos, rx_pos):
            pl = (
                compute_direct_pl(ap_pos, e1)
                + compute_direct_pl(e1, e2)
                + compute_direct_pl(e2, rx_pos)
                + diffraction_loss(angle_at_e1)
                + diffraction_loss(angle_at_e2)
            )
            best_pl = min(best_pl, pl)

    return best_pl
```

### 2.2 直線段路徑損耗拆解

`pathLossOnSegment(from, to, freq, ...)` 的完整組成：

```
PL_segment(A, B) =
    FSPL(distance)                                # 自由空間
  + Σ wall_i_attenuation_dB                      # 穿牆累加 (WallAttenuationProvider)
  + Σ zone_j_attenuation_dB_per_m × travel_j     # 體積衰減 (ZoneAttenuationService)
  + Σ triangle_k_attenuation                     # 三角網格額外衰減
  + BaseLoss                                      # 系統常數偏置
```

對應 wasm 函式名：
- `PredictionService::addWallPathLoss` — 逐一牆穿透
- `ZoneAttenuationService::distanceLossDB` — zone 內 travel × dB/m
- `RegularTriangleGridAttenuationService::forEachRayPieceAtFrequency` — 沿射線切片累加三角格衰減
- `DominantPathAccelerationStructureDerivedImpl::pathLossOnSegment` — 上述總和

## 3. FSPL + Log-distance 基礎公式

### 3.1 Free-Space Path Loss

$$
\text{FSPL}(d, f) = 20 \log_{10}(d) + 20 \log_{10}(f) + 20 \log_{10}\left(\frac{4\pi}{c}\right)
$$

`c` = 光速。單位：`d` m、`f` Hz → dB。
常用快速形式（d 以 m、f 以 MHz）：

$$
\text{FSPL}_{dB} = 20 \log_{10}(d) + 20 \log_{10}(f_{MHz}) - 27.55
$$

### 3.2 Log-distance 擴充（PLE 模型）

NPv1 以 `pathLossExponent` (PLE, n) 替換純 FSPL 的距離項：

$$
\text{PL}(d) = \text{PL}(d_0) + 10 n \log_{10}\left(\frac{d}{d_0}\right)
$$

- `d_0` 通常取 1 m
- `PL(d_0)` = FSPL(1m, f)
- `n` = 2.0 代表真空；室內典型 2.5~4.0
- NPv1 每頻段各自校正：`pleEstimate2_4GHz`、`pleEstimate5GHz`、`pleEstimate6GHz`

**重要**：PLE 是 zone-aware 的。每個 `AttenuatingZone` 可覆寫 `pathLossExponent`，因此室內天井區域可用 n=2.0，辦公隔間區用 n=3.5。

```
// wasm 符號
setPathLossExponent(pathLossExponent)                   // 全域預設
setDefaultPathLossExponent(pathLossExp)
appendRaisedFloorZone(..., pathLossExponent)            // zone 級覆寫
addAttenuatingZoneType(..., pathLossExp, ...)
```

## 4. 繞射損耗（簡化模型）

NPv1 **不使用嚴格 UTD**，而是最簡化的 "per-90-degree" 線性模型：

```
HeatmapSettings.diffractionLossDBPer90Deg   # 可 UI 調整
```

**公式（推測）**：

$$
L_{diff} = L_{90} \times \frac{\theta_{turn}}{90°}
$$

- `θ_turn` = 路徑在繞射點的轉角
- `L_{90}` 典型 4~8 dB

這比嚴格 UTD/Fresnel 粗略，但：
- ✅ 完全可預測、O(1) 計算
- ✅ UI 可調、方便 survey 校正
- ❌ 不處理頻率依賴、極化、刃邊寬度

## 5. 加速結構 (Acceleration Structure)

`DominantPathAccelerationStructure` 的作用是避免每個接收點都重新搜尋所有牆端點。推測實作（常見做法）：

### 5.1 預計算階段
1. **牆端點可見性圖 (Visibility Graph)**：建構一張圖，節點 = 牆端點，邊 = 兩端點間無遮擋
2. **空間索引**：R-tree 或 Quadtree 索引所有牆線段（Boost.Geometry 內建 R-tree）
3. **網格預切片**：對正三角形網格每個 cell，預計算覆蓋它的所有 zone

### 5.2 查詢階段
1. 對目標點 `p`：R-tree 查詢 `p` 到 AP 連線上所有相交牆
2. 取得所有候選繞射點（只考慮對 AP 與 p 都可見的端點）
3. Dijkstra / A* 在 visibility graph 上找最短加權路徑（權重 = 路徑 PL）

## 6. 網格取樣 (RegularTriangleGrid)

`RegularTriangleGridAttenuationService`：

- 把整張地圖三角化成**正三角形** (equilateral triangles) 的網格
- 邊長可調（控制精度/效能）
- 每個三角形保存一個衰減值（從 env-learning 或區域模型聚合）

**為什麼正三角形而不是方格**：
- 任意方向走線段，穿過的三角形數約等於距離（各向同性）
- 方格會因為走斜線比直角多走 √2 倍而偏誤
- NPv1 叫 `regularTriangleGridAttenuatingEstimate`，明確

**取樣步驟**：
1. 射線從 AP 到 p 切成小片段
2. 每片段中心落在哪個三角形 → 查表得衰減
3. 累加

## 7. 3D 擴充

所有 zone 都有 `topAltitudeM / bottomAltitudeM`：

```
appendSlopedAttenuatingZone(zoneID, polygon, topAltM, bottomAltM,
    attenuationDBPerM, pathLossExp,
    topSlopeX, topSlopeY, topOriginOffset,     # 頂平面是傾斜的
    bottomSlopeX, bottomSlopeY, bottomOriginOffset)
```

- Zone 的上/下邊界是 **一般平面** (ax + by + c) 不是水平面，能描述樓梯、斜屋頂
- 射線 PL 計算需做 3D 線段 × 3D 多邊形柱體 相交

**AP 位置**：`positionMeters` 三維、`installHeight`；**接收點**：`clientHeightMeters`（通常 1.0~1.5m）

## 8. 跨樓層傳播

`HeatmapSettings.fullBuildingPropagation` = true 時啟用：

- 從 `getBuildingMapsByIds` 載入**所有樓層**的 AP、牆、地板衰減
- 每樓層：`floorAttenuation`（dB）、`floorThickness`（m）、`floorHeight`（m）
- 從鄰樓層 AP 到本樓層接收點的路徑會額外加 `floorAttenuation`
- GraphQL fragment `adjacentFloorAccessPointFields` 確認存在

**簡化公式**：

$$
PL_{cross} = PL_{2D}(ap_{other\_floor} \to rx_{this\_floor})
           + |floor_{diff}| \times floor\_att
$$

## 9. 複現參考程式骨架

```cpp
// 類似 NPv1 的 API 設計
class RfEngine {
public:
    void setPathLossExponent(double ple);
    void addWallType(int id, double attDb, double refFreqMHz,
                     bool isConductor, double a, double b, double c, double d);
    void addWall(int id, Point2D start, Point2D end, int wallTypeId,
                 double topHeightM, double bottomHeightM);
    void addAttenuatingZone(int id, Polygon poly, double topAltM, double botAltM,
                            double attDbPerM, double ple);
    void addAccessPoint(int id, Point3D pos, double txPowerDBm,
                        int antennaTypeId, Vec3 xAxis, Vec3 zAxis);

    // 主入口
    double estimatePathLoss(Point3D from, Point3D to, double freqMHz, int maxOrder);

    // 全 heatmap
    std::vector<double> computeRssiGrid(double freqMHz, double cellSize);
};
```

### 主迴圈虛擬碼

```cpp
double RfEngine::estimatePathLoss(Point3D a, Point3D b, double freq, int maxOrder) {
    double best = INFINITY;

    // Order 0
    best = min(best, pathLossOnSegment(a, b, freq));

    // Order 1, 2: 搜尋候選繞射路徑
    for (int order = 1; order <= maxOrder; ++order) {
        auto paths = findKShortestPaths(visibilityGraph, a, b, /*k=*/K_CAND, order);
        for (auto& path : paths) {
            double pl = 0;
            for (int i = 0; i + 1 < path.size(); ++i) {
                pl += pathLossOnSegment(path[i], path[i+1], freq);
            }
            for (int i = 1; i + 1 < path.size(); ++i) {
                double theta = turnAngle(path[i-1], path[i], path[i+1]);
                pl += diffractionLossDBPer90Deg * (theta / 90.0);
            }
            best = min(best, pl);
        }
    }

    return best;
}

double RfEngine::pathLossOnSegment(Point3D a, Point3D b, double freq) {
    double d = distance(a, b);
    double pl = FSPL(d, freq);                          // 或改用 PLE 模型
    // 穿牆
    for (auto& wall : rtree.findIntersecting(a, b)) {
        pl += wall.attenuationAtFreq(freq);
    }
    // 體積衰減
    for (auto& zone : zonesAlongSegment(a, b)) {
        double travel = segmentInsideZoneLength(a, b, zone);
        pl += zone.attDbPerM * travel;
    }
    // 三角格微調
    pl += triangleGridAttenuation(a, b, freq);
    return pl;
}
```
