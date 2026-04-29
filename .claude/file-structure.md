# File Structure — Floorplan System

## Root

```
floorplan/
  index.html                  # 主入口 HTML
  generate-floorplan.html     # 測試用 HTML
  package.json                # 專案依賴 (React 17, Zustand v4, Konva 8, Three.js)
  vite.config.js              # Vite 設定：base='/floorplan/', alias '@' → './src'
  pnpm-lock.yaml              # pnpm lockfile
  .node-version               # Node 20.x (fnm)
  CLAUDE.md                   # Claude 指令
  task.md                     # 任務進度追蹤
  .claude/
    spec.md                   # 產品規格書
    youtube.md                # Hamina 影片筆記
    workflow.md               # 協作流程規範
    file-structure.md         # 本文件
    settings.local.json       # Claude Code 本地設定
  public/
    test-floorplan.png        # Demo 測試用平面圖
    sample-walls/             # AI walls debug page 用的測試圖（複製自 sampleImg/）
    vendor/
      opencv/
        opencv.js             # OpenCV.js 4.10.0（lazy load，AI 牆壁辨識用，不進 bundle）
    workers/
      aiWalls.classic.worker.js  # 16-3a + 16-3e + 16-3f + 16-3h classic-mode worker（importScripts opencv.js）
                                 #   不走 Vite bundling，避免 ES module worker 限制 importScripts
                                 #   pipeline: binarize → long-line mask → HoughLinesP → mergeCollinear → extendEndpoints
                                 #   options: blurKernel / invert / morphKernel / morphDilatePx /
                                 #            houghThreshold / minLineLengthRatio / maxLineGapPx /
                                 #            mergeAngleTolDeg / mergeOffsetTol / mergeGapTol /
                                 #            extendMissThreshold / extendMaxStepsPx
                                 #   merge 邏輯與 src/utils/aiWalls/mergeSegments.js 同步維護
  sampleImg/                  # 範例圖片（原始）
```

## src/

### 進入點

```
src/
  main.jsx                    # ReactDOM.render() 進入點，掛載 <App /> 到 #root
  App.jsx                     # 根元件，組合 Toolbar + SidebarLeft + CanvasArea + PanelRight + DemoLoader + ProgressPanel
```

### Store（Zustand 狀態管理）

所有 store 以 floor 為單位分桶管理資料。

```
src/store/
  useEditorStore.js           # 編輯器 UI 狀態
                              #   - EDITOR_MODE: select / pan / draw_scale / draw_wall / place_ap / draw_scope / draw_floor_hole / crop_image / marquee_select / door_window / align_floor
                              #   - VIEW_MODE: 2d / 3d
                              #   - selectedId, selectedType, selectedItems[]
                              #   - regulatoryDomain, autoChannelOnPlace
                              #   - showFloorImage / showScopes / showFloorHoles / showWalls / showAPs / showAPInfo（圖層可見度）
                              #   - alignRefFloors / alignRefOpacity（對齊模式參考樓層疊影）

  useFloorStore.js            # 樓層管理
                              #   - floors[], activeFloorId, scale (px/m)
                              #   - setFloors(), addFloor(), removeFloor(), setActiveFloor(), updateFloor(), setScale()
                              #   - importFloorFromUrl(), importImageFloor(), importMultipleFloors()

  useWallStore.js             # 牆體管理（per floor）
                              #   - wallsByFloor {}
                              #   - getWalls(), addWall(), updateWall(), removeWall(), removeWalls(), updateWalls()

  useAPStore.js               # AP 管理（per floor）
                              #   - apsByFloor {}, globalAPCounter
                              #   - getAPs(), nextAPName(), addAP(), updateAP(), removeAP(), removeAPs()

  useScopeStore.js            # 範圍區域管理（per floor）
                              #   - scopesByFloor {}
                              #   - addScope(), updateScope(), removeScope(), removeScopes()

  useFloorHoleStore.js        # 中庭/挑高管理（per floor）
                              #   - floorHolesByFloor {}
                              #   - addFloorHole(), updateFloorHole(), removeFloorHole(), removeFloorHoles()

  useHeatmapStore.js          # Heatmap 開關與計算參數
                              #   - enabled, reflections, diffraction, gridStepM, blur, showContours
                              #   - hoverReading（當前游標位置的 RSSI/SINR 讀值）

  useHistoryStore.js          # Undo/Redo 歷史管理
                              #   - undoStack[], redoStack[] (snapshot-based)
                              #   - undo(), redo(), canUndo(), canRedo(), clearHistory()
                              #   - 自動監聽 wall/AP/scope/floorHole 四個 store 的變化
                              #   - 還原時設 _restoring 旗標避免觸發循環記錄
                              #   - Debounce 300ms：拖曳等連續操作合併為一步
                              #
                              #   ⚠ 新增 data store 時必須更新此檔案（搜尋「擴充點」）：
                              #     A. takeSnapshot() — 加入新 store 的資料欄位
                              #     B. restoreSnapshot() — 加入還原邏輯
                              #     C. 底部 subscribe — 加一組 _prev 變數 + 監聽
```

