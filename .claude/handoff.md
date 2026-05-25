# Session Handoff — 2026-05-25

> 這份 doc 是 session continuation pack。新 session 開始時讀完這份 + `task.md` + `layer-architecture-spec.md` 就能接續，**不需要回頭撈舊對話**。

---

## 1. 現況一句話

Phase 23 結束。**Phase 24 Step 1 + Step 2 已 commit + MCP 驗證通過**。下一步是 Phase 24 Step 3-5（更多 layer 拆分）或直接跳 Phase 25 純 Konva 改寫。

---

## 2. Phase 24 / 25 / 26 路線圖

完整內容看 `.claude/layer-architecture-spec.md`，這裡只記 critical path。

| Phase | 狀態 | 目標 | 對應 task |
|---|---|---|---|
| **24** Konva Layer 架構 | 🟡 step 1+2 done；step 3-5 待做 | 解 SW+Tray+50AP 操作卡頓（凍結 cable 妥協）| Layer 30 |
| **25** 純 Konva 改寫 | ⬜ 未開始 | 消掉 react-konva commit / reconciliation 成本 | Layer 31 |
| **26** Real-time cable follow | ⬜ 條件式、等 Phase 25 量測 | 達到 Hamina 等級即時 cable 跟手 | Layer 32 |

### Phase 24 step 進度

| # | 狀態 | 動作 |
|---|---|---|
| 30-1 | ✅ done | CableLayer 拆獨立 `<Layer listening={false}>` |
| 30-2 | ✅ done | Tray dragmove → `useDragOverlayStore.tray / trayVertex`，dragend commit |
| 30-3 | ⬜ | Structural / Trays / Devices 三層分離 |
| 30-4 | ⬜ | Overlay 拆 visual / interactive |
| 30-5 | ⬜ | FloorImage 預設 `listening=false` |
| 30-6 | ⏸️ 延後 | DragLayer（量測需要才做） |
| 30-7 | ⏸️ 延後 | Cable focus halo 拆層（hover focus 才需要） |

### Phase 26 決策樹（Phase 25 後執行）

```
量 computeRoutes wall-clock @ 50 AP
├─ < 5 ms/frame  → 32-D 解凍 cable（最便宜）
├─ 5–16 ms       → 32-B WebGL cable rendering（沿用 heatmapGL pattern）
└─ > 16 ms       → 32-C 增量 routing（dirty / single-source Dijkstra）
```

Hamina 等實測能做到 100+ AP 拖曳時 cable real-time follow。Phase 24 凍結 cable 是降規格的妥協，Phase 26 處理這個 gap。差距在兩個結構性點：渲染後端（react-konva commit）+ 演算法（每幀全量 dijkstra × N AP）。

---

## 3. Phase 24 Step 1+2 程式碼變動摘要

### 3.1 `Editor2D.jsx`
原本 `<CableLayer>` 從共用 `<Layer>` 內移出，掛到新獨立 `<Layer listening={false}>`，含 align mode transform：

```jsx
{activeFloorId && showCables && (
  <Layer
    listening={false}
    {...(isAlignMode && activeFloor ? alignLayerProps(activeFloor) : {})}
  >
    <CableLayer floorId={activeFloorId} viewportScale={viewport.scale} />
  </Layer>
)}
```

位置：主 vector Layer close 之後、marquee Layer 之前。

### 3.2 `useDragOverlayStore.js`
新增兩個 slot：
- `tray: { id, dx, dy } | null`                    — body drag 累積偏移
- `trayVertex: { trayId, vertexIdx, x, y } | null` — 單一 vertex 拖曳座標

對應 setter：`setTray` / `setTrayVertex`。`clear()` 一起清。

### 3.3 `CableTrayLayer.jsx`
- 新增 `useDragOverlayStore` import
- 訂閱 `trayBodyOverlay` + `trayVertexOverlay`
- `displayedTrays`：有 overlay 時 map 套 offset；無 overlay 時 identity-return 原 `trays`（memo cache hit）
- `neighborExts` + render iter 都改吃 `displayedTrays`
- `TrayPolyline` 加 `onTranslateEnd` prop，body onDragEnd 呼叫它
- 三個 callback 改：
  - `onTranslate(incDx, incDy)`：寫 overlay（累積）
  - `onTranslateEnd()`：讀 overlay → fresh store points + dx/dy → commit `updateTray` → 清 overlay
  - `onVertexDragMove(idx, raw)`：snap + 寫 `trayVertex` overlay
  - `onVertexDragEnd(idx)`：讀 overlay → commit → 清

