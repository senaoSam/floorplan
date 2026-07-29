# Floorplan Planner — 任務進度（精簡版）

> 設計依據：`.claude/cable-spec.md`、`.claude/layer-architecture-spec.md`、`.claude/client-view-spec.md`
> Progress panel 同步：`src/components/ProgressPanel/ProgressPanel.jsx`
>
> 本檔只列 **還沒做的事** + **已撤回的決策（防重做）**。
> 已完成項目的細節交給 git log。

---

## 現況一句話

**Phase 34 Camera 模式全部完成（34-0~34-5 ✅，2026-06-11 使用者驗收 ok）。**
**Phase 34-V Verkada parity 擴充完成（2026-06，見下表）。**
**Phase 35 相機 4 點校正（含階段 2 真投影）+ 導覽 polish 完成（2026-06-29 驗收 ok，見下表）。**
**Phase 36 Verkada Tier 1&2 擴充完成（2026-06-29 驗收 ok，見下表）。**
**Phase 37 camera 右鍵選單 + 3D camera 三圖 + 3D 唯一光源光影 完成（2026-06-29 使用者驗收 ok，見下表）。**
**Phase 38 熱圖綁定 FOV + 未放置裝置清單 + 3D 動線流線化 完成（2026-07-02 使用者驗收 ok，見下表）。**
**Phase 39 UIUX 規範落地（`.claude/ui-spec.md` U1–U4 全部）完成（2026-07-02 使用者驗收 ok，見下表）。**
**Phase 40 天線俯仰角 tilt（azimuth + tilt，no roll）完成（2026-07-03，commit e6f4ec1，見下表）。**
**Phase 41 熱圖無感重算（粗場秒出 + 波紋過渡 + 非同步 readback）完成（2026-07-03 使用者驗收 ok，見下表）。**
**Phase 42 統計階段 1：Plan 規劃品質面板（A 域）完成（2026-07-06 使用者驗收 ok，見下表）。**
**Phase 43 統計階段 2+3：STATS 獨立模式（B 域聚合 dashboard + C 域趨勢/timelapse）完成（2026-07-08 使用者驗收 ok，見下表）。**
**Phase 44 規劃 vs 實測空間疊合（PM 護城河 backlog）完成（2026-07-08 使用者驗收 ok，見下表）。**
**Phase 45 隱藏 3D 凍結 + 2D/3D 熱圖共用 canvas 完成（2026-07-13 使用者驗收 ok，見下表）。**
**Phase 46 效能第二/三輪（引擎 async 化 + Pixi texture 修正 + marker 免重畫）完成（2026-07-14 使用者驗收 ok，見下表）。SW 機 300 AP 拖曳 long task 累計 3.0s→0.93s（-69%）、最大單筆 777→205ms，效能戰役到此收工。**
**Phase 47 B1 快速正確性修正完成（47-1/3/4/5/7 + 47-24 頻段色 typo，2026-07-20 commit 2c5295d，MCP 驗證通過）。**
**Phase 47 B2 數字可信度完成（47-2/6/8a/9，2026-07-20，MCP 驗證通過；autoChannelPlan 半徑拍板不動）。**
**Phase 47 B3 操作型邏輯 bug 完成（47-14~21，commit eb59e10 + 91c36a7 + 09a5ddf，使用者驗收 ok）。**
**Phase 47 B4 UX/一致性完成（47-22~27，commit 1a4bf16，使用者驗收 ok；含 off-band dim/多頻段 demo/3D toolbar 精簡等使用者追加）。**
**Phase 47 B5 全部完成（2026-07-22，使用者驗收 ok，MCP 通過）：47-12 TX 逐頻段預設 + 47-13 PoE per-port class（Opus 4.8）、47-10 天線增益 + 47-11 材質庫（Fable 5，雙引擎 parity 已驗）。B1~B5 收工，Phase 47 六角色審查缺陷全數清完（47-8b 單台三頻 / 47-6 autoChannelPlan 半徑為 backlog/防重做，非缺陷）。**
**Phase 50 AI 牆改接 cv+graph pipeline API 完成（2026-07-29，commit e242f6d，MCP 驗證通過，見下表）。**

---

## 還沒做的事

### Phase 49 自動規劃 AP 放置（auto place）— 已實作，待使用者驗收（2026-07-23 起）

> Spec 與所有拍板決策見 `.claude/auto-place-spec.md`。
> 三模式（fresh 重新規劃／fixed 固定數量／fill 補洞）+ 頻段選擇 + 完整頻道指派
> （`greedyChannelAssign` 新增 `fixedChannels` 參數）+ ghost 預覽層（`ghostAPsLayer`）
> + what-if 熱圖（heatmapAdapter 併入 previewAps，memoized 不破指紋）
> + 預覽態 docked 小卡不擋畫布。
> 演算法：候選格 → 覆蓋矩陣 → set cover 貪婪 → relocate。
> 同期：autoPowerPlan 修復 + ~100x 提速已 commit（9dde23c）。
>
> **2026-07-27 使用者驗收回饋 → 四輪修正**（細節與實測數據全在 spec）：
> 1. **室內偵測**（`utils/indoorMask.js`）— 原本 AP 會被放到牆外空地（demo 10 顆中 6 顆）。
>    flood fill 自動辨識建築範圍，候選點與評分格都套；牆沒接好時退回全範圍 + UI 明示。
> 2. **格距校準** — `gridStepM` 2→1 m、`candStepM` 4→2 m。候選格才是關鍵瓶頸：
>    demo 從「10 顆 / 93.3% / 未達標」變成「7 顆 / 97.2% / 達標」。
>    加 `stopReason` + `targetMet`，未達標不再假裝成功。
> 3. **移除預覽** — 紅環「✕」標出將被移除的 AP；併修 heatmapAdapter 只加不減
>    導致 what-if 熱圖虛胖（實測落差達 13 dB）。
> 4. **原地保留** — 重跑時位置沒變的 AP 不刪不加（原本會洗掉手動調過的功率/頻道）。
>
> 另修 overlay dismiss（`hooks/useOverlayDismiss.js`）：7 個 modal 的
> 「modal 內按下 → 背景放開」誤關問題。

### Phase 48 樓層對齊修復 — 全部完成（Bundle 1+2，2026-07-23；防重做決策保留如下）

> **已拍板決策（防重做）**：
> ① 對齊語意統一為**米空間**（`src/utils/floorAlign.js` 為唯一正典；圖片幾米由各層比例尺回答）；
> ② 跨樓層計算遇未校正比例尺的樓層 → **排除＋警告**（不要 fallback 硬套 active 比例尺）；
> ③ `alignScale` 保留（僅圖紙比例誤差修正，正常恆 1）；
> ④ 基準樓層採**方案 C**（`alignAnchorFloorId`，預設最底層）。
>
> **Bundle 2 已完成**：buildScenario 跨樓層幾何（AP／牆線段／中庭 bypass）過
> `T = A_active⁻¹ ∘ A_other`，active 維持 identity → scenario 座標系不變、雙引擎自動同步。
> MCP 驗證：scenario 手算 5 case 全對、場峰值位移 198px/期望 200、GL cache round-trip
> bit-exact、JS vs GL 質心 0.0px、排除警告生效。細節見 git log。

### Phase 48+ 3D 全樓層熱圖 — 完成（2026-07-23，A 策略；防重做備註）

> UI＝3D 右上「🌡️ 全樓層熱圖」開關（預設關，熱圖未開/單樓層模式反灰）。
> **A 策略拍板落地**：只在「3D 可見＋開關開」時逐層背景算（每層自己的 rx 高度＋完整跨樓層
> 模型，`buildCrossFloorData` 與 2D adapter 共用）；指紋快取（store refs＋熱圖設定）——
> 開關/視圖切換無資料變更時**零重算**（MCP 驗：rev 不變）；資料變更 debounce 重算。
> **防重做**：不要改成 always-on ×N（吃掉 Phase 46 效能戰果）；要更即時再升級 C 策略
> （idle 補算），骨架已留（heatmapStack.js 的 fingerprint/ensure 分離）。
> 核心檔：`features/viewer3d/heatmapStack.js`、`HeatmapStackPlane3D.jsx`、
> `features/heatmap/buildCrossFloor.js`。

### 效能殘餘（Phase 46 收工後暫緩，防重做）

> 2026-07-14 拍板收工。SW 機 300 AP 拖曳剩餘 ~0.93s long task 的組成與「還能做但 CP 值低」的候選：
> ① 拖曳中被拖 AP 的**纜線 gDynamic 每幀重畫**（虛線 drop leg 逐段細分三角化，buildLine 家族 ~350ms）——候選：拖曳中改實線 ghost、放開才畫虛線。
> ② 放開後全量重算的 CPU fold 單筆 ~165ms RunMicrotasks——候選：再切片。
> ③ 首次拖曳的 per-size FBO/LOS 一次性配置 ~156ms `checkFramebufferStatus`（同場次後續拖曳不付）——候選：idle 時預熱 drag 尺寸。
> ④ SwiftShader 全場光柵化固有成本（最大單筆 205ms 的主體）——要再降是靜態層快照（texture cache）等級工程，歸 Phase 25 效能家族扳機。
> ⑤ `heatmapAdapter` SW/HW 降級門檻（1500/20000）仍是 PLACEHOLDER 未校準。
> **重啟扳機**：使用者再回報拖曳卡頓，或單層 >500 AP 真實需求。

### Phase 47 六角色審查缺陷修復（2026-07-20 立項）

> 來源：設計師 / PM / RF 工程師 / 新手 / 演算法 / 邏輯 六個角色 subagent 全專案掃描。
> 已由使用者剔除（未來串 API 解決，**不修**）：零持久化、`buildingData/onSave` 整合契約、AI 牆偵測外部服務依賴、Stats/相機 mock 資料與 40px/m fallback、dev widget（DemoLoader/StressLoader/ProgressPanel，正式版整塊移除）。
> 下列為「即使 demo 版也算錯數字 / 踩得到的真 bug」，與串不串 API 無關，須修。