### Constants

```
src/constants/
  materials.js                # 牆體材質定義
                              #   - MATERIALS: GLASS(2dB) / DRYWALL(3dB) / WOOD(4dB) / BRICK(8dB) / CONCRETE(12dB) / METAL(20dB)
                              #   - 每材質欄位：{ id, label, dbLoss, color }
                              #   - MATERIAL_LIST: 依 dB 排序
                              #   - OPENING_TYPES: DOOR(預設 wood) / WINDOW(預設 glass)
                              #   - FLOOR_SLAB_DEFAULT_DB / DEFAULT_FLOOR_SLAB_MATERIAL_ID / DEFAULT_FLOOR_SLAB_DB（樓板衰減資料預設）
                              #   - getMaterialById(id)
  apModels.js                 # AP 型號資料庫（廠商規格、per-band 增益、maxTxPower、streamCount）
  antennaPatterns.js          # 內建天線模式（Patch / Sector 90° / Sector 120°）
  channelWidths.js            # 頻寬常數與中心頻率換算
  regulatoryDomains.js        # 國家頻段規範（頻道清單過濾）
```

### Utils

```
src/utils/
  id.js                       # generateId(prefix) → `${prefix}-${timestamp}-${counter}`
  pdfUtils.js                 # renderPdfPageToBlob(), renderAllPdfPages() — PDF.js 渲染
  floorColor.js               # getFloorColor(index) — 參考樓層疊影用色盤（對齊模式）
  autoChannelPlan.js          # greedyChannelAssign() — 同頻最小干擾頻道指派
  autoPowerPlan.js            # runAutoPowerPlan() — HM-F4 greedy 多起點 ±1 dB 功率規劃
                              # （HM-F9 後實際執行於 src/workers/autoPowerPlan.worker.js，main thread 不直接呼叫）
  opencv/
    loader.js                 # OpenCV.js main-thread lazy loader（注入 script、cache window.cv、處理 onRuntimeInitialized）
                              #   目前 16-3a 流程跑在 worker，這支保留供未來 main-thread 預覽用
    preprocessCore.js         # 16-3a 二值化純運算（main / worker 共用，吃 ImageData）
                              #   - preprocessImageData(cv, imageData, opts) → { binaryImageData, width, height, whitePixels }
                              #   - 內部用 arena 自動釋放所有 Mat，不外洩 handle
  aiWalls/
    mergeSegments.js          # 16-3h Graph-based collinear segment merge（純 JS）
                              #   - mergeCollinearSegments(segments, { angleTolDeg, offsetTol, gapTol })
                              #   - Union-Find: edge = 角度近 + 法向 offset 近 + 沿軸 gap 近
                              #   - 合併：長度加權平均方向、投影 min/max 取端點
                              #   - 邏輯同步 inline 於 public/workers/aiWalls.classic.worker.js
```

### Services

```
src/services/
  floorplanService.js         # 資料層抽象（目前 mock）
                              #   - getFloors(), getWalls(), getAPs(), saveWall(), saveAP(), deleteWall(), deleteAP()
                              #   - 未來替換為真實 API
```

### Mock Data

```
src/mock/
  floors.js                   # mockFloors: 範例 1F (800x600)
  walls.js                    # mockWalls: 範例混凝土牆
  aps.js                      # mockAPs: 範例 AP-01 (5GHz, ceiling)
```

### Components（UI 元件）