---

## 4. MCP 驗證結果

| 檢查項 | 結果 |
|---|---|
| Layer 4 是 listening=false 獨立 layer | ✅ 1425 Lines / 1375 Circles 全在 Layer 4 |
| Tray body drag overlay 累積 | ✅ 30 ticks 累積到 dx=300/dy=120 |
| Tray body drag 期 store 不變 | ✅ |
| Tray body drag 期 updateTray 呼叫次數 | ✅ 0 次 |
| Tray body drag 期 cable line 數不變 | ✅ |
| Tray body drag 視覺 polygon 跟手 | ✅ 移到 offset 位置 |
| Tray body dragend commit 正確 | ✅ updateTray 1 次、座標 = orig + dx/dy |
| Tray vertex drag 全鏈路 | ✅ 同上模式 |
| AP drag regression | ✅ 既有行為不變 |
| Switch drag regression | ✅ 既有行為不變 |
| Perf：100 ticks / 0 store mutation | ✅ 17ms / 0.168ms per tick |

舊行為（拖曳每 tick 寫 store + computeRoutes dijkstra × 50AP + cable 500+ nodes 重畫）估算 50-100ms/tick，新版 0.168ms/tick = **改善 300-600 倍**。

---

## 5. Phase 25 開工注意事項

詳見 `task.md` Phase 25 / Layer 31，這裡只記坑點：

| 點 | 處理 |
|---|---|
| `src/` → `oldSrc/` 改名 + 新 `src/` 平地起樓 | 邊改邊參考、可一鍵 rollback |
| 新 `/src` **嚴禁** import `/oldSrc` | 破例就喪失乾淨重來意義 |
| `vite.config.js` `@` alias 維持 `./src` | 新碼用 |
| `oldSrc/` 加 `.eslintignore` + vitest glob 排除 | 避免污染 |
| 新 `src/main.jsx` 第一天就要存在 | index.html 預設指這條 |
| APLayer / Marquee 已 imperative | 直接從 oldSrc 搬 |

Layer 改寫順序：CableLayer → SwitchLayer → RiserLayer → WallLayer → ScopeLayer/FloorHoleLayer → **CableTrayLayer（最複雜留最後）** → Overlays。

---

## 6. 元層級的設計原則（過程中確立）

`動一下就回 store + re-render` 是這類大 canvas 系統的根本性能陷阱。原則：

> **Transient state（暫時狀態）不該進 store**。
> 只要還是 mousedown / keypress / hover / 繪製途中，就活在 ref / local state / dragOverlay。
> 邊界（mouseup / blur / dragend）才 commit 正式 store。

對應反例盤點寫在 [layer-architecture-spec.md §1.3](layer-architecture-spec.md)。Panel sliders（HeatmapControl / AlignFloorPanel / FloorImagePanel）也踩到同樣 pattern，目前未處理，Phase 25 過程或之後可順手收尾。

---

## 7. 跨機器開發注意

User 在多台機器開發。**durable 計畫 / 決策一律進 `.claude/*.md`（隨 repo 走）**，不只 memory（local-only）。Memory 可作為 hint，repo doc 才是 canonical source。

對應 memory：`feedback_cross_machine_dev.md`

---

## 8. 立即可做的清單（按優先序）

1. **Phase 24 Step 3-5** —— 結構性 layer 拆分（Structural / Trays / Devices 三層、Overlay 拆 visual/interactive、FloorImage listening=false）。可分批做也可合一個大 commit。
2. **或直接跳 Phase 25**：`git mv src oldSrc` + 新 `src/main.jsx` 最小骨架 + 配置調整，逐 layer 改寫
3. 廢棄 Phase 24 Step 3-5 也可（決策保留，融進 Phase 25 動工時順手做）

---

## 9. 跨檔對照 quick map

| 你要找的東西 | 看哪裡 |
|---|---|
| 各 phase 任務列表 + 狀態 | `.claude/task.md` |
| Layer 架構設計 + 風險 + 決策樹 | `.claude/layer-architecture-spec.md` |
| 協作流程 / commit 規則 | `.claude/workflow.md` |
| 檔案結構 | `.claude/file-structure.md` |
| Cable 系統設計 | `.claude/cable-spec.md` |
| Playwright MCP 驗證踩坑 | `.claude/playwright-mcp-notes.md` |
| Perf 量測 baseline | `.claude/perf-baseline.md` |
