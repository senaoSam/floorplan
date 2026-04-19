# 12. 編輯器 UI 互動工作流程

> **文件性質**：NPv1 的編輯器 UI 邏輯幾乎全部打包在各 worker bundle 與 lazy-loaded chunks 裡，`index.js` 主 bundle 能看到的線索非常有限。本文件以**確定證據**與**合理推測**兩欄區分，複現時以確定證據為底、推測項以 NPv1 試用站實測補齊。

---

## 1. 證據強度分級

| 主題 | 證據強度 | 來源 |
|---|---|---|
| Undo / Redo | ✅ 強 | `undoStack`, `redoStack`, `undoPush`, `redoPush`, `history` |
| Snap（吸附） | ✅ 弱但確定 | i18n namespace `snap:mn`（有翻譯字串代表有功能） |
| Drag & Drop 基礎 | ✅ 強 | `react-dnd` 完整符號集 |
| 選取（Selection） | ✅ 中 | `selectedId`, `selectedTool`, `onItemSelect`, `selections` |
| 鍵盤快捷 | ✅ 弱 | `_handleKeyboardEvent`, `shortcut` |
| 多選 / 框選 | ⚠️ 推測 | 無直接字串（`rubberBand`、`marquee` grep 0 match） |
| 吸附距離 / 對齊線 | ⚠️ 推測 | 細節在 lazy chunk / mainWorker |
| 即時 vs 放開重算 | ⚠️ 推測 | `progressiveHeatmapWorker` 存在暗示分階段 |

---

## 2. Undo / Redo 架構

### 確定事實

index.js 符號：
- `undoStack`, `redoStack` — 雙 stack 結構
- `undoPush`, `redoPush` — push 動作
- `history` — 整體 manager
- `takeFullSnapshot`, `IncrementalSnapshot`, `FullSnapshot` — **但這批是 rrweb session recording（Sentry 用）**，與 undo 無關，切勿混淆

### 推測（未見直接證據但合理）

- 每次 mutation（`MoveSelectedItems`, `addWall`, ...）**前**呼叫 `undoPush(snapshot)`
- snapshot 可能是 patch-based（只記 diff）或 full-state（整個 map）
- redo stack 在每次新動作時清空

### 複現建議

```ts
interface HistoryStore {
  past: State[]
  present: State
  future: State[]

  push(next: State): void  // clear future, pop if >N
  undo(): void             // present → future, past.pop → present
  redo(): void             // present → past, future.pop → present
}
```

限制深度（例如 50~100 步）避免無限成長。對大 floor（幾千面牆）可能要用 patch-based（immer patches）而非整份 clone。

---

## 3. Drag & Drop

### 確定事實

index.js 大量 `react-dnd` 符號：
- `beginDrag`, `canDrag`, `canDragSource`, `publishDragSource`
- `dragDropManager`, `dragSources`
- `dragstart`, `dragend`, `dragenter`, `dragleave`, `dragover`, `dragging`
- `endDrag`, `isDragging`, `isDraggingSource`, `dragOffset`, `dragOperation`

### 用途推測

- **Toolbox → Canvas**：從左側工具欄拖「牆」「AP」「Zone」到畫布
- **物件拖拉**：選中物件後拖動位置
- **端點拖拉**：牆端點、多邊形頂點

### 複現建議

新版 floorplan 專案已用 Konva 原生拖拉（`draggable: true`），不需要 react-dnd。
但**跨樹的拖拉**（Toolbox DOM → Konva Stage）需要混合方案：
- DOM 拖拉用 HTML5 drag events 或 react-dnd
- 進入 Stage 後換成 Konva 邏輯

---

## 4. 選取 Selection

### 確定事實

- `selectedId` — 單一選中 ID
- `selectedTool` — 目前工具（wall / ap / zone / ...）
- `selectedVendor`, `selectedLiveSsids`, `selectedMeasuredHeatmap`, ...（UI 狀態樹眾多 selected 欄位）
- `onItemSelect` — callback
- `selections`, `selectionSet` — 集合（可能支援多選）

### 推測

- 單選：點擊物件 → `selectedId = id`
- 多選：Shift+click 加入 `selections`（未見明確字串）
- 框選（marquee）：**grep 無結果**，可能沒有，或在 lazy chunk
- `selectedTool` 不同時，點擊行為不同：
  - `tool=wall` → 點擊開始畫牆
  - `tool=select` → 點擊選取物件

### 複現建議（已在本專案實作）

本專案 [src/store/useEditorStore.js](src/store/useEditorStore.js) 已有：
- `editorMode`（類似 `selectedTool`）
- `selectedId`, `selectedType`
- 可擴展：`selectedIds: Set<string>` 做多選

---

## 5. Snap（吸附）

### 確定事實

- i18n 字串 `snap:mn`（與 `wall`, `accessPoint`, `editing`, `paste` 並列為翻譯 namespace）
- 代表**有**吸附功能，至少存在使用者可見文字（「已吸附」「關閉吸附」之類）

### 推測

- 吸附對象：grid / 相鄰牆端點 / 相鄰牆延伸線
- 吸附距離：常見 5~10 px（以螢幕 px 為準，非 canvas px，會隨縮放變）
- 視覺回饋：NPv1 試用站實測觀察（未做）
- 可能的 toggle：Shift 或 Alt 鍵暫時關閉吸附

### 複現建議

