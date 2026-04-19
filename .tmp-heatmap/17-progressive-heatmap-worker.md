# 17. Progressive Heatmap Worker 完整拆解

**Task C 產出**。`progressiveHeatmapWorker-B2VeLWkY.js` 是 NPv1 實際產出 heatmap 的 worker。

---

## 1. 一句話總結

Progressive heatmap = **多輪逐步細化**。Client 送 `type:'start'` 加 `maxSamples:[n0, n1, n2, ...]` 列表，worker 每接到一次訊息就算下一輪 `maxSamples[i]` 對應的解析度，回傳 `{ image, bounds, progressPercentage }`。Client 拿到每輪結果就立刻畫上去，視覺上看起來「由模糊漸細」。

---

## 2. Message Protocol

### 2.1 Request

```ts
{
  topic: 'p',                       // 'p' for progressive
  payload: {
    type: 'start',                   // 第一次呼叫給 'start'，後續空給即可
    deps: {
      majorVersion: number,
      minorVersion: number,
      visualizationType: string,    // 'MAX_RSSI' | 'SNR' | ... (見 §4)
      maxSamples: number[],          // [粗→細] 每輪樣本數，如 [256, 1024, 4096]
      collectStatistics: boolean[],  // 每輪是否收集統計（顯示平均 RSSI 之類）
      // 上面這些是「progressive 層級」
      // 以下是場景資料
      aps, walls, wallTypes,
      attenuatingZones, attenuatingZoneTypes,
      attenuatingFields, attenuatingTriangleField,
      surveyAttenuatingTriangleField,
      scopeZones, capacityZones,
      holeInFloorZones, raisedFloorZones, slopedFloors,
      cachedAntennas,
      adjacentFloors: { aboveFloors, belowFloors },
      mapData: { id, floorThickness, bounds, ... },
      radioChannelLimitationsMap,
      autoScopeZones, autoWalls, autoMaterialWalls, autoAttenuatingZones, autoSlab,
      environmentName,
      // visualization params
      enabledWifiBands,
      tileVisualizerOptions: { heatmapOptions: { clientHeightMeters, ... } },
      overrideWifiBandChannels,
      visualizationLevels,
      predictionMode,
      pathLossExponent,
      heatmapChannelSettings,
      bounds   // viewport box
    }
  }
}
```

### 2.2 Response（每輪一次）

```ts
{
  topic: 'p',
  payload: {
    payload: {
      image: Float32Array | Uint8Array,   // tile 像素資料（透過 transferable）
      bounds: [minX, minY, maxX, maxY],
      majorVersion, minorVersion,
      visualizationType,
      collectStatistics,
      imageType: 'FSPL'                   // 所有回傳都標記為 FSPL（free-space path loss domain）
    },
    progressPercentage: number            // 0 ~ 100
  }
}
```

### 2.3 流程範例（3 輪）

```
Client send: { type: 'start', deps: { maxSamples: [256, 1024, 4096], ... } }
  ↓
Worker HQ=0
  UQ() → sub-dep with maxSamples=256, collectStatistics=deps.collectStatistics[0]
  pQ → fQ → dQ → uQ[type] → cQ(...) → getGaussianBlurredTile
  postMessage result1 with progressPercentage=256/(256+1024+4096)*100 ≈ 4.8%

Client send: (另一個訊息觸發下一輪，或 worker 自走？)
  ↓
Worker HQ=1
  ... maxSamples=1024, percent ≈ 24%

Client send: ...
Worker HQ=2 maxSamples=4096, percent = 100%
```

> **注意**：progressive worker **不是自己 tick**，是 client 每收到一輪結果後再送訊息觸發下一輪。client 可以在任何一輪後停止（例如使用者又改了場景）。

---

## 3. 核心函式鏈

```
onmessage
  └─ switch(topic) { case 'p': KQ(module, payload) }
       └─ 若 type==='start'：存 deps, HQ=0
           ├─ UQ() → 取當前 HQ 的 subset (maxSamples[HQ], collectStatistics[HQ])
           ├─ pQ(module, subDep) → 準備場景、算當前 tile
           │    └─ fQ({ hamina, visualizationType, resolution, extent, input, ... })
           │         ├─ nf / RAII
           │         ├─ YX → Building（跨樓層）
           │         ├─ new Visualizer
           │         ├─ new VisualizerSettings → setPredictionMode / setPathLossExp
           │         ├─ zZ(heatmapOptions, type, settings, channelSettings)
           │         ├─ visualizer.configure(settings)
           │         ├─ visualizer.setMapId
           │         └─ dQ → uQ[type] → cQ(type, blurStdDev)
           │              └─ rQ → getGaussianBlurredTile(lQ(n), min(sQ*blur, 50))
           └─ BQ(result, WQ()) → postMessage
```

---

## 4. 所有可視化類型 (visualizationType dispatch table)

