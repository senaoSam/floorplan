# Verkada Camera — Floorplan / Map 功能筆記

> 來源：Verkada 官方 Blog、Command Help Center、Verkada Engineering (Medium)。
> 整理日期：2026-06-15。範圍**只聚焦平面圖 / 地圖 / 動態 / 熱力 / 覆蓋**相關功能（依使用者指定，非全產品線）。
> 目標：使用者希望「Verkada 平面圖相關有的功能，本專案最終都要有」。本檔 = 功能清單 + 對標現況差距表（roadmap 用）。
>
> **2026-06-24 補充**：另有一份**實機操作調研** [`verkada-floorplan-camera-features.md`](./verkada-floorplan-camera-features.md)，是用 MCP 實際登入 `eason.command.verkada.com`（Senao demo org，相機 CD63 Indoor Dome / floorplan gongon-9f）逐一跑過所有 camera 相關功能的第一手紀錄。本檔（文件研究）與該檔（實機實證）互補；下方 §J 為實機調研對既有差距表的校正補充。

---

## 參考來源

| 來源 | 內容 |
|------|------|
| YouTube `N4dQY8WfMXE` | Setting Up Floor Plans and Map View (**Command Admin**) — 設定者視角：上傳底圖、疊地圖、放裝置、拉 FOV、校準 |
| YouTube `wtpgjmmTnXc` | Using Maps and Floor Plans for Contextual Overviews (**Command User**) — 使用者視角：看即時動態、人流熱圖、點裝置看即時影像 |
| Blog: Announcing Floor Plans | 初版功能發表 |
| Blog: New and Improved Floorplans Experience | 改版：單擊導覽、裝置運作狀態、環境感測器、PDF 上傳、「成為所有 Verkada 產品的中央樞紐」願景 |
| Blog: People Heatmaps | 人流熱圖設計與用途（含 timelapse 動畫） |
| Help: Create a Floorplan / Buildings and Floors / View Live Motion / People Heat Maps | 操作細節 |
| Medium: Real-Time Motion Plotting（"Marauder's Map"） | 即時動態的工程實作（校準、master grid、ray-casting 遮擋、4Hz） |

> 註：兩支 YouTube 影片是上述官方文件功能的「操作示範」。文件文字資訊比影片完整，本檔以文件為準。

---

## A. 底圖與結構

| # | 功能 | 細節 |
|---|------|------|
| A1 | 上傳底圖 | 格式 `.svg` / `.pdf`；< 5 MB；< 512 megapixels。僅 Org Admin 可建立 |
| A2 | Building → Floor 階層 | 建築含名稱/地址/樓層；多樓層逗號一次建立（`1, 2, 3`） |
| A3 | 多站台 Sites 導覽 | 左側列出所有 sites，subsite 巢狀於 parent site 下；可建「星號收藏」過濾常看的站 |
| A4 | 單擊導覽 | 改版後首頁加 Floorplans 按鈕，一鍵進入 |
| A5 | 文字標註 | 平面圖上加文字（粗體 / 一般） |

## B. Google Maps 地理定位（本專案目前無）

| # | 功能 | 細節 |
|---|------|------|
| B1 | 底圖疊在 Google Map 上 | 建立真實地理座標 |
| B2 | Map ↔ Floor Plan 視圖切換 | 整個組織層級可切換兩種視圖 |
| B3 | 裝置繼承 GPS 座標 | 放上平面圖的裝置自動帶 Google Maps GPS |
| B4 | 重定位連動 | 移動整張平面圖會提示一併搬移所有裝置 |

## C. 裝置放置（多型別）

