# Floorplan Planner — 任務進度（精簡版）

> 設計依據：`.claude/cable-spec.md`、`.claude/layer-architecture-spec.md`
> Progress panel 同步：`src/components/ProgressPanel/ProgressPanel.jsx`
>
> 本檔只列 **還沒做的事** + **已撤回的決策（防重做）**。
> 已完成項目的細節交給 git log（commit message 標明 oldSrc 出處）。

---

## 現況一句話

**Phase 25 PixiJS hybrid 重構 — 功能 parity gaps 已補完（853eeef）+ 1000 AP 效能家族經量測全部暫緩（2026-06-01）。MVP 實作在單層真實量級已達標，剩 heatmap polish + 文件小尾巴。**
oldSrc 的功能（AP / Wall / Switch / Tray / Scope / Riser / Cable / Heatmap / 3D viewer / Crop / Align / Scale / Undo-Redo / Marquee / AI walls / AutoPower / PNG·CSV·PDF export / BOM）皆已 port 到新 `src`。2026-05-30 審計的 parity gap 已在 853eeef 補回；31-5/6/9/10/11 效能優化經 2026-06-01 壓測證明單層真實場景不需要（見下表 + perf-baseline §31-12）。
**剩下的是 heatmap polish（27-1/27-2）+ 文件補記（26-3）。**

### Parity gaps（2026-05-30 workflow 審計，oldSrc vs current，已對抗式驗證）

> 細節 + oldSrc 出處見 memory `project_konva_pixi_parity_gaps`。

| 狀態 | Gap | 嚴重度 |
|------|-----|--------|
| ✅ 已修 | Scope/Hole 點回起點閉合（保留畫3點顯示閉合圈） | missing |
| ✅ 已修 | 繪製途中 Backspace 退一步（Tray/Scope/Hole 退頂點、Wall 退上一段）；Ctrl+Z 維持全域 undo | missing |
| ✅ 已修 853eeef | BatchPanel 批次編輯整組消失（只剩計數 stub）→ per-type 編輯器 1:1 port oldSrc（wall/AP/scope + delete-all + AutoPower 鈕） | missing |
| ✅ 已修 853eeef | 中庭(floor-holes)圖層開關在 2D 失效 → 改畫進 scene.layers.floorHoles，binder 補 `['showFloorHoles','floorHoles']` key | missing |
| ✅ 已修 853eeef | 右鍵刪除無條件清空選取 → 補 clearIfTargetSelected（只在刪到的物件 == 當前選取時才清） | partial |
| ✅ 已修 853eeef | Tray 頂點 hover × 刪單一頂點 → handlesLayer × badge + 放大 hit region | missing |
| ✅ 已修 853eeef | Tray 頂點 Shift+click 就地切割 → onSplitVertex | partial |
| ✅ 已修 853eeef | ALIGN_FLOOR 切 toolbar 工具無確認對話框 → Toolbar + ConfirmDialog（portal 置中） | missing |
| ✅ 已修 853eeef | PNG 平面圖匯出 production 壞 → 新增 render/sceneRegistry.js（全 build mode 註冊），SidebarLeft 改用 getSceneRefs() 取代 DEV-only globals | partial |
| ✅ 已修 853eeef | PDF 規劃報告匯出 production 壞 → 同上（getSceneRefs） | partial |
| ✅ 已修 853eeef | 多選 highlight + Ctrl/Cmd+click 加選 → 復原 toggleSelectedItem，每個物件 layer 訂閱 selectedItems 重畫 | missing |
| ✅ 已修 | Heatmap dragMode(Solo/Live)：restore 853eeef(完整 live/solo，預設 solo=old)。先前「無硬體加速拖曳卡」真因經使用者實測=缺 rAF 節流(apsLayer setAP)+缺 setTimeout defer(heatmapAdapter compute)，非 gl.render。兩刀對齊 old，6 場景 old↔now dragend 對齊。詳見 memory `project_heatmap_drag_lag_softwarerender` | partial |
| ⏸️ 使用者不做 | #/vectorize 獨立頁、Gemini 清理圖預覽鈕、#/ai-walls-debug OpenCV 頁 | — |

---

## 還沒做的事

### Phase 25 收尾 — 1000 AP headroom 效能家族（全部已量測暫緩）