從 `uQ` 完整列舉（括號內為預設 blur std dev factor，未標註則為 0.2 base）：

**RSSI 系列**
- `MaxRssi`, `MaxRssiUplink`
- `SecondaryRssi`, `SecondaryRssiUplink`
- `TertiaryRssi`, `TertiaryRssiUplink`

**BLE RSSI 系列**
- `MaxBleRssi`, `MaxBleRssiUplink`
- `SecondaryBleRssi`, `SecondaryBleRssiUplink`
- `TertiaryBleRssi`, `TertiaryBleRssiUplink`

**UWB 系列**
- `UwbMaxRssi`, `UwbMaxRssiUplink`
- `UwbSecondaryRssi`, `UwbSecondaryRssiUplink`
- `UwbTertiaryRssi`, `UwbTertiaryRssiUplink`
- `UwbAccuracy`, `UwbDop`, `UwbNumberOfAnchorsUplink`

**Cellular RSRP 系列**
- `MaxRsrp`, `MaxRsrpUplink`
- `SecondaryRsrp`, `SecondaryRsrpUplink`
- `TertiaryRsrp`, `TertiaryRsrpUplink`

**其他 Rssi (Enocean, Zigbee)**
- `EnoceanMaxRssiUplink`, `EnoceanSecondaryRssiUplink`, `EnoceanTertiaryRssiUplink`
- `ZigbeeMaxRssi`, `ZigbeeSecondaryRssi`, `ZigbeeTertiaryRssi`

**品質指標**
- `Snr`, `SnrUplink`
- `Sinr`, `SinrUplink`
- `Interference` (blur 0.3)
- `DataRate` (blur 0.5), `DataRateUplink` (blur 0.5)
- `CellularDataRate` (blur 0.5), `CellularDataRateUplink` (blur 0.5)
- `ChannelUtilization`, `ChannelUtilizationWifi`, `ChannelUtilizationNonWifi`

**特殊**
- `WifiRequirements` → 映射到 `MaxRssi`
- `WifiNumberOfAccessPoints` → 各 AP 數量疊加

**共 ~50 種**。這比 04-heatmap-pipeline.md 原列的 8 種（RSSI/SNR/datarate/interference/uplink/channel util/coverage/debug）**多出一個數量級**，需要回頭修 04。

---

## 5. Blur 細節：`getGaussianBlurredTile`

```js
// cQ(visualizationType, blurFactor = 0.2)
(n) => rQ(n, () =>
  Lg(
    RZ(n.visualizer, n.tileVisualizerOptions, type),
    (tileVisualizer) =>
      tileVisualizer?.getGaussianBlurredTile(
        lQ(n),                            // tileParameters
        Math.min(sQ(n) * blurFactor, 50)  // blur std dev (px)，上限 50
      )
  )
)
```

- 每個 visualizationType 預設 `blurFactor=0.2`
- `DataRate` / `Interference` / `CellularDataRate` 用較大 blur (0.3~0.5) — 這些指標空間變化劇烈，需要更強平滑
- `sQ(n)` 估計是某個 scale factor（可能是 min(width, height) 或 pixelsPerMeter）— 實際值每 tile 不同
- 最終 stddev 上限 50 px（避免極端模糊）

**本專案啟示**：heatmap 不只是「算 RSSI 再上色」，還需要 Gaussian blur 平滑。blur 應該在：
- wasm 側（C++ / Rust）做完 grid 計算後 → blur → 回傳
- 或 GPU shader 側做（兩 pass horizontal + vertical separable Gaussian）

第二種對 WebGL2 友善，本專案值得採用。

---

## 6. 解析度公式：`HZ` + `UZ`

```js
const HZ = (e, t) => {       // e = viewport dimensions in meters, t = maxSamples
  let n = e.width * e.height
  return n <= 0 ? 0 : Math.sqrt(t / n)
}

const UZ = (e, t) => {       // resolution in pixels for given maxSamples
  let n = HZ(e, t)
  let r = Math.ceil(n * e.width)
  let i = Math.ceil(n * e.height)
  return { width: max(r, 2), height: max(i, 2) }
}
```

解讀：
- 若使用者要 `maxSamples = 1024` 點
- viewport = 50m × 40m = 2000 m²
- `HZ` = √(1024 / 2000) ≈ 0.716 pixels-per-meter
- `UZ` width = ceil(0.716 × 50) = 36
- `UZ` height = ceil(0.716 × 40) = 29
- 結果 tile size = 36 × 29 = 1044 pixels（接近 1024 但對齊到整 px）

所以 `maxSamples` 不是「總格子數」，而是**目標格子數**，實際會算到最接近且不小於 2x2 的 tile。

**多輪 maxSamples 範例**：`[64, 256, 1024, 4096, 16384]` 代表解析度從 8×8 → 16×16 → 32×32 → 64×64 → 128×128（以正方形 viewport 為例）。

