# Stats Spec — 網路統計規格書（Wi-Fi / AP / Switch / Client）

> 狀態：**v0.2（經 QA / User / PM 三角審查改寫；待使用者拍板實作範圍）**
> **範圍：非 camera 域——AP / Switch / Wi-Fi / Client 網路規劃與統計。**
> 定位共識來源：本次對話三角審查 + memory `project_tier1_2_devicelist_plan`
> 對齊規範：`.claude/ui-spec.md`（UIUX）、Phase 41 heatmap bitwise 驗證慣例

---

## 0. 定案：不新增第三個 mode（乾淨兩態）

三角審查一致結論 + 使用者定案：**不做平行的第三態 Stats mode。** 統計功能全保留，但依「資料來源」拆進既有兩態：

| 塊 | 內容 | 歸屬 | 資料來源 |
|---|---|---|---|
| **A 規劃品質** | 覆蓋率%、盲區、頻道衝突、AP 密度、PoE 需求推算、達標判定 | **Plan mode 內的品質面板**（邊擺 AP 邊看，不用切 mode） | propagation.js 真算（免 mock） |
| **B 即時聚合** | 全樓層 AP/Switch/Client 即時聚合 KPI、排行、告警、下鑽 | **Live mode 內的 dashboard view** | 前端拿 device 原始資料**自己算** |
| **C 歷史趨勢** | 占用曲線、負載趨勢、timelapse、vs 昨日對比 | **Live mode 內的趨勢 view** | 前端自己算（現用擬真 mock，預留接口） |

### 0.1 關鍵前提（使用者定案，推翻「重造輪子」疑慮）
> **後端 cloud 只給「device 本身必要的原始資料」；其他需要計算的統計/聚合/趨勢，通通前端自己來。**

因此 B/C 不是重造主產品後台的輪子——**沒有別人會算這些聚合，前端不做就沒有**。這使 §1 的資料 contract 與自洽不變式從「過度設計」升級為「剛需地基」。

### 0.2 差異化護城河（PM 洞察，納入 backlog）
本工具唯一資產是**平面圖**——別人的 dashboard 有 KPI 表，但沒人能把數字貼回空間。最高價值的差異化不是再做圓餅圖，而是 **「規劃 vs 實測的空間疊合」**：Plan 算的理論覆蓋，疊上 Live 實測的 client RSSI，在圖上標「這裡規劃說有訊號、實測卻是盲區」。列為 §6 backlog。

---

## 1. 資料地基 — Data Contract（前端與後端的約定）

所有統計經一層 **`statsSource` adapter**。現在指向 mock，未來換 cloud fetch，**呼叫端與 UI 零改動**。

### 1.0 單一真相：共用拓樸模型（QA H1 / B3 前提）
三個 API **不各自亂生**。mock 內部先有一份 `deriveTopology(floorId, seed)` 作為單一真相（哪些 AP、掛在哪台 Switch 哪個 port、覆蓋哪塊 scope），三個 API 都從它投影。這是設備關聯自洽（§3）與階段 1→2 不重構的前提。真實接線時，這份拓樸改由後端 device 原始資料建立。

### 1.1 `getPlanQuality(floorId) → PlanQuality`（A 域，真算）

| 欄位 | 型別 | 單位 / 範圍 | null / 空樓層 |
|---|---|---|---|
| `coveragePct` | number | **0..100**（%） | 0 AP → `0` |
| `thresholdDbm` | number | dBm（預設 -67，可調） | — |
| `rssiHistogram` | `{binLowDbm, count}[]` | binLowDbm=下界 dBm，binWidth 固定 5 | 空樓層 → `[]` |
| `blindSpots` | `{areaM2, polygonCanvas}[]` | areaM2=公尺²；polygonCanvas=canvas px 座標陣列 | 0 AP → 整層一塊 |
| `apDensity` | number | AP 數 / 可用面積 m²（**進階指標，不放主 KPI**） | 0 |
| `channelConflicts` | `{apA, apB, band, channel}[]` | apA/apB=apId；(A,B) 去重不重複計 | `[]` |
| `poeDemandWatts` | number | 規劃所需 PoE 總瓦（**規劃視角需求推算**，供選 switch） | 0 |
| `verdict` | `{pass:boolean, reasons:string[]}` | 達標紅綠燈（User 要求） | — |

**衝突定義**（QA M4）：conflict = 同 band 同 channel 且兩 AP 距離 < `CONFLICT_DIST_M`（常數）。
**移除的虛胖指標**（三方點名）：`snrHistogram`、`capacityPerAp`（理論容量易成合約糾紛把柄）降級為進階選項，不入預設面板。

