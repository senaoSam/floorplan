# Floorplan Planner — 任務進度（精簡版）

> 設計依據：`.claude/cable-spec.md`、`.claude/layer-architecture-spec.md`、`.claude/client-view-spec.md`
> Progress panel 同步：`src/components/ProgressPanel/ProgressPanel.jsx`
>
> 本檔只列 **還沒做的事** + **已撤回的決策（防重做）**。
> 已完成項目的細節交給 git log。

---

## 現況一句話

**Phase 34 Camera 模式全部完成（34-0~34-5 ✅，2026-06-11 使用者驗收 ok）。**
**Phase 34-V Verkada parity 擴充完成（2026-06，見下表）。**
**Phase 35 相機 4 點校正（含階段 2 真投影）+ 導覽 polish 完成（2026-06-29 驗收 ok，見下表）。**
**Phase 36 Verkada Tier 1&2 擴充完成（2026-06-29 驗收 ok，見下表）。**
**Phase 37 camera 右鍵選單 + 3D camera 三圖 + 3D 唯一光源光影 完成（2026-06-29 使用者驗收 ok，見下表）。**
**Phase 38 熱圖綁定 FOV + 未放置裝置清單 + 3D 動線流線化 完成（2026-07-02 使用者驗收 ok，見下表）。**
**Phase 39 UIUX 規範落地（`.claude/ui-spec.md` U1–U4 全部）完成（2026-07-02 使用者驗收 ok，見下表）。**
**Phase 40 天線俯仰角 tilt（azimuth + tilt，no roll）完成（2026-07-03，commit e6f4ec1，見下表）。**
**Phase 41 熱圖無感重算（粗場秒出 + 波紋過渡 + 非同步 readback）完成（2026-07-03 使用者驗收 ok，見下表）。**
**Phase 42 統計階段 1：Plan 規劃品質面板（A 域）完成（2026-07-06 使用者驗收 ok，見下表）。**
**Phase 43 統計階段 2+3：STATS 獨立模式（B 域聚合 dashboard + C 域趨勢/timelapse）完成（2026-07-08 使用者驗收 ok，見下表）。**
**Phase 44 規劃 vs 實測空間疊合（PM 護城河 backlog）完成（2026-07-08 使用者驗收 ok，見下表）。**
**Phase 45 隱藏 3D 凍結 + 2D/3D 熱圖共用 canvas 完成（2026-07-13 使用者驗收 ok，見下表）。**
**Phase 46 效能第二/三輪（引擎 async 化 + Pixi texture 修正 + marker 免重畫）完成（2026-07-14 使用者驗收 ok，見下表）。SW 機 300 AP 拖曳 long task 累計 3.0s→0.93s（-69%）、最大單筆 777→205ms，效能戰役到此收工。**
**下一個 phase：無。剩餘 backlog：A/B plan diff、漫遊重疊區，待與使用者確立要不要做。**

---

## 還沒做的事

### 效能殘餘（Phase 46 收工後暫緩，防重做）

> 2026-07-14 拍板收工。SW 機 300 AP 拖曳剩餘 ~0.93s long task 的組成與「還能做但 CP 值低」的候選：
> ① 拖曳中被拖 AP 的**纜線 gDynamic 每幀重畫**（虛線 drop leg 逐段細分三角化，buildLine 家族 ~350ms）——候選：拖曳中改實線 ghost、放開才畫虛線。
> ② 放開後全量重算的 CPU fold 單筆 ~165ms RunMicrotasks——候選：再切片。
> ③ 首次拖曳的 per-size FBO/LOS 一次性配置 ~156ms `checkFramebufferStatus`（同場次後續拖曳不付）——候選：idle 時預熱 drag 尺寸。
> ④ SwiftShader 全場光柵化固有成本（最大單筆 205ms 的主體）——要再降是靜態層快照（texture cache）等級工程，歸 Phase 25 效能家族扳機。
> ⑤ `heatmapAdapter` SW/HW 降級門檻（1500/20000）仍是 PLACEHOLDER 未校準。
> **重啟扳機**：使用者再回報拖曳卡頓，或單層 >500 AP 真實需求。

### Phase 25 效能家族（全部暫緩，防重做）

> 31-5/6/9/10/11 經 2026-06-01 MCP 壓測**全部暫緩**：單層真實 AP 量級（~300）MVP 全達標，瓶頸只在 1000 AP（真實到不了）。
> **重啟扳機（共用）**：單層 active floor >500 AP 真實需求 + 實測 pan/zoom 卡。
> 完整量測 + 各項細節見 `perf-baseline.md §31-12`、memory `project_31_5_6_deferred_1000ap_benchmark`。
> 31-13（刪 `oldSrc/`）：使用者決定保留到正式上線穩定後才刪，現階段不做。

---

## 已完成（細節見 git log）