---

## 7. `nQ` — meter → pixel 座標轉換

從 fQ 內：
```js
boxExtent: [
  nQ(i.minCorner, o.metersPerPixel),
  nQ(i.maxCorner, o.metersPerPixel)
]
```

`nQ(point, metersPerPixel)` 把 meter 座標轉 pixel 座標（除以 metersPerPixel）。

---

## 8. `YX` 過濾器：只啟用相關 radio 類型

```js
filters: {
  includedWifiBands: e.enabledWifiBands,
  includeWifiRadios:    XZ.has(n),      // n = visualizationType
  includeCellularRadios: ZZ.has(n),
  includeBleRadios:     QZ.has(n),
  includeUwbRadios:     $Z.has(n),
  includeEnoceanRadios: eQ.has(n),
  includeZigbeeRadios:  tQ.has(n),
  overrideWifiBandChannels: e.overrideWifiBandChannels
}
```

每個 radio 類型有一個 `Set<visualizationType>` 決定「哪些可視化類型會啟用這類 radio」。如：
- `XZ` (WiFi set) 包 `MaxRssi`, `Snr`, `DataRate`, `Interference`, ...
- `ZZ` (Cellular set) 包 `MaxRsrp`, `CellularDataRate`, ...
- `QZ` (BLE set) 包 `MaxBleRssi`, ...
- `$Z` (UWB set) 包 `UwbMaxRssi`, `UwbAccuracy`, ...

這是**效能最佳化**：算 `MaxRssi` 時，蜂窩 / BLE / UWB radios 都不需納入計算，直接過濾掉。

---

## 9. 本專案的複現建議

### 9.1 採用 Progressive Protocol

重建 NPv1 的 `maxSamples:[...]` + 逐輪回傳設計。好處：
- 使用者立刻看到粗略結果（延遲 ~50ms）
- 精細結果 1-2 秒內到位
- 可隨時中斷（使用者又改了場景）

### 9.2 Gaussian Blur 選型

兩條路：
1. **wasm 端 blur**：計算完 grid 後在 Rust 裡做（separable 1D blur 兩 pass）
2. **GPU shader blur**：傳 raw grid 給 WebGL，在 fragment shader 做

本專案用 WebGL2 渲染 → 建議 **GPU 方案**，計算層只吐 raw dBm，blur 在顯示時做。這也符合 [CLAUDE.md](CLAUDE.md) 原則「clamp / 閾值 / 色階映射留在渲染端，Rust compute 吐原始 dBm」。

### 9.3 解析度決策

抄 NPv1 公式：`resolution = sqrt(maxSamples / viewport_m²)`。但：
- 本專案 viewport 單位是 **canvas pixel**，需要額外轉換
- 先以 `pixelsPerMeter = viewport.scale / metersPerCanvasPx` 拿到

### 9.4 Worker 職責切分

NPv1 分 9 個 worker。本專案 V1 不必這麼多。建議：

- `heatmapWorker`（主 RF 計算） — 用 Rust + wasm
- `sceneWorker`（場景解析 / BIM 匯入） — 純 JS 也可
- 其他功能（roaming / capacity / mesh）待有需求再切

### 9.5 Visualization Type enum

V1 先實作最核心 5 種：
- `MAX_RSSI` / `MAX_RSSI_UPLINK`
- `SNR`
- `SINR`
- `DATA_RATE`

其他 40+ 種列為未來 spec 可擴展點。

---

## 10. 04-heatmap-pipeline.md 需要更新的地方

根據 Task C 發現：

1. **Heatmap 類型數量**：原文「8 種」需改為「~50 種」
2. **Gaussian blur 預設存在**：不是只在拖拉時用，是 baseline
3. **Progressive 分輪機制**：需要補 `maxSamples[]` 列表邏輯
4. **Channel interference 不在此 worker**：是 mainWorker 專職

這些改動下面在 §11 執行。

---

## 11. 證據索引

| 位置 | 內容 |
|---|---|
| `progressiveHeatmapWorker-B2VeLWkY.js` @ 1110255 | `self.onmessage` switch topic `'p'` |
| @ 1109947 | `KQ(module, payload)` dispatch |
| @ 1109813 | `WQ()` 計算 progressPercentage |
| @ 1108974 | `RQ` Sentry init + postMessage helper `BQ` |
| @ 1103441 | `pQ` 場景準備 |
| @ 1102401 | `fQ` wasm Visualizer 呼叫 |
| @ 1102368 | `dQ = uQ[visualizationType]` dispatch |
| @ 1100310 | `uQ` 完整 dispatch table（~50 種） |
| @ 1100062 | `cQ(type, blur)` → getGaussianBlurredTile |
| @ 1098087 | `UZ` 解析度計算 |
| @ 1098023 | `HZ` √(maxSamples/area) 公式 |
