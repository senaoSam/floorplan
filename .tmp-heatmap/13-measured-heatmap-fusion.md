# 13. 實測 Heatmap 融合（Live Mode / Survey Attenuation）

NPv1 除了 simulated heatmap，還有一整套 **measured / live heatmap** pipeline。
本文件記錄證據與可複現架構。

---

## 1. 三種 heatmap 來源

| 類型 | 來源 | 切換機制 | wasm 證據 |
|---|---|---|---|
| **Simulated** | DPM 演算法模擬 | 預設 | `setHeatmapType(heatmapType)` |
| **Measured** | Offline site survey（事前量測） | 切 `MeasuredHeatmapType` | `MeasuredHeatmapType` enum, `setMeasuredHeatmapType` |
| **Live / Real-time** | 已安裝 AP 即時 RSSI | `selectedLiveSsids`, `liveClientMaskingEnabled` | `measuredAccessPoints`, `liveAp` |

index.js 的 `UserProjectUiStates` 欄位印證三者並存：
```graphql
selectedHeatmap         # simulated 選項
selectedMeasuredHeatmap # measured 選項
selectedLiveSsids       # live 選項
liveClientMaskingEnabled
```

---

## 2. Measured Heatmap 資料流

### 2.1 資料來源

```cpp
BlobSurveyMeasurementProvider   // blob 儲存的 survey 檔案 provider
MeasurementProvider              // 抽象介面
MeasurementProviderForTriangleProvider  // 與 triangle grid 整合的 provider
```

解讀：NPv1 把 survey 結果打包成 **blob**（單一二進位檔）上傳，wasm 透過 `MeasurementProvider` 介面讀取，不綁定特定格式（可擴充其他 provider）。

### 2.2 Survey 量測點資料模型

```cpp
AbstractSurveyAttenuationEstimator
EnvLearningWallZoneAttenuationEstimator
EnvLearningAttenuatingZoneData
EnvLearningAttenuatingZoneTypeData
ApMeasurementTriangleAttenuationEstimate
ENV_LEARNING_SURVEY
```

量測點不是簡單的 (x, y, rssi)，而是參與**環境學習**（env learning）——把實測值反饋到「牆 / 區域衰減參數」的校正。每個量測點貢獻兩件事：
1. 該位置的實測 RSSI（供 measured heatmap 顯示）
2. 作為 ML 訓練樣本修正 WallType / ZoneType 衰減參數

（詳見 06-env-learning.md）

### 2.3 Triangle 幾何網格

```cpp
AttenuatingRegularTriangleGrid
AttenuatingTriangleField
AttenuatingTriangleContainer
surveyAttenuatingTriangleField
setSurveyAttenuatingTriangleField(mapId, surveyAttenuatingTriangleField)
```

Measured heatmap 不用正方格，用**正三角形網格**（regular triangle grid）儲存衰減估計。
原因推測：三角網格對不規則區域邊界更貼合、相鄰 cell 角度更均勻（6 鄰 vs 4/8 鄰），對干擾傳播更平滑。

詳見 08-implementation-guide.md M6 段（Triangle Grid）。

---

## 3. AP-to-AP Signal（Live Mode 核心）

### 3.1 概念

已部署 AP 之間互聽對方 beacon：AP1 可聽到 AP2 的 -55 dBm → 反推 AP1-AP2 路徑衰減。
這是**最可靠的 ground truth**，因為：
- 發射端已知（AP2 的 txPower 從 config 讀）
- 接收端已知（AP1 的 sensitivity 從 config 讀）
- 沒有 client device 的天線變異

### 3.2 API

```cpp
getWifiAp2ApSignals(includeCrossBandSignals)
    // 取所有 AP 之間的量測 RSSI
getAp2ApMeasurementTriangleAttenuationEstimate(
    ap2apMeasurements, modelSettings, analysisDataObserver)
    // 從 AP-to-AP 實測反推三角網格的衰減分佈
getAp2ApTriangleAttenuationEstimate(modelSettings, errorModel)
    // 對已建模的結果算估計（非實測）
setAp2ApAttenuatingTriangleField(mapId, ap2ApAttenuatingTriangleField)
    // 把 AP-to-AP 反推結果寫回

enum Ap2ApMode { ... }  // 未展開：N6hamina9Ap2ApModeE
```

錯誤訊息 `Unsuppored Ap2ApMode with workspace`（L624263 typo 原樣引用）確認這是多模式設計。

### 3.3 流程

```
已部署 AP 們 同時掃描 → 每 AP 回報聽到的 neighbor RSSI
        ↓
getWifiAp2ApSignals() 彙整
        ↓
getAp2ApMeasurementTriangleAttenuationEstimate()
   [把路徑損耗分配到路徑經過的 triangle cells]
        ↓
setAp2ApAttenuatingTriangleField()  ← 寫入 wasm scene
        ↓
下次 heatmap 重算時使用這組修正過的衰減場
```

相當於用真實信號**校正**模擬器的衰減假設。

---

## 4. Site Survey Pipeline

### 4.1 角色 / 工具

index.js 符號：
- `sitesurvey` / `survey` / `surveyor`
- `surveyInspector` — 查看 survey 資料的 UI
- `measuredAccessPoint(s)` — survey 過程記錄下的 AP

### 4.2 Survey Attenuation 流程

