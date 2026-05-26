# Session Handoff — 2026-05-26 (Phase 25 — Bundle 9+ shipped)

> 新 session **必讀**順序：
> 1. `CLAUDE.md`（專案規則 + Session Start 流程）
> 2. **本檔**（最新狀態 + 嚴格規則）
> 3. `.claude/oldsrc-audit.md`（完整 audit + 嚴格規則 + 完整 backlog）
> 4. `.claude/task.md`（Phase 25 Layer 31 任務清單）

---

## 🚨 最最最重要 — 嚴格規則

**這是「重構」不是「改寫」不是「重設計」**。

User 多次強調 + 抓 bug 都是因為這條被破壞：

- 一切 **顏色 / 大小 / 角度 / 寬度 / alpha / dash / hover 位置 / cursor / 文案 / spacing / padding / radius / icon / 字級 / shadow** 嚴格照 oldSrc
- **絕對不要** 自選、自編、自加、自優化
- 不確定就 **MCP 並排** (`pnpm dev:oldsrc` on 5180) 對照 + grep `oldSrc/...` 抓常數
- commit message 標明每個數值的 oldSrc 出處（哪個檔哪行）

歷史教訓（**不要重複**）：
- 自選紅色 → 用了黃 `#fbbf24`（oldSrc 是 `#e74c3c`）
- 自編 switch chassis decoration（其實 oldSrc 有完整實作）
- 自設 hit tolerance 14 world px（oldSrc Konva 是 screen px）
- 自加 hover ring 跟 in-layer 視覺重複（painted twice）

**完整 memory**：`~/.claude/projects/.../memory/feedback_strict_refactor.md`

---

## 1. 現況一句話

**Phase 25 PixiJS hybrid 重構 — chrome / panel / 互動 / 視覺 全套對齊 oldSrc。Perf shader (31-4/5/6) 全沒動。**

commits（最新在上）：
```
98e4edc  Audit doc: strict refactor rule + remaining work backlog
162de68  Bundle 9.5 — Drop double-paint AP/Wall hover in hoverOverlayLayer
ef282ef  Bundle 9.4 — Quieter debug logs + slimmer halos
d63b1b7  Bundle 9.3 — eventMode='none' on visual-only Sprite/Graphics  ★ FIXED wall-select bug
9b92c09  Bundle 9.2 — Instrument hitArea.contains() (debug)
e170afb  Bundle 9.1 — (failed attempt) Graphics eventMode='none' on interactive layers' own children
bc3bf31  Auto-probe nearest wall on background-click
2b0a373  Wall debug logs: label + world coords + __wallNearestTo helper
278160a  Wall hit tolerance in screen px
9b0bbb0  Quiet wall hover logs
3e74a7b  Bundle 9 — hover effect parity + debug logs gated by __debugWallSelect
51dcf1b  Bundle 8 — Tray magnet visibility + wall select bug attempt + wall drag
66968b9  Bundle 7 — 7 user-reported issues + inverseScale
54f7fc5  Audit doc bundle-completion log (Bundles 1-6)
a407e18  Bundle 6 — DOOR_WINDOW mode
e1d1e6a  Bundle 5 — PanelRight scope/hole/batch + chevron
2b95bdb  Bundle 4 — Canvas object visuals
3120254  Bundle 3 — DevicePlanningPanel + ActiveModeBadge full hint
efcad22  Bundle 2 — Sidebar overhaul + ProgressPanel
0c4fba6  Bundle 1 — Panel shell primitives + 4 panels ported
568db43  oldSrc resurrection + pixel-level audit
```

---

## 2. 已完成（不要再動）

✅ Tier 1C/2.1 audit 主要條目（panel chrome / sidebar / toolbar / chrome widget / hover invert / wall+AP+SW marker / floating layout / heatmap legend）
✅ 4 個物件 (AP / Switch / Wall / Tray) 完整 click / hover / drag / right-click（basic 三項）/ in-layer 選取 / focus halo / snap status
✅ Sidebar add+collapse / floor row 完整 menu / inline floor properties
✅ ActiveModeBadge 14 個 mode 完整中文 hint
✅ DevicePlanningPanel + ProgressPanel + HeatmapControl/Legend
✅ 4 個 panel (AP/Switch/Wall/Tray) with PanelShell primitives + pill rows + material tile grid
✅ ScopePanel / FloorHolePanel / BatchPanel 基本
✅ DOOR_WINDOW mode click handler
✅ Sidebar 樓層 rename / 對齊樓層（mode 進場）/ 刪除樓層 + ConfirmDialog
✅ Wall body drag + screen-space hit tolerance + 14 px 命中保證（任何 zoom level）
✅ Tray magnet halo 條件顯示（SELECT 只 hover/selected / DRAW_CABLE_TRAY 全顯）
✅ Debug log infra (`window.__debugWallSelect = true`)

---

## 3. **未完成** backlog（user 已知，全列 `.claude/oldsrc-audit.md` 末段）

### A. 右鍵 context menu 漏覆蓋 ⚠️

| 物件 | 狀態 |
|---|---|
| Scope (範圍多邊形) | ❌ scopesLayer 沒 per-object container、`button === 2` 沒接 |
| Floor Hole (中庭) | ❌ 同上 |
| Floor Image (底圖) | ❌ 沒接 — oldSrc 右鍵 → detach imageUrl |
| Tray 完整 hit-context menu | ❌ 只 basic 3 項；缺 segment/endpoint/vertex 各自 menu (split/extend/merge/vertex ops)。完整邏輯在 **`oldSrc/features/editor/Editor2D.jsx` 2014-2156** + `oldSrc/components/ContextMenu/TrayContextMenu.sass` |

