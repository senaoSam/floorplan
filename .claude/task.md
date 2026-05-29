# Floorplan Planner — 任務進度（精簡版）

> 設計依據：`.claude/cable-spec.md`、`.claude/layer-architecture-spec.md`
> Progress panel 同步：`src/components/ProgressPanel/ProgressPanel.jsx`
>
> 本檔只列 **還沒做的事** + **已撤回的決策（防重做）**。
> 已完成項目的細節交給 git log（commit message 標明 oldSrc 出處）。

---

## 現況一句話

**Phase 25 PixiJS hybrid 重構 — 純功能對等已完成（Bundle 52「closes pure-feature parity gap」）。**
oldSrc 的功能（AP / Wall / Switch / Tray / Scope / Riser / Cable / Heatmap / 3D viewer / Crop / Align / Scale / Undo-Redo / Marquee / AI walls / AutoPower / PNG·CSV·PDF export / BOM）都已 port 到新 `src`。
**剩下的是「達到 1000 AP 規格的效能實作」+ 驗收。**

---

## 還沒做的事

### Phase 25 收尾 — 達 1000 AP 規格（核心）

> MVP 版功能都在，但渲染/互動是 Graphics + 線性掃描，還沒換成達標的高效能實作。

| #     | 狀態 | Task | 估時 |
|-------|------|------|------|
| 31-5  | ⬜   | **Cables Mesh + dashed line shader** — 取代 MVP polyline；screen-space dash + per-route color/dash semantics + focus halo 2nd pass；`eventMode='none'`。技術風險最高，建議早做 | 2-3 天 |
| 31-6  | ⬜   | **AP markers texture atlas** — PIXI.Sprite + atlas，1000 AP batch 1 draw call；frequency color / direction 透過 frame 或 tint；uniform grid hit-test | 2 天 |
| 31-9  | ⬜   | **Scopes / FloorHoles / RefWall / RefVector spatial index** — 視覺已有，補 R-tree of AABBs hit-test | 1 天 |
| 31-10 | ⬜   | **Interactions + Spatial index** — Stage-level pointer router；R-tree（walls/trays/scopes）+ uniform grid（AP/SW/Riser）；marquee 框選走 spatial query；mode capability 動態 listening | 2 天 |
| 31-11 | ⬜   | **Overlays + SDF text + Animation** — SDF/MSDF text atlas（AP/SW/Tray label，禁大量用 PIXI.Text）；`app.ticker` + 手寫 ease util（focus pulse / selection grow-in / hover transition） | 2-3 天 |
| 31-12 | ⬜   | **Validation** — 1000 AP / 5000 walls / 30000 cable segments 壓測；8 場景視覺 diff < 5%；4 互動 regression（click/hover/右鍵/drag）；context-loss/restore 測試；perf harness 跑 p50/p95/p99 | 2 天 |
| 31-13 | ⏸️ 暫緩 | **刪除 `oldSrc/`** — 使用者決定：保留 oldSrc 作參考，直到正式上線穩定後才刪。**現階段不做** | 0.5 天 |

**驗收標準（Phase 25 ship）**
- [ ] 1000 AP / 5000 walls / 30000 cable segments / 1000+ labels idle FPS ≥ 30
- [ ] AP drag / Wall drag / Pan / Zoom 操作 FPS ≥ 30
- [ ] Heatmap dirty tile update 流暢（FPS ≥ 30 during drag）
- [ ] 視覺對比 oldSrc 8 場景 diff < 5%
- [ ] 4 互動 regression 全 pass + Context loss/restore 仍 work
- [ ] GPU memory < 200 MB / Cold-start first render < 3s / Bundle 增量 < 500 KB gzip
- [ ] 主產品整合接口（`<FloorplanSystem buildingData onSave>`）不變

### Phase 26 — Real-time cable follow（條件式，Phase 25 收尾後重評）

> Phase 24 凍結 cable 是 Konva 妥協。PixiJS 落地後渲染成本接近零，是否解凍 + 是否要增量 routing 取決於量測。

