# Verkada Command — Camera × Floorplan 實機操作調研

> 🤖 **本報告與所有截圖由 Claude Fable 5（`claude-fable-5`）分析產出。**
> **調研方式**：Playwright MCP 實際登入 `eason.command.verkada.com`（Senao demo org `eason`）逐一操作。
> **環境**：Site `linko` → Building `gongon` → Floor `9f`，一台實機相機 **CD63 Indoor Dome**（線上）。
> **調研日期**：2026-07-06（前次 2026-06-24 版本重跑 + 擴充）。
> **範圍**：只記 camera + floorplan 組合的功能、操作方式、UIUX；其他裝置型別（門禁/感測器）依使用者指示忽略。
> **互補文件**：[`verkada-notes.md`](../verkada-notes.md)（文件研究 + 對標差距表）。

---

## 0. 入口與資訊架構（IA）

| 入口 | 行為 |
|------|------|
| All Products 選單 → **Floorplans** | 進入 floorplan 模組（URL `/floorplans`） |
| `/floorplans` | **自動 redirect 到最近的 floorplan** `/maps/<floorplanId>`（org 只有一張圖時直接進入） |
| Cameras Home 右側 **Map** 按鈕 | Google Maps 地理視圖：floorplan 以標籤 pin（`gongon`）釘在真實地理位置，**相機 icon + FOV 錐直接畫在地圖上**；有 Satellite 切換、zoom、全螢幕、✕ 關閉 |
| 相機 popover 內相機名稱 | 連到相機詳情頁 `/cameras/<cameraId>/` |

- Floorplan 模組頂欄極簡：左＝`Floorplans` 標題 + **樓層選擇器**（`gongon: 9f`）；右＝`+ Add`、`Device List`、`…` 選單。
- 左側全域 sidebar 縮成只有 Floorplans 一個 icon（模組間用 All Products 切換）。

---

## 1. 主畫布（Floorplan Canvas）

### 1.1 佈局

- 底圖置中顯示（白底工程圖），畫布背景淺灰。
- **右側直立控制列（floating rail，圓形白底按鈕）由上到下**：
  1. 🚪 **Door Events**（overlay toggle）
  2. 🏃 **Motion Detection**（overlay toggle）
  3. 👥 **People Heatmap**（overlay toggle）
  4. 🔍+ **Zoom In**
  5. 🔍− **Zoom Out**
  6. ⛶ **Fit Screen**
- overlay 三鈕與 zoom 群組之間有間隔分組；hover 各鈕顯示黑底 tooltip（文字在按鈕左側）。

### 1.2 視圖操作

| 操作 | 行為 |
|------|------|
| 畫布任意處拖曳（含相機標記上，**非編輯狀態**） | **平移畫布**（cursor: `grab`） |
| Zoom In/Out 按鈕 | 以畫面中心縮放 |
| Fit Screen | 底圖回到適配大小置中 |
| 右鍵 | **無 context menu**（只觸發 hover 標籤） |

---

## 2. 相機標記與 FOV

### 2.1 視覺

- 標記＝**青色（teal）圓形 dome icon**，**固定螢幕大小**（zoom 不縮放，永遠可點）。
- FOV＝**淡綠色半透明多邊形**（實測為四邊形/梯形，非單純扇形），**隨 zoom 縮放**（貼在底圖座標上）。
- hover 標記 → 顯示灰底白字名稱標籤「CD63 Indoor Dome」。
- 選取（編輯）狀態 → FOV 變**淡藍色高亮**。
- Door Events overlay 開啟時 → 相機 icon 變灰白、FOV 隱藏（該模式聚焦門禁，相機退場）。

### 2.2 點擊 → 即時影像 popover

點擊標記彈出 popover（在標記上方）：

- **即時串流縮圖**（真的在播 live video，非靜態圖）。
- 左下：**線上狀態綠點 + 相機名稱**；名稱是連結 → 相機詳情頁。
- 右上 `…`（aria-label: *Configure entity*）選單，只有兩項：
  - **Edit** → 開右側裝置編輯面板（見 §3）
  - **Remove** → 從平面圖移除
