# 自動規劃 AP 放置（Auto Place）— Spec

> Phase 49。2026-07-23 與使用者拍板五項決策後定稿。
> 對標：Hamina / Ekahau 的 auto-planning（自動擺位是它們的招牌；自動功率是我們獨有，
> 兩者串起來成「擺位 → 頻道 → 功率」一鍵管線，完整度超過對標）。

## 已拍板決策（2026-07-23）

| # | 決策 | 內容 |
|---|------|------|
| 1 | 模式 | **三種都做**：`fresh`（重新規劃：達標所需最少 AP 數）／`fixed`（固定 N 顆擺好擺滿）／`fill`（補洞：現有 AP 不動，只加新的補死角） |
| 2 | 頻段 | **使用者選**（2.4 / 5 / 6 GHz）；設計功率用 per-band 預設（`getDefaultTxPower`） |
| 3 | 放置約束 | v1 只限 in-scope。**可安裝區／離牆距離／最小間距先不做**，程式碼註解保留擴充點 |
| 3b | 室內限定（2026-07-27 追加） | in-scope **∩ 室內**。室內用 flood fill 自動辨識（`utils/indoorMask.js`），不要求使用者畫任何東西；同時套在候選點與評分格上 |
| 4 | 頻道 | **一起做完整**：重用 `greedyChannelAssign`（干擾感知 + 法規域）；`fill` 模式現有 AP 頻道固定不動（`fixedChannels` 參數） |
| 5 | 預覽 | **做 ghost 預覽層**：結果先以半透明 ghost AP 畫在畫布 + 熱圖顯示 what-if 場，確認才真正建立 |

## 室內偵測（`src/utils/indoorMask.js`，2026-07-27）

**問題**：原本唯一的放置約束是 in-scope，而 scope 不知道牆在哪。貪婪 set cover
會**主動偏好**牆外空地 —— 那裡沒有牆遮擋，一顆 AP 能無衰減灑滿一大片評分格，
「新覆蓋格數」分數最高。demo 圖上 10 顆有 6 顆落在建築外。

**解法**：flood fill，不做輪廓萃取（要處理分岔／T 字接頭／巢狀環，很難寫對）。

1. 鋪 0.5 m 布林格，牆線光柵化成 **1 格細線**
2. 端點補半徑 0.6 m 圓點封縫（使用者畫牆端點沒對齊的縫）
3. 從圖面四邊界 flood fill（4-連通）→ 流得到的是室外
4. 流不到 = 室內

遮罩同時套在**候選點**（AP 只能裝室內）與**評分格**（室外不算需求區，
否則 AP 被關在室內卻要為室外覆蓋率硬加顆數）。

### 三個踩過的坑（改動前先讀）

| 坑 | 症狀 | 正解 |
|---|---|---|
| 沿整條牆加粗來封縫 | 隔間密的圖上室內走廊被牆體塞滿，室內只剩 11% | 封縫**只在端點**補圓點；牆身恆為 1 格細線。縫必然發生在端點 |
| 健康判據用「室內佔整張圖面」 | demo 建築沒貼齊圖框（上方留白 6 m），完全正常的圖被判漏光退場 | 分母改用**牆 bbox** |
| 加「最大連通塊佔比」判據 | demo 32 個房間各自獨立（門是牆的分段、不是缺口，房間本來就不連通），被當成漏光 | **拿掉**。真正漏光的特徵是室內幾乎為零，ratio 就抓得到 |

**退場**：室內佔牆 bbox < 25% → `ok:false`，退回全範圍規劃 + UI 明示
（`stats.indoorFallback`），不靜默給空結果。實測沒有牆／牆破大洞都正確退場。

**UI**：「僅室內放置」勾選，預設開。開放式廠房可關掉。

**效果**（demo 圖，fresh / 5 GHz / -65 dBm / 95%）：

| | 修改前 | 修改後 |
|---|---|---|
| 建議 AP | 10 顆 | 8 顆 |
| 落在建築外 | **6 顆** | **0 顆** |
| 評分格 | 192（含室外） | 53（純室內） |
| 覆蓋率 | 96.9%（分母虛胖） | 90.6%（真實室內） |
| 耗時 | 15 ms | 1 ms |

## 格距校準（2026-07-27）

原本 `gridStepM` 2 m / `candStepM` 4 m 太疏，實測室內仍有大片死角
（-85.8 dBm，差目標 20 dB），但演算法回報 90.6% 覆蓋率並宣告完成。

**兩個瓶頸要分開看**，只修一個沒用：

