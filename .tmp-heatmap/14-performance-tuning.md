# 14. 效能調優：Worker 池 / Tile 化 / Cancelable 計算

本文件記錄 NPv1 的效能架構。目標：複現時知道「為什麼 NPv1 跑得動大 floor」，以及新版應照搬哪些做法。

---

## 1. 架構全景

```
Main Thread (React / Konva / index.js)
    ↓ postMessage
9 個 Web Worker（lazy-loaded）
    ├─ mainWorker               ── wasm engine instance #1
    ├─ buildingDataWorker       ── project / floor / walls 解析
    ├─ progressiveHeatmapWorker ── heatmap 分階段計算
    ├─ roamingHeatmapWorker     ── roaming 分析
    ├─ capacityMonitorWorker    ── 容量模擬
    ├─ meshConnectionsWorker    ── mesh 連線顯示
    ├─ antennaViewerWorker      ── 天線 3D 預覽
    ├─ mapPolygonsWorker        ── 地圖多邊形
    └─ offscreenCanvasWorker    ── OffscreenCanvas 背景渲染（2026-04-19 實測新發現）
          ↓ ThreadPool (wasm 內部 C++)
     多執行緒 tile 計算（需要 SharedArrayBuffer 才啟用；詳見 §7）
```

**2026-04-19 補註**：原分析只從 index.js grep 出 8 個 worker；實際在登入後觸發全部功能觀察 browser network，發現第 9 個 **`offscreenCanvasWorker-DMkgPcOi.js`**（148KB，不含 wasm）。推測用途：把 Konva / WebGL 畫布搬到 worker（OffscreenCanvas API），讓主執行緒徹底不參與渲染。這對新版架構是一個值得參考的作法。

---

## 2. Worker 分工（lazy load）

詳見 `summary.md` 與先前分析。關鍵事實：

- **全部 8 個都是 `()=>new Worker(new URL(...))` lazy factory**
- **`hamina.wasm` 由 worker 內部載入**（非 index.js），首屏不下載 6.6MB
- Vite 雜湊檔名：每次 build 變更都有新 hash，防止 CDN 快取污染

### 複現建議

新版若走「單 wasm + 多 worker」架構：

```
src/features/rf/
├── engineProxy.js        主執行緒代理
├── workers/
│   ├── heatmap.worker.js   專做 heatmap
│   ├── scene.worker.js     專做 scene 管理
│   └── ... 按功能分
└── rf-engine-wasm/        Rust → wasm build 產物
```

`new Worker(new URL('./workers/heatmap.worker.js', import.meta.url), { type: 'module' })` 讓 Vite 自動分 bundle。

---

## 3. Tile 化渲染：Viewport vs Static

### 3.1 核心 API（hamina.wasm）

```cpp
setViewportTileBox(viewportTileBox)    // 當前視窗範圍
setStaticTileBox(staticTileBox)         // 全圖範圍
observeViewportTileResult(observer)    // 訂閱可視區結果
observeStaticTileResult(observer)       // 訂閱全圖結果
getSmoothTile(tileParameters)
getGaussianBlurredTile(tileParameters, blurStdDev)
getTileStatistics(levels)
```

### 3.2 雙軌策略

1. **Viewport tile**：優先算當前螢幕看得到的區域，低延遲 feedback
2. **Static tile**：背景算全圖，靜止時才完整更新

### 3.3 Blur 作為低解析預覽

`getGaussianBlurredTile(params, blurStdDev)` 回傳**模糊化**的 tile。應用：
- 拖拉物件時用 blur 版本（計算量低，視覺可接受）
- 停止操作時切到 smooth 版本（高精度）

---

## 4. Cancelable 計算

### 4.1 證據

```cpp
getExpandedTileCancelable
getGaussianBlurredTileCancelable
getGaussianBlurredConfidenceTileCancelable
ShouldCancel  // callback class
```

### 4.2 為何重要

heatmap 計算 100~1000 ms 很常見。如果使用者在計算中又改了牆：
- **無 cancel**：舊計算跑完才開始新的，UI 卡頓、浪費 CPU
- **有 cancel**：立刻停舊計算，開始新的，UI 順暢

### 4.3 複現建議

Rust 端：用 `Arc<AtomicBool>` 傳 cancel flag，內部循環定期檢查。
JS 端：呼叫 `engineProxy.cancelPending()` 改變 atomic，worker 內部迴圈 early return。

```rust
pub fn compute_heatmap(scene: &Scene, cancel: Arc<AtomicBool>) -> Result<Heatmap, CancelError> {
    for row in rows {
        if cancel.load(Ordering::Relaxed) { return Err(CancelError); }
        // ... compute row
    }
    Ok(result)
}
```

---

## 5. 多解析度（Resolution ladder）

wasm 符號 `Resolution` + `getExpandedTile` 搭配使用。推測：
- 初版用低解析度（粗格子，如 1m x 1m）快速出結果
- 使用者停下來後用高解析度（0.25m x 0.25m）重算
- `getExpandedTile` = 用高解析度「擴展」（細化）低解析度版本

### 複現建議

多級解析度陣列：
```js
const RESOLUTIONS = [2.0, 1.0, 0.5, 0.25]  // meters per cell
// 先 2m 版本出圖（~0.1s）
// 使用者不動後逐級 upgrade 到 0.25m
```

---

## 6. ThreadPool（wasm 內部平行化）

### 6.1 證據

wasm 符號：
- `PNS1_10ThreadPoolE`（C++ class `hamina::ThreadPool*`）
- `VisualisationThreadWorkspaceManager`
- `AbstractVisualizationThreadWorkspace`
- `B2BS18move_only_functionIJFvvEEE` ← Boost task function