| # | 功能 | 細節 |
|---|------|------|
| C1 | 多型別裝置 | 攝影機 + 門禁門 + 環境感測器（溫濕度/噪音/PM/竄改/VOC/空品/電子菸偵測） |
| C2 | 拖放放置 | 從裝置清單拖到圖上 |
| C3 | 裝置運作狀態 | 🟢 在線錄影 / 🟠 離線異常 / 🔵 選取中 |
| C4 | 點裝置看即時影像 | 從平面圖直接看 live feed，帶空間定位脈絡 |
| C5 | location 連動陷阱 | 從攝影機設定頁改 location 會把它從平面圖移除 |

## D. FOV 視野

| # | 功能 | 細節 |
|---|------|------|
| D1 | FOV 錐形 | 每台攝影機顯示代表視野的錐形 |
| D2 | 拖曳調向 | 拖錐形調整朝向（orientation / direction） |

## E. 即時動態（Live Motion）— 兩種方式

| # | 功能 | 細節 |
|---|------|------|
| E1 | FOV 脈動 | 偵測到動態時，該攝影機 FOV 錐形即時「脈動（pulse）」。入口：樓層右下 Motion Detection 按鈕 |
| E2 | 即時動態繪製（Marauder's Map） | 多攝影機 motion 即時繪到平面圖成 live heatmap（見 H 區工程細節） |

## F. 人流熱圖（People Heat Maps）— 歷史

| # | 功能 | 細節 |
|---|------|------|
| F1 | 色階等高線 | contour 呈現人員移動歷史 |
| F2 | 用途 | 空間使用率、高人流區、動線模式分析 |
| F3 | timelapse 動畫 | **選起訖日期 + 聚合間隔（1/4/8/12/24h）→ 產生活動演變動畫**（不只靜態圖） |
| F4 | 前置：校準 + analytics | 攝影機需啟用 People Analytics + 校準（四點對齊） |
| F5 | 時間區間 | 動態檢視預設 1h，最長到 1 day |

## G. 占用 / 趨勢

| # | 功能 | 細節 |
|---|------|------|
| G1 | Occupancy Trends | 占用趨勢分析（bullet 機需關閉 LPR 模式才能啟用 occupancy trends） |

## H. 即時動態繪製的工程實作（Medium "Marauder's Map"）

> 這是 Verkada 把「攝影機畫面 → 平面圖座標」做對的核心。
> **⚠️ 校正：原記載「本專案 mock 直接用畫布座標、這層全跳過（優勢）」是理想化判斷——見 §J2/§K。本專案已決策要做 4 點校正「真功能」（前端真算 homography），不再跳過。**

| # | 機制 | 細節 | 本專案對應 |
|---|------|------|-----------|
| H1 | 點對點校準 | **Medium 工程文（研發階段）**：攝影機畫面↔平面圖 15 對點（測 8~20，15 最佳）+ pose extractor 抓人腳框註冊地面位置。**⚠️ 實際產品 UI 已簡化為 4 對點**（見 §L 官方文件）——15 點是研發數字、非上線需求 | 本專案採 **4 對點/台真功能**（見 §L 決策） |
| H2 | master grid 透視校正 | 把梯形 FOV → 平面圖矩形座標，解決「近格小、遠格大」畸變，遠處也有細粒度 | ≈ 你的俯仰角覆蓋帶（near blind / far reach）|
| H3 | ray-casting 牆體遮擋 | 一開始「會穿牆看」；改為手動標牆 + ray-cast 算實際可見區 | ✅ 你已用 wall 做 FOV visibility polygon + ray-cast |
| H4 | 4Hz 更新 | 每攝影機每秒回報 motion 約 4 次；針對單圖 20+ 機最佳化頻率 | mock 自由設計 |

---

## 前提（2026-06-15 使用者確立）