| 瓶頸 | 症狀 | 修法 |
|---|---|---|
| 評分格太疏 | 演算法**看不見**死角 —— 小房間 / 走廊末端整個落在採樣線之間 | `gridStepM` 2 → **1 m** |
| 候選格太疏 | 演算法**搆不到**死角 —— 想補但附近網格沒有候選位置，`bestGain=0` → 提早 exhausted | `candStepM` 4 → **2 m** |

實測（demo，fresh / 5 GHz / -65 dBm / 95%，真實覆蓋率用 0.5 m 精細格獨立重算）：

| 評分 / 候選 | AP | 真實覆蓋 | 停止原因 | 耗時 |
|---|---|---|---|---|
| 2 m / 4 m（原） | 8 | 91.6% | exhausted ✗ | 5 ms |
| 1 m / 4 m | 10 | 93.3% | exhausted ✗ | 5 ms |
| **1 m / 2 m（現）** | **7** | **97.2%** | **target ✓** | 11 ms |
| 1 m / 1 m | 6 | 96.9% | target ✓ | 35 ms |

候選格 4→2 m 是關鍵：**AP 從 10 顆降到 7 顆，覆蓋率反而升到 97.2%** ——
少 3 顆卻更好，因為 AP 能放在對的位置而不是被網格逼到次佳點。
再密到 1 m 沒有更好但耗時 3 倍，2 m 是甜蜜點。

### 停止原因回報

「放不下去了」與「已達標」在畫面上長得一樣（都給出一組 AP），不分辨的話
使用者看到的是一個看起來成功、實則未達目標的結果。`stats.stopReason`：
`target`（達標）／ `count`（fixed 放滿 N）／ `exhausted`（無候選能改善）／
`max-aps`（撞上限）；`stats.targetMet` 為最終判定，UI 在 false 時明示原因。

### 效能（覆蓋矩陣 = 候選數 × 格子數，O(n²)）

| 樓層面積 | AP | 耗時 | 矩陣記憶體 |
|---|---|---|---|
| 671 m²（demo） | 7 | 22 ms | <0.1 MB |
| 2,686 m² | 23 | 0.39 s | 0.5 MB |
| 6,042 m² | 47 | 3.7 s | 2.8 MB |
| 10,742 m² | 60（撞上限） | 20 s | 9.3 MB |

跑在 worker + determinate 進度 + 可中止，量級與自動功率規劃（300 AP ≈ 50 s）一致。
1 萬 m² 會撞 `maxAPs: 60` 上限 → UI 如實顯示未達標。

## 演算法（`src/utils/autoPlacePlan.js`，跑在 worker）

1. **候選點**：in-scope ∩ 室內，鋪 `candStepM`（預設 2 m）格點。
2. **覆蓋矩陣**：每個候選點以設計功率算 RSSI 場（一階傳播、`gridStepM` 1 m 評分格、
   與 autoPowerPlan 同款 scope clip）。這是唯一的射線追蹤重活 → 進度條用它做分母（determinate）。
3. **貪婪 set cover**：反覆挑「新覆蓋格子最多」的候選（平手比未覆蓋區總 RSSI），
   直到：`fresh`/`fill` 覆蓋率 ≥ 目標、`fixed` 放滿 N 顆、或無候選能新增覆蓋、或撞 `maxAPs` 安全上限。
   `fill` 模式初始覆蓋 = 現有**同頻段** AP 的實際場（不同頻段不能服務該頻段客戶端，不計入）。
4. **Relocate 局部搜尋**：對每顆已放置 AP 試「拔掉重挑最佳候選」，最多 3 輪或無改善即止。
5. **頻道指派**：`greedyChannelAssign(現有同頻段 + 新增, domainId, 300, fixedChannels=現有)`。
6. 回傳 proposedAps（畫布 px 座標、完整 AP 物件欄位）+ 統計（放置數、前後覆蓋率）。

## 套用語意

- `fresh` / `fixed`：**移除現有同頻段 AP**（其他頻段不動）→ 逐顆 `addAP`（計數器連號命名）。UI 明示會移除幾顆。
- `fill`：全保留，只 `addAP` 新增。
- 皆可 Ctrl+Z（history store 自動快照）。

### 原地保留（2026-07-27）

演算法是確定性的 —— 同樣的牆／候選格／目標，重跑必然選到**完全相同**的候選點。
不處理的話 fresh 重跑會產出「移除 N 顆 + 在同一像素新增 N 顆」：

