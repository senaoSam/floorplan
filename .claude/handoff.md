# Session Handoff — 2026-05-25 (Phase 25 PixiJS hybrid — well underway)

> Session continuation pack。新 session 讀這份 + `task.md` + `layer-architecture-spec.md` 就能接續。
>
> Phase 24 已 ship。Phase 25 PixiJS hybrid 已連續推進 11 個 commit，視覺 / 互動已大致對齊 oldSrc，PIXI shader 重寫（spec 31-4 / 31-5）尚未動。

---

## 1. 現況一句話

**Phase 25 已連續完成 11 commit。整個 PIXI scaffold + 8 個 layer adapter (floor / wall / AP / switch / tray / cable / scope / hole + heatmap) + 完整互動 (click / drag / right-click menu / hover / marquee) + 視覺 chrome (Toolbar / LayerToggle / RegulatorySelector / ScaleBar / HeatmapControl + Legend + 讀數 / CableSummary / ActiveModeBadge) 全部到位。**

下一步：**Bundle 視 user 指示** —— Phase 25 spec 真正硬骨頭（31-4 walls shader、31-5 cables shader、31-6 AP sprite atlas）尚未開始；視覺 polish 還有 ProgressPanel / FormulaNote / AI walls / history 沒做。

---

## 2. 目標規格（驅動所有後續決策）

| 元素 | 數量 |
|---|---|
| AP | 1000+ |
| Walls | 5000+ |
| Switch / IDF / MDF / Router | 100+ |
| Cable Tray | 50+ |
| Cable routes（衍生）| ~1000，segment ~30000 |
| Heatmap | real-time recompute |
| **FPS** | **30–60 fps** |

Phase 25 MVP 已能跑 demo（5 AP / 45 wall / 1 SW / 1 tray）但**尚未壓力測試到 1000 AP**。31-4 / 31-5 shader 是達標關鍵。

---

## 3. Phase 25 commit 歷史（reverse chronological）

| commit | 內容 |
|---|---|
| `125428e` | HeatmapLegend + hover readout (RSSI/SINR/SNR/CCI 即時讀數) + AP info pill (showAPInfo) + ConfirmDialog port |
| `712d900` | ActiveModeBadge + RegulatorySelector + ScaleBar + Scopes + FloorHoles + switchKind filter |
| `11b79c4` | Toolbar (14 mode icon strip) + LayerToggle + Icon set + StressLoader + chassis port row + tray channel 17-1 + AP name labels + cable dash variants (copper/fiber/fallback) + PLACE_AP/SWITCH/RISER 模式 |
| `94b0564` | Hover state + 右鍵 ObjectContextMenu + marquee 多選 |
| `1a69657` | Switch + Tray + Wall click/drag/delete + 對應 panel |
| `6d0c3ff` | AP click/drag/delete + APPanel + selectionOverlay + Esc/Delete keyboard |
| `3b5337d` | Switches + Trays + Cables MVP（Graphics + computeRoutes）+ CableSummaryPanel |
| `9839e3e` | HeatmapControl 從右下 → 左下 pill row（match oldSrc layout） |
| `5bdcb08` | App shell port: TopBar + SidebarLeft + CanvasArea + PanelRight |
| `5009420` | Heatmap adapter — raw WebGL2 canvas → PIXI.Sprite |
| `4a53405` | Walls + AP markers MVP (Graphics) |
| `78154c7` | Floor image adapter + minimal DemoLoader |
| `d4c1d2a` | PIXI Application + 12-layer Container + viewport + Zustand wiring |
| `d1c6451` | src→oldSrc migration + minimal PixiJS scaffold |

---

## 4. 已 ship 的能力

### 視覺
- 全套 oldSrc layout：TopBar / SidebarLeft / CanvasArea / PanelRight 都對齊位置
- 5 個 floating widgets：Toolbar (top-center) / LayerToggle + RegulatorySelector (top-left) / ActiveModeBadge (under toolbar) / HeatmapControl + CableSummary (bottom-left, pill row) / ScaleBar (bottom-right)
- 物件視覺：switch chassis 含 port row + kind decoration；tray channel style 17-1（parallel borders + dashed centerline + body fill）；AP 含 name label + frequency band + info pill；cable 含 fiber 長 dash / copper 實線 / fallback 短 dash
- Scope + FloorHole 可渲染（in/out 綠紅、hole 紅虛線）
- HeatmapLegend 跟著 mode 切換 colormap，hover readout 顯示 RSSI/SINR/SNR/CCI 即時數值

### 互動
- 4 個物件類型 (AP / Switch / Tray / Wall) 全部支援 click select / drag / right-click menu / hover outline
- Marquee 多選（目前只 AP，wall/tray/switch 等 31-10 spatial index 補）
- Esc / Delete 鍵盤（含 batch delete）
- PLACE_AP / PLACE_SWITCH / PLACE_RISER 模式 click-to-place
- LayerToggle per-layer + per-band AP + per-kind Switch 過濾
- Heatmap mode 切換（RSSI / SINR / SNR / CCI）+ engine / drag mode / sliders 全可調

