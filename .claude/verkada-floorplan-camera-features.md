# Verkada Command — Floorplan 中與 Camera 相關功能調研

> 調研日期：2026-06-24
> 環境：`https://eason.command.verkada.com/`（無痕、使用者代登入）
> Org/Site：`linko` site，唯一一台相機 **CD63 Indoor Dome**（online）
> Floorplan：`gongon` / 樓層 `9f`（底圖為 Senao/EnGenius ISC East 2025 展場封面圖，Unit: cm）
> Floorplan 檢視頁 URL：`/maps/{floorplanId}`；編輯精靈 URL：`/floor_plan/edit/{floorplanId}`

本文件只記錄「但凡沾到 camera」的功能。其餘（純門禁、Sensor、純地圖底圖管理）僅在邊界處標註。

---

## 0. 進入 Floorplan 的兩條路徑

1. **Cameras 首頁 → Map 視圖**
   - `Cameras Home`（`/cameras`）左側 site 清單下方有 **Map** 按鈕。
   - 點 Map → 切換成地理地圖（Google Map，帶 lat/lng/zoom），相機與已定位的 floorplan 會疊在真實世界座標上。
   - 地圖上的 floorplan 會以一個標籤連結呈現（本例為 `gongon`，連到 `/maps/{id}`）。同時相機以「綠色眼睛 icon + 指向線」疊在地圖上。

2. **直接進 Floorplans 模組**
   - 左側產品切換 → Floorplans，或直接開 `/maps/{floorplanId}`。
   - 頂部有樓層選擇器 `gongon: 9f`、`+ Add`、`Device List`、`⋯`(open menu)。

> 注意：每次進入常會跳出「Enable local access for faster video」對話框（要求允許瀏覽器存取區域網路以降低影像延遲），可直接 Close 略過，不影響功能。

---

## 1. Camera 在 Floorplan 上的視覺呈現

底圖之上以 SVG 圖層（DOM class：`CameraLayer` → `CameraRepresentation` → `DefaultFOVComponent`）渲染每台相機：

- **相機點位 marker**：圓形 icon，內含相機輪廓。
  - **綠色** = 相機 online（class `colorGreen`）。
- **FOV 視野扇形**：自 marker 延伸出的半透明扇形，表示相機朝向與視野涵蓋範圍（本例朝右下、涵蓋約 60–90°）。
- **Hover marker** → 浮出**即時影像縮圖氣泡**（live thumbnail popup）：
  - 上方：該相機目前畫面縮圖
  - 標籤：相機名稱 + 綠點(online)，例：`● CD63 Indoor Dome`
  - 右上：`⋯` 選單
  - 氣泡下方有小三角錐指回 marker
  - hover 時 FOV 扇形會收起、改顯示縮圖與名稱

**目的用途**：在平面圖上一眼看出每台相機的安裝位置、朝向、視野涵蓋、上下線狀態，並可即時預覽畫面。

---

## 2. 點擊 Camera → 進入相機詳情頁

**操作**：在 floorplan 上單擊相機 marker。
**結果**：導向該相機頁 `/cameras/{cameraId}/search`（標題 Motion），即完整的單機監看介面。

該頁面（相機本體功能，非 floorplan 內，但由 floorplan 點擊進入）包含：

- 上方：**即時影像**（含 GMT+8 時間戳、HQ 畫質切換）
- 功能 tabs：**Motion / History / People / Vehicles / Archive / Analytics / Settings**
- 事件搜尋列：**People / Vehicles / Animals / Motion** 篩選 + `Number of people`、`Time in view`、**Show Paths（顯示移動路徑）**
- 右側工具：全螢幕、PTZ/數位變焦、放大縮小、截圖(snapshot)、分享、speaker、walk 等

**目的用途**：從平面圖的空間視角，一鍵跳轉到該相機的即時/歷史影像與 AI 事件分析。

---

## 3. Floorplan 右側疊圖工具列（核心 camera 衍生分析）

右側懸浮工具列由上到下三顆資料疊圖開關 + 三顆視圖控制：

### 3-1. Door Events（門禁事件）
- 圖示：門 + 齒輪。
- 將門禁事件疊到 floorplan 上。本 site 無門禁裝置，故無疊圖。
- **與 camera 關聯**：低（屬 Access Control），僅在同一平面圖上與相機並列呈現。

### 3-2. Motion Detection（動態偵測疊圖）
- 圖示：跑步小人。
- 開啟後在 floorplan 上呈現相機偵測到的動態/移動分布。
- **目的用途**：在平面圖上看哪些區域被相機偵測到有移動，用於佈點檢討與事件回溯。

### 3-3. People Heatmap（人流熱圖）★最完整的 camera 衍生功能
- 圖示：雙人。
- 開啟後，相機偵測到的人流以**密度熱圖**疊在 floorplan 上：
  - **左側色標圖例**：藍（少）→ 紅（多）的人流密度漸層。
  - **底部時間控制列**：
    - 顯示目前時段（例：`Jun 24, 02:05 PM - Jun 24, 03:05 PM`）+ 可點開的時間範圍選擇器
    - 可拖曳的時間範圍滑桿（時間軸）
    - **Time Interval 切換**：`1 hour / 4 hours / 8 hours / 12 hours / 1 day`
    - **Timelapse（縮時播放）按鈕**
