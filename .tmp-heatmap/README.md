# NPv1 Network Planner — 技術盤點文件

## 來源

已登入 production 站取回前端資產分析：
- 前端 JS bundle：`/assets/index-Br0HV5ut.js` (777 KB)
- WASM 引擎：`/assets/hamina-DzbGwBcv.wasm` (6.4 MB, unstripped)
- GraphQL API：`/graphql`
- 分析日期：2026-04-18

## 一句話結論

NPv1 是 **React 17 + Vite SPA** 前端 + **C++/Emscripten wasm** RF 引擎 + **GraphQL** 後端 的架構。
RF 演算法核心是 **Dominant Path Model (DPM)**，搭配 **ITU-R P.2040 材料模型**、**簡化繞射 (dB/90°)**、**正三角網格校正** 和 **ML environment learning** 做 survey 實測對齊。Heatmap **100% 前端計算**，後端只給輸入資料；拖 AP 或改牆即時重算。

## 文件導覽（按閱讀順序）

| # | 檔案 | 內容 |
|---|---|---|
| 00 | `00-overview.md` | 系統架構總覽、流水線、層次圖 |
| 01 | `01-core-algorithm-dpm.md` | DPM 演算法、路徑階數、pathLossOnSegment 拆解、加速結構 |
| 02 | `02-material-models.md` | ITU-R P.2040 四參數、牆/zone/triangle-field 衰減 |
| 03 | `03-antenna-3d.md` | 3D 天線方向圖、多平面插值、MIMO、EIRP、AFC |
| 04 | `04-heatmap-pipeline.md` | 8 種 heatmap 類型各自公式、重算觸發、閾值色階 |
| 05 | `05-channel-optimizer.md` | 頻道自動分配、互擾最小化、band steering、2.4G 特殊處理 |
| 06 | `06-env-learning.md` | Survey 反推參數、最佳化策略、誤差權重 |
| 07 | `07-graphql-schema.md` | 資料模型完整規格（各 type 每個欄位） |
| 08 | `08-implementation-guide.md` | **從零重建的實作路線、C++ 程式骨架、效能目標、測試策略** |
| 09 | `09-evidence.md` | 原始證據：wasm 符號、GraphQL payload、函式簽章 |
| **補** | `summary.md` | 2D vs 3D、非 heatmap 物件、00~09 gap 分析總結 |
| **補** | `10-scene-objects-simplifications.md` | Door/Window 真實狀態（WallType enum，修正 summary 原錯誤結論） |
| **補** | `11-cross-floor-propagation.md` | 跨樓層傳播、`HoleInFloor`/`RaisedFloor`/`SlopedFloor` 幾何、`getRayFloorIntersection` |
| **補** | `12-ui-interaction-workflow.md` | Undo/Redo、Drag&Drop、Snap、Selection、鍵盤快捷（含證據強度分級） |
| **補** | `13-measured-heatmap-fusion.md` | Simulated / Measured / Live 三軌並存、AP-to-AP 校正、Triangle grid |
| **補** | `14-performance-tuning.md` | 9 worker 分工（更正）、Viewport/Static tile、Cancelable、多解析度、效能基準 |
| **補** | `15-wasm-glue-analysis.md` | Toolchain = Emscripten + Embind（非 wasm-bindgen）；SAB/COOP/COEP 分析 |
| **補** | `16-mainworker-protocol.md` | mainWorker postMessage 協定；IZ / YX 等函式；`VisualizationType` 完整 enum |
| **補** | `17-progressive-heatmap-worker.md` | Progressive heatmap protocol；50+ 種 visualizationType；Gaussian blur 細節 |
| **補** | `18-offscreen-canvas-worker.md` | Comlink RPC；特效紋理 worker；**fastRayTracingEnabled 推翻原「無 ray tracing」結論** |
| **assets/** | NPv1 前端資產快取（18 檔）| 9 worker + 7 glue + 3 lazy chunk + manifest |

## 快速回答三個問題

### Q1. 用什麼演算法？
**Dominant Path Model (DPM) + ITU-R P.2040 + Log-distance PLE + Env-Learning 校正**。
不是射線追蹤，不是 FDTD。接近 iBwave/Ranplan/Ekahau 的商業實作思路。

### Q2. 計算在前端還後端？
**前端 wasm**。GraphQL 沒有 heatmap 計算 query，只拉輸入資料；wasm 拿到資料後在 browser 算完直接渲染。

### Q3. 重建要多久？
- MVP（直射 + 穿牆 + 簡單繞射 + 單 AP）：**1-2 週**
- 與 NPv1 功能等價（3D zone + 多 AP + 多頻段 + channel optimizer）：**2-3 個月**
- 加上 env-learning（需 survey data + ML）：**再 +1-2 個月**

## 最重要的 3 個重建提示

1. **別走射線追蹤路線**。DPM 一條主導路徑就夠用；射線追蹤太慢，不能做即時互動。
2. **wasm/C++ 或 Rust 不是選項而是必要**。純 JS 會卡，10 AP 以上會跑不動。
3. **視窗化重算**。拖動時只算 viewport 可見區域、降低精度；放開後再跑全域高精度。
