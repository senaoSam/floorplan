# Verkada Camera — Floorplan / Map 功能筆記

> 來源：Verkada 官方 Blog、Command Help Center、Verkada Engineering (Medium)。
> 整理日期：2026-06-15。範圍**只聚焦平面圖 / 地圖 / 動態 / 熱力 / 覆蓋**相關功能（依使用者指定，非全產品線）。
> 目標：使用者希望「Verkada 平面圖相關有的功能，本專案最終都要有」。本檔 = 功能清單 + 對標現況差距表（roadmap 用）。

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

> 這是 Verkada 把「攝影機畫面 → 平面圖座標」做對的核心，**本專案因純 mock + 直接用畫布座標，這層全跳過（優勢）**。

| # | 機制 | 細節 | 本專案對應 |
|---|------|------|-----------|
| H1 | 點對點校準 | 攝影機畫面↔平面圖標 15 對點（測過 8~20，15 最佳）；用 pose extractor 抓人關節框、點人框註冊地面位置 | mock 不需要 |
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
> 圖示：✅ 已有且對等或更強 ・ 🟡 部分/語意不同（可 mock 補齊）・ 🆕 未做但純資料、可 mock

| 領域 | Verkada 功能 | 本專案現況 | 狀態 | 數據本質 / 做法 |
|------|-------------|-----------|------|------|
| **底圖** | SVG/PDF 上傳、Building→Floor | 有 floor / 底圖（floorStore） | 🟡 | 多樓層有；上傳格式/結構建立 UI 待補 |
| **多站** | Sites/Subsites + 星號收藏 | — | 🆕 | 純資料結構（site/subsite 樹 + starred flag），mock 一份站台清單即可 |
| **地圖定位** | Google Maps 疊圖 / GPS / Map↔Floor 切換 | — | 🆕 | 座標 + 經緯度 metadata；地圖瓦片可嵌公開服務；mock 每站經緯度 |
| **裝置型別** | 攝影機 + 門禁 + 環境感測器 | 純攝影機 | 🆕 | 純資料型別 + icon；mock 門禁/感測器裝置與讀數 |
| **裝置狀態** | 線上/離線/選取 顏色 | mock 無真實狀態 | 🆕 | 純 enum（online/offline）；mock 隨機/腳本化狀態即可呈現顏色 |
| **點看即時影像** | 點裝置看 live feed | — | 🟡 | **唯一需真實來源**；用 mock 佔位畫面（影格/靜態圖/循環影片）頂替 |
| **FOV 錐形** | 錐形 + 拖曳調向 | camera 放置/拖曳/旋轉 + FOV polygon | ✅ | 比 Verkada 強：含牆遮擋、玻璃穿透、門擋視線 |
| **FOV 物理** | master grid 透視校正 | 俯仰角覆蓋帶（near blind ring / far reach） | ✅ | 你做了 Verkada 沒在 UI 暴露的物理覆蓋建模 |
| **牆體遮擋** | ray-casting + 手動標牆 | ray-cast FOV visibility polygon | ✅ | 對等 |
| **即時動態 E1** | 偵測時 FOV 錐形脈動 | live detection icons（FOV 內實色/外灰 ghost） | 🟡 | 純數據（偵測 bool → 觸發 pulse 動畫）；加錐形 pulse 即對齊 |
| **即時動態 E2** | 多機 motion 即時繪到平面圖 | mock 一天軌跡 + 即時播放 | ✅ | mockTracks.js：seedable、避牆、雙峰、人/車 |
| **人流熱圖** | contour 色階 | 占用熱圖（人流量/停留/動線三檔 + 時段篩選） | ✅ | 三模式比 Verkada 單一 contour 更細 |
| **熱圖 timelapse** | 選日期區間 + 聚合間隔產生**動畫** | 時段篩選為**靜態**圖 | 🟡 | 純數據（時間×格子計數）；playback 已有 clock，把窗篩升級成沿軸自動播放 |
| **占用趨勢** | Occupancy Trends 報表 | 分析區逐時長條圖 | 🟡 | 純數據（逐時聚合）；補全樓層趨勢報表 |
| **計數線** | （Verkada 屬 analytics，非 floorplan 核心） | 計數線（分方向、端點可拖） | ✅ | 本專案額外有 |
| **盲區** | （Verkada 文件未明列） | 盲區圖 overlay | ✅ | 本專案額外有，符合「覆蓋缺口」訴求 |
| **回放** | （Verkada 看歷史走 heatmap timelapse） | 回放 timeline（scrubber/倍速/日循環） | ✅ | 本專案額外有 |

---

## Roadmap（依「除影像外全是數據」前提，按 CP 值排序）

> CP 值 = 對齊 Verkada 程度 ÷ 實作成本。所有項目皆可純 mock；估時為相對量級，非承諾。

### Tier 1 — 現有能力延伸，低風險高回報（建議先做）
| 序 | 項目 | 為何優先 | 接哪個現有基礎 |
|----|------|---------|---------------|
| 1 | **熱圖 timelapse 動畫** | Verkada 招牌賣點；純把「靜態窗篩」變「沿時間軸自動播放」 | useTrackingStore 已有 clock + occupancyFrom/ToSec；occupancyGrid 已可窗篩 |
| 2 | **FOV 錐形偵測脈動（E1）** | 視覺上最像 Verkada；小工 | tracksLayer 已有「點在 FOV polygon 內」判定；觸發 fovPolygon alpha pulse |
| 3 | **裝置線上狀態（顏色）** | 純 enum，立刻讓畫面「像營運系統」 | camerasLayer 已渲染 camera body，加 status 欄位 + 顏色 |

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