| #    | 狀態 | Task |
|------|------|------|
| 32-0 | ✅   | **量測** — `computeRoutes` wall-clock @ 50/150/300/500/1000 AP × {0,1,5,10} tray，已記到 `perf-baseline.md §32-0`。真因：每 pointermove 對全部 AP 跑 Dijkstra（1000 AP / 1 tray = 94ms） |
| 32-D | ⏸️ 不採用 | **解凍 cable** — 改走 32-C 增量（保留即時精確跟隨）。tray/trayVertex drag 仍凍結（32-C 範圍決策） |
| 32-C | 🟡 部分 | **增量 routing** — ✅ 拖 AP/SW 只重算動到的路徑（`buildRoutingContext`+`routeOneAP`+`routeOneSwitchLink`，full↔inc byte-identical 已驗）。routing 成本 214ms→1ms（300AP）。**剩第二瓶頸**：cable Graphics 每幀重送（300AP ~8880 段，hover/重繪即卡）— 另開 32-E |
| 32-E | ✅   | **Cable 畫圖效能 — 軟體渲染也達標**。量測推翻多個假設（idle 連續 render、cable 每幀重 raster、selection/drag 多處全量 computeRoutes）。五刀：①render-on-demand（停連續 ticker，store→requestRender，idle 60→0 render/s）②cacheAsTexture on gStatic（cable 背景烤貼圖，hover/drag-move 每幀 ~120ms→~9ms）③apsLayer 逐 AP identity diff（drag commit 重畫 1 marker 非 300：99→1.6ms）④routesCache 增量 + 共享（focus/panel 單顆 AP 變只重算那顆，選取 2-3秒→2-22ms）⑤靜動分層 + drag 期不 invalidateStatic（拖曳每幀 3-13ms，dragEnd append）。300AP+SW+tray：軟體渲染 hover/drag/select 全順，剩 drag 開始/結束各 ~105ms（單張快取貼圖固有，可接受）。routing identity 88/0、視覺無回歸（已對 stash 前後比對）。詳見 perf-baseline.md §32-E |

### 其他小尾巴

| #    | 狀態 | Task |
|------|------|------|
| 26-3 | ⬜   | Phase 20 bench 結果補記到 `perf-baseline.md`（before/after FPS + frame time） |
| 27-1 | ⬜   | Heatmap polish audit — 列已知熱圖 bug/視覺缺陷寫成 `.claude/heatmap-audit.md` |
| 27-2 | ⬜   | 依 audit 動手：hover readout 精度 + contour antialiasing + colormap 國際標/自訂 toggle |

---

## 已完成（細節見 git log）

| Phase | 範圍 |
|-------|------|
| 7–8   | Cable 基礎建設：Switch/IDF/MDF、AP↔SW routing、Cable Tray/Riser graph、PoE/port 容量、Cable Summary BOM + warnings |
| 10–11 | S2S routing、BOM 分類、3D cable 視覺、Tray 通道風格 + 選取上下文 + switch hub snap |
| 12–14 | Tray 編輯（vertex/drag/naming）、工程屬性（kind/mount/system/capacity）、Planning BOM、context menu、CSV/PDF/PNG export |
| 17    | Mode capability matrix + 左右鍵分工（左鍵=操作物件、右鍵=指令選單） |
| 18    | UI 分群、Toolbar 浮動 panel、PanelShell 共用框架、active mode badge、color-legend |
| 23    | Switch kind 差異化（access/IDF/MDF/router default + 階層 enforcement + routing 偏好 + BOM 細分 + 視覺） |
| 20    | 效能：APMarker memo、HeatmapLayer fingerprint skip、HM drag solo、CableLayer drag freeze、APLayer imperative Konva |
| 22    | 3D 強化：AP label sprite、樓層切換 UI、camera presets、hover readout |
| 24    | Konva layer 拆分 + Tray drag overlay（解 SW+Tray+50AP 拖曳卡頓） |
| 25 (Bundle 1–52) | PixiJS hybrid 全功能 port：scene/viewport/store wiring + 全物件 layer + heatmap + 3D viewer + crop + align + scale + undo/redo + marquee + snap + AI walls + AutoPower + export + BOM |
| 25 (parity) | Heatmap PIXI↔Konva 等高線對齊：heatmapAdapter 無條件建 crossFloor（移除 `length>1` 守衛），單樓層也走 3D 幾何路徑，canvas 與 oldSrc byte-identical（MCP 驗證 checksum 2469578956） |