```
src/components/
  Toolbar/
    Toolbar.jsx               # 頂部工具列：編輯模式按鈕、視圖切換(2D/3D)、Undo/Redo
    Toolbar.sass

  SidebarLeft/
    SidebarLeft.jsx           # 左側面板：樓層列表、active 選擇、新增樓層
    SidebarLeft.sass

  CanvasArea/
    CanvasArea.jsx            # 條件渲染：2D → Editor2D, 3D → Viewer3D
    CanvasArea.sass

  PanelRight/
    PanelRight.jsx            # 右側面板分派器：依 selectedType 顯示對應面板
    WallPanel.jsx             # 牆體屬性：材質選擇、頂/底高度、長度顯示、刪除
    WallPanel.sass
    APPanel.jsx               # AP 屬性：頻段、頻道(依頻段連動)、天線模式、安裝方式、功率、高度、刪除
    APPanel.sass
    ScopePanel.jsx            # 範圍屬性：in/out 切換、頂點數、刪除
    ScopePanel.sass
    FloorHolePanel.jsx        # 中庭屬性：說明、頂點數、刪除
    FloorHolePanel.sass
    FloorImagePanel.jsx       # 平面圖屬性：旋轉(0~360°)、透明度、裁切模式
    FloorImagePanel.sass
    BatchPanel.jsx            # 批次操作：統一改材質(牆)、統一改頻段(AP)、全部刪除
    BatchPanel.sass

  ProgressPanel/
    ProgressPanel.jsx         # 功能進度清單 (Phase tracker)
    ProgressPanel.sass

  DemoLoader/
    DemoLoader.jsx            # Demo 按鈕：載入 test-floorplan.png
    DemoLoader.sass

  LayerToggle/
    LayerToggle.jsx           # 圖層可見度開關：平面圖/範圍/中庭/牆體/AP/AP資訊
    LayerToggle.sass

  DevicePlanningPanel/
    DevicePlanningPanel.jsx   # 設備規劃：自動頻道、新AP自動選頻開關
    DevicePlanningPanel.sass

  HeatmapControl/
    HeatmapControl.jsx        # 熱圖開關按鈕 + 設定面板（反射/繞射/grid/blur/contour）
                              # + hover RSSI/SINR 讀值顯示（按鈕上方）
                              # 位置：畫布左下、DemoLoader 右邊
    HeatmapControl.sass

  FormulaNote/
    FormulaNote.jsx           # 熱圖公式說明（ITU-R P.1238 / Friis / 鏡像反射 / UTD / SINR）
                              # 嵌在 HeatmapControl 設定面板裡
    FormulaNote.sass

  RegulatorySelector/
    RegulatorySelector.jsx    # 國家頻段規範下拉（影響可用頻道）
    RegulatorySelector.sass

  ConfirmDialog/
    ConfirmDialog.jsx         # 通用確認對話框（離開對齊模式等）

  AutoPowerModal/
    AutoPowerModal.jsx        # HM-F4 自動功率規劃對話框（目標 RSSI 設定 + 進度條 + 結果預覽）
    AutoPowerModal.sass
```

### Features（核心功能）

