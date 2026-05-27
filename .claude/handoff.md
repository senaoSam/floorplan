# Session Handoff — 2026-05-27 (Phase 25 — Bundles 10–21 shipped)

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

**Phase 25 PixiJS hybrid 重構 — Bundles 10-21 完成全 Tier 1A oldSrc port + capability matrix (cursor/dim/hover gating) + undo/redo + marquee 跨層 + tray snap helpers + cable riser feature。剩 perf shader (31-4/5/6) 跟 3D viewer 沒做。**

commits（最新在上）：
```
bd35992  Bundle 21 — Cable Riser feature (risersLayer + RiserPanel + dragOverlay slot)
5491532  Bundle 20 — DRAW_CABLE_TRAY snap helpers (wallEndpoint/Segment/parallel)
69779b0  Bundle 19 — Marquee multi-type hits (oldSrc collectMarqueeHits port)
41d6a8c  Bundle 19.1 — Toolbar comment refresh
39a25a9  Bundle 18 — Real Undo/Redo (oldSrc useHistoryStore port + Ctrl+Z wiring)
fd65e39  Bundle 17 — modeCapabilities matrix + cursor + dimOthers
f60214b  Bundle 16 — LMB select only in SELECT mode (capability parity)
7d19565  Bundle 13 — Revert floor image to non-interactive (fix can't-draw-over-image)
9bdbd7f  Bundle 12 — Esc fully exits draw/place mode
47f6f22  Bundle 15 — Fix handle drag interrupted by hover-triggered rebuild
e63e85e  Bundle 14 — Tray vertex drag overlay (fix destroy-during-drag crash)
ccc34ad  Bundle 11 — Tray hit-context menu (split/extend/merge/convert)
436389b  Bundle 10e — Fix RMB on object B while A's menu open closes everything
f61cee0  Bundle 10d — Fix RMB menu instant-close from same-gesture mousedown
6dc9fd5  Bundle 10c — DRAW_CABLE_TRAY draft UI + scope/hole/image right-click
ec36914  Bundle 10b — Strict oldSrc port: Cable / Scope / Tray
4b73884  Bundle 10a — Strict oldSrc port: AP / Switch / Wall / endpoint handles
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

### Bundle 10 新增 (2026-05-26, autonomous session 1)

✅ **Tier 1A AP layer 嚴格 port**：focus halo radius 15 / azimuth 0=+x convention / dashed directional selected ring / `patternPolygonPoints` custom 天線 / orientation arrow group / name label 改 ABOVE body / info pill width 80 + y 19
✅ **Tier 1A Switch layer 嚴格 port**：chassis roundRect / 刪自編 status LED / 補 PoE badge yellow line / port pip square Rect + 對齊公式 / status dot 2.8 / warning 5+'!'fs7 / kind label top of chassis / name label 改 ABOVE
✅ **Tier 1A Wall layer 嚴格 port**：hover 白 beam 22px alpha 0.45 + black halo 10/7/4 by state + body 6/5/3 + opening color 改 OPENING_TYPES (door brown / window blue) + width 6/8/6
✅ **Tier 1A Wall endpoint handles**：radius 7 / strokeWidth 2.5 / show on isSelected||isHovered / snap-to-endpoint during drag (SNAP_PX=12) / double-click extend → DRAW_WALL
✅ **Tier 1A Cable layer 嚴格 port**：inverse-scale 全套 widths + dashes / S2S switch link 完整 (purple copper + rose fiber + node markers) / tray node markers (foot/riser-foot/riser@floor) / fallback elbow marker / unroutable badge 完整 (fill+!)+stroke
✅ **Tier 1A Scope layer 嚴格 port**：per-scope Container w/ point-in-polygon hit-test / hover fill alpha 0.18→0.5 / 改成 interactive
✅ **Tier 1A Tray layer 嚴格 port**：closed polygon w/ semicircle caps + miter joints (offsetPolyline + buildChannelPolygon) / 2-tray junction detect (computeTrayNeighborExts) / inverse-scale 全套 / 刪 always-on vertex dots / hover invert 完整
✅ **DRAW_CABLE_TRAY 繪製 UI**：draftOverlayLayer 改 per-mode；tray draft 完整 port DraftTray
✅ **右鍵 context menu 覆蓋**：Scope / FloorHole / FloorImage 都接好 button===2

### Bundles 10d–16 (2026-05-27 早段, 互動 race fixes)

✅ **Bundle 10d / 10e**：RMB menu 自我關閉的 timing bug — outside-click listener 加 rAF 延後 + button===2 短路
✅ **Bundle 11**：Tray hit-context menu 完整 (segment 切割 / endpoint 延伸 + 合併 / 轉換系統 submenu)
✅ **Bundle 12**：Esc 完全退出 draw/place 模式 (清 draft + setEditorMode(SELECT))
✅ **Bundle 13**：Floor image 改回 `eventMode='none'` — 修「DRAW_SCOPE 不能在底圖上點」
✅ **Bundle 14 / 15**：Tray vertex drag dragOverlay 改寫 + handlesLayer `isDragging` flag (修拖一點就卡)
✅ **Bundle 16**：LMB 只在 SELECT mode 才 setSelected (oldSrc allowSelectClick capability)

### Bundles 17–21 (2026-05-27 晚段, autonomous session 2)

✅ **Bundle 17 — modeCapabilities matrix**：完整 port oldSrc capability 系統 (14 mode × 9 flag)；新 `src/render/modeCapabilities.js` + `modeAdapter.js`；layers 改用 `cap.allowSelectClick`/`allowSelectHover`/`allowCommandHover`/`showMagnet`；cursor + `dimOthers` 跟 mode 走（draw 模式 AP/SW/tray dim 0.4 等）
✅ **Bundle 18 — Undo/Redo**：完整 port `useHistoryStore` 雪花機制 (debounce 300ms + idle commit)；Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 鍵盤 shortcut；Toolbar undo/redo 按鈕自動啟用
✅ **Bundle 19 — Marquee 跨層**：完整 port oldSrc `collectMarqueeHits`；wall / scope / floorHole / switch / tray / riser 全可框；Delete 批次刪除所有類型；尊重 layer visibility 開關
✅ **Bundle 20 — DRAW_CABLE_TRAY snap helpers**：完整 port oldSrc 20-3 — shift angle lock / tray vertex snap / wall endpoint 橘環 / wall segment 橘方 / parallel wall 紫色 guide
✅ **Bundle 21 — Cable Riser feature**：完整 feature port — `risersLayer.js` + `RiserPanel.jsx` + dragOverlay slot + ContextMenuMount cable_riser case + PanelRight 路由

---

## 3. **未完成** backlog

### F. Phase 25 perf shader (核心 — 1000 AP 規格)

❌ **31-4 Walls Mesh + line shader** — 2-3 天，技術風險最高
❌ **31-5 Cables Mesh + dashed line shader** — 2-3 天
❌ **31-6 AP markers texture atlas** — 2 天
❌ **31-9 Scopes/FloorHoles R-tree** — 1 天
❌ **31-10 Stage event router + R-tree + uniform grid** — 2 天
❌ **31-11 SDF text atlas + ticker animation** — 2-3 天
❌ **31-12 1000 AP 壓力測試 + diff 8 場景** — 2 天
❌ **31-13 刪除 `oldSrc/`** — 0.5 天

合計 ~15 天。**沒這部分 Phase 25 不算 ship**。

### H. 3D Viewer

❌ TopBar 3D toggle 目前 disabled；oldSrc 有完整 Viewer3D 用 `@react-three/fiber 7.0.29`。整套沒做。估 5-7 天。

### Workflow gaps (小)

- AutoPowerModal（Sidebar 自動規劃 button stub）
- PNG 匯出（Sidebar floor menu 沒此項）
- AI walls modal（從底圖辨識牆）
- Crop image mode
- DRAW_SCALE → ScaleDialog wiring 沒完整測
- Auto-channel on place（已 port `autoChannelPlan.js` + apModels，沒接 placement）

### Audit polish (小, 大多是 feature 沒做不是 polish)

- E3 CableSummaryPanel BOM 細分 + CSV/PDF export — 從 119 → 598 LoC
- F7 FloorImage crop / rotation / opacity / align transform — full feature
- B1 `floor_image` / `floor_align` panel route（占位中）

### G. Phase 26（條件式）

32-0 量測 baseline + 32-C 增量 routing（看量測結果決定）

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

Bundles 17-21 完成後剩餘的依嚴重度排序：

1. **Phase 25 perf shader 31-4 walls** — 2-3 天，技術風險最高。**沒這個 Phase 25 不算 ship**（1000 AP 規格）
2. **Phase 25 perf shader 31-5 cables / 31-6 AP atlas** — 4-5 天，接 31-4 之後
3. **Workflow gaps 小項**：AutoPowerModal / PNG export / Auto-channel on place — 1-2 天
4. **CableSummaryPanel BOM 完整版** — 0.5-1 天（純 UI work）
5. **FloorImage 修圖工具**（crop / rotation / opacity / align transform）— 1-2 天
6. **AI walls modal** — 1 天（OpenCV.js + worker 已 port，要接 UI）
7. **3D Viewer** — 5-7 天，最後做

**永遠記住**：不要動 oldSrc / 不要重設計 / grep oldSrc 抓常數 / MCP 並排對照 / commit message 標 oldSrc 出處。

Bundle 10-21 commit 範例可參考標的 — 每個視覺常數變更都標明 oldSrc 對應行號。

---

## 7. 跨機器開發

User 跨多台機器。**所有 durable 決策 / 進度 / 規則寫在 `.claude/*.md`**（隨 repo 走），不只 memory。Memory 是 hint，repo doc 是 canonical。
