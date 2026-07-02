# UI Spec — 浮動面板分區與互動規範

> 建立背景：2026-07-02 UIUX 盤點（使用者回報「不直觀」+ 3D 選相機遮住右上功能面板）。
> 本文件是後續所有 UI 相關修改的依據。**僅考慮電腦版**（設計基準 1920×1080，最低支援 1366×768），不做手機/平板 RWD。
>
> 原則：**能被新 UIUX 規範直接覆蓋的問題，不individually 修舊行為，直接照新規範實作。**
> 只有規範管不到的功能性 bug 才逐項修（見 §5 對照表「個別修」欄）。

---

## 1. 發現的問題

### 1a. Overlay / 遮擋（程式碼已確認）

| ID | 問題 | 成因 | 嚴重度 |
|----|------|------|--------|
| A1 | **3D 選相機/AP/牆 → PanelRight 被 3D 控制面板蓋住**（使用者回報） | `PanelRight.jsx` 不看 `viewMode`，有選取就開（z100）；`viewer3d__panel` 在 `top:12 right:12`（z400）正好壓在 300px 屬性面板上 | 高 |
| A2 | ProgressPanel 蓋住左下角所有面板 | 它是 `position:fixed` 釘視窗左下 z500，不理會畫布座標系 | 中 |
| A3 | HeatmapControl 展開侵入 CableSummary | CableSummary 寫死 `left:290`，只留給收合狀態的 HeatmapControl（sass 註解自己承認） | 中 |
| A4 | CoveragePanel 用固定 `top:64` 對齊 LayerToggle | 非 flow 堆疊，LayerToggle 長高就撞 | 低 |
| A5 | 短視窗時 TrendPanel（左下）頂到 CoveragePanel（左上） | 各自寫死座標，無避讓 | 低 |
| A6 | CLIENT_VIEW 選到物件時 ClientPanel（z400）蓋 PanelRight（z100） | 同 A1：PanelRight 不受模式 gating | 低 |
| A7 | 死碼：`.camera-list` 浮動版樣式（left:12/bottom:254/z389）還在，重新啟用會撞 TrendPanel | `--docked` 覆蓋後 base rule 未刪 | 低 |

**共同根因**：
1. 全 app 沒有統一「螢幕分區 + z-index 階層」，27 個浮動面板各自寫死角落座標與 z 值（50~1200 散落）。
2. PanelRight 是唯一不受模式/視圖 gating 的浮動面板，成為跨模式衝突熱點。

### 1b. UIUX 不直觀（依影響排序）

| ID | 問題 |
|----|------|
| B1 | 刪除完全不確認且不一致：AP/相機/牆/批次從面板 ✕、右鍵、Delete 鍵都是立刻刪；唯獨刪樓層有 ConfirmDialog。也沒有任何「可 undo」提示 |
| B2 | 3D 是 read-only 但零提示；3D 點選物件場景內無 highlight，只默默開右側面板；使用者會嘗試拖移然後得到零回饋 |
| B3 | 進 CAMERA 模式時 AP/熱圖/Cable 面板全部悄悄消失，唯一線索是小小的 ActiveModeBadge；使用者以為 AP 被刪了 |
| B4 | 選取跨模式殘留：選 AP 切到 CAMERA，AP 圖層隱藏但 PanelRight 還顯示那顆看不到的 AP |
| B5 | 右鍵選單標 `F2` 重新命名，但 F2 沒實作（全域 keydown 無此分支） |
| B6 | 鍵盤 guard 只擋 INPUT/TEXTAREA：焦點在 `<select>` 按 Backspace/Enter 會誤觸刪除/draft 操作；也沒擋 contentEditable |
| B7 | 各工具「結束/取消」語意至少四套（牆=右鍵/Esc、tray=Enter/右鍵/Esc、計數線=Esc 兩段、ALIGN_FLOOR 吃掉 Esc 只能按面板「完成」且畫布無提示） |
| B8 | 相機清單 ✕ 關掉後找不回：唯一重開入口是時間軸第二排「📋 清單」chip，關聯不可發現 |
| B9 | 收合/關閉符號五花八門：`‹›`、`▸▾`、`✕`、`＋`、`⋯`、SVG chevron 混用 |
| B10 | Toggle 狀態表達不一致：熱圖主鈕寫「已開啟/已關閉」，時間軸 chips 只靠 `--active` 邊框色 |
| B11 | 樓層列可拖曳排序但零 affordance（無 grip icon），同一列還擠 onClick 切樓層 + `⋯` 選單 |
| B12 | 開工具選單時 ActiveModeBadge return null——最需要提示的時刻提示消失 |
| B13 | 原生 `alert('PIXI scene 還沒就緒…')` + 「尚未在 PIXI 版本上線」等內部用語外漏給使用者 |
| B14 | 相機清單列太擠：checkbox+狀態點+名稱+✓校+型號+📹+✕ 一列，✕（無確認）緊貼 📹 易誤點 |
| B15 | 所有浮動面板寫死像素座標，1366×768 等短視窗下兩排時間軸 bar 與角落面板互相重疊/溢出 |