> **「Verkada 平面圖功能，除了『點進去播放的那段即時/錄影畫面』本身需要真實來源外，其餘全部都是數據。」**
> 連真實影片最終也是被 AI 轉成數據（偵測框、軌跡座標、計數、移動向量）。所以：
> - 線上狀態、地圖定位、多站結構、占用趨勢…拆穿都只是**資料欄位 / 資料結構**，mock 一份假數據即可完整呈現 UI 與互動。
> - 唯一「不可純 mock」的是**點裝置播放的那段畫面** → 用 **mock 佔位畫面（影格/靜態圖/循環影片）頂替**，UI 走得通。
> - **結論：Verkada 平面圖功能可 100% 達成，不存在「定位張力」。** 下表所有舊 ❌ 一律重歸類為「可 mock」。

## 對標差距表（Verkada 有 / 本專案有 / 缺口）

> 本專案現況以 Phase 34（已驗收）程式碼為準，掃描 `src/features/cameras/`。
> 圖示：✅真 對等或真強化（不靠 mock 紅利、真實場景＆使用者＆可運維皆站得住）・ 🔶理想 demo 強但靠 mock 紅利/跳過真實難題/更細未證明更實用 ・ 🟡 部分/語意不同（可 mock 補齊）・ 🆕 未做但純資料、可 mock
>
> **⚠️ 2026-06-24 重要校正**：原本多項標 ✅「比 Verkada 強」，經「真實使用場景」檢驗後改判。判準三關：(1) 真實雜訊資料下成立 (2) 真實使用者看得懂會用 (3) 部署後可運維免持續校準。任一關靠「因為我們 mock 所以沒成本」＝**🔶理想化超越**（demo 漂亮、接真實場景會塌），與 ✅真強化本質不同。詳見 §K。

| 領域 | Verkada 功能 | 本專案現況 | 狀態 | 數據本質 / 做法 |
|------|-------------|-----------|------|------|
| **底圖** | SVG/PDF 上傳、Building→Floor | 有 floor / 底圖（floorStore） | 🟡 | 多樓層有；上傳格式/結構建立 UI 待補 |
| **多站** | Sites/Subsites + 星號收藏 | — | 🆕 | 純資料結構（site/subsite 樹 + starred flag），mock 一份站台清單即可 |
| **地圖定位** | Google Maps 疊圖 / GPS / Map↔Floor 切換 | — | 🆕 | 座標 + 經緯度 metadata；地圖瓦片可嵌公開服務；mock 每站經緯度 |
| **裝置型別** | 攝影機 + 門禁 + 環境感測器 | 純攝影機 | 🆕 | 純資料型別 + icon；mock 門禁/感測器裝置與讀數 |
| **裝置狀態** | 線上/離線/選取 顏色 | mock 無真實狀態 | 🆕 | 純 enum（online/offline）；mock 隨機/腳本化狀態即可呈現顏色 |
| **點看即時影像** | 點裝置看 live feed | — | 🟡 | **唯一需真實來源**；用 mock 佔位畫面（影格/靜態圖/循環影片）頂替 |
| **FOV 錐形** | 錐形 + 拖曳調向 | camera 放置/拖曳/旋轉 + FOV polygon | 🔶理想 | 拖曳調向本身真強（見 §J2 D2）；但「牆遮擋/玻璃/門擋」的**準確性靠真實場景手動標牆**，mock 牆現成才不痛，成本未省 |
| **FOV 物理** | master grid 透視校正 | 俯仰角覆蓋帶（near blind ring / far reach） | 🔶理想 | 有物理意義，但 Verkada 刻意不在 UI 暴露 → 更細 ≠ 使用者更會用，可能過度工程；待真實使用者驗證 |
| **牆體遮擋** | ray-casting + 手動標牆 | ray-cast FOV visibility polygon | ✅真 | 機制與 Verkada 對等、幾何運算真實成立（標牆成本歸 FOV 那條不重複扣） |
| **即時動態 E1** | 偵測時 FOV 錐形脈動 | live detection icons（FOV 內實色/外灰 ghost） | 🟡 | 純數據（偵測 bool → 觸發 pulse 動畫）；加錐形 pulse 即對齊 |
| **即時動態 E2** | 多機 motion 即時繪到平面圖 | mock 一天軌跡 + 即時播放 | 🔶理想 | **最典型**：Verkada 難點全在「真實影像→平面座標」(15點校準/透視/4Hz)，我們 mock 直接給座標＝跳過整個難題，非做得更好 |
| **人流熱圖** | contour 色階 | 占用熱圖（人流量/停留/動線三檔 + 時段篩選） | 🔶理想 | 多 ≠ 強；真實雜訊資料下三模式是否各自清晰可用、使用者分得出差異，未驗證 |
| **熱圖 timelapse** | 選日期區間 + 聚合間隔產生**動畫** | 占用熱圖已沿時間軸自動播放（Phase 34-V ①） | ✅真 | 占用窗沿日滑動（`advanceOccupancyLapse` + trackingBinder lapse rAF + CameraTimelineBar「⏱ 推移」按鈕含自動縮窗）。**對標的是人流/占用熱圖**，已落地；WiFi 訊號熱圖無時間維度，timelapse 不適用 |
| **占用趨勢** | Occupancy Trends 報表 | 分析區逐時長條圖 | 🟡 | 純數據（逐時聚合）；補全樓層趨勢報表 |
| **計數線** | （Verkada 屬 analytics，非 floorplan 核心） | 計數線（分方向、端點可拖） | ✅真 | 獨立 UI 功能（畫線數穿越），不靠 mock 完美資料（前提：計數來源真實） |
| **盲區** | （Verkada 文件未明列） | 盲區圖 overlay | ✅真 | FOV 補集的幾何運算，真實成立，符合「覆蓋缺口」訴求 |
| **回放** | （Verkada 看歷史走 heatmap timelapse） | 回放 timeline（scrubber/倍速/日循環） | ✅真 | 時間 scrubber 純 UI，真實成立 |