| Phase | 範圍 |
|-------|------|
| 7–8   | Cable 基礎建設：Switch/IDF/MDF、AP↔SW routing、Cable Tray/Riser graph、PoE/port 容量、Cable Summary BOM + warnings |
| 10–14 | S2S routing、BOM 分類、3D cable 視覺、Tray 編輯/工程屬性、Planning BOM、context menu、CSV/PDF/PNG export |
| 17–18 | Mode capability matrix + 左右鍵分工；UI 分群、Toolbar 浮動 panel、PanelShell、active mode badge、color-legend |
| 20–24 | 效能（memo/fingerprint/drag freeze）、3D 強化、Switch kind 差異化、Konva layer 拆分 |
| 25    | PixiJS hybrid 全功能 port（Bundle 1–52 + parity gaps 853eeef + heatmap 等高線 byte-identical）+ 32-C 增量 routing + 32-E cable 靜動分層（殘影回歸已驗證消除） |
| 26–27 | perf-baseline 文件脈絡警示；heatmap polish audit 實測後全部不做（品質已達標） |
| 33    | **Client View 完整落地**（33-0~33-17）：CLIENT_VIEW mode + simulate（band/hysteresis/MCS/data rate）+ ClientPanel + association/coverage（門檻 -67 可調）+ indoorLoss 距離模型 + 位置記憶 + 手動鎖定 AP（右鍵選單）+ 單台 AP 涵蓋（紅色）+ CV hover 回饋。語意/架構決策見 `.claude/client-view-spec.md` + 下方引擎決策 |
| 34    | **Camera 模式完整落地**（34-0~34-5，2026-06-11 驗收）：CAMERA mode（畫布只剩底圖+牆）+ camera 放置/拖曳/旋轉 + FOV visibility polygon（牆遮擋、玻璃/窗穿透、門擋視線；人移動相反：玻璃擋人、門可走）+ mock 一天軌跡（seedable、避牆、雙峰）+ 偵測語意 live icons（FOV 內實色/外灰 ghost、車=俯視車形朝行進方向）+ 人流熱圖（人流量/停留/動線三檔+時段篩選）+ 盲區圖 + 計數線（分方向、端點可拖、右鍵/Esc 取消）+ 分析區域（全區選取可拖、逐時長條圖）+ 回放 timeline（scrubber/倍速/日循環）。畫布標籤白字+深色描邊適應任意底圖。設計共識與驗收細節：memory `project_camera_mode_phase34`。新增 stores：useCameraStore/useTrackingStore；新增 scene layers：cameraFov/cameras |
| 35    | **相機 4 點校正 + 導覽 polish**（2026-06-29 驗收 ok）：① 4+4 點校正 modal（平面圖 4 點 + mock 相機畫面 4 點 → 前端真求 frame→floor homography，`utils/homography.js` solveHomography/invertHomography）② 品質防呆：四邊形過小/共線即時橘色警告（**不顯示重投影誤差**——4 對點恰定恆為 0 是假精度）；步驟提示跟著 active pane（① 在平面圖上方、② 在相機畫面上方）③ **階段 2 真投影**：軌跡綁定相機 FOV（projectTracks）+ 經 homography 投影；**first-freeze 模型**（首次校正不位移、重校才位移；baseSamples 不可變、frameSamples 凍結），消費者（熱圖/計數線/趨勢/3D）零改動 ④ **純手動校正**（對標 Verkada，無 auto 預設——曾做 auto 但「畫面四角↔地面正方形」非真實光學投影，撤除）；未校正→軌跡用平面座標顯示（demo 不空），已校正綠徽記、未校正提示 ⑤ Device List hover：清單↔marker 雙向高亮 + mock CCTV live 縮圖 ⑥ 占用趨勢點長條跳時間 ⑦ 回放時鐘到秒 HH:MM:SS ⑧ 重構：抽共用 FOV rasteriser + wrapAzimuth 抽 utils/angle。新增：homography/frameConstants/projectTracks、useTrackingStore.reprojectCameraTracks、CalibrationModal、utils/angle。決策與驗證細節：`.claude/verkada-notes.md` §L4/§L5。**未來 live 版**接真實相機主機後校正才對位真實偵測，現 plan/mock 版校正驗證數學正確性 |
| 34-V  | **Verkada parity 擴充**（2026-06，branch `feat/verkada-parity`，對標 Verkada 平面圖 camera 功能，調研+差距表見 `.claude/verkada-notes.md`）：① 熱圖 timelapse 時間推移（占用窗沿日滑動，按鈕自動縮窗）② FOV 偵測脈動 + 由內而外水波擴散環（牆裁切）③ 裝置線上/離線狀態（綠/橘點、離線錐暗+不偵測+計盲區；`deviceStatus.js`：undefined=online，僅 status==='offline' 才離線）④ 占用趨勢面板（逐時長條、可拖、左下）⑤ 即時影像 mock popover（canvas CCTV 畫面、離線雪花）⑥ 覆蓋率報表（涵蓋%/盲區/重疊備援/平均重疊；目標門檻 pass/fail；最大盲區定位=移畫面+開盲區遮罩+脈動環，遮罩 4.5s 自動恢復；單台相機 solo 貢獻）⑦ 重疊覆蓋 overlay（黃=1台/藍綠=≥2台）⑧ 型號預設（dome/bullet/turret/wide/fisheye）⑨ 相機清單面板（多選批次改型號/狀態/刪除、區域分組、可收合、點列定位）⑩ 複製相機 ⑪ 高度快設 ⑫ 方位角 ±15°/對準中心。新增：deviceStatus/detectionBus/coverageStats/overlapLayer/gapMarkerBus/gapMarkerLayer/exportless、cameraModels 常數、CoveragePanel/TrendPanel/CameraListPanel/LiveViewModal。**已撤回**：門禁/環境感測器多裝置（偏離 camera 主線，整包丟棄）、CSV 匯出（使用者喊停）。Code review（2026-06）：無 bug，僅可選重構（3 rasterizer 重複/wrapAzimuth 重複）未做 |
| 36    | **Verkada Tier 1&2 擴充**（2026-06-29 驗收 ok，effort=ultracode+workflows，roadmap 見 `.claude/verkada-notes.md` Tier 1/2）：① 抽共用 `features/cameras/mockCctv.js drawCctvFrame`（合併 LiveViewModal/HoverThumb/CalibrationModal 三處重複 mock CCTV 畫格；加 `renderMode:'mock'\|'stream'` seam 留給未來真實串流，touch 只一檔）② 統一 hover store（cameras 從 `useCameraStore.hoverCameraId` 遷到 `useHoverStore` type:'camera'，刪舊欄；camerasLayer + CameraListPanel 同步）③ 全樓層占用趨勢報表（Tier2 #4）：`generateWeekTracks` 生 7 日 mock（seed-per-day，每天 distinct 數不同；track 帶 `day` 欄）+ `analyticsStats.computeDayRollup`（day-level Set 去重）+ TrendPanel 逐時/逐日切換 + 人數/人·秒/車數 metric 切換（**CSV 匯出曾加後移除——尊重 34-V「CSV 撤回」決策，2026-06-29 使用者確認**）；day-0 消費者（熱圖/計數/3D/校正）零改動，週資料只在面板內 memoize 不入 store ④ Device List 側欄（Tier 1 #3b，**只列攝影機對標 Verkada**——「AP+camera 統一」原為自編延伸、Verkada Device List 無 WiFi AP，已捨棄）：CameraListPanel 從 CAMERA 模式 floating 浮窗升級成 **docked 常駐左欄**（掛 App.jsx，SidebarLeft↔CanvasArea 間，預設顯示、寬 260；多選/批次/分組/雙向 hover/縮圖全保留；切走自動回收空間）⑤ 清單列 📹 鈕（Tier2 #6）直接 openLiveView，stopPropagation 不誤觸選取。**排除**：多裝置型別（門禁/環境感測器，尊重 34-V 撤回）。新增：mockCctv.js、$device-list-width；MCP 驗證 0 console errors。設計共識與取捨：memory `project_tier1_2_devicelist_plan` |
| 37    | **Camera 右鍵選單 + 3D camera 三圖 + 3D 唯一光源光影**（2026-06-29 MCP 自測 ok，effort=ultracode+workflows）：① **Camera 右鍵 context menu**（對標 AP）：camerasLayer container pointerdown button=2 → openContextMenu({targetType:'camera'})（armed draw tool 時跳過讓 analyticsLayer draw-cancel 仍生效）；ContextMenuMount 加 camera 分支 `buildCameraItems`；選單 6 項：重新命名/選取/⧉複製相機/📹即時影像/🎯校正熱圖/刪除。**需在 modeCapabilities.js CAMERA_CAP 加 allowContextMenu:true**（emptyCap 預設 false，否則整個選單不渲染）。複製相機無 store action，inline 複製 CameraPanel.handleDuplicate 邏輯（generateId('cam')+strip id/name+nextCameraName+x/y+24）。② **3D 顯示 camera 三分析圖**（盲區/重疊/占用）：新建 `features/viewer3d/CameraOverlay3D.jsx`（BlindSpot/Overlap/Occupancy 三 sub-plane），仿 HeatmapPlane3D（offscreen canvas→CanvasTexture→floor-aligned plane），**重用 2D rasteriser**（`fovRasterize.rasterizeCoverageCounts` 供盲區/重疊、`occupancyGrid.computeOccupancyGrid/renderOccupancyCanvas` 供占用）使 3D 與 2D 像素一致；**跟隨 2D store 開關**（showBlindSpots/showOverlap/occupancyMode）+ CAMERA mode + active floor gate；各 plane 不同 y-lift（occupancy 0.03/overlap 0.04/blind 0.05）避免 z-fight；texture 在 unmount/off 釋放。③ **3D 唯一光源 + 明顯光影**（不分 mode）：Canvas 開 `shadows`（PCFSoft）；`KeyLight` 元件（directionalLight castShadow、跟樓層 center、intensity 1.1、shadow-mapSize 2048、frustum ±80m、shadow-bias -0.0005）；ambientLight 弱化 0.6→0.28 + hemisphereLight 0.25 微弱補光。**注意**：frustum 固定 ±80m，超大樓層或遠離 active center 的堆疊樓層陰影會裁切（已知設計取捨）。新增：CameraOverlay3D.jsx。④ **3D 動線（flow）立體箭頭**（37b，2026-06-30）：occupancy flow 模式在 CameraOverlay3D 加 `FlowArrows3D`——**單一 THREE.InstancedMesh** cyan(#06b6d4) cone，instanceCount=可見格數（frac≥0.04，cap 4000），matrix 在 useMemo/useEffect off-frame 算（非每幀）；重用 `computeFlowGrid`（vx/vy 現成不重算）；px→world 對齊 HeatmapPlane3D（floor 旋 -PI/2，cell 中心→world，Y=0.06 疊在熱圖 plane 上方）；cone 朝 (vx,0,vy) 方向。實測 demo 580 箭頭、效能無虞。⑤ **全物件參與陰影**（37b）：Switch(pole+body)/Tray body/Riser body/Track 人車 7 mesh +castShadow；AP/Camera body/門 leaf +receiveShadow；門框+窗框+sill +cast/receive（共 22 flag）。**跳過**（three.js 無法投影）：line（纜線/tray 邊框/中線）、sprite（AP label）、meshBasicMaterial（FOV 體/riser wireframe）、meshPhysicalMaterial 玻璃。MCP 自測：右鍵 6 項+複製/live 有效、3D 三圖各自可見、3D 動線箭頭指向正確、全物件陰影明顯、0 console errors ⑥ **3D 控制面板整理**（37c，2026-06-30）：移除 Log Camera（debug-only，連 handler 一起刪）；新增「🔄 自動旋轉」toggle 鈕（沿用既有 OrbitControls autoRotate idle spin 機制，速度 0.6；CameraRig 暴露 `setAutoRotate`，使用者拖曳時 OrbitControls `start` 事件經 `onAutoRotateStop` 回呼把按鈕 state 同步關閉）；右上角 `viewer3d__panel` 從「透明容器散落按鈕」改成**統一深色玻璃面板**（dark-glass 外框+邊框+圓角，對齊 CoveragePanel/TrendPanel）+ 標題「3D 視圖」+ 可收合 caret（收合只剩標題列）。MCP 自測：Log Camera 已無、自動旋轉前後截圖視角確實轉動、面板有外框+收合正常、0 console errors |

| 38    | **熱圖綁定 FOV + 未放置裝置清單 + 3D 動線流線化**（2026-07-02 使用者驗收 ok）：① **占用/動線熱圖裁切到相機 FOV 覆蓋區**（Verkada §J3「熱圖只渲染在 FOV 內」）：共用 `fovRasterize.buildFovMaskGrid`（online-only、牆裁切、對齊各 grid 自己的 cols/rows/cellPx）；`computeOccupancyGrid`/`computeFlowGrid` 接 `maskFn`（caller 建遮罩、grid 內套用保證對齊）；streamline 積分在遮罩邊界截斷（bilinear 會漏過邊界 1-2 格）；`useCameraStore.clipHeatmapToFov` toggle「FOV 內」預設開（熱圖控制列，推移鈕右邊）；2D/3D 共用同一 maskFn 像素一致。② **未放置裝置清單**（Verkada Add Cameras）：`unplacedCameras` org-level pool（非 per-floor）+ `addUnplacedCamera`（進 pool 就取號，計數器連號）/`placeCamera`（放樓層中心）/`removeUnplacedCamera`；CameraListPanel 加搜尋框（同時過濾已放置+未放置）+「尚未放置」區段（琥珀虛線圈、＋放置鈕）；demo 種 2 台未放置。③ **3D 動線改流線平面**：`FlowArrows3D`（InstancedMesh 圓錐）→ `FlowPlane3D` — octant-bins commit `8c39e49` 後 flow.cells 變每 bin 一筆（一格最多 8 筆），圓錐版同點疊 8 支變糊（回歸）；新版用 2D 同一份 `computeFlowGrid(cellM 1.5)+computeStreamlines` 畫到 offscreen canvas（×2 supersample cap 2048）貼地面 plane（Y_FLOW 0.06），`useFrame` 30fps 重繪爬行動畫（frameloop 可見時 always）。④ **流線配色**（2D/3D 同步）：通道 cyan→**fuchsia 0xe879f9**（跳出 FOV 青綠/藍車色系）；箭頭=**黑色 stroked「>>」**（兩個相連 > 線條，非實心飛鏢），尺寸/線寬低於通道一階當方向記號。**中途撤回**：3D「主導 bin 圓錐」方案（仍是立體物、斜看變噪點，直接對齊 2D 流線） |

| 40    | **天線俯仰角 tilt**（2026-07-03，commit e6f4ec1；azimuth + tilt 兩自由度，no roll）：① AP 加 `tiltDeg`（-90~+90，+為上仰，預設 0；directional/custom 適用，omni 不變）② **雙引擎同步**：propagation.js apGainDbi 垂直偏角 =（rx/AP 高度差 ÷ 水平距離的仰角）− tilt，gain = Gh + Gv；custom 的 Gv 用同組水平樣本近似、directional 兩平面同錐 taper；propagationGL per-AP uniform `uAntTiltDeg` + aggregated AP texture t3.y 打包 tilt，apGainAt 鏡射 JS 公式；sampleFieldGL grid cache 簽名含 tiltDeg ③ APPanel 俯仰角欄位與方位角並排；PatternPreview3D 上下拖曳改為調 tilt（放開才 commit，Shift+拖曳保留觀察視角）④ APLayer3D custom lobe 把 tilt 烘進幾何、directional cone 內層 group 旋轉俯仰；FormulaNote §7 補垂直增益公式。**當時未納入**：AP `mountType`（ceiling/wall）與 tilt 預設值互動、legacy（tilt 前語意）對照開關 |
| 41    | **熱圖無感重算**（2026-07-03 使用者驗收 ok）：① **二段渲染**——idle 重算先粗場（≥1.0m、關 refl/diff → aggregated）秒級上畫，細場（使用者品質）背景算完無縫換底；drag solo/live 路徑不動 ② **Hamina 式波紋過渡**——新場**立即全尺寸上畫**（移動 AP：舊 blob 立刻消失、新等高線直接最終大小），疊加漂移 value-noise 擾動（`WOBBLE_AMP_DB 1.6`／`LAMBDA 2m`（使用者調校）／`DECAY 900ms`／hold cap 4s，旋鈕在 heatmapAdapter.js）至細場落地後收斂；**撤回**第一版舊場→新場 dBm 內插（舊 blob 內縮/新 blob 從中心長大，觀感錯誤）③ **41-5 非同步 readback**：PBO+fence（不再 sync readPixels stall）+ per-AP 分批送件 `SUBMIT_BATCH=4`（防 GPU command-buffer 反壓，300 AP 曾一個 13s task）+ aggregated 主 pass scissor 分帶 `ceil(apCount/24)`（拆 2.4s 不可搶佔 GPU atom）+ `sampleFieldGLAsync` mutex 序列化（2D/3D 共用 instance）+ generation counter 丟過期結果；3D HeatmapPlane3D 跟進 async ④ 41-6 CPU 聚合切片 ~5ms/塊 ⑤ fingerprint-skip（`lastIdleInputs`）回歸 idle 路徑 ⑥ **solo 放開交棒**：畫面完全不動直到粗場換底（撤回「快照拉回全亮」——舊位置閃回/新位置消失）⑦ isSoftwareRender 關動畫直接跳變。**驗證**：sync/async 引擎 4 field bitwise 一致；5 AP 移動 0 long task；300 AP 冷啟 13s→250ms，殘餘 ~1.9s 經關熱圖對照證實為 apsLayer/3D/routing 既有成本（效能家族範疇，扳機 >500AP）。Worker 方案確認不做，殘餘卡頓再重啟。**41-postfix（2026-07-03 使用者回報 300 AP 放開仍先卡再動畫）**：profiler 歸因出兩個非熱圖元兇 + 一個 41-5 回歸 bug——① `CableLayer3D` 每次 AP 變動全量重算 routes 且 pts3 全新 ref → ~2000 段 line geometry 重建（主因）→ `PolylineTube` 改**值比較 memo**（座標沒變不重建）② `APLayer3D` APMarker 無 memo → 300 marker 全重 render → `React.memo`（updateAP per-item immutable 保證 ref 穩定）③ **syncEpoch guard**：solo 拖曳的 sync 計算會大量淘汰 losCache/apGeoCache（deleteTexture），in-flight 的 3D async job（其 cancelled flag 不知 2D 在拖）batch 醒來 bind 已刪 texture（INVALID_OPERATION + 汙染 grid cache）→ sync `sampleFieldGL` 入口 bump epoch，所有 in-flight async 在下個 await 檢查點作廢。實測 300 AP 放開 max long task **2995ms → 258ms**、GL 警告 97→0；3D 反應性驗證無回歸（纜線重佈/熱圖更新正常） |
| 39    | **UIUX 規範落地**（2026-07-02 驗收 ok，規範+實作狀態見 `.claude/ui-spec.md`）：① z-index token 化（8 階，`_variables.sass`，禁裸數字）② 四角 stack container（CanvasArea `__overlay--tl/--bl`，面板入堆疊不再寫死座標——A2/A3/A4/A5 消失）③ 右側避讓 `--right-dock` CSS 變數（PanelRight 開啟時 3D 面板/ClientPanel/ScaleBar 平移讓位——修 A1「3D 選物遮右上面板」）④ 全域 UiToast + 刪除策略統一（單刪即刪+undo toast、批次>1 ConfirmDialog，四個刪除入口全覆蓋）⑤ 模式切換一次性說明 toast（CAMERA/CLIENT_VIEW）+ 3D「唯讀」徽記 ⑥ 收合符號統一 SVG chevron、熱圖鈕固定標籤、✕ 關閉配對提示、hint 常駐（Toolbar z 提到 badge 之上蓋過）⑦ ALIGN Esc=完成、F2 改名實作、keyboard guard 補 SELECT/contentEditable（`utils/isTypingTarget`）、alert→toast、內部用語清除、樓層 grip ⠿、`.camera-list` 浮動死碼刪除 ⑧ **dev widget（Demo/Stress/Progress）移至 SidebarLeft 最下方**（使用者指示：不入畫布 overlay，正式版整塊移除）。發現免修：3D 選取 highlight 與切模式清 selection 本already存在。MCP 驗證 0 console errors，截圖 `.playwright-mcp/ui-01~06` |
| 42    | **統計階段 1：Plan 規劃品質面板（A 域）**（2026-07-06 使用者驗收 ok，設計共識見 `.claude/stats-mode-spec.md` + memory `project_stats_spec_two_mode`）：三角審查（QA/User/PM）定案「統計不新增第三 mode」——A 規劃品質併進既有 `DevicePlanningPanel`（Plan/非 camera 模式顯示），B/C 之後進 Live。① 新 `features/heatmap/planQuality.js`：`computePlanQualityStats`（`buildScenario`+JS `sampleField` gridStep 1.0m、refl/diff off，掃 RSSI grid 依門檻算涵蓋率/盲區/盲區面積 m²/最大盲區 image-px 定位，分母=非 NaN in-scope 格）+ `detectChannelConflicts`（同 band+同 channel+距離<300px、去重每對一筆）② `DevicePlanningPanel` 加「規劃品質」section：涵蓋率 hero + 進度條（綠填/紅底盲區/白目標標記）+ 目標門檻可調（預設 90%）+ 達標紅綠燈 verdict + 盲區/頻道衝突/訊號門檻(-67 可調 -85~-55) rows + ◎ 定位最大盲區（viewport 置中，用 `getSceneRefs().app.canvas` rect）；debounce 200ms 且僅展開時算；門檻/目標為面板本地 state（不共用 clientView 語意）③ sass 配色對齊 CoveragePanel（綠 #10b981/橘 #f59e0b）。**MCP 驗證**（demo 5AP/45 牆/scale 22.83）：涵蓋率 89.1%/盲區 10.9%·81m² 面積自洽、compute 9ms、衝突偵測正負向皆正確（同頻近距報 1 對、遠距不誤報）、定位盲區 viewport 移動、0 console errors，截圖 `stats-a-plan-quality.png`。**未做**：B/C（Live 聚合/趨勢，階段 2/3）、PM 差異化 backlog（規劃 vs 實測空間疊合） |
| 43    | **統計階段 2+3：STATS 獨立模式（B 域聚合 dashboard + C 域趨勢/timelapse）**（2026-07-08 使用者驗收 ok）：**定位修正**——原 spec 說「B/C 進 Live」，但專案無 Live editorMode，經使用者拍板改為**新增 `EDITOR_MODE.STATS` 獨立唯讀模式**（memory `project_stats_spec_two_mode` 的「乾淨兩態」在無 Live mode 下具體化為此）。**資料地基**：`features/stats/statsSource.js`——`deriveTopology`（單一真相：seed 撒 client（AP-centric 高斯散佈，**不依賴 scope**，避免污染規劃熱圖）→ `buildCandidates` 真算每 client 連哪台 AP+RSSI+band；AP↔switch 用 `getCachedRoutes`；LLDP port groupBy 編號；`occupancyFactor(ts)` 日夜曲線；AP 可帶 `mockStatus:'offline'` 釘死狀態，否則 seed ~90% online）+ `getSnapshot(building,floorId,{ts})`（spec §1.2 shape，INV-1~10 自洽 by construction）+ `getTimeSeries`（掃 range 每 bucket 一次 getSnapshot 取值，實測 24 點 44ms，與 scrubber 停駐點同函式零漂移）。**共用 seed**：`utils/seededRng.js`（mulberry32+hashStringToSeed，抽共用不動 camera 版）。**時間源**：`store/useStatsTimeStore.js`（anchorTs 即時邊緣/playheadTs 顯示時刻/playing/speed，dashboard+overlay 共訂閱，比照 useTrackingStore 模式；epoch ms 非日內秒）。**UI**：① `components/StatsDashboard.jsx`（右側 dark-glass docked 面板）：KPI tiles + 連線裝置趨勢 24h 長條圖 + scrubber（▶播放/range 拖桿/×1×60×300；togglePlaying 從 live edge 按▶會倒帶到窗口起點避免瞬間 goLive；rAF 播放 dt clamp 0.25s；即時徽記+回即時鈕）+ 告警清單 + AP 負載排行 + Switch PoE/LLDP 鄰居 + 頻段分布 + client MAC 下鑽；點列跳定位（setActiveFloor+setSelected）；hover 列→useHoverStore→圖上脈動環 ② `features/stats/statsOverlayLayer.js`（overlays layer）：**AP 負載 badge**（對標 Meraki/Aruba：數字 pill+狀態色綠<15/黃<25/紅≥25，Text pool 固定螢幕大小；**撤回**初版「負載光暈圈」——使用者指出圓圈=涵蓋範圍既有語意會誤讀）+ **離線 AP 灰「離線」badge+灰環**（不只少數字）+ hover 白青脈動環；讀 useStatsTimeStore.playheadTs（timelapse 拖動整個 dashboard+光暈跟著變）③ `EDITOR_MODE.STATS` + `STATS_CAP`（唯讀，keepLayers floorImage/devicesAP/devicesSW/walls）④ Toolbar：STATS 與 camera 並排最前的 direct 頂層鈕（divider 移到 statistics 後），Icon 加 `stats` 長條圖 ⑤ **STATS 隱藏 RSSI 熱圖**（`layerVisibilityBinder` heatmap `!inCamera && !inStats`，統計光暈才不被彩色場干擾）。**DemoLoader**：AP-03 釘 `mockStatus:'offline'`、加第 2 台 idf switch（拓樸有料）；**移除**曾補種的 3 scope（會把規劃熱圖限制在 scope 內——回歸，已改 AP-centric 撒點）。**MCP 驗證**：INV-1~10 全通過、日夜曲線（夜4/尖峰54/午休14/週日18）、可重現 deep-equal、掃24點44ms、timelapse 拖4am→KPI 37→6 同步、跨時間不變式零漂移、離線 AP-03 四處一致（圖/告警/KPI/排行）、切模式生命週期無 crash、0 console errors。**注意**：播放連續滾動因 MCP headless rAF 降頻無法自動驗，倒帶+時間前進已證實，需前景實測。**未做**：PM backlog（規劃 vs 實測空間疊合）、A/B plan diff、漫遊重疊區 |
| 44    | **規劃 vs 實測空間疊合（PM 護城河）**（2026-07-08 使用者驗收 ok）：STATS 內標出「規劃說 ≥門檻（該有訊號）但實測 client RSSI <門檻（實際差）」的落差點——平面圖工具獨有、dashboard 給不了的空間洞察。① `statsSource.js`：client 同時帶 `theoreticalRssiDbm`（傳播模型算）+ `rssiDbm`（實測=理論−環境劣化）；`measuredDegradationDb`（依 3m 網格 seeded、~38% 問題格重劣化 22–40dB 模擬死角，其餘 1–4dB）——比例調高確保白天穩定有落差（實測 9/24 小時有、尖峰數個）② `useStatsTimeStore`：`showGapOverlay` toggle + `gapThresholdDbm` ③ `statsOverlayLayer.js`：落差 client 位置畫**紅鑽石（白框加大 11px，落在 AP 密集處也跳出）** ④ `StatsDashboard`「規劃 VS 實測」section：落差點數 + 顯示 toggle（無落差時灰字提示拖白天）。**過程修的 4 個問題**（都使用者回報）：❶ 負載光暈圈誤讀成涵蓋範圍→改數字 badge（已在 Phase 43）❷ **定位落差點按鈕移除**（會硬移畫面、第一個點任意、價值低）❸ apStatus 改「只 mockStatus 釘死、其餘一律 online」（移除隨機 flapping，離線固定 AP-03 方便測試；連帶 rng 流偏移→落差場景變，靠提高問題格比例補回）❹ **overlay redraw 漏 `scene.requestRender()`**——本 app 按需 render（`app.ticker.stop()`），toggle 落差只改 Graphics 幾何卻沒請求重繪，導致「要 hover floorplan 才顯示」；加 requestRender 後 toggle 立即生效（此 bug 亦是先前 MCP 截不到紅鑽石的同源）；另 statsTime 訂閱只在 playheadTs 變才 recompute（toggle 不重算 44ms snapshot）。**MCP 驗證**：seek 白天 toggle 不 hover 紅鑽石立即出現（10 落差一堆紅鑽石）、AP-03 跨時段固定離線、0 console errors。**未做**：A/B plan diff、漫遊重疊區 |

| 45    | **隱藏 3D 凍結 + 2D/3D 熱圖共用 canvas**（2026-07-13 使用者驗收 ok）：使用者回報軟體渲染機（硬體加速關閉→SwiftShader）300 AP 拖曳很卡。**Profiler 歸因**（trace 解析腳本抽 long task + CPU profile）：3.4s long task 中 57% 來自**隱藏中的 Viewer3D**——2D 模式下 Viewer3D 常駐 mounted 只用 CSS 藏，`frameloop='demand'` 仍隨每次 store 變動重繪整個 3D 場景（含陰影），HeatmapPlane3D 隱藏中重算、CableLayer3D 每次 AP 位移重跑 dijkstra；unmount A/B 驗證版實測 long task 3432ms→1468ms、最大單筆 777ms→232ms。**正式修法（凍結而非 unmount）**：① Viewer3D 隱藏時 `frameloop='never'`（invalidate 全 no-op；r3f 7.0.29 `setFrameloop` 不會自動重啟 loop，新增 `WakeOnVisible` 在 hidden→visible 邊緣補一次 invalidate）② CableLayer3D：computeRoutes 手動輸入 ref 快取（隱藏凍結、重入輸入沒變直接沿用=秒切保留、有變才 re-route 一次）+ 隱藏時回傳快取 element tree 讓 reconciliation bailout（**null 路徑也必須寫快取**，否則會復活更舊的樹）③ **2D/3D 熱圖共用 canvas**（回答「兩邊要分開算嗎」→ 不必）：新增 `render/heatmapFrameBus.js` 小 pub-sub，heatmapAdapter `paintCanvas` 每次上畫廣播 canvas+padding 對位、`hide()`/銷毀廣播 null；HeatmapPlane3D **全檔重寫成純消費者**（刪自有 GL context+sampleFieldGLAsync 整條計算路徑+凍結/暖身邏輯），CanvasTexture 包 2D canvas、UV offset/repeat 裁 padding（flipY 下 v 從 canvas 底算）、只在 3D 可見時訂閱（隱藏零成本）、重入拿 `getHeatmapFrame()` 最新一張。**效果**：3D 熱圖零計算成本（繼承 2D 粗場秒出+大場景降級）、2D/3D 像素級一致、300 AP 切 3D 熱圖從幾十秒（3D 舊路徑無大場景降級，MCP 實測 60s 才落地）變 +400ms 即現。**中途撤回**：HeatmapPlane3D「輕場景隱藏暖身」patch（修首次進 3D 空窗）——共用 canvas 後不需要，已刪。MCP 驗證：5 AP 切 3D 即時、2D 移 AP 重入正確跟上、熱圖開關 plane 同步、300 AP +400ms 完整呈現，全程 0 console errors |

| 46    | **效能第二/三輪：熱圖引擎 async 化 + Pixi 修正 + marker 免重畫**（2026-07-14 使用者驗收 ok；三份 trace 逐輪歸因驅動，SW 機 300 AP 拖曳 long task 3.0s→1.25s→0.93s、最大單筆 777→205ms）：① **per-size render target 快取**（propagationGL）：out/outField/mask 從單一可變尺寸改為每尺寸一份（`makeSizedTargets`，LRU cap 6）+ losCache key 加 grid size（`@@${nx}x${ny}`）+ 年齡汰換（LOS_STALE_BAKES 32；**汰換必須用 AP-part 比對**，整 key 比對會讓粗細場互相驅逐）——消除 coarse(1.0m)↔fine(0.5m) 交替時整批 texture realloc + `checkFramebufferStatus`（強制 GPU 同步）；殘餘的 cfs 只剩首次拖曳 per-size 一次性配置 ② **solo/live 拖曳改 async 管線**（heatmapAdapter）：drag 幀不再同步 `sampleFieldGL`+`readPixels` stall，改 latest-wins 單格佇列 + `runDragLoop`（PBO+fence async，1 幀延遲換主執行緒零等待）；**教訓：latest-wins 只作用於佇列**——第一版把「有新請求」放進 isStale 會殺進行中計算，拖曳事件比計算快時每個計算死在半路、疊層凍在第一幀（starvation）；isStale 只留 `!dragSessionOn`（放開後 idle 接管，遲到的 drag paint 直接丟）③ **拖曳輸出解析度減半**（DRAG_OUT_SCALE 0.5）：採樣 grid 之外連 colormap 輸出 canvas 也減半（光柵化+Pixi 上傳都 1/4），sprite scale 自動補償、blur 半徑同步縮放，放開回滿解析度 ④ **Pixi v8 CanvasSource resize bug 修正**（使用者回報「拖曳中熱圖放大好幾倍/全紅」）：③ 讓共用 canvas 首次在執行期改尺寸，`source.resize()` 後 JS 側 source/frame/uvs 全一致但**場景渲染取樣到舊尺寸 GL 配置**（extract/讀 canvas 都會重新上傳所以看起來對，只有螢幕合成錯→初期誤判為測試假影，使用者實測逼出）；修法：尺寸變化時整顆 texture 重建（顯式 `new CanvasSource` 繞過 `Texture.from` 的 resource 快取），只在拖曳開始/結束發生 ⑤ **apsLayer 拖曳移動免重畫**：`drawAP` 幾何本畫在 local(0,0)+`container.position` 定位，`applyDragOverlay` 卻每移動幀全量重畫（circle/fan 筆劃重新三角化+Text 重設，SW 機 ~500ms buildLine+126ms flush 純白做）；改為首幀全畫、移動幀只 `position.set`（拖曳中 hover 被抑制、視覺狀態不會中途變）。**MCP 驗證**：solo/live 兩模式拖曳中疊層正確（牆影/blob 跟手）、放開回滿解析度、5AP 拖曳 0 long task、300AP 拖曳單筆 154ms、0 console errors。**trace 解析腳本**（long task 抽取+CPU profile 歸因+bucket 分類）在 scratchpad，重建成本低、未入 repo |

> **引擎架構決策（2026-06-02，不可違反）**：JS 傳播引擎（propagation.js）**不可移除**——Client View 後 JS 是「單點查詢主力」（probeAt/coverage/hover），shader 只負責 heatmap 整圖。基礎物理常數兩邊須一致。詳見 memory `project_clientview_js_engine_role`。
>
> **association/coverage 語意（2026-06-03 確立）**：藍色 = 「良好訊號涵蓋」（RSSI ≥ coverageThresholdDbm 預設 -67），不是「連不連得到」（實際可關聯到 -85）；藍色外仍可能連得到只是弱。多 AP 取聯集。

---

## 已撤回的決策（防重做，不要再提案）

| ID | 撤回理由 |
|----|----------|
| 12-4 Hybrid routing | 17-3 switch hub 落地後痛點消失，沒人抱怨 |
| 21-1 Vertical tray / conduit | Hamina 無此物件；Riser 已涵蓋跨樓層垂直走線；conduit 無實際 routing 價值 |
| 21-2 / 21-3 Zone box | TIA-568 consolidation point 用在有線工位 cabling；分散需求已由 IDF/MDF + uplinkTo 涵蓋 |
| 22-3b SVG export | Konva 無內建 SVG renderer（自製 ~10× 工程）；PNG + PDF 已覆蓋 95% 情境 |
| 22-4 DXF export | AutoCAD 交付在純 AP planner 工作流外；PDF + PNG 已足夠 |
| Phase 19 Auto IDF | IDF 真實選位是空間語意（弱電間/機房），非幾何最佳化；使用者再次確認不必要 |
| 26-2-P4 CableLayer imperative Konva | 視覺 ~1% pixel diff + 無效能改善 |
| 30-3 ~ 30-7 Konva 多層拆分 | react-konva 環境做會白工；融入 Phase 25 PixiJS Container 階層 |
| 31-4 Wall Mesh + line shader | 5000 wall 對 GPU trivial，Graphics + batching 撐得到；日後實測卡頓再重啟 |
| Verkada Tier 3（多站 Sites/Subsites 導覽、Google Maps 地理定位） | 2026-07-02 使用者確定不做——本專案維持單站閉環畫布，不做導覽 IA / 地圖底圖級改動 |

---

## Design Principles（後續所有 phase 都遵守）

| 主題 | 原則 |
|---|---|
| **3D = read-only** | Z 軸屬性一律在 **2D panel 編輯**；3D 只負責高度視覺化 |
| **Capacity rule** | tray fill 用 `capacityProfile`，**不**寫死「NEC 40%」 |
| **Color legend** | tray 顏色用 owner / company / discipline standard，不綁地區法規 |
| **垂直走線只用 Riser** | 不另做 vertical tray / conduit 物件 |
| **BOM = Planning BOM** | planning estimate，**不是**施工 final BOM |
| **Warning ≠ Code violation** | 寫「exceeds selected fill rule」，不寫「code violation」 |

---

## 嚴格重構規則（未刪 oldSrc 前一直適用）

**這是「重構」不是「改寫」不是「重設計」。**
- 一切 **顏色 / 大小 / 角度 / 寬度 / alpha / dash / hover 位置 / cursor / 文案 / spacing / radius / icon / 字級** 嚴格照 oldSrc
- 絕對不要自選、自編、自加、自優化
- 不確定就 **MCP 並排**（`pnpm dev:oldsrc` on 5180）對照 + grep `oldSrc/...` 抓常數
- commit message 標明每個數值的 oldSrc 出處
> 註：Phase 34 Camera 是**全新功能**（oldSrc 無對應物），不受此規則約束；視覺風格對齊現有新 src 慣例即可。