#### 建議動工順序（2026-07-20 拍板，按 CP 值＝影響÷風險排批次，跨越 P 分層）

> **P0–P3 是嚴重度/類別分層，不是動工順序。** 實際動工照下面批次 B1→B5。每條 task 標題末尾標 〔B?〕。
> 原則：先撿「低風險高影響、改動小驗證快」的，再進大改動；操作型 bug 優先於觀感。

| 批次 | 內容 | 為何這個順序 |
|------|------|--------------|
| **B1 快速正確性修正** | 47-24(僅頻段色 typo 那條) → 47-1 → 47-3 → 47-7 → 47-4 → 47-5 | 改動極小（多為改常數/一行取負）、影響大、驗證快；先讓引擎不再算錯數字。47-1 JS+shader 各一行；47-3/47-7 改常數。 |
| **B2 數字可信度（算法/語意）** | 47-2 → 47-6 → 47-8a → 47-9 | 影響報表/規劃數字正確性，需動邏輯但不動全鏈。 |
| **B3 操作型邏輯 bug** | 47-14 → 47-15 → 47-18 → 47-16 → 47-17 → 47-19 → 47-20 → 47-21 | 「操作就踩到」，優先於觀感；47-14/15/18 使用者最易觸發。 |
| **B4 UX/一致性** | 47-22 → 47-23 → 47-24(其餘 token) → 47-25 → 47-26 → 47-27 | 47-22 比例尺指引影響大但需設計 UI 流程，成本高於改常數故排 B4；其餘為收斂性清理。 |
| **B5 大工程（非急迫）** | 47-10 → 47-11 → 47-12 → 47-13 | 牽動較廣、非急迫；材質庫/天線增益/PoE class 可獨立慢慢做。 |

> 註：47-24 拆兩處出現——頻段色 typo（一字元、撞警告橘）併入 B1 隨手修；其餘色彩 token 收斂留 B4。

> **B5 分模型 + effort 決策（2026-07-21 拍板）**：B1~B4 全程 Opus 4.8。B5 依「牽動面 × 失敗代價」分模型——
> - **47-10（天線增益，JS+shader 雙引擎同步）、47-11（材質庫，動 materials.js＋可能牆資料結構＋UI）：用 `claude-fable-5`，effort `high`。** 這兩條牽動最廣、要同時 hold 住多處不變量，用最強模型降低漏改/破壞已驗證 parity 的機率，錢花在刀口上。
> - **47-12（TX 預設，評估＋查表）、47-13（PoE per-port class，邏輯＋對比 switch 埠級）：用 Opus 4.8，effort `high`。** 有明確 spec/資料、改動面收斂，Opus 綽綽有餘。
> - Fable 的 API 差異（thinking 永遠開、refusal fallback、需 30 天資料保留）在 Claude Code harness 內對開發是透明的，非負擔。**切模型須使用者手動 `/model`**——Fable 那兩條開工前先切到 Fable。
> - 護城河仍是 MCP 並排驗證（對 Opus/Fable 一視同仁）＋嚴格照 spec/oldSrc、不准自行設計。

#### P0 — 物理/演算法正確性（會直接算錯數字，最優先）

- [x] **47-1【高】〔B1〕Knife-edge 繞射符號反轉**（✅ commit 2c5295d，MCP 驗：符號表 v>0 回正損耗、diff>40 cull 復活、實場繞射 on/off 截圖確認補陰影不灌爆）：`knifeEdgeLossDb` 回傳的是負值繞射增益 Gd，呼叫端當正損耗「加」進 path loss → 繞射越深訊號越強（陰影區被灌爆）。旁證：`if (diff > 40) continue` 恆不觸發（死碼）。預設 `diffraction:true` 即走此路。**JS + shader 同步**取負。
  - `src/features/heatmap/propagation.js:87-93`（回傳取負）、`:411`（驗算）；`src/features/heatmap/propagationGL.js:749-758`、`:1112`。
- [x] **47-2【中】〔B2〕planQuality scope 過濾失效**（✅ commit 6c6afe8，MCP 驗：加 out-scope 蓋右半後 coverage 89.2%→81.5%、盲區面積 77→68m² 分母縮小；迴圈內自呼 scopeMaskFn + 界外 row/col 剪除）：面板靠 NaN 濾 out-of-scope，但 `sampleField` 已改全矩形取樣不寫 NaN（註解明說），排除區被算進涵蓋率分母與盲區面積。修：迴圈內自呼 `scenario.scopeMaskFn(x,y)`。附帶：`nx=ceil(w/step)+1` 多一排界外格，面積略高估。
  - `src/features/heatmap/planQuality.js:86`、`src/features/heatmap/sampleField.js:53-55`。
- [x] **47-3【中】〔B1〕Client View 資料速率頻寬倍率錯**（✅ commit 2c5295d，MCP 驗：80MHz=1202、160MHz=2403；widthRateMultiplier 已刪）：用 11n/ac 的 2.08/4.34/8.68，11ax 正確為 2.0/4.19/8.38。80MHz MCS11 2SS 顯示 1245 應為 1201；160MHz 顯示 2489 應為 2402（人盡皆知值）。另 `channelWidths.js` 有第三套沒人用的 `widthRateMultiplier`（2.1/4.5/9.0），一併收斂。
  - `src/features/clientView/dataRate.js:84-89`；`src/constants/channelWidths.js:64-69`。
- [x] **47-4【低】〔B1〕聚合 shader 缺 0.25m 水平距離 clamp**（✅ commit 2c5295d，best-AP+CCI 兩迴圈加 max(length(dxy),0.25) 對齊 JS；shader 編譯 0 error、聚合場正常）：`FS_FIELD`/CCI 迴圈無 clamp，AP 正下方一格與 JS/per-AP 路徑差 ~0.1-0.6dB，違反雙引擎一致性不變量。
  - `src/features/heatmap/propagationGL.js:1542-1544`、`:1600-1602`。
- [x] **47-5【低】〔B1〕probeAt zM 優先序潛伏**（✅ commit 2c5295d，MCP 驗：caller zM=1m 優先、hover 無 zM fallback scenario 5m）：`scenario.rxElevationM ?? rx.zM` 讓 scenario 蓋過呼叫端 client 高度，crossFloor 一啟用即靜默忽略使用者高度。改 `rx.zM ?? scenario.rxElevationM ?? 0`。
  - `src/features/heatmap/hoverProbe.js:8`。

#### P1 — RF 領域語意缺口（工具核心價值，讓真實設計翻車）

- [x] **47-6【高】〔B2〕頻道衝突改用公尺 + 頻寬相交**（✅ commit 6c6afe8，MCP 驗：ch36@80 vs ch44@20 近距報 1 對、ch36 vs ch149 不報、ch36 相距 20m 不報；detectChannelConflicts 收 floor.scale 用 12m 門檻 + apsShareSpectrum）。**決策（2026-07-20 拍板）**：只改 detectChannelConflicts（報表數字）；`autoChannelPlan.js` 的 greedyChannelAssign `interferenceRadius=300px` **不動**——它是頻道指派演算法的鄰居啟發式（非物理干擾距離），改它要動 3 個呼叫端且改變已驗證的 auto-plan/DemoLoader 行為，CP 值不對。**防重做**：不要再把 autoChannelPlan 半徑改公尺。
  - `src/features/heatmap/planQuality.js`（已改）；`src/utils/autoChannelPlan.js:35`（保留 300px）。
- [x] **47-7【高】〔B1〕雜訊底隨頻寬抬升**（✅ commit 2c5295d，MCP 驗：serving AP 20→160MHz SNR 降 9.03dB、20→80 降 6.02dB、RSSI 不變；三處同步 clientView SNR/SINR + JS aggregate + shader RSSI-only/full）：`widthNoiseDelta()`（`+10log10(W/20)`）是死碼無呼叫者，160MHz SNR 高估 ~9dB → MCS/速率虛胖。接進熱圖引擎與 clientView 逐頻段雜訊底。
  - `src/constants/channelWidths.js:73-75`（無呼叫者）、`src/features/heatmap/rfConstants.js:4`、`src/store/useClientViewStore.js:52`。
- [x] **47-8a【高】〔B2〕顯示層分頻段篩選**（✅ commit 6c6afe8，MCP 驗：3 頻段 demo 切 6GHz 後熱圖只剩該台 AP 場、其餘紅色，0 errors）：在 heatmapAdapter buildScenario 前按 `String(ap.frequency)===bandFilter` 篩 active + cross-floor aps + totalApCount；store 加 `bandFilter`（預設 all）+ `setBandFilter`；HeatmapControl 主控列加下拉（全部/2.4/5/6GHz）。**MCP 逼出的 bug + 已修**：idleInputs fingerprint 漏 bandFilter → 切 band 被 idleInputsEqual 判定無變化而跳過重算（熱圖不變）；補 `bandFilter: hm.bandFilter` 進 fingerprint 後生效。**不動 AP 資料結構、不碰 shader 物理**，純 render 前 filter。**增強（2026-07-20 使用者提議，commit 088c26a）**：切單一頻段時，非該頻段的 AP marker **半透明化 alpha 0.3（不隱藏）**，明確傳達「存在但不屬於當前檢視頻段」（對標 Verkada）。2D `apsLayer.bandDimAlpha`（訂閱 heatmap store）+ 3D `APLayer3D` 折進既有 dimOpacity。MCP 驗 2D/3D 皆生效、0 errors。
  - `src/render/heatmapAdapter.js`（filter + fingerprint）、`useHeatmapStore.js`、`HeatmapControl.jsx`、`apsLayer.js`、`APLayer3D.jsx`。