---

## J. 實機調研校正補充（2026-06-24，來自 `verkada-floorplan-camera-features.md`）

> 以下為「親手在 Verkada Command 跑過」對前述（文件研究）差距表的**校正與細節補強**。能落實的 UX 細節都在這裡。

### J1. 實機確認與文件一致的點
- **底圖**：實機底圖為 **PDF 多頁封面**（A1 的 `.pdf` 屬實）；Building→Floor 階層為 `gongon → 9f`（A2 屬實）。
- **裝置型別**：`+ Add` 選單實機只有 **Camera / Sensor** 兩項（C1「攝影機 + 感測器」屬實；門禁是另經 Door Events 疊圖，不在 Add 選單）。
- **點裝置看即時影像（C4）**：實機**完全成立**——hover marker 即浮出 live 縮圖氣泡；單擊 marker 直接導向 `/cameras/{id}` 監看頁（Motion/History/People/Vehicles/Archive/Analytics/Settings + Show Paths）。
- **FOV 錐形（D1）**：實機相機就是「綠 marker + 半透明扇形 FOV」，online 為綠色。
- **熱圖 timelapse（F3/F5）**：實機確認 interval `1h/4h/8h/12h/1day`、最長 1 day、Timelapse 切單日逐時動畫，控制列 `✕/▶/⏮`，與文件完全吻合。

### J2. 實機**校正**前述差距表的項目
| 差距表項目 | 原記載 | 實機校正 |
|---|---|---|
| **FOV 拖曳調向（D2）** | 「拖錐形調整朝向」 | **校正**：在 `/maps/{id}` 檢視頁**無法**拖曳移動相機或調 FOV（拖曳 = 平移畫布，重整後相機回原位）。相機位置/朝向是在 **`Add → Camera` 拖放放置**當下設定；之後檢視頁只能：檢視、改樓層歸屬、Remove。重擺底圖走 `Floor Settings → Edit` 4 步精靈（Upload→Address→Set Location）。→ **D2「隨時可在主視圖拖曳調向」對本專案反而是比 Verkada 更強的能力，不是缺口。** |
| **location 連動陷阱（C5）** | 「改 location 會從平面圖移除」 | 實機對應：相機編輯面板（Device List→鉛筆）有 **Floor 下拉**可改歸屬樓層、**Remove Camera** 紅鈕；改樓層即等同搬離本層 floorplan。 |
| **裝置狀態（C3）** | 線上/離線/選取 顏色 | 實機確認：online=綠 marker、選取=藍 marker、Add 模式下其他相機淡化為灰。 |