> **2026-06-01 MCP 壓測結論：整個 31-5/6/9/10/11 效能家族全部暫緩。**
> 實測證明單層真實 AP 量級（~300）下 MVP 實作全部達標；瓶頸只在 1000 AP 出現，
> 而本工具是「單層 active floor」在編輯（對標 Hamina），真實單層 AP 數 20-200、到不了 1000。
> 全部共用同一重啟扳機：**單層 active floor >500 AP 真實需求 + 實測 pan/zoom 卡**。
> 完整量測 + 重啟條件見 `perf-baseline.md §31-12`、memory `project_31_5_6_deferred_1000ap_benchmark`。

| #     | 狀態 | Task | 估時 |
|-------|------|------|------|
| 31-5  | ⏸️ 暫緩 | **Cables Mesh + dashed line shader** — 取代 MVP polyline。**2026-06-01 壓測（perf-baseline §31-12）決定暫緩**：31-5 原想解的 drag 瓶頸 32-E 已解（drag-move 5-7ms）；唯一未達標的 pan/zoom（1000 AP ~20fps，cable 是主瓶頸 ~140ms）只在 1000 AP 出現，而單層平面圖真實 AP 數 ~300 以下已全順。與已撤回的 31-4 同構（Graphics 撐得到、shader 雙寫維護高）。**重啟扳機**：單層 active floor >500 AP 真實需求 + pan/zoom 卡 | 2-3 天 |
| 31-6  | ⏸️ 暫緩 | **AP markers texture atlas** — 1000 AP batch 1 draw call。同 31-5 屬「1000 AP headroom」產物；壓測顯示 AP layer（1000 children）對 pan 影響 ~18ms（次於 cable）。單層真實 AP 數到不了 1000，暫緩。重啟扳機同 31-5 | 2 天 |
| 31-9  | ⏸️ 暫緩 | **Scopes / FloorHoles / RefWall / RefVector spatial index** — R-tree hit-test。**2026-06-01 量測（perf-baseline §31-12）決定暫緩**：hit-test 走 PIXI 原生 `rootBoundary.hitTest`（非自寫線性掃描），1000 AP 單次仍只 75µs（佔 60fps 預算 0.45%），使用者無感。過度工程，重啟扳機同 31-5 | 1 天 |
| 31-10 | ⏸️ 暫緩 | **Interactions + Spatial index** — R-tree/uniform grid + marquee spatial query。同 31-9：PIXI 原生 hit-test 已足夠（300AP 26µs / 1000AP 75µs）。暫緩，重啟扳機同 31-5 | 2 天 |
| 31-11 | ⏸️ 暫緩 | **Overlays + SDF text + Animation** — SDF text atlas + ticker ease。**量測決定暫緩**：1000 AP 確有 3000 PIXI.Text，但 showAPInfo 開/關 frame time 幾乎不變（Text texture render 完即 cache，pan 不重繪）。SDF 對 pan/idle 效能無幫助；單層真實場景碰不到記憶體上限。重啟扳機同 31-5 | 2-3 天 |
| 31-12 | 🟢 縮減 | **Validation** — 縮減為「已記錄基準」。31-5/6/9/10/11 全暫緩後無新實作需完整驗收。1000 AP 基準已記在 perf-baseline §31-12；完整 8 場景 diff / context-loss 待真有 ship 需求再啟 | 2 天 |
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
| 32-C | ✅   | **增量 routing** — ✅ 拖 AP/SW 只重算動到的路徑（`buildRoutingContext`+`routeOneAP`+`routeOneSwitchLink`，full↔inc byte-identical 已驗）。routing 成本 214ms→1ms（300AP）。第二瓶頸（cable Graphics 每幀重送）由 32-E 解決 |
| 32-E | ✅   | **Cable 畫圖效能 — 軟體渲染也達標**（vector，非烤貼圖）。最終四刀：①render-on-demand（停連續 ticker，13 store→requestRender，idle 60→0 render/s）②靜動分層 gStatic/gDynamic（拖曳凍結 gStatic、PIXI 重畫凍結幾何 ~1ms 不重 tessellate——這才是真解）③routesCache 增量+共享（單顆 AP 變只重算那顆，選取 2-3秒→ms 級）④apsLayer 逐 AP diff（drag commit 重畫 1 marker 非 300）。**cacheAsTexture 試過但移除**（a33dc14：模糊/變暗一串 bug + 靜動分層已使其多餘）。另修 SW↔tray snap stub（477887d）、focus+拖曳殘影（3f9a3f6）。routing 88/0。**殘影回歸已驗證消除**（2026-06-01 MCP）：6 高風險情境（含選 SW 多條前景、marquee 多選、拖曳後切選取）用量化探針（gStatic/gDynamic instruction 數 + staticDim.alpha）跑 10 步全 pass——focus↔無focus 不變量從不混雜。詳見 perf-baseline.md §32-E + memory `project_cable_render_architecture_32e` |

