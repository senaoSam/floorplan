# 08. 從零複現實作指南

## 1. 技術選型建議

| 層 | NPv1 | 推薦替代 | 備註 |
|---|---|---|---|
| 前端 | React 17 + Vite | 任何 React 版本 | 主產品用什麼用什麼 |
| 狀態 | 未知（推測 Redux/Zustand） | Zustand | 輕量 |
| 2D 繪圖 | 推測 Konva/Canvas | React-Konva | 牆編輯必備 |
| RF 引擎 | C++ + Emscripten wasm | **C++ + wasm** / **Rust + wasm** | 不建議純 JS，效能差 10x |
| Heatmap 渲染 | 推測 WebGL | WebGL shader | 插值、色階都適合 GPU |
| 後端 | GraphQL (Apollo?) | REST 也可 | 資料傳輸簡單，選順手的 |

> **關於 3D 的常見誤解（wasm 實測後澄清）**
> NPv1 的 `enable3D` / `buildingViewMode="3d"` / `raisedHeatmap` 三個開關
> **全部只是 UI / 渲染層設定**，不觸發任何 RF 計算路徑的切換：
> - Grid 永遠是 2D，固定在 `clientHeightMeters` 平面
> - 跨樓層不是「3D 傳播」，只是在路徑沿線累加 `floorAttenuation`
> - 3D 視圖是把同一份 2D grid 的結果用 GPU 抬起顯示
>
> 複現時**不要**為了「3D 模式」多寫一套演算法；只需在渲染層切換 Three.js/WebGL pipeline。
> 若要做真正的 3D RF 計算（ray tracing、voxel grid），是**新版可擴展點**，不在原版範圍。

## 2. MVP 里程碑

### M1：2D 直射模型（1 週）
- Wall 編輯（線段）
- 簡單 WallType（單一頻率 dB）
- 單 AP，全向天線
- RSSI = TxPower - FSPL(d) - Σ wall_dB
- Canvas 畫 heatmap（RGBA 顏色映射）

### M2：多路徑 + 繞射（1 週）
- 牆端點 visibility graph
- Order 1-2 path 搜尋（k-shortest paths）
- `diffractionLossDBPer90Deg` 線性繞射
- 多 AP 取最大 RSSI

### M3：ITU-R 材料模型（3 天）
- 每 WallType 帶 `(a, b, c, d, refFreq, isConductor)`
- 頻率外推公式實作
- 預設材料庫（concrete/brick/drywall/wood/glass/metal）

### M4：3D 天線方向圖（1 週）
- 解析天線 pattern（用標準 `.msi` 格式或自訂 JSON）
- Bilinear/多平面插值
- AP 方位 + roll 變換

### M5：Zone 衰減（1 週）
- Polygon zone 編輯
- 3D 線段 × 3D 柱體相交
- `attenuationDBPerM` 沿射線累加
- Raised floor / sloped 特殊型

### M6：Triangle Grid（1 週）
- 正三角形網格生成
- Per-cell 衰減儲存
- 射線切片 + 累加

### M7：Channel Optimizer（1 週）
- 頻道衝突圖建構
- Greedy DSATUR 或 Simulated Annealing
- Fitness 計算

### M8：Env Learning（2-4 週，需 survey 資料）
- Survey 資料收集 UI
- 參數最小二乘反推
- Triangle field 殘差插值

## 3. 關鍵程式骨架（C++/Rust 核心）

### 3.1 全系統結構

