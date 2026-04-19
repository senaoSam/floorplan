# 16. mainWorker Protocol 與 Embind API 使用

**Task B 產出**。解析 `mainWorker-HFjmjknA.js` 的 postMessage 協定與 wasm 呼叫鏈。

---

## 1. 簡版 mermaid

```
Main Thread (index.js)
    │
    │ postMessage({ topic: 'r', payload: { visualizationInput, predictionMode } })
    ↓
mainWorker
    │
    ├─ await WZ() → lazy import('./hamina-D07_0Pul.js') → embind Module
    ├─ lQ(module, payload)
    │     ├─ IZ(module, input, predictionMode)
    │     │     ├─ YX(...) ── 建立 hamina.Building, 套用 slab 幾何
    │     │     ├─ new module.Visualizer(building)
    │     │     ├─ new module.VisualizerSettings
    │     │     │     .setPredictionMode(predictionMode)
    │     │     │     .setPathLossExp(input.pathLossExponent || 2)
    │     │     ├─ visualizer.configure(settings)
    │     │     ├─ visualizer.setMapId(input.mapData.id)
    │     │     └─ visualizer.monitorChannelInterference(-72, -82, -82, 0.25, 50, 1/20, 10)
    │     │            → Map<radioId, interferenceLevel>
    │     └─ 過濾 rssi > PZ(radio) → Set<radioId>（強干擾者）
    │
    └─ postMessage({ topic: 'r', payload: Set<radioId> })
```

---

## 2. 入口 postMessage protocol

### 2.1 輸入（client → worker）

```ts
{
  topic: 'r',    // 單一 topic
  payload: {
    visualizationInput: {
      aps: Array<{
        id: string
        radios: Array<{
          id: string
          // ...band, frequency, etc.
        }>
      }>
      mapData: { id, floorThickness, bounds, ... }
      pathLossExponent?: number                  // 預設 2
      holeInFloorZones: Array<HoleInFloorZone>
      slopedFloors: Array<SlopedFloor>
      raisedFloorZones: Array<RaisedFloorZone>
      autoSlab: AutoSlab
      cachedAntennas: Array<Antenna>
      metersPerPixel: number
      adjacentFloors?: {
        belowFloors?: AdjacentFloor[]
        aboveFloors?: AdjacentFloor[]
      }
      optimizeChannels?: boolean
    }
    predictionMode: string   // 具體值未直接出現，推測 "DPM" | "ACCURATE" | "FAST"
  }
}
```

### 2.2 輸出（worker → client）

```ts
{
  topic: 'r',
  payload: Set<string>     // 被視為強干擾的 radio id 集合
}
```

**這個 `mainWorker` 不是算 heatmap 的**——是算「哪些 AP 的 radio 在當前視覺化設定下，對其他 AP 造成強干擾」，用於 channel planning 上游輔助。真正 heatmap 是 `progressiveHeatmapWorker` 的工作（Task C）。

---

## 3. Embind 使用模式：RAII-style `deleteLater`

Embind 綁的 C++ 物件在 JS 側是 handle，必須手動 `.delete()` 釋放（wasm heap 記憶體）。NPv1 用 closure helper：

```js
function nf(e) {
  let t = new Set
  let n = (e) => (e && t.add(e), e)           // deleteLater(obj) → 登記
  let r = (e) => (e && t.delete(e), e)        // release(obj) → 取消登記（通常 return）
  try {
    return e({ deleteLater: n, release: r })
  } finally {
    for (let o of t) o.delete()                // 自動釋放
  }
}
```

使用：

```js
const IZ = (module, input, predictionMode) => nf(({deleteLater: r, release}) => {
  let a = r(YX({ hamina: module, input, filters: FZ, predictionMode }))
  let o = r(new module.Visualizer(a))
  let s = r(new module.VisualizerSettings)
  s.setPredictionMode(predictionMode)
  s.setPathLossExp(input.pathLossExponent || 2)
  o.configure(s)
  o.setMapId(input.mapData.id)
  let c = o.monitorChannelInterference(-72, -82, -82, 0.25, 50, 1/20, 10)
  if (!c) throw Error(`Can't access access point monitor`)
  let l = new Set
  let i = /*... 從 aps.radios 建 Map */
  for (let [id, t] of c) {
    let n = i.get(id)
    if (n && t > PZ(n)) l.add(id)
  }
  return l
  // 離開 nf 時，a/o/s 自動 .delete() 釋放 wasm heap
})
```

**這個模式對新版 Rust + wasm-bindgen 也適用**——Rust 側若用 `#[wasm_bindgen]` class 也需要 JS 呼叫 `.free()`，這個 helper 可以直接照抄。

---

## 4. `monitorChannelInterference` 魔術數字解碼