### Phase 33 — Client View / Client Experience（討論定案，待實作）

> 對標 Hamina「Client experience / Client view」。完整設計共識見 `.claude/client-view-spec.md`。
> 引擎核心 `probeAt`（hoverProbe.js）已存在，主要工作量在互動層＋面板＋裝置 profile＋MCS 表。

| #    | 狀態 | Task |
|------|------|------|
| 33-0 | ✅   | 研究 Hamina + 推測用處 + 與使用者討論定案（範圍＝完整版、漫遊＝hysteresis、裝置＝手寫 mock）。共識寫進 `.claude/client-view-spec.md` |
| 33-1 | ✅   | 裝置 profile（`src/constants/clientDevices.js`，5 顆 mock：旗艦/筆電/平板/舊手機/IoT）＋ SNR→MCS→data rate 對照（`src/features/clientView/dataRate.js`，11ac/ax/be MCS ladder） |
| 33-2 | ✅   | 互動層：新 EDITOR_MODE `CLIENT_VIEW` ＋ cap ＋ `useClientViewStore` ＋ `simulate.js`（band 過濾＋hysteresis＋data rate）＋ `clientViewBinder`（放置/拖曳 probeAt）＋ `clientViewLayer` overlay（serving 藍線＋候選灰線＋client marker）。viewport 加 isClientViewMode 守衛不 pan |
| 33-3 | ✅   | `ClientPanel`（右側浮動面板：裝置下拉＋6E toggle＋association toggle＋RSSI/SNR/SINR/band/data rate/MCS/串流/頻寬/serving AP/距離/候選清單）；CanvasArea 依 mode 掛載 |
| 33-4 | ✅   | Association area（`association.js` 粗網格 1m 掃 serving AP，binder 在 toggle 開時算＋cache 進 store，client 移動清除重算；layer 畫藍色半透明 cells） |
| 33-5 | ✅   | Toolbar 新增「體驗」群組＋`client` icon＋ActiveModeBadge hint。**MCP 全功能驗證通過**（旗艦 1494Mbps↔IoT 143Mbps band 差異、association area、拖曳跟隨、hysteresis 不抖、0 console error）|
| 33-6 | ✅   | **client marker 改 Google-Maps 小人**（黑底白邊、腳底錨點、連線從心臟出發）＋同款 SVG cursor（`personGeometry.js` 共用幾何，cursor 縮 50%）。詳見 `clientViewLayer.drawPerson` / `clientCursor.js` |
| 33-7 | ✅   | **CLIENT_VIEW 右鍵不跳 context menu**（`ContextMenuMount` 讀 `cap.allowContextMenu`，CLIENT_VIEW 的 emptyCap=false；binder 切換時 closeContextMenu 清殘留）|
| 33-8 | ✅   | **Client Experience 進階參數對齊 Hamina**（使用者比對官方面板要求補齊）：Wi-Fi 7 toggle（11be→11ax 降速）、Link direction（down/up/worst，uplink 用互易性 `down−apTx+clientTx` 不重跑傳播）、Client height、per-band Noise floor（2.4/5/6）、Min interfering RSSI、Client tx power。**association↔heatmap 互斥**（勾 association 自動隱藏熱圖、取消/離開恢復；binder 加 re-entrancy guard 防遞迴）。simulate.js 抽 `buildCandidates` 共用 helper，association.js 同步吃全部參數。**MCP 驗證**：link direction 數字精確（up=down−10）、noise±15→SNR±15、Wi-Fi7 MCS13↔11、min-interfering 門檻過濾 SINR、互斥三路徑（開/關/離開）全對、0 error |
| 33-9 | ✅   | **association = coverage 重做（語意修正）**。原把藍色塗「會離開的外側」做反了；經 Hamina heatmap-vs-association 並排比對證實：**藍色 = 涵蓋區（任一可用 AP RSSI ≥ 門檻）、白色 = 無訊號**，多台聯集越大。改成「coverage 門檻聯集填色」（不挖洞、不塞外側），輪廓用 `contour.js` 有向邊追蹤（修好之前 stitchLoops 破碎 bug）+ Chaikin + 形態學 open/close。門檻常數 `COVERAGE_THRESHOLD_DBM` 在 association.js（暫 -72，待實測定）。MCP 驗證 1/2/3 台涵蓋對齊 Hamina |
| 33-10 | ✅ 重做 | **只加 indoorLoss（不動牆損）**。經 2-AP 無牆對照確認：Friis(n=2) 室內太樂觀、訊號傳太遠（無牆也全藍、無 Hamina 那種邊角白）；真因是**距離模型**非牆。加 `indoorLossPerMeter`（2.4/5/6 = 0.15/0.25/0.35 dB/m）到 `pathLossDb`（JS propagation.js + GLSL propagationGL.js 三處 + indoorLossPerM helper），等效 n→~2.5。**sec cap 維持原 3.5 沒動**（上次連 cap 一起改才改壞 heatmap，這次只加 indoorLoss 這刀）。`fOver24` 不動。**MCP 量化驗證**：10m 多衰 2.5dB、近 AP 3m 等高線只移 0.2m（看不出）、遠處 5-10m 移 0.7-2m（明顯，因 Friis 遠處斜率平→同 dB 位移大，物理正確）。heatmap 近核心不變、遠處收斂。coverage 自然出現 Hamina 邊角白邊 |