### B. DRAW_CABLE_TRAY 繪製 UI 跟原版有差 ⚠️ (user 抓到 2026-05-26)

兩件事：
1. **繪製中的 UI**：ghost line / snap halo / 起點 marker / parallel-wall lock 提示樣式 ≠ oldSrc
2. **完成 tray 的 corner / endpoint 樣式** ≠ oldSrc

對照來源：`oldSrc/features/editor/layers/CableTrayLayer.jsx`（`DraftTray` + `TrayPolyline` 段）+ `Editor2D.jsx` 對應 ghost line code。

### C. Audit polish

- A6 `CableTrayPanel` 19-x 詳細欄位細部對照
- B1 `floor_image` / `floor_align` / `cable_riser` panel route（占位中）
- D4 Toolbar 細部 icon / undo-redo 細節
- E3 CableSummaryPanel BOM 細分 + CSV/PDF export
- F7 FloorImage crop / rotation / opacity / align transform

### D. Workflow gaps

- AutoPowerModal（Sidebar 自動規劃 button stub）
- Marquee 跨 layer type（只 AP）
- PNG 匯出（Sidebar floor menu 沒此項；oldSrc 用 Konva exporter）
- AI walls modal（從底圖辨識牆）
- Snap helpers 在 DRAW_CABLE_TRAY（20-3）
- Auto-channel on place（已 port `autoChannelPlan.js` + apModels，沒接 placement）
- Tray vertex context menu（同 A 提）
- History (Undo/Redo) — `useHistoryStore` stub
- DRAW_SCALE mode → ScaleDialog wiring 沒測
- Crop image mode

### E. Cable Riser 整 feature

`risersLayer.js` + `PLACE_RISER` mode + `RiserPanel` + 跨樓層 xy 共用邏輯（cable-spec §12-3）— 完全沒做。估 2-3 天。

### F. Phase 25 perf shader（**真正核心** — 1000 AP 規格達標）

| Layer | 內容 | 估時 |
|---|---|---|
| 31-4 | Walls Mesh + line shader | 2-3 天 |
| 31-5 | Cables Mesh + dashed line shader | 2-3 天 |
| 31-6 | AP markers texture atlas | 2 天 |
| 31-9 | Scopes/FloorHoles R-tree | 1 天 |
| 31-10 | Stage event router + R-tree + uniform grid | 2 天 |
| 31-11 | SDF text atlas + ticker animation | 2-3 天 |
| 31-12 | 1000 AP 壓力測試 + diff 8 場景 | 2 天 |
| 31-13 | 刪除 `oldSrc/` | 0.5 天 |

合計 ~15 天。**沒這部分 Phase 25 不算 ship**。

### G. Phase 26（條件式）

32-0 量測 baseline + 32-C 增量 routing（看量測結果決定）

### H. 3D Viewer

oldSrc `Viewer3D` 用 `@react-three/fiber 7.0.29`（package.json 依賴還在）。整套沒做。估 5-7 天。

---

## 4. 開發環境

```bash
# 載入 fnm (CLAUDE.md 指示)
eval "$(fnm env)" && fnm use

# 開兩個 dev server 並排
pnpm dev          # new src 5173 (port 通常)
pnpm dev:oldsrc   # oldSrc 5180 (URL: /floorplan-old/oldsrc.html)
```

任何不確定就並排 + MCP screenshot 對照。**不要憑印象寫 code**。

oldSrc store 動態載入（debug 用）：
```js
const editorMod = await import('/floorplan-old/oldSrc/store/useEditorStore.js')
editorMod.useEditorStore.getState()
```

new src store 已暴露：
```js
window.__stores // { editor, floor, ap, wall, cable, heatmap, viewport, drag, hover, scope, hole, hoverReadout, draft }
window.__scene  // PIXI scene { app, world, layers }
window.__pixiApp
```

---

## 5. Debug 工具

```js
// Wall select bug (已 fix 但保留)
window.__debugWallSelect = true
// → [stage] / [wall] / [editor] logs 含 trace stack
// → 背景點自動印 __wallNearestTo(world.x, world.y) 結果

// 手動查詢
window.__wallNearestTo(worldX, worldY)
// → { id, d, worldTol, withinTolerance, screenDistance }
```

---

## 6. 建議下個 task

依嚴重度 + 影響面排序：

1. **DRAW_CABLE_TRAY 繪製 UI 對齊**（user 剛抓到，記憶猶新）— 0.5-1 天
2. **右鍵 menu 覆蓋全 7 type** + Tray 完整 context menu — 1-2 天
3. **Bundle 1-9 漏單 polish**（A6 / D4 / E3 / F7 / 各 mode 文案 / unit suffix）— 1-2 天
4. **Workflow gaps 中影響大的**：undo/redo 基礎 + marquee 跨層 + auto-channel on place — 3-5 天
5. **Phase 25 perf shader 31-4 walls**（技術風險最高、早做早知道） — 2-3 天

**永遠記住**：不要動 oldSrc / 不要重設計 / grep oldSrc 抓常數 / MCP 並排對照 / commit message 標 oldSrc 出處。

---

## 7. 跨機器開發

User 跨多台機器。**所有 durable 決策 / 進度 / 規則寫在 `.claude/*.md`**（隨 repo 走），不只 memory。Memory 是 hint，repo doc 是 canonical。