- [ ] **47-8b【backlog，不現在做】單射頻→多射頻 AP 模型**：現況一台 AP = 一個 radio（單 `frequency`/`channel`），model 已有 `supportedBands`/per-band 欄位但引擎只用單頻。要讓一台同發三頻需把 AP 展開成 N 個 radio 訊號源，**牽動全鏈**（buildScenario 展開、shader AP texture 打包、channel 面板 per-band、SINR/CCI 同頻干擾、Client View 關聯、統計負載）+ 風險破壞已驗證 parity。**CP 值不對**：47-8a 做完後痛點大幅緩解，雙頻可用「放兩顆」workaround。**重啟扳機**：使用者明確需要單台三頻建模，或 47-8a 的 workaround 造成實際規劃困擾。
  - `src/constants/apModels.js`（supportedBands 現成）、`buildScenario.js:187-204`。
- [x] **47-9【中】〔B2〕secondary coverage 視圖**（✅ commit 6c6afe8，MCP 驗：coverage 89.2% / secondary 43.6%，secondary ≤ coverage 不變式成立）：`sampleField` 加 opt-in `redundancyThresholdDbm` → 每格達門檻 AP 數（Uint8，reuse 現成 perAp 零額外 probe，預設不算不影響熱圖效能）；planQuality 算 `secondaryCoveragePct`（≥2 台達門檻的 in-scope 面積比）；DevicePlanningPanel 加「雙重涵蓋（≥2 台）」列（語音/漫遊備援白話 title）。
  - `src/features/heatmap/sampleField.js`、`planQuality.js`、`DevicePlanningPanel.jsx`。
- [x] **47-10【中】〔B5〕AP 型號逐頻段天線增益是死資料**（✅ 2026-07-22，Fable 5，使用者驗收 ok，MCP 驗：只換 model → JS RSSI 差正好 +1/+2/+3dB；GL delta = JS delta = 3.000、GL vs JS 絕對差 0.00；GL cache A→B→A round-trip=0；0 errors）：`apModels.js` 加 `getAPAntennaGain(ap)`（讀 model per-band `antennaGain`，未列頻段回 undefined）；buildScenario AP entry 加 `antGainDbi`；propagation.js `apGainDbi()` peak 從寫死 `AP_ANT_GAIN_DBI` 改 `ap.antGainDbi ?? AP_ANT_GAIN_DBI`（omni/directional/custom 三分支同步）；sampleFieldGL 三處 `_antGainDbi` 打包 + 兩處 cache hash 改用有效增益（否則換 model 吃舊快取）。**雙引擎不變量已驗**。
  - `src/constants/apModels.js`、`buildScenario.js`、`propagation.js`、`sampleFieldGL.js`、`FormulaNote.jsx`（第 7 節文案）。
- [x] **47-11【中】〔B5〕材質庫**（✅ 2026-07-22，Fable 5，使用者驗收 ok，MCP 驗：7 材質、金屬 30dB 全頻持平、Low-E 2.4/5/6G=25/32/33dB；customDb 雙引擎 delta 44.43=44.43；WallPanel 自訂衰減欄覆寫/解除正常；0 errors）：**決策（2026-07-22 拍板）**＝金屬 20→**30dB**（電梯井/機房級中間值）；新增 **Low-E 玻璃**（anchor 25dB@2.4 + lossB 0.3 → 5G≈32/6G≈33，落在 25-40 實測範圍；反射用金屬係數＝鍍膜強反射物理）；逐面牆 **customDb 覆寫欄**（WallPanel 材質列下方，留空=用材質值，只覆寫 anchor dB、lossB/反射/色沿用材質）。buildScenario expandWall 讀 `wall.customDb ?? material.dbLoss`；uploadWalls signature 已蓋 lossDb 故 GL 自動失效重算。
  - `src/constants/materials.js`、`buildScenario.js`（expandWall）、`WallPanel.jsx`、`FormulaNote.jsx`、`CLAUDE.md`（材質數 6→7）。
- [x] **47-12【中】〔B5〕預設 TX 20dBm 偏熱**（✅ 2026-07-22，Opus 4.8，使用者驗收 ok，MCP 驗：demo AP 2.4G=11/5G=15/6G=15dBm 不再全 20）：**決策（2026-07-22 拍板）＝逐頻段合理預設**。apModels.js 加 `DEFAULT_TX_POWER_DBM = {2.4:11, 5:15, 6:15}` + `getDefaultTxPower(band)`（單一來源，對齊 47-23 常數收斂）；三個 AP 建立點（FloorplanSystem 手動放置 / DemoLoader / StressLoader）+ buildScenario fallback 全改引用。取企業實務範圍（2.4G 8–14 / 5G 14–17）中間偏典型值，6G 對齊 5G。
  - `src/constants/apModels.js`（新常數+helper）、`FloorplanSystem.jsx`、`DemoLoader.jsx`、`StressLoader.jsx`、`buildScenario.js:194`。
- [x] **47-13【低】〔B5〕PoE per-port class 協商檢查**（✅ 2026-07-22，Opus 4.8，使用者驗收 ok，MCP 驗：3bt AP 連 3at switch→classShort count=1 + UI 顯示「⚠ 需 802.3bt」，switch 改 3bt→警告消失非恆真，0 errors）：**決策（2026-07-22 拍板）＝完整 per-port class 協商**。apModels.js 加 per-model `poeClass`（3af/3at/3bt）+ `POE_CLASSES` 元資料（rank/perPortWatt 15.4/30/60W）+ `getAPPoeClass`/`getPoeClassMeta`；`poeWattage` 改 worst-case（fallback 15→18W）。useCableStore per-kind default 加 `poePortStd`（access 3at / idf 3bt / core 無）。SwitchPanel connected 迴圈算 `classShort`（AP rank > port rank），PoE 區加「每埠供電」下拉 + 警告 hint，已連 AP 清單標「⚠ 需 802.3bt」。
  - `src/constants/apModels.js`、`src/store/useCableStore.js`、`src/components/PanelRight/SwitchPanel.jsx`、`SwitchPanel.sass`。

#### P2 — 邏輯/狀態 bug（demo 操作就踩得到）

- [x] **47-14【中】〔B3〕STATS 唯讀模式可 Delete 刪 AP/Switch**（✅ commit eb59e10，使用者驗收 ok）：加 `readOnly` capability（STATS + CLIENT_VIEW）；Delete handler + PanelRight 在 readOnly 模式 no-op / 不開物件編輯面板（含面板顯示，2026-07-20 拍板一起擋）。MCP 驗 STATS 選 AP Delete 存活、SELECT 正常刪。
  - `src/render/modeCapabilities.js`（readOnly flag）、`FloorplanSystem.jsx`（Delete guard）、`PanelRight.jsx`（面板 gate）。
- [x] **47-15【中】〔B3〕刪樓層漏清相機/軌跡**（✅ commit eb59e10，使用者驗收 ok）：confirmRemove 補呼叫 `useCameraStore.clearFloor` + `useTrackingStore.clearFloor`。MCP 驗 camera clearFloor 5→0。
  - `src/components/SidebarLeft/SidebarLeft.jsx`。
- [x] **47-16【中】〔B3〕「＋放置」相機後 Ctrl+Z 相機徹底消失**（✅ commit 91c36a7，使用者驗收 ok）：history snapshot 納入 org-level `unplacedCameras`（一律存 before-pool，因 placeCamera 同一 set() 改 pool+camerasByFloor）。MCP 驗 undo 後相機回 unplaced pool（pool 3→2→3）。
  - `src/store/useHistoryStore.js`。
- [x] **47-17【中】〔B3〕Switch 刪除/新增的跨樓層 uplinkTo 副作用不被 undo 還原**（✅ commit 91c36a7，使用者驗收 ok）：snapshot 的 switches 從單樓層 array 改成全建築 `switchesByFloor` map，restoreSnapshot 整份還原。MCP 驗跨樓層 uplink 刪→undo 還原、同樓層 switch undo 無回歸。
  - `src/store/useHistoryStore.js`（takeSnapshot/restoreSnapshot/commitPending/onStoreChange 全改 switchesAll）。
- [x] **47-18【中】〔B3〕DRAW_WALL Backspace 誤刪既有牆**（✅ commit eb59e10，使用者驗收 ok）：draftModeController 追蹤 `sessionWallIds`（commitWall push、新 anchor reset），Backspace 只 pop 本 chain 仍存在的牆，非 walls[length-1]。MCP 驗 45 牆未畫即 Backspace 全保留。
  - `src/render/draftModeController.js`。
- [x] **47-19【低】〔B3〕刪樓層後死快照卡住 undo 堆疊**（✅ commit 91c36a7，使用者驗收 ok）：`useHistoryStore.dropFloor(floorId)` 清該樓層 undo/redo 快照 + pending raw；SidebarLeft.confirmRemove 呼叫。MCP 驗 dropFloor 移除死快照、保留 active 樓層項。
  - `src/store/useHistoryStore.js`、`src/components/SidebarLeft/SidebarLeft.jsx`。
- [x] **47-20【低】〔B3〕複製相機連 calibration 帶走 → 假「已校正」**（✅ commit 09a5ddf，使用者驗收 ok）：ContextMenuMount + CameraPanel.handleDuplicate 解構加 `calibration: _omitCal` strip。MCP 真 UI 驗：原相機有 calibration、複製鈕產生的副本 calibration=false。
  - `src/components/ContextMenu/ContextMenuMount.jsx`、`CameraPanel.jsx`。
- [x] **47-21【低】〔B3〕雜項**（✅ commit 09a5ddf，使用者驗收 ok）：① ContextMenuMount menu-target-removed 的 closeContextMenu 從 render 期間搬進 `useEffect`（targetExists 判斷）——MCP 驗刪 target 後 menu 自動關、無 "cannot update while rendering" 警告 ② `viewport.js` Space keydown 加 `isTypingTarget` guard ③ `camerasLayer.js` drag/rotate 兩個 onMove 加 `isCameraMode()` guard ④ history onStoreChange：`_pendingRaw.floorId !== floorId` 時先 flushPending 再建新 raw（跨樓層第一步可 undo）。