---

## 2. 新 UIUX 設計

### 2.1 螢幕分區（Zone Map）

```
┌──────────┬─────────────────────────────────────────────┬──────────────┐
│ Sidebar  │ [TL 堆疊]      [Toolbar]           [TR 堆疊] │  PanelRight  │
│ Left     │                [ModeBadge/Hint]              │  (有選取時)   │
│ 260px    │                                              │  300px       │
│          │                  Canvas                      │              │
│ (+Camera │                                              │              │
│  List    │                                              │              │
│  260px)  │ [BL 堆疊]      [BC 時間軸/Toast]    [BR 堆疊] │              │
└──────────┴─────────────────────────────────────────────┴──────────────┘
```

**分區規則（一律遵守）：**

1. **每個角落是一個 stack container**（`position:absolute` 的 flex column/row），面板「加入」container 依序排列，**禁止面板各自寫死角落座標**。container 定義在 `CanvasArea`：
   - `.canvas-overlay--tl`：`top:12 left:12`，column（LayerToggle → CoveragePanel → DevicePlanningPanel → RegulatorySelector，依模式顯示各自成員）
   - `.canvas-overlay--tr`：`top:12`，column（3D 控制面板 / ClientPanel — 每個 view mode 只有一個「右上主面板」）
   - `.canvas-overlay--bl`：`bottom:12 left:12`，**column-reverse**（HeatmapControl → CableSummary → ProgressPanel trigger 由下往上疊；橫向擠壓問題消失，改為垂直堆疊）
   - `.canvas-overlay--br`：`bottom:12 right:12`，column-reverse（ScaleBar）
   - `.canvas-overlay--bc`：`bottom:18` 置中（CameraTimelineBar；toast 疊其上方）
   - container 本身 `pointer-events:none`、子元素 `pointer-events:auto`（沿用現有 top-left stack 作法）
2. **右側避讓（解 A1/A6 的核心機制）**：PanelRight 開啟時，在 `.app`（或 `.canvas-area`）設 CSS 變數 `--right-dock: 300px`（關閉時 0）。TR 與 BR container 的定位一律 `right: calc(12px + var(--right-dock, 0px))` 並加 transition，隨面板開合平移。**PanelRight 在 3D 保留**（符合「Z 軸屬性在 2D panel 編輯、3D read-only」原則，看屬性仍有價值），遮擋靠避讓解決而非 gating。
3. **ProgressPanel 改為 canvas-anchored**，trigger 加入 BL 堆疊（dev widget 不得用 `position:fixed` 蓋過工作面板）。
4. **可拖曳面板**（TrendPanel）初始位置由 BL 堆疊給，拖走後脫離堆疊（現行為保留）；拖曳範圍 clamp 在 canvas-area 內。
5. 全螢幕 modal（LiveView/Calibration/ScaleDialog/Confirm 等）不分區，走 z-index 階層（§2.2）。

### 2.2 z-index 階層（token 化）

在 `src/styles/_variables.sass` 定義，**禁止再出現裸數字 z-index**：

| Token | 值 | 成員 |
|---|---|---|
| `$z-canvas-overlay` | 100 | 四角 stack container、時間軸 bar、ScaleBar、CableSummary |
| `$z-badge` | 150 | ActiveModeBadge、hover readout/縮圖 popover |
| `$z-floating` | 200 | 拖離堆疊的 TrendPanel |
| `$z-dock` | 300 | PanelRight（+ 其 chevron） |
| `$z-toast` | 400 | MaterialToast、新全域 toast |
| `$z-modal` | 500 | ScaleDialog、AutoPower、AIWalls、Confirm、LiveView、Calibration（同層開後蓋前）、DemoLoader/StressLoader、ProgressPanel 展開面板 |
| `$z-menu` | 600 | ObjectContextMenu、ClientViewMenu、TrayContextMenu |
| `$z-tooltip` | 700 | Tooltip |

> 分區規則已保證同層不重疊；z-index 只處理「跨層」誰蓋誰。

### 2.3 面板統一樣式（Panel Idiom）

以 Phase 37c 的 `viewer3d__panel` dark-glass 卡片為基準，抽成共用樣式（sass mixin 或 class）：