```
src/features/
  editor/
    Editor2D.jsx              # 主畫布元件
                              #   - Konva Stage 管理：viewport (pan/zoom)
                              #   - 所有繪製模式的滑鼠/鍵盤事件處理
                              #   - 端點吸附 (snap-to-grid, 12px threshold)
                              #   - 整合 DropZone、LayerToggle、DevicePlanningPanel、RegulatorySelector、ScaleDialog
                              #   - Heatmap 已於 2026-04-21 移除；新版 JS 引擎（features/heatmap/）已上線，shader 化進行中

    ScaleDialog.jsx           # 比例尺對話框：輸入像素距離 + 實際公尺數 → 計算 px/m
    ScaleDialog.sass

    layers/
      FloorImageLayer.jsx     # 平面圖圖層：旋轉/透明度/裁切 clipping，點擊選取
      HeatmapLayer.jsx        # 熱圖圖層：跟隨 floor 旋轉/裁切；吃 heatmapGL 產生的 canvas
                              #   依 useHeatmapStore + walls/APs/scopes 任意變動即重算
      RefWallLayer.jsx        # 對齊模式：參考樓層的牆體輪廓（tint、不互動）
      RefVectorLayer.jsx      # 對齊模式：參考樓層的 AP / Scope / Floor Hole 輪廓（tint、不互動）
      WallLayer.jsx           # 牆體圖層：線段繪製 + 端點把手 + 材質顏色、拖曳吸附、刪除按鈕
      APLayer.jsx             # AP 圖層：同心圓(頻段色碼 2.4G=橘, 5G=青, 6G=紫)、拖曳移動、標籤
      ScopeLayer.jsx          # 範圍圖層：多邊形繪製(in=綠, out=紅)、第一點吸附、刪除
      FloorHoleLayer.jsx      # 中庭圖層：紫色多邊形、繪製 UI 同 Scope
      ScaleLayer.jsx          # 比例尺圖層：兩點 + 距離標籤 + ghost 線
      CropLayer.jsx           # 裁切圖層：四角把手 + 遮罩覆蓋、更新 floor.crop
      DeleteButton.jsx        # 共用刪除按鈕元件（紅圈+X），依 viewport 縮放

  importer/
    DropZone.jsx              # 拖放匯入區：PNG/JPG/PDF，PDF 自動多頁拆樓層，loading 狀態
    FloorImporter.jsx         # 佔位元件（未來 CAD 匯入）
    DropZone.sass

  viewer3d/
    Viewer3D.jsx              # React Three Fiber 3D 場景
    HeatmapPlane3D.jsx        # 10-5e：active floor heatmap canvas 貼到 3D 地板上方

  heatmap/
    buildScenario.js          # 主系統 state → heatmap engine scenario 格式
                              #   - px → m（用 floor.scale）
                              #   - walls 依 openings 展成多段（各段帶自己的 dbLoss）
                              #   - scopes 轉成 scopeMaskFn(x,y) → true/false
                              #   - AP 帶 centerMHz（依 band + channel 算）
    frequency.js              # channelCenterMHz / channelRangeMHz / apsShareSpectrum
                              #   供 propagation.js SINR 判斷同頻重疊
    rfConstants.js            # AP_ANT_GAIN_DBI / RX_ANT_GAIN_DBI / NOISE_FLOOR_DBM
    geometry.js               # 2D ray/segment/normal/mirror 等基本幾何 helper
    propagation.js            # **JS 引擎真相來源**：per-AP 傳播模型
                              #   純 Friis + image-source 反射（複數 Fresnel） + UTD 繞射
                              #   + secant 斜入射 + 多頻點寬頻平均；shader 路徑要對齊這份
    sampleField.js            # 在粗網格上取樣 rssi/sinr/snr/cci；out-of-scope 設 NaN
    propagationGL.js          # GLSL fragment shader：對齊 propagation.js 的 GPU 版本
    sampleFieldGL.js          # 用 propagationGL 在 GPU 跑 per-AP grid，再 CPU 聚合
    heatmapGL.js              # WebGL2 colormap/blur/contour renderer（吃 sampleField 出的 grid）
    hoverProbe.js             # 單點 probeAt(scenario, rx) — 供 hover 讀值使用
    modes.js                  # RSSI / SINR / SNR / CCI 視覺化模式 + 色階 anchors

  aiWalls/
    debugPage/
      AIWallsDebugPage.jsx    # 16-3a + 16-3e + 16-3f + 16-3h dev-only 頁面（route: #/ai-walls-debug）
                              #   選測試圖 → binarize + long-line mask + HoughLinesP + mergeCollinear → 四欄顯示
                              #     (原圖 / Otsu binary / long-line mask × original / morph + 紅(raw)/綠(merged) 線段)
                              #   參數：blurKernel / invert / morphKernel / morphDilatePx /
                              #         houghThreshold / minLineLengthRatio / maxLineGapPx /
                              #         mergeAngleTolDeg / mergeOffsetTol / mergeGapTol
                              #   Overlay 切換 raw / merged / both；showSegments toggle 不需重跑 worker
                              #   統計：binarize/morph/hough/merge 分項耗時、raw vs merged 線段數與總長
```

### Workers

```
src/workers/
  autoPowerPlan.worker.js     # HM-F9：在 Web Worker 裡跑 runAutoPowerPlan
                              # （AI walls worker 是 classic mode，不在這，見 public/workers/）
                              # message 協定：
                              #   in  { type:'run', payload:{floor,walls,aps,scopes,apIdsToPlan,userOpts} }
                              #   in  { type:'cancel' }
                              #   out { type:'progress', state }
                              #   out { type:'done', result:{aborted,error?,txMapEntries?,score?,opts?} }
                              #   out { type:'error', message }
                              # txMap 跨 postMessage 序列化為 entries array
                              # （main 端 new Map(entries) 還原）
```

### Styles

```
src/styles/
  index.sass                  # 主樣式匯入鏈
  App.sass                    # 全域 grid layout (toolbar / body / sidebar / canvas / panel)
  _variables.sass             # SASS 變數：顏色、尺寸
  _reset.sass                 # CSS reset
```
