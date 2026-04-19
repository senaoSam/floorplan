# 15. wasm Glue 與 Toolchain 分析

**Task A 產出**。來源：`.tmp-npv1/assets/hamina-*.js` 共 7 份 glue + 9 個 worker bundle。
**分析日期**：2026-04-19。

---

## 1. Toolchain：Emscripten + Embind（不是 wasm-bindgen）

早期分析推測 NPv1 用 Rust + wasm-bindgen，**這是錯的**，實測證據：

- glue 裡大量 `_emscripten_*` 函式：`_emscripten_builtin_malloc`, `_emscripten_thread_init`, `_emscripten_run_js_on_main_thread`, `_emscripten_check_mailbox`, ...
- 完整 **Embind** API：`__embind_register_class`, `__embind_register_class_function`, `__embind_register_class_constructor`, `__embind_register_class_property`, `__embind_register_smart_ptr`, `__embind_register_value_object`, `__embind_register_optional`, `__embind_register_std_string`, `__embind_register_std_wstring`, `__embind_finalize_value_array`, `__embind_initialize_bindings`, ...
- `em-pthread` Worker 名稱標識
- wasm C++ ABI：先前 wasm strings dump 中的 `NSt3__2...`, `N6hamina3api7graphql...` 都是 **Itanium C++ mangling**，與 Emscripten 輸出一致

**影響**：NPv1 的 RF 引擎是用 **C++ + Emscripten** 編譯的，不是 Rust。本專案選 Rust + wasm-pack 是合理的現代替代（Rust 記憶體安全、編譯速度快），但要注意 **Emscripten 能綁 C++ class 到 JS**，而 Rust + wasm-bindgen 只能綁 function + struct（無 virtual method / 多型）—— 如果新版架構需要仿 NPv1 的 `Module.XxxClass` 風格，要改走 **trait object + opaque pointer** 模式。

---

## 2. 執行緒模型：需要 SharedArrayBuffer + COOP/COEP

NPv1 glue 明確檢查：

```js
typeof SharedArrayBuffer>`u` && console.log(`Warning: SharedArrayBuffer is not detected, which may affect WASM threading capabilities.`)
crossOriginIsolated || console.log(`Warning: crossOriginIsolated is false, which may affect WASM threading capabilities.`)
```

- 用 **Emscripten pthread**（`-pthread` / `-sUSE_PTHREADS=1`）
- 需要 `SharedArrayBuffer`（瀏覽器預設只在 `crossOriginIsolated` 為 true 時啟用）
- 需要後端送出 `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`

實測：`us.hamina.com` 確實設置了 COOP/COEP（否則 pthread 無法跑），所以 **NPv1 自己能用是因為 domain 自控**。

### ⚠️ 本專案為何不能走這條路

本專案 [CLAUDE.md](../CLAUDE.md) 明確禁用 SAB：

> 產品未來需嵌入第三方環境,無法保證 same-origin

當 floorplan UI 以 iframe / embed 形式進別人的系統，我們無法要求宿主頁面設置 COOP/COEP。一旦沒 CrossOriginIsolation，pthread / SAB 全都死。

所以本專案選 **多 Worker 分塊 + transferable ArrayBuffer**，放棄 wasm 內部多執行緒。這與 NPv1 的架構決策**根本性不同**，不是「實作差異」而是「約束條件不同」。

---

## 3. wasm URL

所有 glue 載同一個 wasm：

```
/assets/hamina-DzbGwBcv.wasm   (6.4 MB)
codeId: 10de1734cf7fef57538c63190cc949d564 (stable across glues)
debugFile: hamina.debug.wasm   ← 推測是 DWARF debug symbols，未公開
```

9 個 worker 各自 fetch 這個 wasm，各自 compile 一次（因此記憶體成本 ≈ 6.4MB × 9 = 58 MB）。瀏覽器對 `WebAssembly.compile` 有 cache，實務上只有網路費 6.4MB 一次，但 compile 結果 per-worker 獨立。

---

## 4. Glue 檔配對（每 worker 獨立一份）

| Worker | Glue |
|---|---|
| mainWorker-HFjmjknA.js | **hamina-D07_0Pul.js** |
| progressiveHeatmapWorker-B2VeLWkY.js | **hamina-ODTbAoGI.js** |
| roamingHeatmapWorker-JzaFazwK.js | **hamina-CJIujPVS.js** |
| capacityMonitorWorker-d2_6YU4s.js | hamina-CHRqgdPw.js |
| meshConnectionsWorker-DaaurNLj.js | hamina-DLRjsB10.js |
| antennaViewerWorker-vbvmoCI2.js | **hamina-CwtMENiB.js** |
| buildingDataWorker-D82HD6Bb.js | (無獨立，推測內嵌或無需 wasm) |
| mapPolygonsWorker-DLc26fTQ.js | (無獨立) |
| offscreenCanvasWorker-DMkgPcOi.js | (無獨立，渲染 worker 不需 wasm) |

**six 份 glue 內容幾乎相同**（每份 ~80KB），差異只在：
- `codeId` 雜湊
- `import {t as e} from "./<該 worker 檔名>"`（指向父 worker）
- Sentry `debugId` UUID

即 Vite 對每個用到 wasm 的 worker 獨立 bundle 一份 glue。本專案若用 Rust + wasm-pack 也會有類似行為，不是 NPv1 特有。