### J3. 文件沒提、實機才看到的 UX 細節（值得對標）
- **Device List 側欄（Floorplan Items）**：分類列裝置（`Cameras 1`）、搜尋框、清單↔圖上 marker **雙向 hover 高亮**、項目浮出「鉛筆(編輯) + 定位」兩 icon。→ 本專案目前無此側欄，是值得補的導覽件。
- **Add Cameras 面板**：列「**尚未放置**的相機」供拖放、可 `Filter by site or device name`；已全部放置時顯示 `No cameras found`。→ 對標「未放置裝置清單」這個過濾語意。
- **Hover live 縮圖氣泡**：marker hover 即出即時畫面縮圖 + 名稱 + online 點 + ⋯ 選單。→ 比單純 tooltip 更進一步。
- **熱圖只渲染在 FOV 覆蓋區**：人流熱圖嚴格落在相機 FOV 扇形內，FOV 外不上色（本專案占用熱圖可參考此「綁定覆蓋區」呈現）。
- **⋯ 選單**：Create Floorplan / Floor Settings(含 Edit 精靈、Delete、Add Label) / Share Floorplan（產生對外分享連結）。→ Share 為對外分享，本專案閉環暫不需要。

---

## Roadmap（依「除影像外全是數據」前提，按 CP 值排序）

> CP 值 = 對齊 Verkada 程度 ÷ 實作成本。所有項目皆可純 mock；估時為相對量級，非承諾。

### Tier 1 — 現有能力延伸，低風險高回報（建議先做）
| 序 | 項目 | 為何優先 | 接哪個現有基礎 |
|----|------|---------|---------------|
| 1 | ~~**熱圖 timelapse 動畫**~~ ✅已做（Phase 34-V ①） | Verkada 招牌賣點；占用窗已沿時間軸自動播放 | useTrackingStore.advanceOccupancyLapse + trackingBinder lapse rAF + CameraTimelineBar「⏱ 推移」 |
| 2 | ~~**FOV 錐形偵測脈動（E1）**~~ ✅已做（Phase 34-V ②，含由內而外水波擴散環） | 視覺上最像 Verkada；小工 | tracksLayer 已有「點在 FOV polygon 內」判定；觸發 fovPolygon alpha pulse |
| 3 | ~~**裝置線上狀態（顏色）**~~ ✅已做（Phase 34-V ③，綠/橘點 + 離線錐暗） | 純 enum，立刻讓畫面「像營運系統」 | camerasLayer 已渲染 camera body，加 status 欄位 + 顏色 |
| 3b | **Device List 側欄 + 清單↔marker 雙向高亮 + hover live 縮圖**（實機新發現，§J3） | Verkada 核心導覽件、純前端互動、無新資料 | apsByFloor/camerasByFloor 已有清單資料；加側欄元件 + hover 連動 selectedId。**註**：34-V ⑨ 已有相機清單面板（多選/批次/區域分組/點列定位），但 hover live 縮圖與 AP↔camera 統一導覽尚缺 |

### Tier 2 — 純資料結構，中等工程
| 序 | 項目 | 數據本質 | 備註 |
|----|------|---------|------|
| 4 | **占用趨勢報表** | 逐時/逐日聚合 | 在分析區 histogram 之上做全樓層趨勢面板 |
| 5 | **多裝置型別（門禁/環境感測器）** | 型別 + icon + mock 讀數 | 需新 store 或擴 cameraStore；非 camera 範圍，視產品決定 |
| 6 | **點裝置看「即時影像」(mock 佔位)** | 佔位影格/循環影片 | UI 走通即可；真實串流留給主產品整合點 |