```js
visualizer.monitorChannelInterference(
  -72,    // associationLimitDBm        (client 能關聯的最低 RSSI)
  -82,    // clientRssiLimitDBm         (算覆蓋的底線)
  -82,    // mutualRssiLimitDBm         (AP-AP 互擾判定底線)
  0.25,   // interferenceShareLimit     (允許的干擾占比)
  50,     // absMinClientPointsDirection(每方向至少 client 點數)
  1/20,   // = 0.05 minClientPointsPerMDirection (每公尺 client 點密度)
  10      // minClientPointsPerRadioOnBand
)
```

函式簽章與 hamina.wasm 字串對應：
```
monitorChannelInterference(
  associationLimitDBm, clientRssiLimitDBm, mutualRssiLimitDBm,
  interferenceShareLimit, absMinClientPointsDirection,
  minClientPointsPerMDirection, minClientPointsPerRadioOnBand)
```

這批參數可視為 NPv1 的**預設 channel planning profile**。新版若要做 channel optimizer，可用這組當 baseline。

---

## 5. `PZ` — Band 敏感度 margin

```js
const PZ = e =>
  Vd(e) === `BAND_2_4` ? 3.5 : 0.5
```

- 2.4 GHz radio：干擾門檻 3.5 dB
- 5 GHz / 6 GHz radio：干擾門檻 0.5 dB

2.4G 本來就擁擠（只有 3 個不重疊頻道），容忍度較低 → 反而要等到干擾超過 3.5 dB 才算嚴重。
5/6G 頻道多，容忍度高 → 0.5 dB 就算強干擾。

---

## 6. `FZ` — 預設 Radio 類型 filter

```js
const FZ = {
  includedWifiBands: { BAND_2_4: true, BAND_5: true, BAND_6: true },
  includeWifiRadios: true,
  includeCellularRadios: false,
  includeBleRadios: false,
  includeUwbRadios: false,
  includeEnoceanRadios: false,
  includeZigbeeRadios: false
}
```

NPv1 支援的 radio 類型：**Wifi / Cellular / BLE / UWB / EnOcean / Zigbee**（6 種）。WiFi 是此 worker 的主焦點，其他默認關閉。

---

## 7. 完整 `VisualizationType` enum（40+ 種）

`mainWorker` 中 dump 出的字串常數（搜 `e.MaxRssi=`）：

```
ChannelUtilizationNonWifi = 'CHANNEL_UTILIZATION_NON_WIFI'
ChannelUtilizationWifi    = 'CHANNEL_UTILIZATION_WIFI'
DataRate                  = 'DATA_RATE'
DataRateUplink            = 'DATA_RATE_UPLINK'
EnoceanMaxRssiUplink      = 'ENOCEAN_MAX_RSSI_UPLINK'
EnoceanSecondaryRssiUplink = 'ENOCEAN_SECONDARY_RSSI_UPLINK'
EnoceanTertiaryRssiUplink = 'ENOCEAN_TERTIARY_RSSI_UPLINK'
Interference              = 'INTERFERENCE'
MaxBleRssi                = 'MAX_BLE_RSSI'
MaxBleRssiUplink          = 'MAX_BLE_RSSI_UPLINK'
MaxRsrp / MaxRsrpUplink
MaxRssi / MaxRssiUplink
SecondaryBleRssi / SecondaryBleRssiUplink
SecondaryRsrp / SecondaryRsrpUplink
SecondaryRssi / SecondaryRssiUplink
Sinr / SinrUplink
Snr / SnrUplink
TertiaryBleRssi / TertiaryBleRssiUplink
TertiaryRsrp / TertiaryRsrpUplink
TertiaryRssi / TertiaryRssiUplink
UwbAccuracy / UwbDop / UwbMaxRssi / UwbMaxRssiUplink
...
```

**原 04-heatmap-pipeline.md 列 8 種是嚴重低估**，實測 40+ 種。分類：
- Primary / Secondary / Tertiary（依信號強度排名；第 1/2/3 強的 AP）
- Downlink / Uplink（方向）
- WiFi / BLE / Cellular (Rsrp) / UWB / Enocean 技術
- Rssi / Snr / Sinr / DataRate / Interference / ChannelUtilization 指標
- UwbAccuracy / UwbDop — 室內定位專屬

---

## 8. `PredictionMode` 實際值

wasm C++ 端有 `PredictionModeControl` struct，包 `predictionMode` 與 `autoWallsStatus` 兩欄位。具體 enum 值**在 wasm 字串中未找到明確列表**（可能是 int enum 或動態字串）。推測 2-3 種：
- `"ACCURATE"` / `"FAST"`（快慢兩檔）
- 或 `"DPM"` / `"RAYTRACING"`（演算法類型）
- 或 int `0 / 1 / 2`