---

## 已撤回的決策（防重做，不要再提案）

| ID | 撤回理由 |
|----|----------|
| 12-4 Hybrid routing | 17-3 switch hub 落地後痛點消失，沒人抱怨 |
| 21-1 Vertical tray / conduit | Hamina 無此物件；Riser 已涵蓋跨樓層垂直走線；conduit 無實際 routing 價值（AP/SW 不 snap、dz 不進 BOM） |
| 21-2 / 21-3 Zone box | TIA-568 consolidation point 用在有線工位 cabling，不是 AP planning；分散需求已由 IDF/MDF + uplinkTo 涵蓋；Hamina 也沒做 |
| 22-3b SVG export | Konva 無內建 SVG renderer（自製 ~10× 工程）；PNG + PDF 已覆蓋 95% 情境 |
| 22-4 DXF export | AutoCAD 交付在純 AP planner 工作流外；交付 PDF + PNG 已足夠；Hamina 也沒做 |
| Phase 19 Auto IDF | IDF 真實選位是空間語意（弱電間/機房），非幾何最佳化；本工具無房間模型；候選點只能 snap tray vertex 太死板。**使用者再次確認不必要** |
| 26-2-P4 CableLayer imperative Konva | 視覺 ~1% pixel diff（dash phase/AA 對不上）+ 無效能改善；瓶頸位置跟 APLayer 不同 |
| 30-3 ~ 30-7 Konva 多層拆分 | react-konva 環境做會白工；架構決策融入 Phase 25 PixiJS Container 階層 |
| 31-4 Wall Mesh + line shader | 5000 wall 對 GPU 是 trivial 量級，Graphics + batching 撐得到；shader 維護成本高（GLSL/WGSL 雙寫）；31-4-mvp Graphics 版即最終版，日後實測卡頓再重啟 |

---

## Design Principles（後續所有 phase 都遵守）

| 主題 | 原則 |
|---|---|
| **3D = read-only** | Z 軸屬性（mountHeight/kind…）一律在 **2D panel 編輯**；3D 只負責高度視覺化，不開放 3D 拖曳/畫線 |
| **Capacity rule** | tray fill 用 `capacityProfile`（25% planning / 40% warning / custom），**不**寫死「NEC 40%」 |
| **Color legend** | tray 顏色用 owner / company / discipline standard，不綁地區法規 |
| **垂直走線只用 Riser** | 跨樓層 / 同樓層垂直需求都靠 Riser；不另做 vertical tray / conduit 物件 |
| **BOM = Planning BOM** | 算的是 planning estimate（tray 長、彎頭、AP cable），**不是**施工 final BOM |
| **Warning ≠ Code violation** | 容量提示寫「exceeds selected fill rule」，不寫「code violation」 |

---

## 嚴格重構規則（Phase 25 期間，未刪 oldSrc 前一直適用）

**這是「重構」不是「改寫」不是「重設計」。**
- 一切 **顏色 / 大小 / 角度 / 寬度 / alpha / dash / hover 位置 / cursor / 文案 / spacing / radius / icon / 字級** 嚴格照 oldSrc
- 絕對不要自選、自編、自加、自優化
- 不確定就 **MCP 並排**（`pnpm dev:oldsrc` on 5180）對照 + grep `oldSrc/...` 抓常數
- commit message 標明每個數值的 oldSrc 出處