### Tier 3 — 大結構改動（視產品定位再決定）
| 序 | 項目 | 數據本質 | 備註 |
|----|------|---------|------|
| 7 | **多站 Sites/Subsites 導覽** | site 樹 + starred | 影響整體導覽 IA；單站→多站是架構級改動 |
| 8 | **Google Maps 地理定位** | 經緯度 metadata + 地圖瓦片 | 嵌地圖底圖 + Map↔Floor 切換；與純畫布並存需設計 |

> 建議節奏：**先 Tier 1（1→2→3）**，每項都是現有 store/layer 的小延伸、能立刻 MCP 驗證、最像 Verkada。Tier 2/3 待 Tier 1 落地後再依產品方向逐項開 phase。

---

## K. 「理想化超越」 vs 「真實場景強化」判準（2026-06-24 討論結論）

> 使用者提醒：**「超越很好，但要分清楚是『理想化超越』還是『真的在該功能之上全面強化』，這完全不一樣。」** 本節定下判準，避免 roadmap 建立在「我們已經贏了」的錯覺上。

### 三關判準（要算 ✅真，三關全過）
1. **真實雜訊資料下成立** — 不是因為我們 mock 完美、Verkada 吃真實雜訊。
2. **真實使用者看得懂、會用** — 保全/營運日常會依賴它做決策，不是工程上做得出來就算。
3. **可運維** — 部署後不需人工持續校準/調參維持正確。

> 任一關靠「因為我們是 mock 所以沒那個成本」→ **🔶理想化超越**（demo 漂亮、一接真實場景就塌）。

### 被改判的項目與「接真實場景要補的成本」
| 項目 | 為何 🔶 | 接真實場景的隱藏成本 / 待驗證 |
|---|---|---|
| FOV 牆遮擋準確性 | mock 牆現成 | 真實場景須**人工標牆/隔間/玻璃**，標註負擔與 Verkada 同等，未省 |
| FOV 俯仰覆蓋帶 | 更細未證明更實用 | Verkada 刻意不暴露；須驗證真實使用者「看得懂環狀覆蓋」否則是雜訊 |
| 即時動態繪製 E2 | 跳過真實難題 | 真實要做「影像→平面座標」(**4 點校準**/透視校正/牆遮擋/4Hz)，我們 mock 直接給座標＝沒做這件事。**→ 已決策補上 4 點校正真功能，見 §L** |
| 人流熱圖三模式 | 多 ≠ 強 | 真實雜訊下三模式是否各自清晰、使用者分得出差異，待驗證 |

### 確實是 ✅真強化的（不靠 mock 紅利）
- **牆體遮擋 ray-cast**（幾何運算）、**計數線**（畫線數穿越）、**盲區圖**（FOV 補集）、**回放 timeline**（時間 scrubber）。
- 共通點：都是**獨立的幾何/UI 功能**，正確性不依賴「資料剛好很乾淨」。

### 對 roadmap 的意涵
- 🔶 項目不代表要砍，而是：**做的時候要設計「真實場景退路」**（標牆 UI、覆蓋帶可關、熱圖在雜訊下的呈現），否則只是 demo 件。
- 真正該擴的護城河，優先放在 **✅真** 那類（幾何/覆蓋/缺口分析），那是不靠資料紅利、主產品接真實資料後仍成立的能力。

---

## L. 相機校正（People Heat Maps Calibration）— 官方事實 + 本專案決策

> 來源：**Verkada Help Center 官方文件**「Calibrate Cameras for Heat Maps」（Organization Settings → Buildings and Floors），2026-06-24 用已登入瀏覽器實查。比 §H 的 Medium 工程文更新、更權威。

