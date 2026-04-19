# NPv1 Network Planner — 演算法技術分析完整文件

> 來源：已登入 production 站取回前端資產分析（JS bundle、wasm 引擎 6.4MB、GraphQL payload）。
> 目的：作為新部門重寫新版時的技術規格底稿，讓團隊能重建同類 RF 規劃引擎。

## 1. 系統頂層架構

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React 17 SPA, Vite bundle, Clerk auth)            │
│                                                              │
│  ┌──────────────┐    GraphQL    ┌─────────────────────────┐│
│  │ React UI     │ ────────────► │ Server (GraphQL API)    ││
│  │ (Zustand/    │ ◄──────────── │  - projects, maps       ││
│  │  Redux?)     │   inputs only │  - walls, zones, APs    ││
│  └──────┬───────┘               │  - antenna patterns     ││
│         │                        │  - heatmap settings    ││
│         ▼                        │  - env-learning mesh   ││
│  ┌──────────────┐                │    (ML pre-computed)   ││
│  │ hamina.wasm  │                └─────────────────────────┘│
│  │ (C++ /       │                                            │
│  │  Emscripten) │    ┌──────────────────┐                   │
│  │              │◄───┤ /api/MapImage    │   (only for      │
│  │ RF engine    │    │   PNG snapshot   │    export/share) │
│  └──────┬───────┘    └──────────────────┘                   │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────┐                                           │
│  │ Canvas /     │  heatmap overlay                          │
│  │ WebGL render │                                            │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
```

## 2. 核心設計決策

| 決策 | 選擇 | 為什麼 |
|---|---|---|
| 計算位置 | **前端 (WASM)** | 互動即時反饋；拖 AP 要 <100ms 重算 |
| 演算法 | **Dominant Path Model (DPM)** | ms 級運算；商業主流方案（iBwave/Ranplan/Ekahau 都用） |
| 語言 | **C++ → Emscripten** | 數值運算效能；幾何計算用 Boost.Geometry |
| 幾何資料結構 | **Boost.Geometry (cartesian 2D/3D)** | 線段交點、多邊形包含檢測成熟 |
| 結果網格 | **正三角形網格 (RegularTriangleGrid)** | 等距取樣；內插簡單；比方格更均勻 |
| 材料模型 | **ITU-R P.2040** | 官方標準；四參數即可描述複介電常數頻率外推 |
| 繞射 | **線性 dB/90°** | 非嚴格 UTD；犧牲精度換速度 |
| 校正 | **Survey + Env-Learning** | ML 反推牆衰減 / PLE；提高實測符合度 |
| 三頻段 | **2.4 / 5 / 6 GHz 獨立建模** | 不同頻段 PLE、noise floor、穿透損耗不同 |

## 3. 演算法流水線（每次 AP/牆異動觸發）

```
Input (GraphQL)
 ├── Walls + WallTypes + ITUR parameters
 ├── Attenuating Zones (2D/3D, sloped, raised floor)
 ├── Access Points + Radios + Antenna patterns
 ├── Survey data (optional, for env-learning)
 └── HeatmapSettings (noise floor, diffraction, prediction mode)
         │
         ▼
┌──────────────────────────────────────────────┐
│ 1. Build Obstacle Container                  │
│    - walls as segments with materialId       │
│    - zones as polygons with dB/m             │
│    - height-aware (top/bottom altitude)      │
└────────┬─────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────┐
│ 2. Build Triangle Grid Attenuation Service   │
│    - regular triangulation of floor plan     │
│    - each triangle carries aggregated        │
│      attenuation from env-learning mesh      │
└────────┬─────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────┐
│ 3. For each grid sample point p:             │
│    For each AP a:                            │
│      PL = DominantPathAccelerationStructure  │
│           .estimatePathLoss(a → p)           │
│      RSSI_ap_p = TxPower(a) + AntennaGain    │
│                  + RxGain - PL               │
│    RSSI_p = max over all a (signal)          │
└────────┬─────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────┐
│ 4. Compose heatmap layers                    │
│    - primary/secondary/tertiary coverage     │
│    - SNR, data rate, interference, etc.      │
│    - apply HeatmapSettings thresholds        │
└────────┬─────────────────────────────────────┘
         ▼
┌──────────────────────────────────────────────┐
│ 5. Rasterize to Canvas/WebGL overlay         │
└──────────────────────────────────────────────┘
```

## 4. 精度來源的層次結構

**由下往上每層都是前一層的誤差修正：**

```
Layer 4:  Survey ML Env-Learning (EnvLearningWallZoneAttenuationEstimator)
          ← 用實測數據反推每面牆/每區域的「真實」衰減
Layer 3:  Triangle Grid Attenuation (RegularTriangleGridAttenuation)
          ← 把環境總衰減離散化到網格，供快速查詢
Layer 2:  ITU-R Material Model
          ← 用建材參數（混凝土、玻璃）計算頻率依賴的穿透損耗
Layer 1:  Dominant Path + Log-distance (PLE + FSPL)
          ← 基礎傳播模型：FSPL + n·10·log10(d)
```

## 5. 檔案導覽

- **`01-core-algorithm-dpm.md`** — DPM 演算法骨架、路徑搜尋、階數控制（0=LOS、1=1-diff、2=2-diff）
- **`02-material-models.md`** — ITU-R P.2040 四參數公式、牆衰減、zone 衰減、floor 衰減
- **`03-antenna-3d.md`** — 多平面天線方向圖、插值、azimuth/elevation pattern
- **`04-heatmap-pipeline.md`** — 每個 heatmap type 的計算公式（coverage/SNR/data rate/interference）
- **`05-channel-optimizer.md`** — 頻道自動分配 + 互擾最小化
- **`06-env-learning.md`** — 如何用 survey 反推環境衰減
- **`07-graphql-schema.md`** — 所有資料型別完整欄位
- **`08-implementation-guide.md`** — 從零到一的實作步驟
- **`09-evidence.md`** — wasm 符號、GraphQL 原文證據