#### P3 — UX / 一致性（demo 展示會出糗）

- [x] **47-22【高】〔B4〕比例尺靜默失敗指路**（✅ commit 1a4bf16，使用者驗收 ok）：heatmap store 加 `scaleMissing` flag（heatmapAdapter 在 enabled+無 scale 時 set true）；HeatmapControl 顯示「⚠️ 尚未設定比例尺」notice + 「設定比例尺」鈕（進 DRAW_SCALE）。MCP 驗 flag true/false 正確切換。**未做**：「匯入樓層後 scale=null 常駐入口」（DRAW_SCALE 已可從 toolbar 進，未加常駐入口，範圍收斂）。
  - `src/store/useHeatmapStore.js`、`heatmapAdapter.js`、`HeatmapControl.jsx`。
- [x] **47-23【高】〔B4〕-67 門檻收斂單一來源**（✅ commit 1a4bf16，使用者驗收 ok）：新增 `src/constants/coverage.js`（`COVERAGE_THRESHOLD_DBM=-67` + `COVERAGE_TARGET_PCT=90`），四處引用（ClientView store / DevicePlanningPanel / association fallback / useStatsTimeStore gapThreshold）。**決策（2026-07-21 拍板）：相機 coverageTargetPct 80% 不動**（FOV 覆蓋屬不同物理量，非 RSSI）——**防重做：不要把相機 80 改成 90**。熱圖色階 anchor 不塞 -67（視覺 ramp，非涵蓋計算，不動）。STATS gapThreshold 用共用常數即標明固定（未加獨立 UI 入口）。
  - `src/constants/coverage.js`（新）、`useClientViewStore.js`、`DevicePlanningPanel.jsx`、`association.js`、`useStatsTimeStore.js`。
- [x] **47-24【中】〔B1+B4〕色彩 token 收斂**（✅ B1 typo commit 2c5295d；B4 危險紅+開關色 commit 1a4bf16，使用者驗收 ok）：`_variables.sass` 加 `$danger`/`$danger-hover`/`$danger-soft`；各面板 #ef4444/#f87171/#e74c3c(危險語意) 收成 token（10 檔）；熱圖開關「開啟」#ef4444→`$accent`。**決策（2026-07-21 拍板）：只收危險紅+開關色**——「暗玻璃底 %dark-glass / 三種 radius / chip active 畫法統一」深度視覺重構**未做**（風險/CP 值不對，留 backlog）；頻段色留 JS（apsLayer FREQ_COLOR 已統一，sass 用不到）。
  - `_variables.sass`、各面板 sass、`HeatmapControl.sass`。
- [x] **47-25【中】〔B4〕內部黑話外漏**（✅ commit 1a4bf16，使用者驗收 ok）：引擎下拉 F5a→「精確（完整物理）/快速（GPU 加速）」；SidebarLeft/DevicePlanningPanel/BatchPanel/AutoPowerModal 的 greedy→白話；CableSummary/APPanel「Manhattan fallback/Unroutable/Z drop/slack」→「直角走線（未沿線槽）/無法接線/垂直落線/預留餘量」。
  - `HeatmapControl.jsx`、`SidebarLeft.jsx`、`CableSummaryPanel.jsx`、`APPanel.jsx`、`BatchPanel.jsx`、`DevicePlanningPanel.jsx`、`AutoPowerModal.jsx`。
- [x] **47-26【中】〔B4〕版面避讓**（✅ commit 1a4bf16，使用者驗收 ok）：① CameraTimelineBar center 改吃 `--right-dock`（`left: calc((100% - dock)/2)`）不被 PanelRight 蓋 ② **3D 隱藏 2D overlay**：CanvasArea `is3D` gate 左上/左下 stack + 時間軸 + 比例尺；ActiveModeBadge 3D 回 null ③ **3D Toolbar 精簡（2026-07-21 使用者拍板方案）：只留 AP/Camera/Stats 世界切換鈕**，藏第二行工具列 + Undo/Redo + 操作提示——世界切換在 3D 仍可用（實測點 Camera 切世界維持 3D）④ `--tl` stack 加 `max-height + overflow-y auto`（矮視窗可捲）。MCP 驗切 3D→2D overlay 消失/恢復、世界切換可用、0 errors。
  - `CameraTimelineBar.sass`、`CanvasArea.jsx/.sass`、`Toolbar.jsx`、`ActiveModeBadge.jsx`。
- [x] **47-27【低】〔B4〕hit target / 殘留樣式**（✅ commit 1a4bf16，使用者驗收 ok）：SidebarLeft 樓層輸入框 hover 泛紅殘留 bug→中性藍邊；CameraListPanel del/live + TrendPanel close 18px→24px hit target；StatsDashboard `fmtBps` 死碼移除、`linkMbps` 單位「M」→「Mbps」、rank-name 加 `title`。**未做**：三套 toast 中心點統一（觀感細節，CP 值低，留 backlog）。

#### 保留為 backlog（缺口非 bug，依產品優先序拍板）

- [ ] **PDF 規劃報告輸出**：Ekahau/Hamina 核心交付物（涵蓋熱圖截圖 + AP 清單 + verdict + Planning BOM）。jspdf 仍在 package.json；數據皆現成，缺組版。（CSV/SVG/DXF 已撤回，尊重。）
- [ ] **容量/airtime 規劃**：純覆蓋工具，缺高密度場域容量輸入（Ekahau Capacity Planner 對標）。
- [ ] **A/B plan diff、漫遊重疊區**：原有 backlog，待拍板。
- [ ] **spec.md 同步**：已嚴重落後實作（Camera/ClientView/Stats/Cable 整域未寫）；自訂材質、CAD 匯入等承諾與現況對不上，建議修 spec 或明列不做。

---

### Phase 25 效能家族（全部暫緩，防重做）

> 31-5/6/9/10/11 經 2026-06-01 MCP 壓測**全部暫緩**：單層真實 AP 量級（~300）MVP 全達標，瓶頸只在 1000 AP（真實到不了）。
> **重啟扳機（共用）**：單層 active floor >500 AP 真實需求 + 實測 pan/zoom 卡。
> 完整量測 + 各項細節見 `perf-baseline.md §31-12`、memory `project_31_5_6_deferred_1000ap_benchmark`。
> 31-13（刪 `oldSrc/`）：使用者決定保留到正式上線穩定後才刪，現階段不做。

---

## 已完成（細節見 git log）