- 點畫布空白處關閉 popover。

### 2.3 重新定位與轉向（**必須先進 Edit 狀態**）

- 非編輯狀態拖標記＝平移畫布（防誤觸設計）。
- **Edit 面板開啟時**：
  - **拖曳標記本體 → 重新定位**（標記+FOV 跟著游標走，背景不動）。
  - **拖曳 FOV 區域 → 旋轉朝向**（FOV 繞標記轉，跟隨游標角度）。
- 無 FOV 張角/距離的畫布手柄；FOV 形狀推測由相機型號/校準自動決定。

---

## 3. 裝置編輯面板（右側 slide-in panel）

入口：popover `…` → Edit，或 Device List 列 hover 的 ✏️ 鉛筆。

| 欄位 | 可編輯性 |
|------|----------|
| 即時影像縮圖 | —（live） |
| Name | 唯讀顯示（改名在相機設定頁） |
| Device Type | 唯讀（Camera） |
| Building | 唯讀（gongon） |
| **Floor** | **下拉可改**（跨樓層搬移裝置） |
| Site | 唯讀（linko） |
| **Remove Camera** | 紅色按鈕（從平面圖移除，非刪裝置） |

> 面板開啟 = 該裝置進入「placement 編輯狀態」（可拖位置/轉 FOV，見 §2.3）。關閉（✕）即結束。

---

## 4. Add（放置新裝置）

- `+ Add` 下拉：**Camera / Sensor** 兩型別（此 org 無門禁授權，Verkada 完整版還有 Doors 等）。
- 選 Camera → 右側「**Add Cameras**」panel：
  - 搜尋框「Filter by site or device name」。
  - 清單**只列尚未放置**的相機；全放完顯示「No cameras found」。
  - （官方流程：從清單點選/拖到圖上完成放置。）

---

## 5. Device List（「Floorplan Items」panel）

- 頂欄 `Device List` 按鈕開啟右側 panel，標題「**Floorplan Items**」。
- 搜尋框 + **依裝置型別分組**（灰底 section header）：`Cameras 1`（型別 + 數量 badge）。
- 每列：型別 icon + 裝置名。
- **列 hover** →
  - 畫布上該標記**同步顯示名稱標籤**（清單→畫布高亮聯動）。
  - 列尾浮出兩顆 icon：**✏️ 編輯**（開 §3 面板）與 **📹 預覽**。

---

## 6. 樓層選擇器（頂欄 `gongon: 9f`）

- 點開 → **左側抽屜**：
  - 頂部搜尋框（過濾建築/樓層）。
  - **Building → Floor 樹狀清單**（`gongon` 可收合 → `9f`）。
- 點樓層即切換；Esc/點外面關閉。

---

## 7. `…` 選單（floorplan 層級操作）

三項：**Create Floorplan / Floor Settings / Share Floorplan**。

### 7.1 Floor Settings（右側 panel）

| 區塊 | 內容 |
|------|------|
| Building | 唯讀（gongon） |
| **Floor Name** | 文字輸入可改名（`9f`） |
| **Floorplan** | `Edit`（進 §7.3 精靈）＋ 紅色 `Delete`（刪底圖） |
| **Add New Label** | 兩顆按鈕：**粗體 Abc / 一般 Abc**（在圖上加文字標註，兩種字重） |

### 7.2 Share Floorplan（modal，URL `/maps/<id>/share`）

- 輸入框「Enter phone, e-mail, or contact」。
- **Access to** 下拉：`live video only` / `live and historical video`。
- **for** 時效：數字 + 單位下拉（預設 `1 hour`）。
- 警語：「Shared video and features can be viewed by anyone with access to the link URL」。
- **Send Link** 送出；**More options** 展開：**Copy Link / Manage Links**。
- → 本質是**限時訪客連結**：拿到連結的人可看 floorplan + 相機即時（或含歷史）影像。