| 33-11 | ✅   | **client 位置記憶**（切換模式回來自動放回上次位置）。store `reset()` 拆成 `leave()`（保留 pos、只清暫態 serving/reading/associationArea）+ `reset()`（硬清，保留給 floor switch）；binder 離開呼叫 leave()、進入時 pos 存在就 recompute 自動還原；layer 加 `useEditorStore` 守衛只在 CLIENT_VIEW 畫（pos 跨模式保留，否則小人殘留其他 mode）。MCP 驗證：放置→切 SELECT（小人消失、pos 留）→切回（小人自動回原位、serving 重算） |
| 33-12 | ✅   | **association padding 修正 + coverage 語意/門檻**。①移除形態學 close（`cleanMask` 只留 open）——close 的膨脹把外緣外推一圈造成 padding 環；open 只移除孤立小塊不外擴。②**藍色語意確立＝「良好訊號涵蓋」非「連不連得到」**（業界慣例：coverage 門檻設在可正常使用品質，非可關聯門檻 -85）。門檻改 store 狀態 `coverageThresholdDbm`（預設 -67 業界 good，可調），面板加 slider（-85~-55）+ 文案「藍色＝訊號達標；藍色外仍可能連得到只是弱」。MCP：覆蓋率 -80→89% / -67→72% / -55→37% 單調正確 |

> **引擎架構決策（2026-06-02）**：JS 傳播引擎（propagation.js）**不可移除**。原規劃「heatmap 穩定後刪 JS、只留 shader」已失效——Client View 落地後，**JS 升級為「單點查詢主力」**（probeAt / coverage 逐格 / hover readout 都走 JS；shader 只擅長整張圖、單點查要 readback 慢且要加裝置視角參數）。shader=heatmap 整圖、JS=Client View 單點，各司其職。基礎物理常數（牆損 cap 等）兩邊須一致。詳見 memory `project_clientview_js_engine_role`。

> **association/coverage 語意（2026-06-03 確立）**：association area 的藍色 = **「良好訊號涵蓋」（RSSI ≥ coverageThresholdDbm，預設 -67）**，是「訊號強不強」不是「連不連得到」。裝置實際可關聯到 -85（simulate.js `MIN_USABLE_RSSI_DBM`），所以**藍色外仍可能連得到、只是訊號弱**——這是業界 coverage 圖慣例（門檻設在可用品質，非關聯極限）。多台 AP 取涵蓋聯集。

### 其他小尾巴

| #    | 狀態 | Task |
|------|------|------|
| 26-3 | ✅   | Phase 20 bench before/after 數據其實當時已完整記在 `perf-baseline.md`（After 26-2 P1/P2/P3a 各段）。本次（2026-06-02）發現那是已汰換的 Konva 架構數據，補一段開頭脈絡警示標明「§1~P3a 是 Konva 歷史紀錄，當前 PixiJS 基準看 §31-12/§32」即收尾 |
| 27-1 | ✅   | Heatmap polish audit — 已寫 `.claude/heatmap-audit.md`（A-1 hover 物理不一致 🔴 / A-2 contour 鋸齒 🟡 / A-3 colormap 寫死無 toggle 🟡 / B-1 填色溢出邊界 / B-2 SINR contour 過密；C 區確認 OK）|
| 27-2 | ✅   | audit 視覺項逐一實測後全部不做：A-1 hover 物理 ⛔won't-fix（量測差<1.3dB）、A-3 colormap toggle ⛔跳過（使用者決定）、A-2 contour AA ✅複測平滑不需做、B-1/B-2 無做的需求。熱圖在真實場景已達品質要求，27 系列告一段落。詳見 `heatmap-audit.md` |

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