### 規格 spec 對應（task.md Phase 25 Layer 31）
- 31-0 ~ 31-3 ✅
- 31-4 / 31-5 / 31-6 → 都用 `-mvp` 變體先到位（Graphics-based）
- 31-7-mvp / 31-8-mvp ✅
- 31-9 (Scopes/Holes) ✅
- 31-10 (互動 + spatial index) → 互動 ✅、spatial index 還是 O(n) 暴力 hit-test
- 31-11 (SDF text + animation) → 用 PIXI.Text，SDF 還沒做；無 animation
- 31-12 (validation) → 部分（MCP end-to-end 都跑過，正式 perf harness 沒）
- 31-13 (廢棄 oldSrc) → ⬜ 還沒

---

## 5. 還沒做的清單（給下一個 session 排優先）

### Visual polish（小，1 個 bundle 可清）
- ProgressPanel（phase 進度 pill，左下 fixed）
- FormulaNote（heatmap 公式說明 popover，HeatmapControl 設定 panel 內）
- AI walls modal（從底圖辨識牆）— 需要 useAIPreviewStore + opencv
- DemoLoader 自動 enable LayerToggle 預設展開？視 UX 決定

### Interaction follow-ups（中，1-2 個 bundle）
- Wall endpoint drag（需 handles，跟 31-4 shader 一起）
- Tray vertex edit（18-x，handles）
- Multi-select marquee 擴到 wall / switch / tray（spatial test）
- Snap helpers（snap to wall / parallel wall / angle lock — 20-3）
- Auto-channel on place（要 port autoChannelPlan + apModels + channelWidths constants）
- Wall draw（DRAW_WALL multi-click）/ Scope draw (DRAW_SCOPE polygon) / Tray draw（DRAW_CABLE_TRAY polyline）
- Cropping / floor align 對應 mode 進場

### Perf spec hard work（大，3-4 個 bundle）
- **31-4 walls shader** — PIXI.Mesh + 自寫 GLSL line shader（quad expand + screen-space width + AA + per-material color + hoverWallId uniform + opening sub-segments）
- **31-5 cables shader** — 同 walls + dashed pattern (screen-space distance) + multi-color
- **31-6 AP sprite atlas** — texture atlas + 1 draw call for 1000 APs
- R-tree / uniform grid spatial index for hit-test
- SDF/MSDF text atlas（取代 PIXI.Text）
- Tile-based heatmap with AP data texture + dirty tile update

### Phase 26 條件式（量測後決定）
- Phase 24 凍結 cable 解凍（heatmap 即時 follow drag）
- 增量 routing（per-AP single-source Dijkstra）

### oldSrc 廢棄
- 視覺 + 互動 8 場景 diff 確認 oldSrc 無剩餘參照後刪除整個 oldSrc/

---

## 6. 重要踩坑筆記（已寫進 playwright-mcp-notes.md）

- **HMR module instance split**：`await import()` 跟 callback closure 的 useStore 可能是不同 instance。Phase 25 起 FloorplanSystem 在 DEV mode 暴露 `window.__stores = { editor, floor, ap, wall, cable, heatmap, viewport, drag, hover, scope, hole, hoverReadout }` —— MCP eval 一律讀 `window.__stores.xxx` 那份。
- **PIXI v8 CanvasSource 不自動 resize**：heatmap canvas 改尺寸後要明確 `texture.source.resize(canvas.width, canvas.height)` 才會在 GPU 看到新尺寸。
- **PIXI federated events**：viewport 改用 stage.on('pointerdown')，layer 上 children call `e.stopPropagation()` 才能蓋過 pan。canvas.addEventListener 跟 stage 同時 fire 順序不可靠。

---

## 7. 規格目標 vs 現狀（perf）

| Metric | 規格 | 目前 demo (5 AP) | 1000 AP 預估 |
|---|---|---|---|
| Idle FPS | ≥ 30 | 60 | 未測 |
| Drag AP | ≥ 30 | 60 | 未測 |
| Heatmap recompute | smooth | 100-300ms (5 AP shader) | 估 1-3s（不可接受，要 tile-based） |
| Wall draw call | 1 (shader 後) | N (Graphics, 每 wall 1) | 5000 個 Graphics — 預估嚴重慢 |
| Cable draw call | 1 (shader 後) | N×dash segs | ~30000 segs / dash — 預估嚴重慢 |
| AP draw call | 1 (atlas 後) | N (per-AP Container + 3 Text) | 1000 個 Container + 3000 Text — 嚴重慢 |

**結論**：MVP 已能跑 demo 完整流程，但壓力測試 1000 AP / 5000 wall 一定爆。spec 規格達標仍要 31-4 / 31-5 / 31-6 shader 重寫。

---

## 8. 跨機器開發

User 跨多台機器。所有 durable 決策 / 進度寫在 `.claude/*.md`（隨 repo 走），不只 memory。Memory 是 hint，repo doc 是 canonical。
