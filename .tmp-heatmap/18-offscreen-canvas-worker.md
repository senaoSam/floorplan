# 18. OffscreenCanvas Worker & Comlink RPC

**Task D 產出**。`offscreenCanvasWorker-DMkgPcOi.js` 角色與原先推測**完全不同**。

---

## 1. 結論一句話

這不是「把主畫布搬到 worker」的通用渲染 worker，而是**專門做視覺特效紋理**的 worker，用 OffscreenCanvas 2D 作為**像素處理工具**產生 WebGL texture，然後傳回主執行緒的 WebGL 渲染管線。

---

## 2. 暴露的 API（Comlink-exposed）

```ts
{
  computeWallGlowTexture(...)              // 牆體輝光紋理
  computeWallFillTexture(...)              // 牆體填充紋理
  computeShadowTexture(...)                // 陰影紋理
  computeShadowTextureAndMesh(floor, ...)  // 陰影紋理 + 三角網格
  computeAutoScopeMask(...)                // AutoScope 區域遮罩
  computeAttenuatingZoneGlowTexture(...)   // Zone 輝光紋理
}
```

---

## 3. Comlink：主↔Worker RPC 實作

NPv1 **不**用裸 `postMessage`，用 [Comlink](https://github.com/GoogleChromeLabs/comlink) 包 proxy：

```js
// 主執行緒（推測）
const worker = new Worker('/assets/offscreenCanvasWorker-XXX.js', { type: 'module' })
const api = Comlink.wrap(worker)
const texture = await api.computeShadowTexture(floorData, lightSource)  // 看起來像同步
```

worker 端自動處理 `GET / SET / APPLY / CONSTRUCT / ENDPOINT / RELEASE` 訊息，裝飾 proxy；FinalizationRegistry 自動清理。Comlink 優點：
- 主執行緒看來像 function call，不用手寫 postMessage / onmessage
- 型別傳遞（arguments / return）由 Comlink 序列化
- 支援 transferable objects（OffscreenCanvas / ImageBitmap / ArrayBuffer）自動轉移

---

## 4. OffscreenCanvas 在這裡的角色

`OffscreenCanvas` 一般有兩種用法：
1. **Transfer from main**：主執行緒的 `<canvas>` 呼叫 `canvas.transferControlToOffscreen()`，把渲染權交給 worker（worker 端畫 → 直接顯示）
2. **Worker own canvas**：worker 自己 `new OffscreenCanvas(w, h)`，畫完用 `transferToImageBitmap()` 丟回主執行緒

NPv1 用 **第 2 種**——OffscreenCanvas 當**離螢幕畫布**用來產生紋理（2D context 畫 polygon / shadow / blur），完成後轉 ImageBitmap → 主執行緒上 WebGL `gl.texImage2D(..., imageBitmap)`。

---

## 5. 實際 compute 函式範例：`computeShadowTextureAndMesh`

從 tail 拆解：
```js
computeShadowTextureAndMesh: (e, t, n, r, i) => {
  let a = bt(e, n, r, i)                                 // 1. 算陰影紋理 (bt)
  if (!a) return
  let o = At([[[[n.minX,n.minY], [n.maxX,n.minY], ...]]]) // 2. 建地板矩形 polygon (At)
  let s = At(t)                                           // 3. 建實際樓板 polygon
  let c = Tl(o, s)                                        // 4. 算「排除區」= 地板矩形 - 實際樓板
  if (!c || !c.geometry) return
  let l = []
  if (c.geometry.type === 'Polygon')
    l = Dl(c.geometry.coordinates.map(...))                // 5. earcut 拆三角形 (Dl)
  else
    for (let e of c.geometry.coordinates) { ... }
  return {
    texture: a,                                            // 紋理
    mesh: Ol(l, n.minX, n.minY, n.maxX, n.maxY, false)    // 頂點 + UV + normal
  }
}
```

工作管線：
1. 從 AP / 光源位置 + 牆幾何 → 算出陰影圖（像素寫入 OffscreenCanvas）
2. 把地板邊界轉成 polygon
3. 用 turf.js / martinez（`Tl` 可能是 polygon union/diff）算陰影覆蓋區域
4. earcut triangulation 把多邊形拆三角形
5. 組 `{ texture, mesh(positions + texCoords + normals) }` 回傳
6. 主執行緒 WebGL 用這個 texture + mesh 繪製有陰影的地板

---

## 6. 混合 AutoScope / 牆輝光 / Zone 輝光

其他暴露的 compute function 做類似的事：

| 函式 | 產出 | 用途 |
|---|---|---|
| `computeWallGlowTexture` | 紋理 | 牆體選中 / hover 時的發光邊框 |
| `computeWallFillTexture` | 紋理 | 牆體內部 diagonal line / pattern |
| `computeShadowTexture` | 紋理 | 地板陰影 |
| `computeAutoScopeMask` | 遮罩 | 自動偵測 scope 區域的 alpha 遮罩 |
| `computeAttenuatingZoneGlowTexture` | 紋理 | Zone 選中 / hover 發光 |

都是重計算操作（多邊形運算 + 像素繪製），放 worker 不卡主執行緒。

---

## 7. 重大發現：NPv1 **有** Ray Tracing 模式！

`offscreenCanvasWorker` 尾段的 feature flag 設定：

```js
{
  autoMaterialWallsEnabled: true,
  buildingViewEnabled: true,
  cableRisersEnabled: true,
  cableTraysEnabled: true,
  channelWidthAutoInterferenceConfigurable: true,
  clipProductEnabled: true,
  combinedApToolEnabled: true,
  devToolMenuEnabled: true,
  envLearningLayersEnabled: true,
  fastRayTracingEnabled: true,           // ← !!!
  homeMarkerToolEnabled: true,
  invoiceRequestEnabled: true,
  liveClientMaskingButtonEnabled: true,
  liveClientsEnabled: true,
  mapAlterationEnabled: true,
  showAllSurveyedApsEnabled: true,
  showHolidayShippingInfo: false,
  simulatedLiveClientRoamsEnabled: true,
  switchToSwitchEnabled: true,
  teamsEnabled: true,
  universalSnapEnabled: true,            // ← universal snap（summary §2.5 提到的 snap:mn）
  uwbExperimental: false,
  vendorRoutesEnabled: true,
  wifiRequirementsHeatmapUplinkEnabled: false
}
```

同樣的 config 也出現在 `mainWorker`, `progressiveHeatmapWorker`, `roamingHeatmapWorker`, `capacityMonitorWorker`。

### ⚠️ 這推翻了先前分析的結論

早期 summary / 11-cross-floor-propagation.md 寫：「NPv1 無 3D RF 計算，無 ray tracing」。
**這部分要更正**：

- **有 `fastRayTracingEnabled` feature flag，預設 true**
- 雖然此 flag **具體影響到哪個 wasm function** 還未追到，但既然被 4 個不同的 worker 讀，代表是**計算層**（不是 UI）的行為旗標
- 可能的含義：
  - (A) 新版 DPM 用 **快速 ray tracing**（限制 bounce 數）取代純 DPM — 可能
  - (B) 3D ray tracing 是 opt-in 實驗功能，平常走 DPM — 也可能
  - (C) 只是個名字，內部是更快版 DPM — 機率較低

### 需要進一步查證

- wasm 字串中搜 "fast" / "ray" 相關的函式簽章（已試過，grep 無具體發現）
- 登入 NPv1 實測切換 predictionMode 看效能差異
- 若有 GraphQL schema 有 `fastRayTracing` 欄位，可從 07-graphql-schema.md 補 query

---

## 8. 其他新 feature flag（給長官報告用）

重要的產品 feature（從 flag 名判斷）：

| Flag | 意義（推測） | 新版可擴展點 |
|---|---|---|
| `autoMaterialWallsEnabled` | ML 自動偵測牆材質 | ✅ 已知（10-scene-objects-simplifications.md） |
| `buildingViewEnabled` | 3D 建築總覽 | ✅ 已知 |
| `cableRisersEnabled` | 線纜豎井 | 新！ |
| `cableTraysEnabled` | 線纜托盤 | 新！ |
| `channelWidthAutoInterferenceConfigurable` | 使用者可調 interference 閾值 | 新！ |
| `clipProductEnabled` | 產品 clipboard 功能 | 新？ |
| `combinedApToolEnabled` | 合併 AP 工具 | 新？ |
| `envLearningLayersEnabled` | 環境學習圖層 | ✅ 已知 |
| **`fastRayTracingEnabled`** | **快速 ray tracing** | **重大**：新版可選更精準算法 |
| `homeMarkerToolEnabled` | Home marker 標記 | 新？ |
| `liveClientMaskingButtonEnabled` | 即時 client 遮罩切換 | ✅ 已知 |
| `liveClientsEnabled` | 即時 client 追蹤 | ✅ 已知 |
| `mapAlterationEnabled` | 地圖修改權限 | 新 |
| `simulatedLiveClientRoamsEnabled` | 模擬 live client 漫遊 | 新 |
| `switchToSwitchEnabled` | switch 對 switch 網狀連線 | 新 |
| `teamsEnabled` | 多人協作 | 新！ |
| `uwbExperimental` | UWB 實驗功能 | 已知 |
| `universalSnapEnabled` | 全域吸附 | ✅ 已知 |
| `vendorRoutesEnabled` | 廠商路由管理 | 新 |
| `wifiRequirementsHeatmapUplinkEnabled` | Uplink 需求 heatmap | 新 |

共 **20+ feature flags**，部分是 summary §3.4 建議可擴展點已列的，但至少有 10 個是新發現（cable trays / risers / teams 協作 / switch topology / combined AP tool / ...）。

---

## 9. 本專案的啟示

### 9.1 Comlink 值得採用

- 比手寫 `{ topic, payload }` 清爽很多（topic + switch 會越寫越長）
- 支援 transferable 自動處理
- 型別可配 TS 共享介面

Rust + wasm-bindgen 輸出的 worker API 可以直接用 Comlink 包：

```ts
// worker.ts
import * as Comlink from 'comlink'
import init, { RfEngine } from './rf-engine-wasm'
await init()
Comlink.expose({
  createEngine: () => new RfEngine(),
  computeHeatmap: (sceneJson) => { /* ... */ }
})
```

### 9.2 OffscreenCanvas 特效 worker

本專案目前沒有相應設計。建議 V2：
- 把 wall glow / shadow / zone highlight 等特效移到 worker
- 可用 Comlink 介面暴露：`computeWallGlowTexture(floorId) -> ImageBitmap`
- 透過 transferable 傳回主執行緒貼到 Konva Image / WebGL texture

好處：主執行緒只需發請求 + 收 ImageBitmap（幾 ms 的 GPU 上傳），繪圖效能提升。

### 9.3 Ray Tracing 可擴展點

報告給長官可列為**關鍵差異點**：NPv1 已上線 `fastRayTracingEnabled` flag。新版若要競爭，至少要：
- 支援同等「DPM + fast ray tracing」雙模式切換
- UI 提供「精準 vs 快速」開關
- 效能目標：fast ray tracing 模式下仍能 < 1s 完成 500m² 案場

---

## 10. 證據索引

| 位置 | 內容 |
|---|---|
| `offscreenCanvasWorker-DMkgPcOi.js` @ 36367 | Comlink message listener 1 (RPC dispatch) |
| @ 37521 | Comlink message listener 2 (response handling) |
| @ 60661 / 60948 / 61812 | `OffscreenCanvas` 使用處 |
| @ 尾部 | 暴露的 compute function 列表 |
| @ 尾部 | feature flag 完整設定 |
| `mainWorker-HFjmjknA.js` @ 484980, 486619, 488300 | `fastRayTracingEnabled` 使用處 |
| `progressiveHeatmapWorker-B2VeLWkY.js` | 同樣含 `fastRayTracingEnabled` |
| `roamingHeatmapWorker-JzaFazwK.js` | 同樣含 `fastRayTracingEnabled` |
| `capacityMonitorWorker-d2_6YU4s.js` | 同樣含 `fastRayTracingEnabled` |