```cpp
namespace rf {

struct Point3D { double x, y, z; };
struct Polygon { std::vector<Point3D> vertices; };

enum FrequencyBand { GHz_2_4, GHz_5, GHz_6 };

// Material
struct WallType {
    int id;
    double refAttDB;
    double refFreqMHz;
    double a, b, c, d;
    bool isConductor;
    double topHeight, bottomHeight;
    double width;
    double attAtFreq(double freqMHz) const;
};

struct Wall {
    int id;
    Point3D start, end;
    int wallTypeId;
};

struct AttenuatingZone {
    int id;
    Polygon footprint;
    double topAltM, botAltM;
    double attDbPerM;
    double pathLossExp;     // optional override
    // sloped:
    double topSlopeX, topSlopeY, topOffset;
    double botSlopeX, botSlopeY, botOffset;
    double topZ(double x, double y) const {
        return topSlopeX*x + topSlopeY*y + topOffset;
    }
};

// Antenna
struct AntennaPattern {
    enum Mode { TwoPlane, Full2D, MultiPlane } mode;
    std::vector<double> azPattern, elPattern;
    std::vector<std::vector<double>> full2D;
    double peakGainDBi;
    double gainAt(double thetaDeg, double phiDeg) const;
};

struct AccessPoint {
    int id;
    Point3D pos;
    double azimuth, elevation, roll;
    double txPowerDBm;
    double freqMHz;
    FrequencyBand band;
    int channelWidth;
    int streamCount;
    AntennaPattern* pattern;
    bool enabled;
};

// Settings
struct HeatmapSettings {
    double clientHeight = 1.0;
    double cutoutDist = 50.0;
    double diffLossPer90Deg = 6.0;
    bool fullBuildingPropagation = false;
    double noiseFloor[3] = {-95, -95, -95};
    double clientTxPower = 15.0;
    double pathLossExponent[3] = {3.0, 3.3, 3.5};  // per band
};

// Engine
class RfEngine {
    std::vector<Wall> walls;
    std::vector<WallType> wallTypes;
    std::vector<AttenuatingZone> zones;
    std::vector<AccessPoint> aps;
    HeatmapSettings settings;

    // Accel structures
    boost::geometry::index::rtree<...> wallRTree;
    VisibilityGraph visGraph;
    TriangleGrid attGrid;

public:
    void build();
    double estimatePathLoss(Point3D a, Point3D b, double freqMHz, int maxOrder=2) const;

    struct GridResult {
        double primaryRssi;
        double secondaryRssi;
        double snr;
        double dataRate;
        double interferenceDB;
    };
    std::vector<GridResult> computeHeatmap(FrequencyBand band, double cellSize) const;
};

} // namespace rf
```

### 3.2 PathLossOnSegment（核心函式）

```cpp
double RfEngine::pathLossOnSegment(Point3D a, Point3D b, double freqMHz) const {
    double d = distance(a, b);
    if (d < 0.1) d = 0.1;  // 避免 log(0)

    double band_idx = bandIndex(freqMHz);
    double ple = settings.pathLossExponent[band_idx];
    double fspl1m = 20*log10(1.0) + 20*log10(freqMHz) - 27.55;
    double pl = fspl1m + 10*ple*log10(d);

    // 穿牆
    for (auto& wall : wallRTree.queryIntersect(a, b)) {
        if (segmentIntersectsWall3D(a, b, wall, wallTypes)) {
            pl += wallTypes[wall.wallTypeId].attAtFreq(freqMHz);
        }
    }

    // Zone
    for (auto& zone : zonesAlongSegment(a, b)) {
        double travel = segmentInsideZone(a, b, zone);
        double zonePl = travel * zone.attDbPerM;
        if (zone.hasMaxLoss) zonePl = std::min(zonePl, zone.maxLossDB);
        pl += zonePl;
    }

    // Triangle grid
    pl += attGrid.integrateAlong(a, b, band_idx);

    return pl;
}
```

### 3.3 Order > 0 路徑搜尋

```cpp
double RfEngine::estimatePathLoss(Point3D a, Point3D b, double freq, int maxOrder) const {
    double best = pathLossOnSegment(a, b, freq);

    if (maxOrder >= 1) {
        // 對每個對 a 和 b 都可見的牆端點
        for (auto& v : visGraph.vertices()) {
            if (!visGraph.visible(a, v)) continue;
            if (!visGraph.visible(v, b)) continue;
            double pl1 = pathLossOnSegment(a, v, freq);
            double pl2 = pathLossOnSegment(v, b, freq);
            double turn = angleDegrees(a - v, b - v);
            double diff = settings.diffLossPer90Deg * (turn / 90.0);
            best = std::min(best, pl1 + pl2 + diff);
        }
    }
    // Order 2 similar with pair of vertices
    return best;
}
```

### 3.4 計算 RSSI 與 Heatmap