- 套用結果 = 什麼都沒變，但 AP 全部換了 id 與名字
- **會洗掉使用者手動調過的功率／頻道／型號**
- 預覽是一堆紅叉疊著藍圈（紅環 r13、藍環 r14 幾乎同心），看不出新的在哪

**對策**：組裝結果時把候選點與「將被移除的既有同頻段 AP」配對，距離 ≤
`candStepM/4` 視為原地保留 —— 該候選不產生新 AP，該既有 AP 也不列入移除，
其頻道進 `fixedChannels` 不重排。回傳 `keptApIds` + `stats.keptCount`。

實測（demo，第一次套用 7 顆後重跑）：

| 情境 | 新增 | 移除 | 保留 |
|---|---|---|---|
| 直接重跑 | **0** | **0** | 7 |
| 手動拖走一顆 5 m | 1 | 1 | 6 |
| 目標拉到 99% | 2 | 0 | 7 |
| 手動刪掉一顆 | 1 | 0 | 6 |

保留不等於「什麼都不做」—— 該動的仍會動。手動改過 txPower/channel 的 AP
被保留時設定不受影響（已驗證）。

「新增 0 + 移除 0」時小卡改顯示「現有配置已是本次規劃的最佳解」並停用套用鈕，
避免看起來像規劃失敗。

## 預覽架構

- `useAutoPlaceStore`：`{ floorId, previewAps[], removeApIds[] }`。
- `ghostAPsLayer`（`src/features/autoPlace/`）：掛 `scene.layers.overlays`，screen-constant
  大小（1/viewport.scale），照 statsOverlayLayer 模板。畫兩種標記：
  - **新增**：半透明頻段色圓 + 白色「+」 + 名稱
  - **移除**：紅環 + 紅「✕」疊在現有 AP 上（半徑 13 > apsLayer 的 `AP_RADIUS` 10）
- **熱圖 what-if**：heatmapAdapter 在 AP 來源 choke point 併入 preview **並排除
  removeApIds**（memoized merge，避免指紋每次失效）+ 訂閱 preview store。

### 移除必須同時反映在標記與熱圖（2026-07-27）

只在小卡寫「將移除 N 顆」看不出是誰 —— 且原本 heatmapAdapter **只加不減**，
what-if 熱圖是「新 AP + 舊 AP 全在」的疊加。實測 demo（fresh / 5 GHz，移除 2 顆）：

| 取樣點 | 修正前 | 修正後 | 差 |
|---|---|---|---|
| AP-03 位置 | -36 dBm | -41 dBm | 5 dB |
| AP-04 位置 | -36 dBm | -49 dBm | **13 dB** |

13 dB 足以讓看起來滿格的區域實際變成邊緣訊號 —— 使用者會照著一張不會發生的圖做決定。
- 預覽階段 modal 退成右下角 docked 小卡（背板透明、不擋畫布），可「套用 / 重新設定 / 取消」。

## v1 不做（保留擴充點，程式碼有註解）

- 可安裝區 polygon / 離牆距離 / 最小 AP 間距（`candidateOk` 擴充點）
  —— 手繪可安裝區評估過但不做：scope 已有 `in`/`out` 兩型，畫 out-scope
  就能手動排除區域，再開一個平行繪圖模式要碰 ~20 個檔案且語意重複
- 指向性天線候選（全 omni）
- 多頻段一次規劃（單頻段一次一跑；跑完可換頻段再跑 fill）
- 位置連續微調（候選格 relocate 已足；要更細再加 pattern search）

## 檔案清單

| 檔案 | 角色 |
|------|------|
| `src/utils/indoorMask.js` | 室內偵測（flood fill；純函式，無相依） |
| `src/utils/autoPlacePlan.js` | 演算法核心（純函式，worker 可跑） |
| `src/workers/autoPlacePlan.worker.js` | worker 包裝（同 autoPowerPlan 模式；取消 = 主線程 terminate） |
| `src/store/useAutoPlaceStore.js` | ghost 預覽 store |
| `src/features/autoPlace/ghostAPsLayer.js` | PIXI ghost 層 |
| `src/components/AutoPlaceModal/` | UI（設定 → 進度 → 預覽 docked 卡） |
| `src/utils/autoChannelPlan.js` | +`fixedChannels` 選用參數（向後相容） |
| `src/render/heatmapAdapter.js` | preview 併入 AP 來源 + 訂閱 + 指紋 |
| `SidebarLeft.jsx` / `FloorplanSystem.jsx` | 按鈕與層掛載 |