```cpp
getSurveyAttenuationWallTypeEstimate(modelSettings, measuredRadios)
    // 從 survey 反推 WallType 衰減（校正 WallType）
getSurveyAttenuationTriangleAttenuatingEstimateAsync(
    modelSettings, measuredRadios, progressCallback, resultCallback, analysisDataObserver)
    // 非同步：從 survey 反推 triangle grid
getSimulatedSurveyAttenuationTriangleAttenuatingEstimate(...)
getSimulatedSurveyAttenuationWallTypeEstimate(...)
    // 用模擬 survey（驗證用，不是真實量測）
```

兩種反推粒度：
1. **WallType-level**：調整每種 WallType 的 `attenuationDB`（少量參數，結果全域一致）
2. **Triangle-level**：直接寫入三角網格的 per-cell 衰減（細粒度但不泛化）

推測流程：先做 WallType-level 快速校正，若殘餘誤差大，再做 Triangle-level 局部修補。

### 4.3 Async + progress + observer

```cpp
getSurveyAttenuationTriangleAttenuatingEstimateAsync(
    modelSettings,
    measuredRadios,
    progressCallback,      // 進度 0~1
    resultCallback,         // 最終結果
    analysisDataObserver    // 中間分析資料
)
```

代表這個計算可能需要**數秒到數十秒**，需要非同步 + 進度條 UI。

---

## 5. Blending：Simulated vs Measured

**index.js / wasm 中 `blend` / `blending` 字串 grep 0 match**——NPv1 可能**不做**直接融合，而是讓使用者切換顯示：
- 要看 simulated → `selectedHeatmap`
- 要看 measured → `selectedMeasuredHeatmap`
- 要看 live → `selectedLiveSsids`

Measured 資料的角色更像**校正 simulated 模型的參數**，而非顯示時融合。

### Measured 如何改善 simulated？

1. Survey data → `getSurveyAttenuationWallTypeEstimate` → 調整 WallType 參數
2. AP-to-AP → `setAp2ApAttenuatingTriangleField` → 設定 triangle 衰減場
3. 這兩者寫回 wasm scene 後，**下次 simulated heatmap 計算**就會自然反映量測修正

所以「融合」不是在 heatmap 像素層，而是在**衰減模型層**融合。

---

## 6. 新版設計建議

### 6.1 V1 範圍（重建）

- 顯示模式切換：simulated / measured / live（三個獨立 heatmap，不融合顯示）
- 支援匯入 site survey 檔（blob format，先接一種即可）
- WallType-level 參數校正（從 survey 反推）

### 6.2 V2 可擴展點

- **即時 AP-to-AP 校正**：AP 安裝後自動互測，每 5 分鐘更新一次衰減場
- **Triangle-level 局部校正**：對 WallType 全域調整後殘差大的區域做局部 triangle 補丁
- **多次 survey 時間序列**：比較不同時間 survey 看環境變化（家具移動、隔間改變）
- **Live alert**：實測 < 模擬 門檻以上時提示「覆蓋不如預期，可能有新遮擋」

### 6.3 V3 願景

- **ML-based prediction**：以 survey 資料訓練 per-site model，比 ITU-R 通用模型準
- **眾包 survey**：多個 client 長期回報 RSSI 自動累積（像 Google 的 WiFi location DB）

---

## 7. 複現實作 checklist

- [ ] 資料模型：`Survey { id, mapId, timestamp, measurementPoints: [(x, y, rssi, apBssid)] }`
- [ ] Import：接 NPv1 blob format 或自訂 JSON
- [ ] API：`applySurveyToMap(mapId, surveyId, mode: 'wallType' | 'triangle')`
- [ ] AP-to-AP API：`recordApToApSignal(fromAp, toAp, rssi)`, `computeAp2ApField()`
- [ ] UI：heatmap 類型切換（simulated / measured / live）
- [ ] UI：survey inspector（看量測點分佈、殘差、校正效果）

---

## 8. 證據索引

| 來源 | 證據 |
|---|---|
| hamina.wasm | `MeasuredHeatmapType`, `setMeasuredHeatmapType(measuredHeatmapType)` |
| hamina.wasm | `BlobSurveyMeasurementProvider`, `MeasurementProvider`, `MeasurementProviderForTriangleProvider` |
| hamina.wasm | `AbstractSurveyAttenuationEstimator`, `EnvLearningWallZoneAttenuationEstimator` |
| hamina.wasm | `AttenuatingRegularTriangleGrid`, `surveyAttenuatingTriangleField`, `setSurveyAttenuatingTriangleField` |
| hamina.wasm | `getWifiAp2ApSignals`, `getAp2ApMeasurementTriangleAttenuationEstimate`, `setAp2ApAttenuatingTriangleField`, `Ap2ApMode` |
| hamina.wasm | `getSurveyAttenuationWallTypeEstimate`, `getSurveyAttenuationTriangleAttenuatingEstimateAsync` |
| hamina.wasm | `ENV_LEARNING_SURVEY`, `EnvLearningAttenuatingZoneData`, `EnvLearningAttenuatingZoneTypeData` |
| index.js | `measured`, `measuredAccessPoint(s)`, `sitesurvey`, `surveyInspector`, `surveyor`, `surveyAttenuatingTriangleField` |
| index.js | `selectedMeasuredHeatmap`, `selectedLiveSsids`, `liveClientMaskingEnabled` |
| grep 0 match | `blend` / `blending`（推論：不做像素層融合，只在模型層融合） |