```cpp
double RfEngine::computeRssiAt(Point3D p, const AccessPoint& ap) const {
    double pl = estimatePathLoss(ap.pos, p, ap.freqMHz, 2);
    Vec3 dirWorld = normalize(p - ap.pos);
    auto localDir = apFrame(ap).inverse() * dirWorld;
    double theta = asin(localDir.z) * 180/PI;
    double phi = atan2(localDir.y, localDir.x) * 180/PI;
    double gain = ap.pattern->gainAt(theta, phi);
    double mimo = 10*log10(ap.streamCount);
    return ap.txPowerDBm + gain + mimo - pl;
}

std::vector<GridResult> RfEngine::computeHeatmap(FrequencyBand band, double cellSize) const {
    auto grid = generateTriangleGrid(scopeExtent(), cellSize);
    std::vector<GridResult> out(grid.size());

    #pragma omp parallel for
    for (size_t i = 0; i < grid.size(); ++i) {
        Point3D p = {grid[i].x, grid[i].y, settings.clientHeight};
        std::vector<std::pair<double, const AccessPoint*>> rssis;
        for (auto& ap : aps) {
            if (!ap.enabled || ap.band != band) continue;
            if (distance(ap.pos, p) > settings.cutoutDist) continue;
            double r = computeRssiAt(p, ap);
            rssis.push_back({r, &ap});
        }
        std::sort(rssis.begin(), rssis.end(),
                  [](auto& a, auto& b) { return a.first > b.first; });

        out[i].primaryRssi = rssis.empty() ? -INF : rssis[0].first;
        out[i].secondaryRssi = rssis.size() > 1 ? rssis[1].first : -INF;

        // SNR with interference
        double intfPower = 0;
        for (size_t j = 1; j < rssis.size(); ++j) {
            if (overlapsChannel(*rssis[j].second, *rssis[0].second)) {
                intfPower += pow(10.0, rssis[j].first / 10);
            }
        }
        double nf = settings.noiseFloor[band] + 10*log10(ap.channelWidth/20.0);
        double nEff = 10*log10(pow(10,nf/10) + intfPower);
        out[i].snr = out[i].primaryRssi - nEff;
        out[i].interferenceDB = intfPower > 0 ? 10*log10(intfPower) : -INF;
        out[i].dataRate = lookupDataRate(out[i].snr, rssis[0].second);
    }
    return out;
}
```

## 4. 效能目標

- **單 AP heatmap (1000m² @ 0.5m grid = 4000 points)**：< 50ms
- **10 AP heatmap**：< 300ms
- **互動拖動 AP**：降採樣到 1m grid，< 100ms 回饋
- **Env learning fit (500 survey points)**：< 5s

## 5. 優化技巧

### 5.1 可見性圖預計算
- 一次性算 visibility graph（O(E²)）
- AP 移動時：只更新受影響區域
- 牆增減：局部重建

### 5.2 Grid 分塊平行
- 用 OpenMP 或 Web Worker 切網格
- 每塊獨立計算（無共享寫）

### 5.3 空間索引
- Boost.Geometry R-tree：`wall_rtree.query(intersects(segment))`
- 牆一次塞入 R-tree，查詢 O(log N)

### 5.4 快取
- Per-AP 的「該 AP 所有 grid 點 RSSI」cache
- 只有該 AP 或其周邊牆變動才 invalidate

### 5.5 降精度預覽 + 非同步高精度
- 即時互動時用 0.5-1m grid
- 放開滑鼠後 worker 算 0.1m grid replace

## 6. 測試與驗證

### 6.1 單元測試
- FSPL @ 1m, 2.4GHz = 40 dB (可驗證)
- FSPL @ 10m, 2.4GHz = 60 dB
- 一面混凝土牆，5GHz 應穿透 ~10-15 dB
- ITU-R 公式：concrete @ 2.4GHz 計算 α → 比對 P.2040 表格

### 6.2 整合測試
- 畫個 5m × 5m 空房間，中心放 AP
- 預期 heatmap 應圓形對稱
- 加一面牆 → 背面應明顯衰減

### 6.3 實測對照
- 找場地實測 RSSI，對比預測
- RMSE 目標：< 5 dB（有校正）、< 8 dB（無校正）

## 7. 開源替代方案參考

若完整複現太重，以下開源專案可參考：

- **PyLayers** (http://pylayers.github.io) — 射線追蹤 Python，物理嚴謹但慢
- **Sionna RT** (NVIDIA) — GPU 射線追蹤
- **Python ITU-R P.2040 implementation** — GitHub 有參考實作
- **OpenWiFi** — WLAN 部分工具

但沒有開源能比擬 NPv1 的完整性（DPM + ITU-R + env learning），複現需要自己拼。

## 8. 內部重寫合規 checklist

本文件為新部門翻新 NPv1 的技術盤點，作為內部重寫的底稿。啟動前建議確認：

- **ITU-R 公式與係數表**：公開標準，可自由實作
- **DPM 演算法**：公開學術成果，採用無虞
- **UI/UX 風格**：新版建議獨立設計（新產品定位與新形象）
- **文件持有範圍**：本文件僅限本部門內部參考；對外（含其他部門與客戶）引用前需徵得主管同意