### L1. Verkada 現行產品的校正流程（官方原文）
- **前提**：Org Admin 才能校正；熱圖**只顯示在「已校正」相機**偵測到的動態。
- **不相容機型/設定**：D30/D50/D80/CF81/CF83、停用 analytics 的相機、LPR(車牌)模式的相機。
- **安裝建議**：相機 FOV 盡量朝正下方對地面，與水平面**夾角 ≥ 70°**。
- **步驟（6 步，使用者手動）**：
  1. Command → All Products → Floorplans
  2. 選一個 floorplan
  3. 右下角點 **People Heatmap**
  4. 選相機 → 點 **Calibrate for heatmap**
  5. 在 **floorplan** 上 click-drop **4 個點**，框出要追蹤人流的區域
  6. 在 **相機畫面** 上，依**相同順序、相同區域** click-drop **4 個點**，完成校正
- **關鍵**：兩邊 4 點的**順序必須一致**（floorplan 4 點 ↔ 相機畫面 4 點一一對應）→ 數學上即解一個 homography（單應性矩陣）。

### L2. 對先前「15 點」說法的校正
- §H1 的「15 對點」出自 Medium 工程 blog（研發階段測 8~20 的結論），**非上線產品需求**。
- 實際產品 UI = **使用者點 4 對點/台**，輕量、一次性、無持續維護成本。
- 也解釋了：相機 Settings 頁**沒有** calibration 選項（已實查確認）——校正入口在 **floorplan 的 People Heatmap 模式**裡。

### L3. 本專案決策（使用者確立 2026-06-24）
- **採「4 對點/台」校正**，對齊 Verkada 現行做法（非 15 點研發數字）。
- **做「真功能」**：使用者在 floorplan 點 4 點 + 在 mock 相機畫面點 4 點 → **前端真的求解 homography** → 偵測座標經此矩陣投影上圖。**接真實資料即可用**，屬 §K 的 ✅真，不是 demo 殼。
- **分階段落地**：
  - **階段 1（先做）**：4+4 點校正 UI + homography 求解（4 對點解 3×3 矩陣，純前端可實作）。可先用現有資料驗證數學正確性。
  - **階段 2（後接）**：把 mock 偵測資料從「直接生平面座標軌跡」改為「**生在相機畫面座標系 → 經校正矩陣投影到平面圖**」。這是讓校正「有意義」的關鍵，屬架構級改動，排程後再開。
- **真功能 vs 殼的分水嶺**：階段 2 的 mock 資料重構若不做，homography 算了也是恆等對應＝退回成殼。故階段 2 是這條能真正脫離 🔶 的必要條件。

### L4. 用詞對齊（2026-06-29）
- Verkada 官方：功能標題 `Calibrate Cameras for Heat Maps`、按鈕 `Calibrate for heatmap`。
- 本專案落地用詞：modal 標題「**相機校正 · 用於人流熱圖**」（對齊官方標題語意——校正的主體是相機，非熱圖）；CameraPanel 按鈕「**校正熱圖 / 已校正**」（對齊官方按鈕）。
- 點法提示：modal 提示「點地面構成四邊形的 4 角、兩邊**相同順序**對應、四角攤越開越準、避免共線」+ 四邊形面積過小（共線/擠在一起）時即時橘色警告。
  - ⚠ **來源辨明**：Verkada 官方文件（§L1）僅說「**框出要追蹤人流的區域**（4 點）」+「相同順序」，**未**提「點牆角/四角攤開/避免共線」。後者是依 homography 數學推得的工程最佳實務（使用者 2026-06-29 確認保留）。不是官方 UI 原文。
- **不顯示重投影誤差/展開度數字**：4 對點恰定 → 重投影誤差恆為 0（假精度），故不顯示任何 px/% 數字；品質只用「面積過小→橘色警告」表達。完成只寫「校正完成」、按鈕只寫「已校正」。