1. **外觀**：dark-glass 背景 + 邊框 + 圓角（對齊 CoveragePanel/TrendPanel/viewer3d__panel 現有風格）。
2. **標題列**：左=標題文字，右=控制鈕。控制鈕只允許兩種：
   - **收合**：SVG chevron（`Icon chevronDown/chevronRight`，全面淘汰 `▸▾‹›` unicode），收合後只剩標題列。
   - **關閉 ✕**：僅限「有明確、就近重開入口」的面板（如相機清單 ✕ ↔ 時間軸 📋 chip）。沒有重開入口的面板**只給收合、不給關閉**。
3. **Toggle/chip 狀態統一**：開=實心底色（accent 填滿），關=描邊。淘汰「只變邊框色」與「已開啟/已關閉」文字兩套並存——全面改用實心/描邊視覺，文字標籤不隨狀態變。
4. **關閉↔重開配對提示**：按 ✕ 關閉面板時，若重開入口不在原位，發一則 toast「清單已收合，可從時間軸『📋 清單』重新開啟」。

### 2.4 互動慣例（Interaction Conventions)

**繪製工具結束/取消（全工具統一）：**

| 按鍵 | 行為 |
|---|---|
| `Esc` 第一下 | 取消目前 draft（未完成的線段/框） |
| `Esc` 第二下（無 draft 時） | 退回 SELECT 模式 |
| 右鍵 | = Esc 第一下（有 draft 取消 draft；無 draft 且多點工具已 ≥ 最低點數則=完成） |
| `Enter` | 完成多點繪製（≥ 最低點數才生效） |

- ALIGN_FLOOR 特例收編：`Esc` = 完成（等同面板「完成」鈕），並在 hint 明確寫出。
- **Hint 常駐**：ActiveModeBadge 不再因 `toolbarMenuOpen` 隱藏（工具選單與 badge 垂直錯開即可）。

**鍵盤 guard（全域統一函式）：**

```js
const isTypingTarget = (el) =>
  el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
  el.tagName === 'SELECT' || el.isContentEditable
```
所有全域 keydown（FloorplanSystem、wallsLayer 等）一律用此 guard。

**刪除策略（全物件統一）：**

| 情境 | 行為 |
|---|---|
| 單一物件（AP/相機/牆/scope/switch/tray/riser…） | 立即刪 + toast「已刪除 ○○ — Ctrl+Z 復原」 |
| 批次刪除（>1 個） | ConfirmDialog（列出數量） |
| 刪樓層 | ConfirmDialog（現行為保留） |

需要一個**全域 toast 元件**（可從 MaterialToast 泛化：bottom-center、$z-toast、自動消失、可含快捷鍵提示）。

**模式切換：**

1. 切換 editorMode / viewMode 時**一律清除 selection**（`selectedId`/`selectedType`），PanelRight 隨之關閉。
2. 進入會大幅改變畫布內容的模式（CAMERA、CLIENT_VIEW）時，發一次性 toast 說明：「已進入監控模式：畫布只顯示底圖與牆，AP/熱圖面板暫時隱藏」。同 session 內同模式只提示第一次。

### 2.5 3D 檢視回饋

1. **選取回饋**：3D 點選物件時，該 mesh 加 highlight（emissive 提亮或 outline），與 PanelRight 開啟同步；點空白處取消選取並還原。
2. **唯讀標示**：`viewer3d__panel` 標題列加「唯讀」小徽記（或副標「編輯請回 2D」）；hover 可編輯物件時 cursor 維持 pointer（僅表示可選取）。
3. PanelRight 在 3D 照常可用（編輯屬性即時反映到 3D），遮擋由 §2.1-2 避讓機制解。

### 2.6 文案與回饋

1. **禁用原生 `alert()`**，一律走全域 toast 或 ConfirmDialog。
2. **禁止內部實作用語外漏**：「PIXI scene 還沒就緒」→「畫布尚未載入完成，請稍候再匯出」；「尚未在 PIXI 版本上線」→「此物件類型的屬性面板即將推出」。
3. 空狀態一律用面板內置灰字提示（現有「本樓層還沒有相機…」的模式），不留空白。

---

## 3. 問題 ↔ 解法對照表

「新 UIUX 覆蓋」= 實作 §2 規範時自然解掉，**不個別修舊行為**。