**待實測 NPv1 站補齊**。本專案複現時可先單 mode，需要調整時再擴展。

---

## 9. 建築場景處理（`YX` / `XX` / `QX` 等）

`mainWorker` 在做 channel interference 計算前，會先重建完整 **多樓層 3D 場景**：

```js
const XX = e => {
  let t = new OT(e.input.cachedAntennas)          // 天線池
  let n = ld(e.input.mapData)                     // 當層座標矩陣
  let r = KX(e.input.metersPerPixel)
  let i = r.clone().multiplyRight(n.clone().invert())  // world → lib 變換
  let a = $X(i, e)                                // slab polygon
  let o = { ...e, slabLibPolygon: a, cachedAntennaMap: t, worldToLibMatrix: i }

  QX({ ...o, belowFloors: e.input.adjacentFloors?.belowFloors ?? [] })
  UX({ ...o, ceiling: e.input.adjacentFloors?.aboveFloors?.[0] })
  rZ({ ...o, aboveFloors: e.input.adjacentFloors?.aboveFloors ?? [] })
}
```

**意義**：`mainWorker` 的 channel planning **會考慮上下樓層**（跨樓層干擾）——這和 11-cross-floor-propagation.md 講的 `fullBuildingPropagation` 是同一件事。

處理的樓層要素：
- `holeInFloorZones`（天井、挑高、中庭）— 不產生 slab
- `slopedFloors.slabOnly` — 只要 slab 的版本
- `raisedFloorZones.slabOnly` — 抬高樓板的 slab
- `autoSlab` — 自動偵測的 slab
- `worldTransformation` — 每樓層的對齊變換

---

## 10. 複現架構建議

### 10.1 Worker message protocol

抄 NPv1 的 `{ topic, payload }` 結構，但擴展多 topic：

```ts
// request
type RfRequest =
  | { topic: 'scene/load',       payload: Scene }
  | { topic: 'scene/patch',      payload: Patch[] }
  | { topic: 'compute/heatmap',  payload: HeatmapRequest, requestId: string }
  | { topic: 'compute/channel',  payload: ChannelRequest, requestId: string }
  | { topic: 'compute/cancel',   payload: { requestId: string } }

// response
type RfResponse =
  | { topic: 'ready' }
  | { topic: 'result',   payload: ComputeResult, requestId: string }
  | { topic: 'progress', payload: { pct: number }, requestId: string }
  | { topic: 'error',    payload: { message: string }, requestId: string }
```

requestId 必要——用 async postMessage pattern 對應 promise resolve。

### 10.2 RAII 釋放策略

Rust + wasm-bindgen 也有 `.free()` 問題。建議套用 NPv1 `nf` closure helper：

```ts
function withDisposable<T>(fn: (deleteLater: <U extends { free(): void }>(obj: U) => U) => T): T {
  const toFree: Array<{ free(): void }> = []
  const deleteLater = <U extends { free(): void }>(obj: U) => { toFree.push(obj); return obj }
  try { return fn(deleteLater) }
  finally { for (const o of toFree) o.free() }
}
```

### 10.3 Channel interference API 設計

重建 `monitorChannelInterference`，但把魔術數字改成 config object：

```ts
interface ChannelInterferenceConfig {
  associationLimitDBm:          number  // default -72
  clientRssiLimitDBm:           number  // default -82
  mutualRssiLimitDBm:           number  // default -82
  interferenceShareLimit:       number  // default 0.25
  absMinClientPointsDirection:  number  // default 50
  minClientPointsPerMDirection: number  // default 0.05
  minClientPointsPerRadioOnBand: number // default 10
  bandMargin: { BAND_2_4: number, BAND_5: number, BAND_6: number }  // default {3.5, 0.5, 0.5}
}
```

---

## 11. 證據索引

| 證據 | 位置 |
|---|---|
| `onmessage` switch-on-topic | `mainWorker-HFjmjknA.js` @ offset 1100958 |
| `lQ` dispatch function | @ offset 1100834 |
| `IZ` compute function | @ offset 1095528 |
| `PZ` (band margin) | @ offset 1095306 |
| `FZ` (radio filter) | @ offset 1095338 |
| `YX` (scene builder) | @ offset 1082438 |
| `JX` (Building factory) | @ offset 1082258 |
| `XX` (cross-floor handler) | @ offset (隨 YX) |
| `nf` (RAII closure) | @ offset 194238 |
| `VisualizationType` enum (40+ values) | @ offset 357400 |
| `monitorChannelInterference` 簽章 | `hamina.wasm` strings @ L624813 |
| `PredictionModesType` / `PredictionModeControl` | `hamina.wasm` strings @ L630335, L630495 |