NPv1 的 C++ 內部**有** ThreadPool 架構。

### 6.2 但！ 本專案不能用（CLAUDE.md 已規範）

ThreadPool + SharedArrayBuffer 需要 COOP/COEP headers。本專案明確**禁用**（[CLAUDE.md](CLAUDE.md)：「不使用 COOP/COEP」、「不使用 SharedArrayBuffer」、「不使用 wasm-bindgen-rayon」）。

### 6.3 替代方案：多 Worker 分塊

主執行緒把 heatmap grid 切成 N 塊 → N 個 worker 各算一塊 → 結果拼回：

```
主執行緒:
  tiles = splitGrid(fullGrid, N)
  promises = tiles.map((tile, i) =>
    workers[i].compute(tile, scene).then(r => mergeInto(fullResult, r))
  )
  await Promise.all(promises)
```

每個 worker 各自載入 wasm instance、各自處理一塊 tile。
壞處：每 worker 都要 wasm instance（記憶體 × N）。
好處：不需 cross-origin isolation，可嵌第三方環境。

---

## 7. 異步 + Progress Callback

```cpp
getSurveyAttenuationTriangleAttenuatingEstimateAsync(
    ..., progressCallback, resultCallback, analysisDataObserver)
```

非同步 API 標準模式：
- `progressCallback(0.0~1.0)` — 更新進度條
- `resultCallback(result)` — 最終結果
- `analysisDataObserver` — 中間值（debug / analytics）

### 複現建議

```ts
interface AsyncComputation<T> {
  onProgress: (pct: number) => void
  onResult: (result: T) => void
  onCancel: () => void
  cancel(): void  // user-triggered
}
```

長時間計算（≥ 200ms）一律走此介面，配合 UI 進度條。

---

## 8. 主執行緒的效能技巧（index.js）

### 8.1 常見 hooks

index.js 出現：
- `debounce` / `debouncedFlush`
- `throttle` / `throttleTime` / `throttledAddEvent`
- `requestIdleCallback`
- `batch` / `defer` / `deferredOperations` / `deferSpec`
- `lazy` / `lazyCloseTimeout`

### 8.2 建議落地位置

| 場景 | 技巧 |
|---|---|
| 拖拉中的 heatmap 重算 | Throttle 50~100ms |
| 面板 input 更新後重算 | Debounce 300~500ms |
| 儲存草稿 | `requestIdleCallback` |
| 多筆 mutation | `batch`（單次 state 更新） |
| 畫面外面板、teleport 預覽 | `lazy` / React.lazy |

### 8.3 在本專案

Zustand + React 17 的配合：
- mutations 內部 batch（Zustand set 是同步，可連續呼叫）
- RF heatmap 更新走 `engineProxy.updateScene()` debounce
- 重型面板（FormulaPanel 等）用 code split

---

## 9. 效能驗收基準（可用於驗證新版 ≥ 舊版）

舊版實測需到 NPv1 試用站量測（本次未做），但可抓以下數字當 target：

| 操作 | 可接受 | 目標 |
|---|---|---|
| 開啟 500m² 案場（~300 牆, 10 AP） | < 3 s | < 1 s |
| 初次 heatmap 計算（500m²） | < 2 s | < 500 ms |
| 拖拉牆 heatmap 即時更新 | 30+ fps | 60 fps |
| 放牆後精緻版 heatmap | < 1 s | < 300 ms |
| Floor 切換 | < 500 ms | < 100 ms |
| Undo / Redo | < 50 ms | < 20 ms |
| 記憶體（整 session） | < 500 MB | < 300 MB |

驗收時用 Performance panel 錄 flame chart + 用 DevTools Memory heap snapshot。

---

## 10. 複現實作 checklist

- [ ] 多 Worker 架構（至少 heatmap worker 獨立）
- [ ] Cancelable computation（Arc<AtomicBool> + Rust 迴圈檢查）
- [ ] Tile-based 漸進渲染（viewport 優先、static 背景）
- [ ] Blur 低解析版本（拖拉時）
- [ ] 多解析度 ladder（2m → 0.25m）
- [ ] Debounce heatmap update（主執行緒側）
- [ ] Progress callback 介面（長計算必備）
- [ ] Heatmap 結果走 transferable ArrayBuffer（[CLAUDE.md](CLAUDE.md) 既定）
- [ ] 記憶體上限監控（Worker 多→記憶體多，需要關閉閒置 worker）

---

## 11. 證據索引

| 來源 | 證據 |
|---|---|
| index.js | 8 個 worker `new Worker(new URL(...))` factory |
| hamina.wasm | `setViewportTileBox`, `setStaticTileBox`, `observeViewportTileResult`, `observeStaticTileResult` |
| hamina.wasm | `getSmoothTile`, `getGaussianBlurredTile`, `BlurredTileParameters`, `TileParameters` |
| hamina.wasm | `getExpandedTile`, `Resolution`（多解析度） |
| hamina.wasm | `*Cancelable` 變體多個, `ShouldCancel` class |
| hamina.wasm | `ThreadPool`, `VisualisationThreadWorkspaceManager`, `AbstractVisualizationThreadWorkspace` |
| hamina.wasm | `getTileStatistics(levels)` |
| hamina.wasm | `progressCallback`, `resultCallback`, `analysisDataObserver` in `*Async` APIs |
| hamina.wasm | 43 種 `TileVisualizer`（SNR / RSSI / Rsrp / Bluetooth / DataRate / ChannelInterference / ...） |
| index.js | `debounce`, `throttle`, `requestIdleCallback`, `batch`, `defer`, `lazy` |
