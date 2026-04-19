# NPv1 前端資產快取

**取回時間**：2026-04-19
**來源**：已登入 production 站取回前端資產分析（Sample Airport 專案）
**方法**：透過 Playwright MCP 導航並觸發全部功能，從 browser network 取得所有 `/assets/*.js` 後以 `curl` 下載
**用途**：新版前端重寫的參考素材（原 NPv1 部門產出，本部門負責翻新）

---

## 清單（18 檔）

### 9 個 Web Worker bundles

| 檔名 | 大小 (bytes) | 用途（推測） |
|---|---|---|
| `mainWorker-HFjmjknA.js` | 1,101,123 | 主計算 worker（wasm scene host） |
| `buildingDataWorker-D82HD6Bb.js` | 1,397,772 | 專案/樓層/牆資料解析 |
| `progressiveHeatmapWorker-B2VeLWkY.js` | 1,110,425 | 漸進式 heatmap 計算 |
| `roamingHeatmapWorker-JzaFazwK.js` | 1,105,920 | Roaming 分析 |
| `capacityMonitorWorker-d2_6YU4s.js` | 1,102,604 | 容量模擬 |
| `meshConnectionsWorker-DaaurNLj.js` | 1,101,762 | Mesh 連線顯示 |
| `antennaViewerWorker-vbvmoCI2.js` | 1,045,758 | 天線 3D 預覽 |
| `mapPolygonsWorker-DLc26fTQ.js` | 1,051,316 | 地圖多邊形渲染 |
| `offscreenCanvasWorker-DMkgPcOi.js` | 151,585 | **新發現**：OffscreenCanvas 背景渲染 |

> 原 summary 列 8 個 worker，實測發現 **9 個**。`offscreenCanvasWorker` 尺寸特別小 (148KB)，沒載 wasm，推測是純渲染 worker（把 Konva / WebGL 畫布搬到 worker 以解放主執行緒）。

### 9 個支援 JS / Lazy chunks

| 檔名 | 大小 (bytes) | 用途（推測） |
|---|---|---|
| `hamina-CbPOEkX8.js` | 167,304 | **wasm-bindgen glue**（被載 19 次，每個 worker 各一次） |
| `hamina-CKNcElXH.js` | 80,660 | 可能是 wasm-bindgen 的精簡 glue（為主執行緒 or 特定 worker） |
| `hamina-CHRqgdPw.js` | 80,666 | 同上，另一個版本 |
| `hamina-DLRjsB10.js` | 80,666 | 同上 |
| `sentryForWorker-emUL6rku.js` | 1,346 | Worker 專用 Sentry 初始化 |
| `AppPage-taMUSOQN.js` | 744,009 | 主 App 頁面 lazy chunk |
| `ReportPage-Dklg01vU.js` | 2,213,807 | 報告頁面 lazy chunk（含 PDF / 圖表） |
| `HeatmapLegend-Bgl4_FrG.js` | 4,361,424 | Heatmap 色階 / 圖例（**含大量色階表 / icon**） |
| `esm-ynPLVMni.js` | 1,604,165 | 泛用 ESM 模組 bundle |

### 主 bundle（原已有）

| 檔名 | 來源 |
|---|---|
| `../index.js` (`index-Br0HV5ut.js`) | 首屏入口，794 KB |
| `../hamina.wasm` (`hamina-DzbGwBcv.wasm`) | RF 引擎，6.4 MB |

---

## SHA256

```
2b236aec1e2010ba9bf258a4a943afb240ba3762551e4dfe2b1845c89e79ed4b  AppPage-taMUSOQN.js
5777aae1974ec29e0bf519689bceb8199cff0171181bd471ecedc8c44a24360f  HeatmapLegend-Bgl4_FrG.js
ea51bc0fd9e4187f2ad4c8c5980d102c81d53a3cc0ce281bfaab8a1d18afca65  ReportPage-Dklg01vU.js
71d98abe4409ef0faedf6379bd1c94a82749b6d036eb1dace9e94b97f075c798  antennaViewerWorker-vbvmoCI2.js
82be69b31d4e9e2824b864c1fc4148b3ccc67dbb386c4921cb9482c55479c3d4  buildingDataWorker-D82HD6Bb.js
e56a63252662e090fdbcac0ef6f5a02ecf0a66066a9635dc2a15dcd394240335  capacityMonitorWorker-d2_6YU4s.js
49a8b8cdd710d908339d85db74a7e21dea910cec3427aa75aa305611fac811e3  esm-ynPLVMni.js
8b2e166ec7e9de43345aafec4b0f6c18d4ff124629fdd423cc21c5abb89127c9  hamina-CHRqgdPw.js
c0979881736b9f7fec608b6e3d5040f35c1f448f49f1e5cb0b76389b7555f18c  hamina-CKNcElXH.js
b5bee1fa5c87b34d3331206fbf05e6d3166d056fd6c6983174992f669da41d0c  hamina-CbPOEkX8.js
```

（完整列表：`sha256sum *.js > SHA256SUMS` 重算）

---

## 使用方式

此資料夾僅供**參考分析**（讀取、grep、抽 API 簽章），**不**會被產品 code 匯入。
分析產出應寫回 `.tmp-npv1/*.md` 文件（00~14 系列 + summary）。

---

## 下個可做的分析

下載完成後優先掃這幾點：

1. `hamina-CbPOEkX8.js`（wasm-bindgen glue）— 看 wasm 導出/導入清單，對照新版 Rust 引擎 API 設計
2. `mainWorker-HFjmjknA.js` — 主 message protocol（`postMessage` 格式），新版對接時需相容
3. `progressiveHeatmapWorker-B2VeLWkY.js` — tile-based 漸進式計算細節，補完 `14-performance-tuning.md`
4. `offscreenCanvasWorker-DMkgPcOi.js` — OffscreenCanvas 用法（新發現物，補 summary）
5. `HeatmapLegend-Bgl4_FrG.js` — 色階表 & 圖例（為何 4.3MB？含圖片或字型？）