| ID | 解法 | 依據 |
|----|------|------|
| A1 | 新 UIUX 覆蓋 | §2.1-2 右側避讓（`--right-dock` CSS 變數） |
| A2 | 新 UIUX 覆蓋 | §2.1-3 ProgressPanel 進 BL 堆疊 |
| A3 | 新 UIUX 覆蓋 | §2.1-1 BL 改垂直堆疊，廢除 `left:290` 寫死偏移 |
| A4 | 新 UIUX 覆蓋 | §2.1-1 CoveragePanel 進 TL 堆疊 flow 排列 |
| A5 | 新 UIUX 覆蓋 | §2.1-1/-4 堆疊 + 拖曳 clamp |
| A6 | 新 UIUX 覆蓋 | §2.1-2 避讓 + §2.4 切模式清 selection |
| A7 | **個別修** | 刪除 `.camera-list` 浮動版死碼（做 §2.1 時順手清） |
| B1 | 新 UIUX 覆蓋 | §2.4 刪除策略 + 全域 toast |
| B2 | 新 UIUX 覆蓋 | §2.5 3D 選取 highlight + 唯讀標示 |
| B3 | 新 UIUX 覆蓋 | §2.4 模式切換一次性說明 toast |
| B4 | 新 UIUX 覆蓋 | §2.4 切模式清 selection |
| B5 | **個別修** | 實作 F2 = 觸發改名（等同右鍵「重新命名」）；全域 keydown 加分支 |
| B6 | **個別修** | §2.4 `isTypingTarget` 抽共用並套到所有 keydown |
| B7 | 新 UIUX 覆蓋 | §2.4 工具結束/取消統一表（含 ALIGN_FLOOR 收編） |
| B8 | 新 UIUX 覆蓋 | §2.3-2 ✕ 準則 + §2.3-4 關閉配對 toast |
| B9 | 新 UIUX 覆蓋 | §2.3-2 SVG chevron / ✕ 統一 |
| B10 | 新 UIUX 覆蓋 | §2.3-3 實心/描邊統一 |
| B11 | **個別修** | 樓層列加 grip icon（⠿），拖曳僅限 grip 啟動，行點擊=切樓層不變 |
| B12 | 新 UIUX 覆蓋 | §2.4 hint 常駐 |
| B13 | 新 UIUX 覆蓋 | §2.6 文案規範 |
| B14 | **個別修** | 清單列瘦身：📹/✕ 改 hover 才顯示；型號全名進 title tooltip |
| B15 | 新 UIUX 覆蓋 | §2.1 堆疊制在 1366×768 下自然垂直排列不重疊（時間軸 bar 過寬時允許內部換行/收斂 chips） |

---

## 4. 實作順序建議

| 批次 | 內容 | 對應 |
|------|------|------|
| U1 基礎設施 | z-index token 化、四角 stack container、`--right-dock` 避讓、全域 toast 元件 | A1–A7、B15 的地基 |
| U2 高影響行為 | 切模式清 selection + 模式說明 toast、3D 選取 highlight + 唯讀標示、刪除策略統一 | B1–B4 |
| U3 統一 idiom | 面板標題列/收合/✕ 準則、chip 實心/描邊、hint 常駐、工具結束/取消統一 | B7–B10、B12 |
| U4 小修 bundle | F2、keyboard guard、alert/文案、死碼清理、grip icon、相機清單列瘦身 | A7、B5、B6、B11、B13、B14 |

> 每批做完以 MCP 驗證（讀 `.claude/playwright-mcp-notes.md`）+ 使用者瀏覽器驗收後才 commit（依 workflow）。

---

## 5. 實作狀態（2026-07-02，U1–U4 一次完成，待使用者驗收）

- **盤點修正**：實作時發現兩項「問題」其實已存在，不需修——
  ① B2 的 3D 選取 highlight 本來就有（AP/牆/相機 layer 都有紅色 emissive selected 態），只補了「唯讀」badge；
  ② B4 的跨模式 selection 殘留不存在（`setEditorMode` 本來就會清 selection）。
- **z-index 例外**：面板「內部」的小型 dropdown/submenu（CableSummary 匯出選單 z60、Toolbar 選單 z1、Sidebar 樓層選單 z20、DropZone z10、viewer3d wrapper z2）保留裸數字——它們只在自己的 stacking context 內競爭，不是浮動面板。
- **Toolbar 與 badge 的階層互換**：hint 常駐後，工具下拉選單必須蓋得過 badge，所以 Toolbar 用 `$z-badge`、ActiveModeBadge 用 `$z-canvas-overlay`（選單展開時實體蓋住 badge，收起即恢復）。
- **Dev widget（Demo/Stress/Progress）最終落點＝SidebarLeft 最下方**（2026-07-02 使用者指示）：不放進畫布 overlay——這整塊正式版會移除，放畫布會影響後續 UIUX 設計考量。收合側欄時三者以 icon-only 顯示；進度 popup 改 fixed 視窗左下（避開側欄 overflow clip）。
- **已知殘留（小）**：1366 寬 + CAMERA 模式時，時間軸 bar 第二排 chips 較寬，最右側的「動線」chip 可能與 ScaleBar 視覺相近；如介意可後續把 chips 收斂成下拉。
- MCP 驗證截圖：`.playwright-mcp/ui-01`~`ui-05`；全程 0 console errors。