---

## 5. Embind 綁定的 C++ API 概覽

Embind 支援的綁定種類（來自 glue）：

| Embind 函式 | 綁定類型 |
|---|---|
| `__embind_register_class` | C++ class |
| `__embind_register_class_constructor` | constructor |
| `__embind_register_class_function` | member method |
| `__embind_register_class_class_function` | static method |
| `__embind_register_class_property` | field |
| `__embind_register_smart_ptr` | `std::shared_ptr<T>` |
| `__embind_register_value_object` | POD struct |
| `__embind_register_value_array` | fixed-size array |
| `__embind_register_optional` | `std::optional<T>` |
| `__embind_register_std_string` / `_std_wstring` | 字串 |
| `__embind_register_integer/float/bool/bigint` | scalars |
| `__embind_register_memory_view` | 直接共享 memory view（不 copy） |
| `__embind_register_emval` | `emscripten::val`（JS 值在 C++ 側操作） |

綁定的實際 class 名稱在 wasm binary 裡（先前 dump 看過的 `DpmPathLossCalculator`, `MlWallType`, `AutoWall`, `MeasurementProvider`, `ThreadPool`, 等等）。

---

## 6. mainWorker postMessage Protocol（Task B 預告）

粗略抓到 mainWorker 的入口：

```js
self.onmessage = async (e) => {
  let t = await WZ(),                    // embind module (lazy init)
      { topic: n, payload: r } = e.data
  switch (n) {
    case `r`:                             // 'r' = "run / render"
      return lQ(t, r)                     // dispatch
  }
}

const lQ = (e, t) => {
  let { visualizationInput, predictionMode } = t
  let i = visualizationInput
        ? IZ(e, visualizationInput, predictionMode)  // actual compute
        : new Set
  self.postMessage({ topic: `r`, payload: i })
}
```

- 入：`{ topic: 'r', payload: { visualizationInput, predictionMode } }`
- 出：`{ topic: 'r', payload: <Set or computed result> }`
- 核心：`IZ(module, input, mode)` — 這是真正的計算 dispatch，需要 Task B 分析

`visualizationInput` 結構沒看到定義（可能動態結構），應該包含：
- heatmap type（RSSI / SNR / data rate / ...）
- viewport box
- resolution
- floor id
- ...

Task B 會專門解 `IZ` 與 `predictionMode` 的定義。

---

## 7. 對本專案（新版重寫）的啟示

### 7.1 toolchain 決策「自覺」

- 選 Rust + wasm-pack 是正確方向（記憶體安全、編譯速度、無 LLVM 地獄）
- 但接受代價：**不能綁 C++ class**，要用 `#[wasm_bindgen]` + opaque handle 模擬
- 若未來發現 NPv1 某個 C++ class 有繼承 / 多型而新版很難映射，就用 trait object + enum dispatch

### 7.2 執行緒策略**絕不能抄**

- NPv1 的 pthread 路線在我們產品無法用（無 COOP/COEP）
- 本專案既定方案「多 Worker 分塊」是對的，不要動搖
- 但可借用 NPv1 的「9 worker 分工」思路：每個 worker 專注一個 feature（heatmap / roaming / capacity / mesh / antenna viewer / ...），而不是一個 worker 包全部

### 7.3 Embind-style API 接口設計

Rust 端可以這樣仿：
```rust
#[wasm_bindgen]
pub struct RfEngine { /* opaque */ }

#[wasm_bindgen]
impl RfEngine {
    #[wasm_bindgen(constructor)] pub fn new() -> Self {...}
    pub fn set_walls(&mut self, walls: JsValue) {...}
    pub fn set_aps(&mut self, aps: JsValue) {...}
    pub fn compute_heatmap(&self, input: JsValue) -> Vec<u8> {...}
}
```

這會產生類似 Embind 的 JS side API `new RfEngine().computeHeatmap(...)`，開發體驗相近。

### 7.4 postMessage protocol 參考

NPv1 的 `{ topic, payload }` 風格簡潔，但單 topic `'r'` 表達力不夠——新版建議多 topic：

```ts
type WorkerMessage =
  | { topic: 'scene/load', payload: Scene }
  | { topic: 'scene/patch', payload: Patch[] }
  | { topic: 'compute/heatmap', payload: HeatmapRequest }
  | { topic: 'compute/cancel', payload: { requestId: string } }
```

---

## 8. 證據索引

| 證據 | 來源 |
|---|---|
| Emscripten `_emscripten_*` 函式清單 | `hamina-CbPOEkX8.js` |
| Embind `__embind_register_*` 清單 | `hamina-CbPOEkX8.js` |
| `em-pthread` worker naming | `hamina-CbPOEkX8.js`, 各 glue |
| `SharedArrayBuffer` 檢查 + `crossOriginIsolated` | `mainWorker-HFjmjknA.js` @ offset 1097060 |
| wasm URL `hamina-DzbGwBcv.wasm` | 各 glue 檔 `.wasmUrl` 欄位 |
| mainWorker onmessage switch | `mainWorker-HFjmjknA.js` @ offset 1100958 |
| `lQ` dispatch function | `mainWorker-HFjmjknA.js` @ offset 1100828 |
| 6 份 glue diff 幾乎相同（只差 codeId/debugId） | `diff` 比對結果 |