### 1.2 `getSnapshot(floorId, { ts } = {}) → Snapshot`（B 域）

> 簽名帶 optional `ts`（QA H2）：階段 1 不傳=取最新；階段 2 timelapse 傳歷史時間點，**走同一條 timeline code path，不重構**。

| 路徑 | 型別 | 單位 / 範圍 | offline / 空 |
|---|---|---|---|
| `ts` | number | epoch ms | — |
| `ap.total/online/offline` | number | 台數 | 0 |
| `ap.perAp[].clientCount` | number | 個 | offline → `0` |
| `ap.perAp[].radio['2.4'/'5'/'6']` | `{clients,util,txbps,rxbps}` | util **0..1**；bps=bits/s | offline → 各 `null` |
| `ap.perAp[].channelUtil` | number | **0..1** | offline → `null` |
| `ap.perAp[].status` | `'online'\|'offline'` | — | — |
| `switchStat.perSwitch[].portsUp/portsTotal` | number | portsUp ≤ portsTotal | — |
| `switchStat.perSwitch[].poeWatts` | number | 當下實測瓦，≤ 供電上限 | 0 |
| `switchStat.perSwitch[].neighbors` | `{port, deviceId}[]` | LLDP 拓樸 | `[]` |
| `client.total` | number | 個 | 0 |
| `client.byBand` | `{'2.4','5','6'}` | 個，三頻加總=total | 全 0 |
| `client.byAp` | `{apId: count}` | 個 | `{}` |
| `client.rssiHistogram` | `{binLowDbm,count}[]` | 同 §1.1 規則 | `[]` |
| `client.list` | `{mac, apId, rssiDbm, band, linkMbps, assocSince}[]` | **可下鑽查單一 MAC**（User 維運剛需） | `[]` |
| `alerts` | `{id, severity, kind, targetId, ts, msg}[]` | 告警/事件（User 維運剛需，「推」非「看」） | `[]` |

**移除虛胖**：`linkRateHistogram` 降級進階（維運日常不看）。

### 1.3 `getTimeSeries(floorId, { metric, range, bucket }) → Series`（C 域，階段 2）

| 欄位 | 型別 | 單位 / 範圍 |
|---|---|---|
| `metric` | 封閉 enum：`'clientCount'\|'apLoadUtil'\|'poeWatts'\|'occupancy'` | 不用 `...` 開放式（QA L3） |
| `range` | `{from, to}` | epoch ms |
| `bucket` | `'hour'\|'day'` | 階段 1 明確不支援 minute（防蔓延，QA M5） |
| `points` | `{ts, value}[]` | value 型別依 metric（見下對照）；缺值點 `value:null` 佔位不省略 ts |
| `byEntity` | `{id, points:{ts,value}[]}[]` | **必填**（階段 1 回 `[]`，UI 從第一天渲染，空即不畫，避免階段 2 改 UI，QA H2） |

**value 型別對照**（QA B1）：clientCount→整數；apLoadUtil→0..1；poeWatts→瓦；occupancy→0..1（占用率，定義=有 client 關聯的時間占比）。

---

## 2. 跨 API 自洽不變式（§3「設備關聯自洽」的可測化 — QA B3）

mock 與未來真實資料都必須通過。同一 floorId 的 snapshot：

```
INV-1  Σ ap.perAp[].clientCount === client.total
INV-2  client.byBand 三頻加總 === client.total
INV-3  client.byAp[apId] === 對應 perAp.clientCount（逐台）
INV-4  每個 online AP，∃ switchStat.neighbors 指向它（AP 必掛某 port）
INV-5  portsUp ≤ portsTotal
INV-6  poeWatts ≈ (該 switch neighbors 中 AP 台數) × POE_PER_AP_W ± 容差
INV-7  perAp.radio 三頻 clients 加總 === perAp.clientCount
INV-8  offline AP 的 clientCount === 0
INV-9  online 台數 === perAp 中 status==='online' 的數量
INV-10 client.list 每筆 apId ∈ 現存 AP；Σ list groupBy apId === byAp
```

跨時間（階段 2）：`getSnapshot({ts:T}).client.total` === `getTimeSeries(clientCount, range∋T)` 在 T 點值（同純函數，見 §3.5）。

---

## 3. Mock 擬真原則