### 7.3 Edit/Create Floor Plan 精靈（全頁 wizard，URL `/floor_plan/edit/<id>`）

四步驟進度條：**Select Building and Floor → Upload File → Enter Address → Set Location**。

1. **Upload File**：顯示目前底圖縮圖「Confirm your floor plan」+ `Change File` 換檔（官方限制：SVG/PDF、<5MB）。
2. **Enter Address**：Google 地圖 + 地址 autocomplete 輸入 + 可拖 pin。
3. **Set Location**：底圖**半透明疊在 Google Map 上**，虛線框 + 四角圓形手柄（縮放對位），可拖曳移動整張圖；地圖可 zoom；`Back` / `Save`。
4. 中途按 ✕ → confirm dialog「Cancel Editing Floor Plan — All unsaved changes will be lost」（Cancel/紅色 Confirm）。

> Create Floorplan 走同一支精靈（從 step 1 選建築/樓層開始）。

---

## 8. 分析 Overlay（右側 rail 三鈕）

三個 overlay 是**獨立 toggle**（開啟後按鈕變深色 active 狀態）。

### 8.1 Door Events

- 此 org 無門禁 → 無事件顯示；開啟後**相機 icon 轉灰白、FOV 隱藏**（視覺讓位給門禁裝置）。

### 8.2 Motion Detection

- Toggle 後即時動態模式啟動（官方：偵測到的人/車即時畫在平面圖上，4Hz 更新）。
- 實測時間內畫面無人 → 無標記可見；無額外控制列。

### 8.3 People Heatmap（最完整的 overlay）

開啟後出現兩塊 UI：

**a) 左側顏色圖例（vertical legend）**
- 直立色條：紅（頂）→黃→藍（底）漸層。
- 頂端「多人」icon、底端「單人」icon → 紅=人多、藍=人少。

**b) 底部時間軸列（dark bar，全寬）**
- `↶1h` / `1h↷`：時間窗前後平移一小時。
- **▶ Timelapse**：進入時間推移模式（見下）。
- 中央時間範圍 chip：`Jul 6, 09:30 AM - Jul 6, 10:30 AM ˅` → 點開**日期時間選擇器**：月曆 + Date 輸入 + Time 下拉 + 時區顯示（Taipei Standard Time）+ `Apply`。
- 右側 **Time Interval** 檔位：`1 hour / 4 hours / 8 hours / 12 hours / 1 day`。
- 最下方**刻度時間軸 scrubber**：整段顯示小時刻度，目前選取窗以亮色 highlight，可點跳。

**Timelapse 模式**
- 底列變成 `✕`（退出）/ `▶`（播放，播放中變 `⏸`）/ `⏮`（回開頭）。
- 時間軸展開成**整天**（12AM–12AM，含日期）；Time Interval 檔位變 `1h/4h/8h/12h`（沒有 1 day）。
- 播放時選取窗自動沿天推進，熱圖跟著窗滑動更新（= 我們 34-V 的熱圖 timelapse 對標對象）。

---

## 9. 地理地圖視圖（Cameras Home → Map）

- Google Maps 底圖（可切 Satellite）。
- Floorplan 以**名稱 pin**（`gongon` 灰底標籤）+ 縮小輪廓疊在真實座標。
- **相機在地圖上直接畫 icon + FOV 錐**（geo 化的 FOV，可在地圖層級看覆蓋）。
- 點 pin → 進入該 floorplan 頁。
- URL 帶 `?lat=&lng=&zoom=` 狀態。

---

## 10. UIUX 設計要點（可借鑑）