- **Timelapse 模式**：
  - 底部時間軸變成**整日刻度**（00:00 → 次日 00:00）
  - 播放控制：`✕ 關閉`、`▶ 播放`、`⏮ 回到起點`，中間顯示當前播放日（例：`June 24 - June 24`）
  - 可看一整天的人流熱圖隨時間動態變化。
- **目的用途**：分析空間中人流聚集熱點與隨時間的變化趨勢（零售動線、展場熱區、辦公室使用率等），資料來源為相機的人物偵測。

#### 3-3-1. 深入實測（2026-06-24 補充）
- **熱圖呈現機制**：熱圖只渲染在相機 **FOV 扇形覆蓋的區域**（本例 "niu" 一帶），FOV 外不上色。色彩依該區人流密度，從淡綠（低）往黃→紅（高）漸變，對應左側色標。
- **Interval 與時間軸連動**：
  - 切 `1 hour` → 時間軸為當日逐小時刻度（約 10:30AM–06:30PM 視窗），選取窗 1 小時。
  - 切 `1 day` → 時間軸變跨日刻度（本例 06/21–06/28，每日標 12AM/8AM/4PM），選取窗 1 整天（例 `Jun 23 03:23 PM – Jun 24 03:23 PM`），左下 `1h` 標記也跟著變 `1d`。
  - 中間有「起訖時間範圍按鈕」顯示目前查詢區間。
- **拖曳行為釐清**：在熱圖檢視下於圖面按住拖曳 = **平移畫布(pan)**，不會改時間窗；改時間窗需操作底部時間軸滑桿/interval 按鈕。
- **Timelapse 實測**：點 Timelapse → 進播放模式，時間軸切成**單日 12AM→次日 12AM** 的逐時(1 hour 幀)刻度、左下變 `1d`、標題顯示當前播放日（例 `June 24 - June 24`），左下控制列 `✕ / ▶ / ⏮`。
- **本 demo 相機無濃烈熱點**：不論 1h 或 1day，CD63 這台相機 FOV 內都只有淡綠、無黃/紅熱點。原因是該機監看辦公室走道、demo 環境人流稀疏、資料量少 —— 屬**資料面**而非功能限制；色標/時段/interval/Timelapse 等 UI 機制皆正常運作。要看到紅色熱點需相機底下有實際密集人流。

### 3-4. 視圖控制
- **Zoom In / Zoom Out / Fit Screen**（縮放與一鍵還原全圖）。
- 在圖上滾輪可縮放、按住拖曳可平移畫布（pan）。

---

## 4. Device List（Floorplan Items，平面圖裝置清單）

**操作**：頂部 `Device List` 按鈕 → 右側滑出「Floorplan Items」面板。
**內容**：
- 搜尋框（Search…）
- 分類清單，例：**Cameras 1** → `CD63 Indoor Dome`（dome 圖示）
- **Hover 清單項目**：
  - floorplan 上對應相機同步高亮、顯示名稱標籤。
  - 項目右側浮出兩個 icon：**鉛筆（編輯/開啟詳情）** 與 **相機定位 icon**。
- **點清單項目 / hover floorplan 相機**：彈出即時影像預覽氣泡（同 §1）。

**目的用途**：以清單方式檢索、定位平面圖上的所有相機（及其他裝置），並快速跳到單機操作。

### 4-1. Camera 編輯／詳情面板（清單項目鉛筆 icon）
點清單項目的鉛筆 icon → 右側面板顯示該相機在 floorplan 的屬性：
- **Name**：CD63 Indoor Dome
- **Device Type**：Camera
- **Building**：gongon
- **Floor**：9f（**可改下拉**，調整相機歸屬樓層）
- **Site**：linko
- **Remove Camera**（紅色按鈕，從此 floorplan 移除相機）

選取時 floorplan 上的 marker 變藍（選取態）。
**目的用途**：管理相機在平面圖上的歸屬（樓層）與移除，不需離開 floorplan。

---

## 5. Add → 新增 Camera 到 Floorplan

**操作**：頂部 `+ Add` → 下拉兩個選項 **Camera** / **Sensor**。
點 **Camera** → 右側滑出「**Add Cameras**」面板：
- 頂部搜尋框：`Filter by site or device name`
- 下方列出**尚未放到此 floorplan 的相機**，供拖放到圖上。
- 本例顯示 **「No cameras found」**——因為 org 內唯一相機 CD63 已放置，故無可新增的剩餘相機。

**完整流程（依 UI 推得）**：`Add → Camera → 從面板選未放置相機 → 拖放到 floorplan 指定位置 → 設定位置/方向`。
**注意**：Add Cameras 面板開啟時，已放置的相機 marker 會淡化為灰色小圈、FOV 隱藏（進入「放置模式」狀態）。