| Phase | 範圍 |
|-------|------|
| 7–8   | Cable 基礎建設：Switch/IDF/MDF、AP↔SW routing、Cable Tray/Riser graph、PoE/port 容量、Cable Summary BOM + warnings |
| 10–14 | S2S routing、BOM 分類、3D cable 視覺、Tray 編輯/工程屬性、Planning BOM、context menu、CSV/PDF/PNG export |
| 17–18 | Mode capability matrix + 左右鍵分工；UI 分群、Toolbar 浮動 panel、PanelShell、active mode badge、color-legend |
| 20–24 | 效能（memo/fingerprint/drag freeze）、3D 強化、Switch kind 差異化、Konva layer 拆分 |
| 25    | PixiJS hybrid 全功能 port（Bundle 1–52 + parity gaps 853eeef + heatmap 等高線 byte-identical）+ 32-C 增量 routing + 32-E cable 靜動分層（殘影回歸已驗證消除） |
| 26–27 | perf-baseline 文件脈絡警示；heatmap polish audit 實測後全部不做（品質已達標） |
| 33    | **Client View 完整落地**（33-0~33-17）：CLIENT_VIEW mode + simulate（band/hysteresis/MCS/data rate）+ ClientPanel + association/coverage（門檻 -67 可調）+ indoorLoss 距離模型 + 位置記憶 + 手動鎖定 AP（右鍵選單）+ 單台 AP 涵蓋（紅色）+ CV hover 回饋。語意/架構決策見 `.claude/client-view-spec.md` + 下方引擎決策 |
| 34    | **Camera 模式完整落地**（34-0~34-5，2026-06-11 驗收）：CAMERA mode（畫布只剩底圖+牆）+ camera 放置/拖曳/旋轉 + FOV visibility polygon（牆遮擋、玻璃/窗穿透、門擋視線；人移動相反：玻璃擋人、門可走）+ mock 一天軌跡（seedable、避牆、雙峰）+ 偵測語意 live icons（FOV 內實色/外灰 ghost、車=俯視車形朝行進方向）+ 人流熱圖（人流量/停留/動線三檔+時段篩選）+ 盲區圖 + 計數線（分方向、端點可拖、右鍵/Esc 取消）+ 分析區域（全區選取可拖、逐時長條圖）+ 回放 timeline（scrubber/倍速/日循環）。畫布標籤白字+深色描邊適應任意底圖。設計共識與驗收細節：memory `project_camera_mode_phase34`。新增 stores：useCameraStore/useTrackingStore；新增 scene layers：cameraFov/cameras |
| 35    | **相機 4 點校正 + 導覽 polish**（2026-06-29 驗收 ok）：① 4+4 點校正 modal（平面圖 4 點 + mock 相機畫面 4 點 → 前端真求 frame→floor homography，`utils/homography.js` solveHomography/invertHomography）② 品質防呆：四邊形過小/共線即時橘色警告（**不顯示重投影誤差**——4 對點恰定恆為 0 是假精度）；步驟提示跟著 active pane（① 在平面圖上方、② 在相機畫面上方）③ **階段 2 真投影**：軌跡綁定相機 FOV（projectTracks）+ 經 homography 投影；**first-freeze 模型**（首次校正不位移、重校才位移；baseSamples 不可變、frameSamples 凍結），消費者（熱圖/計數線/趨勢/3D）零改動 ④ **純手動校正**（對標 Verkada，無 auto 預設——曾做 auto 但「畫面四角↔地面正方形」非真實光學投影，撤除）；未校正→軌跡用平面座標顯示（demo 不空），已校正綠徽記、未校正提示 ⑤ Device List hover：清單↔marker 雙向高亮 + mock CCTV live 縮圖 ⑥ 占用趨勢點長條跳時間 ⑦ 回放時鐘到秒 HH:MM:SS ⑧ 重構：抽共用 FOV rasteriser + wrapAzimuth 抽 utils/angle。新增：homography/frameConstants/projectTracks、useTrackingStore.reprojectCameraTracks、CalibrationModal、utils/angle。決策與驗證細節：`.claude/verkada-notes.md` §L4/§L5。**未來 live 版**接真實相機主機後校正才對位真實偵測，現 plan/mock 版校正驗證數學正確性 |
| 34-V  | **Verkada parity 擴充**（2026-06，branch `feat/verkada-parity`，對標 Verkada 平面圖 camera 功能，調研+差距表見 `.claude/verkada-notes.md`）：① 熱圖 timelapse 時間推移（占用窗沿日滑動，按鈕自動縮窗）② FOV 偵測脈動 + 由內而外水波擴散環（牆裁切）③ 裝置線上/離線狀態（綠/橘點、離線錐暗+不偵測+計盲區；`deviceStatus.js`：undefined=online，僅 status==='offline' 才離線）④ 占用趨勢面板（逐時長條、可拖、左下）⑤ 即時影像 mock popover（canvas CCTV 畫面、離線雪花）⑥ 覆蓋率報表（涵蓋%/盲區/重疊備援/平均重疊；目標門檻 pass/fail；最大盲區定位=移畫面+開盲區遮罩+脈動環，遮罩 4.5s 自動恢復；單台相機 solo 貢獻）⑦ 重疊覆蓋 overlay（黃=1台/藍綠=≥2台）⑧ 型號預設（dome/bullet/turret/wide/fisheye）⑨ 相機清單面板（多選批次改型號/狀態/刪除、區域分組、可收合、點列定位）⑩ 複製相機 ⑪ 高度快設 ⑫ 方位角 ±15°/對準中心。新增：deviceStatus/detectionBus/coverageStats/overlapLayer/gapMarkerBus/gapMarkerLayer/exportless、cameraModels 常數、CoveragePanel/TrendPanel/CameraListPanel/LiveViewModal。**已撤回**：門禁/環境感測器多裝置（偏離 camera 主線，整包丟棄）、CSV 匯出（使用者喊停）。Code review（2026-06）：無 bug，僅可選重構（3 rasterizer 重複/wrapAzimuth 重複）未做 |
| 36    | **Verkada Tier 1&2 擴充**（2026-06-29 驗收 ok，effort=ultracode+workflows，roadmap 見 `.claude/verkada-notes.md` Tier 1/2）：① 抽共用 `features/cameras/mockCctv.js drawCctvFrame`（合併 LiveViewModal/HoverThumb/CalibrationModal 三處重複 mock CCTV 畫格；加 `renderMode:'mock'\|'stream'` seam 留給未來真實串流，touch 只一檔）② 統一 hover store（cameras 從 `useCameraStore.hoverCameraId` 遷到 `useHoverStore` type:'camera'，刪舊欄；camerasLayer + CameraListPanel 同步）③ 全樓層占用趨勢報表（Tier2 #4）：`generateWeekTracks` 生 7 日 mock（seed-per-day，每天 distinct 數不同；track 帶 `day` 欄）+ `analyticsStats.computeDayRollup`（day-level Set 去重）+ TrendPanel 逐時/逐日切換 + 人數/人·秒/車數 metric 切換（**CSV 匯出曾加後移除——尊重 34-V「CSV 撤回」決策，2026-06-29 使用者確認**）；day-0 消費者（熱圖/計數/3D/校正）零改動，週資料只在面板內 memoize 不入 store ④ Device List 側欄（Tier 1 #3b，**只列攝影機對標 Verkada**——「AP+camera 統一」原為自編延伸、Verkada Device List 無 WiFi AP，已捨棄）：CameraListPanel 從 CAMERA 模式 floating 浮窗升級成 **docked 常駐左欄**（掛 App.jsx，SidebarLeft↔CanvasArea 間，預設顯示、寬 260；多選/批次/分組/雙向 hover/縮圖全保留；切走自動回收空間）⑤ 清單列 📹 鈕（Tier2 #6）直接 openLiveView，stopPropagation 不誤觸選取。**排除**：多裝置型別（門禁/環境感測器，尊重 34-V 撤回）。新增：mockCctv.js、$device-list-width；MCP 驗證 0 console errors。設計共識與取捨：memory `project_tier1_2_devicelist_plan` |
| 37    | **Camera 右鍵選單 + 3D camera 三圖 + 3D 唯一光源光影**（2026-06-29 MCP 自測 ok，effort=ultracode+workflows）：① **Camera 右鍵 context menu**（對標 AP）：camerasLayer container pointerdown button=2 → openContextMenu({targetType:'camera'})（armed draw tool 時跳過讓 analyticsLayer draw-cancel 仍生效）；ContextMenuMount 加 camera 分支 `buildCameraItems`；選單 6 項：重新命名/選取/⧉複製相機/📹即時影像/🎯校正熱圖/刪除。**需在 modeCapabilities.js CAMERA_CAP 加 allowContextMenu:true**（emptyCap 預設 false，否則整個選單不渲染）。複製相機無 store action，inline 複製 CameraPanel.handleDuplicate 邏輯（generateId('cam')+strip id/name+nextCameraName+x/y+24）。② **3D 顯示 camera 三分析圖**（盲區/重疊/占用）：新建 `features/viewer3d/CameraOverlay3D.jsx`（BlindSpot/Overlap/Occupancy 三 sub-plane），仿 HeatmapPlane3D（offscreen canvas→CanvasTexture→floor-aligned plane），**重用 2D rasteriser**（`fovRasterize.rasterizeCoverageCounts` 供盲區/重疊、`occupancyGrid.computeOccupancyGrid/renderOccupancyCanvas` 供占用）使 3D 與 2D 像素一致；**跟隨 2D store 開關**（showBlindSpots/showOverlap/occupancyMode）+ CAMERA mode + active floor gate；各 plane 不同 y-lift（occupancy 0.03/overlap 0.04/blind 0.05）避免 z-fight；texture 在 unmount/off 釋放。③ **3D 唯一光源 + 明顯光影**（不分 mode）：Canvas 開 `shadows`（PCFSoft）；`KeyLight` 元件（directionalLight castShadow、跟樓層 center、intensity 1.1、shadow-mapSize 2048、frustum ±80m、shadow-bias -0.0005）；ambientLight 弱化 0.6→0.28 + hemisphereLight 0.25 微弱補光。**注意**：frustum 固定 ±80m，超大樓層或遠離 active center 的堆疊樓層陰影會裁切（已知設計取捨）。新增：CameraOverlay3D.jsx。④ **3D 動線（flow）立體箭頭**（37b，2026-06-30）：occupancy flow 模式在 CameraOverlay3D 加 `FlowArrows3D`——**單一 THREE.InstancedMesh** cyan(#06b6d4) cone，instanceCount=可見格數（frac≥0.04，cap 4000），matrix 在 useMemo/useEffect off-frame 算（非每幀）；重用 `computeFlowGrid`（vx/vy 現成不重算）；px→world 對齊 HeatmapPlane3D（floor 旋 -PI/2，cell 中心→world，Y=0.06 疊在熱圖 plane 上方）；cone 朝 (vx,0,vy) 方向。實測 demo 580 箭頭、效能無虞。⑤ **全物件參與陰影**（37b）：Switch(pole+body)/Tray body/Riser body/Track 人車 7 mesh +castShadow；AP/Camera body/門 leaf +receiveShadow；門框+窗框+sill +cast/receive（共 22 flag）。**跳過**（three.js 無法投影）：line（纜線/tray 邊框/中線）、sprite（AP label）、meshBasicMaterial（FOV 體/riser wireframe）、meshPhysicalMaterial 玻璃。MCP 自測：右鍵 6 項+複製/live 有效、3D 三圖各自可見、3D 動線箭頭指向正確、全物件陰影明顯、0 console errors ⑥ **3D 控制面板整理**（37c，2026-06-30）：移除 Log Camera（debug-only，連 handler 一起刪）；新增「🔄 自動旋轉」toggle 鈕（沿用既有 OrbitControls autoRotate idle spin 機制，速度 0.6；CameraRig 暴露 `setAutoRotate`，使用者拖曳時 OrbitControls `start` 事件經 `onAutoRotateStop` 回呼把按鈕 state 同步關閉）；右上角 `viewer3d__panel` 從「透明容器散落按鈕」改成**統一深色玻璃面板**（dark-glass 外框+邊框+圓角，對齊 CoveragePanel/TrendPanel）+ 標題「3D 視圖」+ 可收合 caret（收合只剩標題列）。MCP 自測：Log Camera 已無、自動旋轉前後截圖視角確實轉動、面板有外框+收合正常、0 console errors |

| 38    | **熱圖綁定 FOV + 未放置裝置清單 + 3D 動線流線化**（2026-07-02 使用者驗收 ok）：① **占用/動線熱圖裁切到相機 FOV 覆蓋區**（Verkada §J3「熱圖只渲染在 FOV 內」）：共用 `fovRasterize.buildFovMaskGrid`（online-only、牆裁切、對齊各 grid 自己的 cols/rows/cellPx）；`computeOccupancyGrid`/`computeFlowGrid` 接 `maskFn`（caller 建遮罩、grid 內套用保證對齊）；streamline 積分在遮罩邊界截斷（bilinear 會漏過邊界 1-2 格）；`useCameraStore.clipHeatmapToFov` toggle「FOV 內」預設開（熱圖控制列，推移鈕右邊）；2D/3D 共用同一 maskFn 像素一致。② **未放置裝置清單**（Verkada Add Cameras）：`unplacedCameras` org-level pool（非 per-floor）+ `addUnplacedCamera`（進 pool 就取號，計數器連號）/`placeCamera`（放樓層中心）/`removeUnplacedCamera`；CameraListPanel 加搜尋框（同時過濾已放置+未放置）+「尚未放置」區段（琥珀虛線圈、＋放置鈕）；demo 種 2 台未放置。③ **3D 動線改流線平面**：`FlowArrows3D`（InstancedMesh 圓錐）→ `FlowPlane3D` — octant-bins commit `8c39e49` 後 flow.cells 變每 bin 一筆（一格最多 8 筆），圓錐版同點疊 8 支變糊（回歸）；新版用 2D 同一份 `computeFlowGrid(cellM 1.5)+computeStreamlines` 畫到 offscreen canvas（×2 supersample cap 2048）貼地面 plane（Y_FLOW 0.06），`useFrame` 30fps 重繪爬行動畫（frameloop 可見時 always）。④ **流線配色**（2D/3D 同步）：通道 cyan→**fuchsia 0xe879f9**（跳出 FOV 青綠/藍車色系）；箭頭=**黑色 stroked「>>」**（兩個相連 > 線條，非實心飛鏢），尺寸/線寬低於通道一階當方向記號。**中途撤回**：3D「主導 bin 圓錐」方案（仍是立體物、斜看變噪點，直接對齊 2D 流線） |

| 40    | **天線俯仰角 tilt**（2026-07-03，commit e6f4ec1；azimuth + tilt 兩自由度，no roll）：① AP 加 `tiltDeg`（-90~+90，+為上仰，預設 0；directional/custom 適用，omni 不變）② **雙引擎同步**：propagation.js apGainDbi 垂直偏角 =（rx/AP 高度差 ÷ 水平距離的仰角）− tilt，gain = Gh + Gv；custom 的 Gv 用同組水平樣本近似、directional 兩平面同錐 taper；propagationGL per-AP uniform `uAntTiltDeg` + aggregated AP texture t3.y 打包 tilt，apGainAt 鏡射 JS 公式；sampleFieldGL grid cache 簽名含 tiltDeg ③ APPanel 俯仰角欄位與方位角並排；PatternPreview3D 上下拖曳改為調 tilt（放開才 commit，Shift+拖曳保留觀察視角）④ APLayer3D custom lobe 把 tilt 烘進幾何、directional cone 內層 group 旋轉俯仰；FormulaNote §7 補垂直增益公式。**當時未納入**：AP `mountType`（ceiling/wall）與 tilt 預設值互動、legacy（tilt 前語意）對照開關 |
| 41    | **熱圖無感重算**（2026-07-03 使用者驗收 ok）：① **二段渲染**——idle 重算先粗場（≥1.0m、關 refl/diff → aggregated）秒級上畫，細場（使用者品質）背景算完無縫換底；drag solo/live 路徑不動 ② **Hamina 式波紋過渡**——新場**立即全尺寸上畫**（移動 AP：舊 blob 立刻消失、新等高線直接最終大小），疊加漂移 value-noise 擾動（`WOBBLE_AMP_DB 1.6`／`LAMBDA 2m`（使用者調校）／`DECAY 900ms`／hold cap 4s，旋鈕在 heatmapAdapter.js）至細場落地後收斂；**撤回**第一版舊場→新場 dBm 內插（舊 blob 內縮/新 blob 從中心長大，觀感錯誤）③ **41-5 非同步 readback**：PBO+fence（不再 sync readPixels stall）+ per-AP 分批送件 `SUBMIT_BATCH=4`（防 GPU command-buffer 反壓，300 AP 曾一個 13s task）+ aggregated 主 pass scissor 分帶 `ceil(apCount/24)`（拆 2.4s 不可搶佔 GPU atom）+ `sampleFieldGLAsync` mutex 序列化（2D/3D 共用 instance）+ generation counter 丟過期結果；3D HeatmapPlane3D 跟進 async ④ 41-6 CPU 聚合切片 ~5ms/塊 ⑤ fingerprint-skip（`lastIdleInputs`）回歸 idle 路徑 ⑥ **solo 放開交棒**：畫面完全不動直到粗場換底（撤回「快照拉回全亮」——舊位置閃回/新位置消失）⑦ isSoftwareRender 關動畫直接跳變。**驗證**：sync/async 引擎 4 field bitwise 一致；5 AP 移動 0 long task；300 AP 冷啟 13s→250ms，殘餘 ~1.9s 經關熱圖對照證實為 apsLayer/3D/routing 既有成本（效能家族範疇，扳機 >500AP）。Worker 方案確認不做，殘餘卡頓再重啟。**41-postfix（2026-07-03 使用者回報 300 AP 放開仍先卡再動畫）**：profiler 歸因出兩個非熱圖元兇 + 一個 41-5 回歸 bug——① `CableLayer3D` 每次 AP 變動全量重算 routes 且 pts3 全新 ref → ~2000 段 line geometry 重建（主因）→ `PolylineTube` 改**值比較 memo**（座標沒變不重建）② `APLayer3D` APMarker 無 memo → 300 marker 全重 render → `React.memo`（updateAP per-item immutable 保證 ref 穩定）③ **syncEpoch guard**：solo 拖曳的 sync 計算會大量淘汰 losCache/apGeoCache（deleteTexture），in-flight 的 3D async job（其 cancelled flag 不知 2D 在拖）batch 醒來 bind 已刪 texture（INVALID_OPERATION + 汙染 grid cache）→ sync `sampleFieldGL` 入口 bump epoch，所有 in-flight async 在下個 await 檢查點作廢。實測 300 AP 放開 max long task **2995ms → 258ms**、GL 警告 97→0；3D 反應性驗證無回歸（纜線重佈/熱圖更新正常） |
| 39    | **UIUX 規範落地**（2026-07-02 驗收 ok，規範+實作狀態見 `.claude/ui-spec.md`）：① z-index token 化（8 階，`_variables.sass`，禁裸數字）② 四角 stack container（CanvasArea `__overlay--tl/--bl`，面板入堆疊不再寫死座標——A2/A3/A4/A5 消失）③ 右側避讓 `--right-dock` CSS 變數（PanelRight 開啟時 3D 面板/ClientPanel/ScaleBar 平移讓位——修 A1「3D 選物遮右上面板」）④ 全域 UiToast + 刪除策略統一（單刪即刪+undo toast、批次>1 ConfirmDialog，四個刪除入口全覆蓋）⑤ 模式切換一次性說明 toast（CAMERA/CLIENT_VIEW）+ 3D「唯讀」徽記 ⑥ 收合符號統一 SVG chevron、熱圖鈕固定標籤、✕ 關閉配對提示、hint 常駐（Toolbar z 提到 badge 之上蓋過）⑦ ALIGN Esc=完成、F2 改名實作、keyboard guard 補 SELECT/contentEditable（`utils/isTypingTarget`）、alert→toast、內部用語清除、樓層 grip ⠿、`.camera-list` 浮動死碼刪除 ⑧ **dev widget（Demo/Stress/Progress）移至 SidebarLeft 最下方**（使用者指示：不入畫布 overlay，正式版整塊移除）。發現免修：3D 選取 highlight 與切模式清 selection 本already存在。MCP 驗證 0 console errors，截圖 `.playwright-mcp/ui-01~06` |
| 42    | **統計階段 1：Plan 規劃品質面板（A 域）**（2026-07-06 使用者驗收 ok，設計共識見 `.claude/stats-mode-spec.md` + memory `project_stats_spec_two_mode`）：三角審查（QA/User/PM）定案「統計不新增第三 mode」——A 規劃品質併進既有 `DevicePlanningPanel`（Plan/非 camera 模式顯示），B/C 之後進 Live。① 新 `features/heatmap/planQuality.js`：`computePlanQualityStats`（`buildScenario`+JS `sampleField` gridStep 1.0m、refl/diff off，掃 RSSI grid 依門檻算涵蓋率/盲區/盲區面積 m²/最大盲區 image-px 定位，分母=非 NaN in-scope 格）+ `detectChannelConflicts`（同 band+同 channel+距離<300px、去重每對一筆）② `DevicePlanningPanel` 加「規劃品質」section：涵蓋率 hero + 進度條（綠填/紅底盲區/白目標標記）+ 目標門檻可調（預設 90%）+ 達標紅綠燈 verdict + 盲區/頻道衝突/訊號門檻(-67 可調 -85~-55) rows + ◎ 定位最大盲區（viewport 置中，用 `getSceneRefs().app.canvas` rect）；debounce 200ms 且僅展開時算；門檻/目標為面板本地 state（不共用 clientView 語意）③ sass 配色對齊 CoveragePanel（綠 #10b981/橘 #f59e0b）。**MCP 驗證**（demo 5AP/45 牆/scale 22.83）：涵蓋率 89.1%/盲區 10.9%·81m² 面積自洽、compute 9ms、衝突偵測正負向皆正確（同頻近距報 1 對、遠距不誤報）、定位盲區 viewport 移動、0 console errors，截圖 `stats-a-plan-quality.png`。**未做**：B/C（Live 聚合/趨勢，階段 2/3）、PM 差異化 backlog（規劃 vs 實測空間疊合） |
| 43    | **統計階段 2+3：STATS 獨立模式（B 域聚合 dashboard + C 域趨勢/timelapse）**（2026-07-08 使用者驗收 ok）：**定位修正**——原 spec 說「B/C 進 Live」，但專案無 Live editorMode，經使用者拍板改為**新增 `EDITOR_MODE.STATS` 獨立唯讀模式**（memory `project_stats_spec_two_mode` 的「乾淨兩態」在無 Live mode 下具體化為此）。**資料地基**：`features/stats/statsSource.js`——`deriveTopology`（單一真相：seed 撒 client（AP-centric 高斯散佈，**不依賴 scope**，避免污染規劃熱圖）→ `buildCandidates` 真算每 client 連哪台 AP+RSSI+band；AP↔switch 用 `getCachedRoutes`；LLDP port groupBy 編號；`occupancyFactor(ts)` 日夜曲線；AP 可帶 `mockStatus:'offline'` 釘死狀態，否則 seed ~90% online）+ `getSnapshot(building,floorId,{ts})`（spec §1.2 shape，INV-1~10 自洽 by construction）+ `getTimeSeries`（掃 range 每 bucket 一次 getSnapshot 取值，實測 24 點 44ms，與 scrubber 停駐點同函式零漂移）。**共用 seed**：`utils/seededRng.js`（mulberry32+hashStringToSeed，抽共用不動 camera 版）。**時間源**：`store/useStatsTimeStore.js`（anchorTs 即時邊緣/playheadTs 顯示時刻/playing/speed，dashboard+overlay 共訂閱，比照 useTrackingStore 模式；epoch ms 非日內秒）。**UI**：① `components/StatsDashboard.jsx`（右側 dark-glass docked 面板）：KPI tiles + 連線裝置趨勢 24h 長條圖 + scrubber（▶播放/range 拖桿/×1×60×300；togglePlaying 從 live edge 按▶會倒帶到窗口起點避免瞬間 goLive；rAF 播放 dt clamp 0.25s；即時徽記+回即時鈕）+ 告警清單 + AP 負載排行 + Switch PoE/LLDP 鄰居 + 頻段分布 + client MAC 下鑽；點列跳定位（setActiveFloor+setSelected）；hover 列→useHoverStore→圖上脈動環 ② `features/stats/statsOverlayLayer.js`（overlays layer）：**AP 負載 badge**（對標 Meraki/Aruba：數字 pill+狀態色綠<15/黃<25/紅≥25，Text pool 固定螢幕大小；**撤回**初版「負載光暈圈」——使用者指出圓圈=涵蓋範圍既有語意會誤讀）+ **離線 AP 灰「離線」badge+灰環**（不只少數字）+ hover 白青脈動環；讀 useStatsTimeStore.playheadTs（timelapse 拖動整個 dashboard+光暈跟著變）③ `EDITOR_MODE.STATS` + `STATS_CAP`（唯讀，keepLayers floorImage/devicesAP/devicesSW/walls）④ Toolbar：STATS 與 camera 並排最前的 direct 頂層鈕（divider 移到 statistics 後），Icon 加 `stats` 長條圖 ⑤ **STATS 隱藏 RSSI 熱圖**（`layerVisibilityBinder` heatmap `!inCamera && !inStats`，統計光暈才不被彩色場干擾）。**DemoLoader**：AP-03 釘 `mockStatus:'offline'`、加第 2 台 idf switch（拓樸有料）；**移除**曾補種的 3 scope（會把規劃熱圖限制在 scope 內——回歸，已改 AP-centric 撒點）。**MCP 驗證**：INV-1~10 全通過、日夜曲線（夜4/尖峰54/午休14/週日18）、可重現 deep-equal、掃24點44ms、timelapse 拖4am→KPI 37→6 同步、跨時間不變式零漂移、離線 AP-03 四處一致（圖/告警/KPI/排行）、切模式生命週期無 crash、0 console errors。**注意**：播放連續滾動因 MCP headless rAF 降頻無法自動驗，倒帶+時間前進已證實，需前景實測。**未做**：PM backlog（規劃 vs 實測空間疊合）、A/B plan diff、漫遊重疊區 |
| 44    | **規劃 vs 實測空間疊合（PM 護城河）**（2026-07-08 使用者驗收 ok）：STATS 內標出「規劃說 ≥門檻（該有訊號）但實測 client RSSI <門檻（實際差）」的落差點——平面圖工具獨有、dashboard 給不了的空間洞察。① `statsSource.js`：client 同時帶 `theoreticalRssiDbm`（傳播模型算）+ `rssiDbm`（實測=理論−環境劣化）；`measuredDegradationDb`（依 3m 網格 seeded、~38% 問題格重劣化 22–40dB 模擬死角，其餘 1–4dB）——比例調高確保白天穩定有落差（實測 9/24 小時有、尖峰數個）② `useStatsTimeStore`：`showGapOverlay` toggle + `gapThresholdDbm` ③ `statsOverlayLayer.js`：落差 client 位置畫**紅鑽石（白框加大 11px，落在 AP 密集處也跳出）** ④ `StatsDashboard`「規劃 VS 實測」section：落差點數 + 顯示 toggle（無落差時灰字提示拖白天）。**過程修的 4 個問題**（都使用者回報）：❶ 負載光暈圈誤讀成涵蓋範圍→改數字 badge（已在 Phase 43）❷ **定位落差點按鈕移除**（會硬移畫面、第一個點任意、價值低）❸ apStatus 改「只 mockStatus 釘死、其餘一律 online」（移除隨機 flapping，離線固定 AP-03 方便測試；連帶 rng 流偏移→落差場景變，靠提高問題格比例補回）❹ **overlay redraw 漏 `scene.requestRender()`**——本 app 按需 render（`app.ticker.stop()`），toggle 落差只改 Graphics 幾何卻沒請求重繪，導致「要 hover floorplan 才顯示」；加 requestRender 後 toggle 立即生效（此 bug 亦是先前 MCP 截不到紅鑽石的同源）；另 statsTime 訂閱只在 playheadTs 變才 recompute（toggle 不重算 44ms snapshot）。**MCP 驗證**：seek 白天 toggle 不 hover 紅鑽石立即出現（10 落差一堆紅鑽石）、AP-03 跨時段固定離線、0 console errors。**未做**：A/B plan diff、漫遊重疊區 |

| 45    | **隱藏 3D 凍結 + 2D/3D 熱圖共用 canvas**（2026-07-13 使用者驗收 ok）：使用者回報軟體渲染機（硬體加速關閉→SwiftShader）300 AP 拖曳很卡。**Profiler 歸因**（trace 解析腳本抽 long task + CPU profile）：3.4s long task 中 57% 來自**隱藏中的 Viewer3D**——2D 模式下 Viewer3D 常駐 mounted 只用 CSS 藏，`frameloop='demand'` 仍隨每次 store 變動重繪整個 3D 場景（含陰影），HeatmapPlane3D 隱藏中重算、CableLayer3D 每次 AP 位移重跑 dijkstra；unmount A/B 驗證版實測 long task 3432ms→1468ms、最大單筆 777ms→232ms。**正式修法（凍結而非 unmount）**：① Viewer3D 隱藏時 `frameloop='never'`（invalidate 全 no-op；r3f 7.0.29 `setFrameloop` 不會自動重啟 loop，新增 `WakeOnVisible` 在 hidden→visible 邊緣補一次 invalidate）② CableLayer3D：computeRoutes 手動輸入 ref 快取（隱藏凍結、重入輸入沒變直接沿用=秒切保留、有變才 re-route 一次）+ 隱藏時回傳快取 element tree 讓 reconciliation bailout（**null 路徑也必須寫快取**，否則會復活更舊的樹）③ **2D/3D 熱圖共用 canvas**（回答「兩邊要分開算嗎」→ 不必）：新增 `render/heatmapFrameBus.js` 小 pub-sub，heatmapAdapter `paintCanvas` 每次上畫廣播 canvas+padding 對位、`hide()`/銷毀廣播 null；HeatmapPlane3D **全檔重寫成純消費者**（刪自有 GL context+sampleFieldGLAsync 整條計算路徑+凍結/暖身邏輯），CanvasTexture 包 2D canvas、UV offset/repeat 裁 padding（flipY 下 v 從 canvas 底算）、只在 3D 可見時訂閱（隱藏零成本）、重入拿 `getHeatmapFrame()` 最新一張。**效果**：3D 熱圖零計算成本（繼承 2D 粗場秒出+大場景降級）、2D/3D 像素級一致、300 AP 切 3D 熱圖從幾十秒（3D 舊路徑無大場景降級，MCP 實測 60s 才落地）變 +400ms 即現。**中途撤回**：HeatmapPlane3D「輕場景隱藏暖身」patch（修首次進 3D 空窗）——共用 canvas 後不需要，已刪。MCP 驗證：5 AP 切 3D 即時、2D 移 AP 重入正確跟上、熱圖開關 plane 同步、300 AP +400ms 完整呈現，全程 0 console errors |

| 46    | **效能第二/三輪：熱圖引擎 async 化 + Pixi 修正 + marker 免重畫**（2026-07-14 使用者驗收 ok；三份 trace 逐輪歸因驅動，SW 機 300 AP 拖曳 long task 3.0s→1.25s→0.93s、最大單筆 777→205ms）：① **per-size render target 快取**（propagationGL）：out/outField/mask 從單一可變尺寸改為每尺寸一份（`makeSizedTargets`，LRU cap 6）+ losCache key 加 grid size（`@@${nx}x${ny}`）+ 年齡汰換（LOS_STALE_BAKES 32；**汰換必須用 AP-part 比對**，整 key 比對會讓粗細場互相驅逐）——消除 coarse(1.0m)↔fine(0.5m) 交替時整批 texture realloc + `checkFramebufferStatus`（強制 GPU 同步）；殘餘的 cfs 只剩首次拖曳 per-size 一次性配置 ② **solo/live 拖曳改 async 管線**（heatmapAdapter）：drag 幀不再同步 `sampleFieldGL`+`readPixels` stall，改 latest-wins 單格佇列 + `runDragLoop`（PBO+fence async，1 幀延遲換主執行緒零等待）；**教訓：latest-wins 只作用於佇列**——第一版把「有新請求」放進 isStale 會殺進行中計算，拖曳事件比計算快時每個計算死在半路、疊層凍在第一幀（starvation）；isStale 只留 `!dragSessionOn`（放開後 idle 接管，遲到的 drag paint 直接丟）③ **拖曳輸出解析度減半**（DRAG_OUT_SCALE 0.5）：採樣 grid 之外連 colormap 輸出 canvas 也減半（光柵化+Pixi 上傳都 1/4），sprite scale 自動補償、blur 半徑同步縮放，放開回滿解析度 ④ **Pixi v8 CanvasSource resize bug 修正**（使用者回報「拖曳中熱圖放大好幾倍/全紅」）：③ 讓共用 canvas 首次在執行期改尺寸，`source.resize()` 後 JS 側 source/frame/uvs 全一致但**場景渲染取樣到舊尺寸 GL 配置**（extract/讀 canvas 都會重新上傳所以看起來對，只有螢幕合成錯→初期誤判為測試假影，使用者實測逼出）；修法：尺寸變化時整顆 texture 重建（顯式 `new CanvasSource` 繞過 `Texture.from` 的 resource 快取），只在拖曳開始/結束發生 ⑤ **apsLayer 拖曳移動免重畫**：`drawAP` 幾何本畫在 local(0,0)+`container.position` 定位，`applyDragOverlay` 卻每移動幀全量重畫（circle/fan 筆劃重新三角化+Text 重設，SW 機 ~500ms buildLine+126ms flush 純白做）；改為首幀全畫、移動幀只 `position.set`（拖曳中 hover 被抑制、視覺狀態不會中途變）。**MCP 驗證**：solo/live 兩模式拖曳中疊層正確（牆影/blob 跟手）、放開回滿解析度、5AP 拖曳 0 long task、300AP 拖曳單筆 154ms、0 console errors。**trace 解析腳本**（long task 抽取+CPU profile 歸因+bucket 分類）在 scratchpad，重建成本低、未入 repo |

| 50    | **AI 牆改接 cv+graph pipeline API**（2026-07-29，commit e242f6d，MCP 驗證通過）：AI 偵測牆壁從「Gemini 清圖 → 舊 `analyzetovec.onrender.com/vectorize`」換成 `https://floorplan.senao.net` 的 **Floorplan cv+graph pipeline**（7 支 API 的非同步 job 佇列，GPU 一次一張）。新服務**自帶 Stage-A 去噪**（CNN 或傳統 cv），所以原圖直接上傳即可——**砍掉 Gemini 整段**（~90 行：清圖 prompt/base64 轉換/`extractFirstImagePart`）+ **API key 欄位**（使用者不用自備 key）+ **解析度 remap**（新服務回傳的座標本來就是原圖像素座標系，不需換算）。① **AIWallsModal 新流程**：`POST /jobs`（multipart）→ 輪詢 `GET /jobs/{id}`（1.5s 間隔／5 分鐘逾時／顯示排隊位置）→ 取 `lines[]` → 既有 `floorplanFromLines` → `setWalls`。**只用 3 支**：`/coords` 刻意不打——完成的 job response 裡已含同一份 `lines[]`（實測逐欄位比對一致），省一次往返。② **演算法選單**（7 種，預設 **cnn**；伺服器自己的預設仍是 v1，所以 `algorithm` 一律明確帶）。實測 demo：cnn 34 牆/861ms vs v1 67 牆/262ms——cnn 慢 ~3x 且牆數少一半，但選單可即時切換 + 「重新偵測」不必關窗重開。③ **`/denoised` 中間圖**（規格後來新增的第 7 支）：CNN denoiser 向量化前的**乾淨 4 色線稿**（實測像素統計剛好 4 色：白底/黑牆/藍窗/黃門——與被砍掉的 Gemini prompt 幾乎同一套配色，證實 CNN 取代了 Gemini 那一步）。**可用條件 `cnn*` + `output=full` 兩者皆須成立**，前端**不硬寫規則**而是看 job 回報的 `denoised_url` 是否為 null（避免與後端脫節），實測 v1 完全不發那次註定 404 的請求。純診斷用途：線稿乾淨但牆很爛 → 怪向量化；線稿本身就髒 → 換 algorithm。④ **ApiTestModal**（新，header「API 測試」鈕）：一鍵跑完 7 支，逐列顯示 method/path/HTTP 狀態色/耗時 + job 狀態徽章 + 座標明細 + `method`/`profile`/`provenance`（**shape 隨演算法而異**，cv+graph 給 `graph_status`/`cv_dedup`，CNN 給 `arch`/`weights`——勿寫死解析）；base URL 與 token 為可編輯欄位。⑤ **ImageLightbox**（新，共用）：兩個 modal 的疊圖/線稿都可放大（🔍 鈕或點縮圖）；**原始尺寸顯示不縮放**（縮圖已是 fit-to-width，再縮就失去意義），過大時**在框內捲動**（實測 900px 視窗下 overlay 1373px 寬：框內捲動、`document`/`body` 均無水平溢出）；Esc 用 **capture phase + stopPropagation** 只關檢視器不連帶關掉 host modal；點圖片本身不關（避免捲動誤觸）。**PNG 一律 fetch→blob→createObjectURL** 而非 `<img src>`（要帶 `Authorization` header），故不觸發下載；object URL 在重跑/關窗/unmount 三處 revoke，放大檢視在 revoke 前先關（否則抓著失效 blob 變破圖）。**已知遺留（非本次造成）**：`useAIPreviewStore` 在 `src/` **無畫面消費者**（`GeminiPreviewButton` 只存在 oldSrc、Phase 25 未 port），故 overlay 存進 store 目前只在 modal 開著時看得到。**實測發現的品質問題（未改，待決策）**：新 pipeline **門偵測率極低**（demo v1 僅 1 門、cnn 與 test-floorplan 皆 **0 門**），而自動比例尺靠門寬推算——1 個樣本時「取中間 50% 抗離群」防護完全失效（實測算出整層樓寬僅 17.6m）。建議補「門 <3~4 個就不自動套用比例尺」門檻。**另實測確認**：`output` 的 `full`/`algo` 差異**只有 overlay 那張圖**（`lines[]` 兩者完全相同、耗時也相同 1574ms），`algo` 模式 `coords_url` 仍有值但 `/overlay`、`/denoised` 皆 404；`floorplanFromLines` 的**合併幾乎不觸發**（`gapTolerance` 僅 1px，實測同軸線段縫隙 20~307px，22 條進 22 條出），真正在做事的是 4px 端點吸附 |

> **引擎架構決策（2026-06-02，不可違反）**：JS 傳播引擎（propagation.js）**不可移除**——Client View 後 JS 是「單點查詢主力」（probeAt/coverage/hover），shader 只負責 heatmap 整圖。基礎物理常數兩邊須一致。詳見 memory `project_clientview_js_engine_role`。
>
> **association/coverage 語意（2026-06-03 確立）**：藍色 = 「良好訊號涵蓋」（RSSI ≥ coverageThresholdDbm 預設 -67），不是「連不連得到」（實際可關聯到 -85）；藍色外仍可能連得到只是弱。多 AP 取聯集。

---

## 已撤回的決策（防重做，不要再提案）

| ID | 撤回理由 |
|----|----------|
| 12-4 Hybrid routing | 17-3 switch hub 落地後痛點消失，沒人抱怨 |
| 21-1 Vertical tray / conduit | Hamina 無此物件；Riser 已涵蓋跨樓層垂直走線；conduit 無實際 routing 價值 |
| 21-2 / 21-3 Zone box | TIA-568 consolidation point 用在有線工位 cabling；分散需求已由 IDF/MDF + uplinkTo 涵蓋 |
| 22-3b SVG export | Konva 無內建 SVG renderer（自製 ~10× 工程）；PNG + PDF 已覆蓋 95% 情境 |
| 22-4 DXF export | AutoCAD 交付在純 AP planner 工作流外；PDF + PNG 已足夠 |
| Phase 19 Auto IDF | IDF 真實選位是空間語意（弱電間/機房），非幾何最佳化；使用者再次確認不必要 |
| 26-2-P4 CableLayer imperative Konva | 視覺 ~1% pixel diff + 無效能改善 |
| 30-3 ~ 30-7 Konva 多層拆分 | react-konva 環境做會白工；融入 Phase 25 PixiJS Container 階層 |
| 31-4 Wall Mesh + line shader | 5000 wall 對 GPU trivial，Graphics + batching 撐得到；日後實測卡頓再重啟 |
| Verkada Tier 3（多站 Sites/Subsites 導覽、Google Maps 地理定位） | 2026-07-02 使用者確定不做——本專案維持單站閉環畫布，不做導覽 IA / 地圖底圖級改動 |

---

## Design Principles（後續所有 phase 都遵守）

| 主題 | 原則 |
|---|---|
| **3D = read-only** | Z 軸屬性一律在 **2D panel 編輯**；3D 只負責高度視覺化 |
| **Capacity rule** | tray fill 用 `capacityProfile`，**不**寫死「NEC 40%」 |
| **Color legend** | tray 顏色用 owner / company / discipline standard，不綁地區法規 |
| **垂直走線只用 Riser** | 不另做 vertical tray / conduit 物件 |
| **BOM = Planning BOM** | planning estimate，**不是**施工 final BOM |
| **Warning ≠ Code violation** | 寫「exceeds selected fill rule」，不寫「code violation」 |

---

## 嚴格重構規則（未刪 oldSrc 前一直適用）

**這是「重構」不是「改寫」不是「重設計」。**
- 一切 **顏色 / 大小 / 角度 / 寬度 / alpha / dash / hover 位置 / cursor / 文案 / spacing / radius / icon / 字級** 嚴格照 oldSrc
- 絕對不要自選、自編、自加、自優化
- 不確定就 **MCP 並排**（`pnpm dev:oldsrc` on 5180）對照 + grep `oldSrc/...` 抓常數
- commit message 標明每個數值的 oldSrc 出處
> 註：Phase 34 Camera 是**全新功能**（oldSrc 無對應物），不受此規則約束；視覺風格對齊現有新 src 慣例即可。