1. **標記固定螢幕大小、FOV 跟底圖縮放** — zoom out 時 icon 不會消失、zoom in 時 FOV 精準貼圖。
2. **看/編分離**：預設畫布只能看（拖曳=pan、點擊=live popover）；要動裝置必須先進該裝置的 Edit 狀態 → 幾乎不可能誤搬相機。
3. **單一 `…` 收斂管理功能**（Create/Settings/Share），頂欄常駐只有 Add 與 Device List 兩個高頻鈕。
4. **overlay = 右側 rail toggle**，開啟才長出對應控制 UI（heatmap 的圖例+時間軸），關閉即回收 — 與我們 Phase 39 四角 stack 思路一致。
5. **清單↔畫布雙向 hover 聯動**（我們 Tier1 Device List 已對齊）。
6. **Share = 限時訪客連結**，權限粒度只有 live / live+歷史 兩檔 + 時效。
7. **每次進頁都跳「Enable local access for faster video」dialog**（WebRTC 區網直連），需手動關 — 自動化操作時要先處理。
8. 熱圖無資料時**不顯示空狀態提示**（畫布就是乾淨的），僅圖例+時間軸表明模式開啟中。

---

## 11. 與本專案的對照速記（詳細差距表見 ../verkada-notes.md）

| Verkada 實機行為 | 本專案現況 |
|------|------|
| FOV 四邊形（校準/型號自動生成），無張角手柄 | 我們：扇形 + visibility polygon（牆遮擋），панель可調張角/距離 — **我們的物理模擬更強** |
| 拖 FOV 旋轉、拖標記移位（edit-gated） | 我們：直接拖 + panel 數值；未做 edit-gated 防誤觸 |
| People Heatmap timelapse（窗沿天滑動 + 播放控制） | 34-V ① 已對標（占用窗滑動）；播放/暫停/回開頭三鍵 + 全天軸展開的**專用 timelapse 模式 UI** 我們沒有獨立化 |
| Time Interval 檔位 1h/4h/8h/12h/1d | 我們：時段篩選較自由但無此固定檔位概念 |
| 日期時間選擇器（月曆+時區+Apply） | 我們：mock 單日資料，無日曆 |
| Share Floorplan 限時連結 | 我們：無（閉環單機，暫無此需求） |
| Google Maps 地理定位 + geo FOV | **已撤回不做**（Tier 3，2026-07-02 使用者拍板） |
| Door Events overlay 讓相機退場的「模式讓位」視覺 | 我們：CAMERA mode 已有類似概念（畫布只剩底圖+牆） |

---

## 附錄：本次調研截圖索引（與本報告同資料夾 `.claude/verkada-screenshots/`）

> 截圖與本報告皆由 **Claude Fable 5** 分析擷取，另見同資料夾 `README.md`。

| 檔名 | 內容 |
|------|------|
| verkada-01-map-view | Cameras Home 的 Google Map 視圖（floorplan pin + geo FOV） |
| verkada-03-floorplan-canvas | Floorplan 主畫布全貌 |
| verkada-05-camera-click2 | 相機 live popover |
| verkada-08-fullwidth | `…` 選單三項 |
| verkada-09-floor-settings | Floor Settings panel |
| verkada-10/11/12 | Edit Floor Plan 精靈三步驟（Upload/Address/Set Location） |
| verkada-14-floor-selector | 樓層選擇器抽屜 |
| verkada-15-add-menu / 16-add-camera | Add 下拉 + Add Cameras panel |
| verkada-17/18 | Floorplan Items panel + hover 聯動 |
| verkada-21/22-heatmap | People Heatmap 圖例 + 時間軸 |
| verkada-23-heatmap-daterange | 日期時間選擇器 |
| verkada-24/25-timelapse | Timelapse 模式（待播/播放中） |
| verkada-26-zoomed | FOV 四邊形放大細節 |
| verkada-33-editdrag-mid | Edit 狀態拖曳重定位 |
| verkada-35-fov-rotate-mid | Edit 狀態拖 FOV 旋轉 |
| verkada-38~42-share | Share Floorplan modal（More options / Access 下拉） |
| verkada-46-door-events | Door Events 開啟（相機灰化） |