1. **空間相關**：AP client 數 ∝ 覆蓋 scope 面積/位置（大會議室 > 走廊），非亂數。
2. **時間相關**：歷史曲線含上班尖峰（09–11、14–16）、午休下凹、夜間低谷、週末低量。
3. **設備關聯自洽**：由 §1.0 共用拓樸保證，用 §2 不變式驗證。
4. **跨設備聚合為靈魂**：預設「多台匯總 + 排行」，非單台。
5. **純函數可重現**：`value = f(seed, floorId, entityId, ts)`，同輸入 deep-equal（QA H3）。snapshot 與 timeSeries **共用同一 seed**，使「趨勢線尾端 ≈ 當下 KPI」肉眼不穿幫。

---

## 4. 邊界行為契約（QA H4；即階段測試案例清單）

| 邊界 | 回傳行為 |
|---|---|
| 空樓層（無 AP/Switch） | coveragePct=0；各陣列 `[]`；KPI tile 顯示「—」非 0 |
| 0 AP 有 Switch | poeWatts=0；byAp={} |
| `range.from === to` | 回 1 點 |
| `range.from > to` | throw（不自動 swap，明示錯誤） |
| range 超出 mock 可生成範圍 | clamp 到可生成範圍 |
| bucket=day 但 range < 1 天 | 回 1 點 |
| 不存在 floorId | throw |
| metric 不在白名單 | throw |
| offline device 的數值欄 | `null`（UI 顯示「—」），陣列欄 `[]` |

---

## 5. UI（對齊 ui-spec.md：四角 stack、dark-glass、z-token、右側避讓）

### 5.1 Plan mode — 規劃品質面板（A 域）
- 邊擺 AP 邊看，**不切 mode**。角落極簡結論條：覆蓋率% + `verdict` 綠/紅燈（規劃者主入口）。
- 圖上：覆蓋熱區 + Wi-Fi 訊號盲區高亮（重用既有 Wi-Fi heatmap，bitwise 一致，Phase 41 慣例驗證）。
- 展開抽屜：頻道衝突清單、PoE 需求瓦、盲區面積。**進階**（AP 密度/SNR/理論容量）收在進階頁。
- 點 AP → 涵蓋圈 + 頻道/功率 + 撞頻對象（規劃者要的，非 client 數）。

### 5.2 Live mode — 聚合 dashboard + 趨勢 view（B/C 域）
- 維運主入口是 **dashboard**：KPI tiles（線上/離線、總 client、PoE 瓦）+ **告警清單（紅點優先）** + 負載排行 Top-N。
- **雙向連動**：dashboard 點一台 → 圖上高亮定位（對齊 DeviceList 慣例）。
- **client 下鑽**：搜 MAC → 看連哪台 AP / RSSI / 速率（投訴處理）。
- **拓樸小視圖**：AP 上聯到哪台 switch 哪 port（LLDP，維運排障）。
- 點 AP → 線上狀態 + 現 client 數 + channelUtil + 上聯 + 近期告警（維運要的，與規劃者不同）。
- **趨勢（階段 2）**：占用曲線 + 時間 scrubber（重用 timelapse 機制）；階段 1 先給「vs 昨日同時段 delta 箭頭」低成本高回報中間態（User 建議）。

> 圖表動工前讀 `dataviz` skill。

---

## 6. Backlog / 差異化 / 明確排除

- **[高價值 backlog]** 規劃 vs 實測空間疊合（§0.2）——平面圖工具獨有護城河。
- **[backlog]** 多方案 A/B plan diff（8 vs 10 台 AP 的覆蓋/成本差，規劃者要）。
- **[backlog]** 漫遊重疊區（-67~-72 overlap 帶，語音/移動場景）。
- **排除**：真實設備連線（後端事）、CSV/PDF 匯出（尊重 34-V/36 撤回）、minute 級 bucket、多裝置型別。

---

## 7. 階段規劃與驗收標準（QA M1）

**階段 1（先做）= A（Plan 品質面板）**
最小、最確定、免 mock。驗收：
- §1.1 單位/範圍表全落地；`verdict` 綠/紅燈正確；
- 圖上著色與 Wi-Fi heatmap 同門檻 sample grid 逐點相等（Phase 41 bitwise 慣例）；
- golden fixture floor（座標寫死）斷言 coveragePct 落預期區間、channelConflicts 對數 == 已知值（QA M2）；
- MCP 驗證 0 console errors。

**階段 2 = B（Live dashboard）**
前端拿 device 原始資料自己算聚合。驗收：§2 INV-1~10 自動化測試綠燈；§4 邊界表每列有對應測試；§3.5 純函數 deep-equal 測試綠燈；MCP 0 errors。

**階段 3 = C（趨勢 / timelapse）**
snapshot 已預留 `{ts}` 參數與 series `byEntity`，只放寬 range，不重構。

> 每階段獨立驗收（沿用專案 `ok` 才 commit 慣例）。實作順序與是否合併階段，待使用者指示。