**目的用途**：把已納管但尚未上圖的相機，安置到平面圖對應的實體位置。

---

## 6. 移動 / 旋轉 / FOV 調整 — 邊界釐清（重要）

實測結論：**`/maps/{id}` 這個 Floorplan 檢視頁是「監看 + 輕量管理」導向，不提供在圖上直接拖曳移動相機、旋轉、拉 FOV 的編輯。**

- 在 marker 上按住拖曳 → 實際是**平移整張畫布（pan）**，非移動相機。
- 重新整理頁面後相機回到原位 → 確認位置未被改變、未寫入。
- 相機的**位置與朝向是在「Add（拖放放置）」當下決定**；之後在檢視頁只能：檢視、改樓層歸屬、移除。
- 單擊 marker = 跳轉相機詳情頁（§2），不是進入編輯。

> 若要重新擺放/換底圖，走 §7 的 Floor Settings → Edit 精靈（屬底圖層級流程）。

---

## 7. 右上 ⋯（open menu）與樓層 / Floorplan 管理

頂部 `⋯` 選單三項：

### 7-1. Create Floorplan
建立新的 floorplan（新樓層/新平面圖）。

### 7-2. Floor Settings（樓層設定）
右側面板：
- **Building**：gongon
- **Floor Name**：9f（可改）
- **Floorplan**：
  - **Edit** → 進入 **Edit Floor Plan 精靈**（見下）
  - **Delete** → 刪除此樓層底圖
- **Add New Label**：兩個 `+ Abc`，在 floorplan 上加文字標籤

### 7-3. Edit Floor Plan 精靈（`/floor_plan/edit/{id}`）
4 步精靈（屬底圖/定位層級，與相機間接相關）：
1. **Select Building and Floor**（選建築與樓層）
2. **Upload File**（上傳/更換底圖檔，可 Change File）
3. **Enter Address**（輸入地址）
4. **Set Location**（在 Google Map 上定位 floorplan，使平面圖釘到真實經緯度）
- 退出時若有未存變更會跳「Cancel Editing Floor Plan / All unsaved changes will be lost」確認框。
- **與 camera 關聯**：間接。`Set Location` 把 floorplan 釘到地理座標後，相機才能正確疊到 §0 的地理地圖視圖上。

### 7-4. Share Floorplan
產生對外分享連結（`/maps/{id}/share`）。（未深入，屬外發行為）

頂部 `gongon: 9f` 樓層選擇器：下拉可在同一 floorplan 的不同樓層間切換（本例僅 9f 一層）。

---

## 8. 與 camera 相關的功能總表

| 功能 | 入口 | 目的用途 | 與 camera 關聯 |
|---|---|---|---|
| 相機 marker + FOV 扇形 + online 色 | floorplan 圖層 | 看位置/朝向/視野/狀態 | 直接 |
| Hover 即時影像預覽氣泡 | hover marker / Device List | 平面圖上即時預覽 | 直接 |
| 點 marker 進相機詳情頁 | 單擊 marker | 跳即時/歷史影像 + AI 事件 | 直接 |
| Motion Detection 疊圖 | 右側工具列 | 動態偵測分布 | 直接 |
| People Heatmap 人流熱圖 + Timelapse | 右側工具列 | 人流密度/時段趨勢 | 直接（人物偵測） |
| Door Events 疊圖 | 右側工具列 | 門禁事件 | 間接（同圖並列） |
| Device List 裝置清單 | 頂部 Device List | 檢索/定位相機 | 直接 |
| 相機編輯面板（Name/Floor/Remove） | 清單鉛筆 icon | 改樓層歸屬 / 移除 | 直接 |
| Add → Camera 拖放 | 頂部 + Add | 把相機安置到平面圖 | 直接 |
| Floor Settings / Edit 精靈 / Delete / Add Label | 右上 ⋯ | 底圖、地址、地理定位 | 間接 |
| Create / Share Floorplan | 右上 ⋯ | 建立 / 對外分享 | 間接 |
| Zoom / Fit / Pan | 右側工具列 / 滾輪拖曳 | 視圖操作 | 輔助 |

---

## 9. 對本專案（Senao Floorplan）的對標重點

最值得對標、且本專案目前較弱或缺的 camera 衍生功能：
1. **People Heatmap + Timelapse 縮時動畫**（時間軸 + Interval 切換 + 整日回放）— CP 值最高的差異化功能。
2. **Hover 即時影像預覽氣泡** + 點 marker 跳監看頁的無縫導覽。
3. **Motion Detection 疊圖**。
4. **Device List 側欄**（清單 ↔ 圖上 marker 雙向高亮、定位）。
5. **Add 拖放放置相機**（含「未放置相機」清單過濾）。

（與既有研究 `verkada-notes.md` 互補：該檔列總差距表，本檔聚焦 floorplan-camera 實機操作流程。）