```js
function snapPoint(candidate, targets, thresholdPx, scale) {
  const threshold = thresholdPx / scale  // canvas 距離 = 螢幕距離 / scale
  for (const t of targets) {
    if (distance(candidate, t) < threshold) return t
  }
  return candidate
}
```

吸附目標類別：
1. 其他牆端點
2. 其他牆線段上的最近點
3. 延伸線交點（兩牆延伸的交會）
4. 規則 grid（如 0.5m 網格）

---

## 6. 鍵盤快捷鍵

### 確定事實

- `_handleKeyboardEvent`, `shortcut` — 有處理器
- 其餘細節（哪些鍵、綁什麼動作）全部在 worker 或 lazy chunk

### 業界常見（以此作為實作起點，再用 NPv1 實測校對）

| 鍵 | 動作 |
|---|---|
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Shift+Z | Redo |
| Delete / Backspace | 刪除選中物件 |
| Escape | 取消當前操作 / 退選 |
| Ctrl/Cmd+A | 全選 |
| Ctrl/Cmd+C / V / X | 複製 / 貼上 / 剪下（有 `paste` i18n namespace） |
| Space（按住） | 平移畫布（手型工具） |
| +/- | 縮放 |
| W / P / A（推測） | 切換工具（Wall / AP / ...） |

### 複現建議

本專案 [CLAUDE.md](CLAUDE.md) 已有 Input 焦點 guard 規則（Delete 時略過 input）——保留此模式。

---

## 7. 即時 vs 放開重算（Progressive Heatmap）

### 確定事實

- `createProgressiveHeatmapWorker` 存在
- wasm 有 `getSmoothTile`, `getGaussianBlurredTile`, `BlurredTileParameters`
- wasm 有 `setViewportTileBox` + `setStaticTileBox`
- observer pattern：`observeViewportTileResult`, `observeStaticTileResult`

### 推測架構

```
使用者拖拉牆端點
    ↓
(每幀) setViewportTileBox(currentViewport)  ← 只算可視區
    ↓
wasm 粗略算（低解析度 tile or blur）
    ↓
observeViewportTileResult 推進 UI
    ↓
使用者放開滑鼠
    ↓
setStaticTileBox(fullMap)  ← 全圖高精度
    ↓
wasm 細緻重算
    ↓
observeStaticTileResult → 更新 UI
```

即時拖拉時只算 viewport 內 tile，放開時才做全圖。這解釋了為什麼 NPv1 拖牆不會卡。

### 複現建議

V1 先做整圖重算 + debounce（300~500ms），效能足以應付中小案場（<500 牆 + <1M grid cells）。
V2 再加 tile-based progressive。

---

## 8. 完整編輯 session 時序（推測 + 確定混合）

```
t=0 使用者點 [Wall] 工具 → selectedTool='wall'
t=1 使用者 mousedown on canvas → 記錄 start point
t=2 使用者 mousemove → draw ghost line，每幀做 snap check
t=3 使用者 mouseup → 寫入 wall 到 state
       ├─ undoPush(pre-state)
       ├─ useWallStore.addWall({...})
       ├─ progressiveHeatmapWorker.postMessage({ action: 'update', ... })
       │     ├─ (fast) setViewportTileBox → observeViewportTileResult → 粗略 heatmap
       │     └─ (slow) setStaticTileBox → observeStaticTileResult → 精緻 heatmap
       └─ GraphQL mutation（非同步，離線 queue）
t=4 使用者 Ctrl+Z → history.undo() → state 還原 → progressiveHeatmapWorker 重算
```

---

## 9. 複現實作 checklist

- [ ] History store（undo/redo stack，深度 50）
- [ ] Drag & drop（toolbox → stage，已有 Konva draggable 基礎）
- [ ] Selection store（selectedId / selectedType / selectedIds for multi）
- [ ] Keyboard handler（含 input 焦點 guard）
- [ ] Snap system（端點 / 牆線 / 延伸線 / grid，threshold = 8px/scale）
- [ ] Debounced heatmap recompute（V1：放開才算；V2：tile-based progressive）
- [ ] Ghost preview（拖拉中的半透明預覽，已有雙線法）

---

## 10. Open questions（需到 NPv1 試用站實測）

1. 吸附預設 on/off？toggle 鍵位？
2. 是否支援多選 + 批次拖拉？框選（marquee）？
3. 牆端點是否自動延伸 / 裁切到相鄰牆？
4. Undo 深度上限是多少？跨 floor undo 是否支援？
5. 拖拉時 heatmap 更新頻率（每幀 vs 每 100ms）？
6. 是否有對齊線 / ruler guides？

這些實測結果應該填回本文件 §1 的「推測」欄，或 spec 階段用 screencast 保存。

---

## 11. 證據索引

| 來源 | 證據 |
|---|---|
| index.js | `undoStack`, `redoStack`, `undoPush`, `redoPush`, `history` |
| index.js | `react-dnd`: `beginDrag`/`endDrag`/`dragDropManager`/`isDragging`/... |
| index.js | `selectedId`, `selectedTool`, `onItemSelect`, `selections`, `selectionSet` |
| index.js | i18n namespace `snap:mn`（暗示有吸附功能） |
| index.js | `_handleKeyboardEvent`, `shortcut` |
| index.js | `createProgressiveHeatmapWorker` |
| hamina.wasm | `setViewportTileBox`, `setStaticTileBox`, `observeViewportTileResult` |
| hamina.wasm | `getSmoothTile`, `getGaussianBlurredTile`, `BlurredTileParameters` |
| index.js grep 0 match | `rubberBand`, `marquee`（框選未證實） |
