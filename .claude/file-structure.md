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
  sampleImg/                  # 範例圖片
```

## src/

### 進入點

```
src/
  main.jsx                    # ReactDOM.render() 進入點，掛載 <App /> 到 #root
  App.jsx                     # 根元件，組合 Toolbar + SidebarLeft + CanvasArea + PanelRight + FormulaNote + DemoLoader + ProgressPanel
```

### Store（Zustand 狀態管理）

所有 store 以 floor 為單位分桶管理資料。

```
src/store/
  useEditorStore.js           # 編輯器 UI 狀態
                              #   - EDITOR_MODE: select / pan / draw_scale / draw_wall / place_ap / draw_scope / draw_floor_hole / crop_image / marquee_select / door_window
                              #   - VIEW_MODE: 2d / 3d
                              #   - HEATMAP_MODE: rssi / sinr / snr / channel_overlap / data_rate / ap_count
                              #   - ENVIRONMENT_PRESETS: free_space(n=2.0) / office(n=3.0) / dense(n=3.5) / corridor(n=1.8)
                              #   - selectedId, selectedType, selectedItems[], showHeatmap, heatmapMode, pathLossExponent

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
                              #   - 各材質含 freqFactor { 2.4, 5, 6 } 頻段乘數
                              #   - MATERIAL_LIST: 依 dB 排序
                              #   - OPENING_TYPES: DOOR(預設 wood) / WINDOW(預設 glass)
                              #   - getMaterialById(id)
```

### Utils

```
src/utils/
  id.js                       # generateId(prefix) → `${prefix}-${timestamp}-${counter}`
  pdfUtils.js                 # renderPdfPageToBlob(), renderAllPdfPages() — PDF.js 渲染
  floorColor.js               # getFloorColor(index) — 參考樓層疊影用色盤（對齊模式）
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
    Toolbar.jsx               # 頂部工具列：編輯模式按鈕、視圖切換(2D/3D)、熱圖模式選擇器、環境預設下拉
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

  FormulaNote/
    FormulaNote.jsx           # f(x) 公式參考面板：FSPL、RSSI、牆體衰減、SINR、SNR、Data Rate 等
    FormulaNote.sass

  LayerToggle/
    LayerToggle.jsx           # 圖層可見度開關：平面圖/範圍/中庭/牆體/AP/AP資訊/熱圖
    LayerToggle.sass
```

### Features（核心功能）

```
src/features/
  editor/
    Editor2D.jsx              # 主畫布元件 (~500+ 行)
                              #   - Konva Stage 管理：viewport (pan/zoom)
                              #   - 所有繪製模式的滑鼠/鍵盤事件處理
                              #   - 端點吸附 (snap-to-grid, 12px threshold)
                              #   - 整合 DropZone、LayerToggle、ScaleDialog、HeatmapWebGL
    Editor2D.sass

    HeatmapWebGL.jsx          # WebGL 2.0 熱圖渲染器
                              #   - Fragment Shader 逐像素計算 RSSI/SINR/SNR/Channel Overlap/Data Rate/AP Count
                              #   - Ray-casting 牆體碰撞 + 頻段衰減查表
                              #   - 門窗 openings 展開為獨立子段
                              #   - Cisco 風格色階 (紅=強, 藍=弱)
                              #   - HeatmapLegend 圖例元件
                              #   - MAX_APS=32, MAX_WALLS=64, MAX_SCOPE_PTS=256

    ScaleDialog.jsx           # 比例尺對話框：輸入像素距離 + 實際公尺數 → 計算 px/m
    ScaleDialog.sass

    layers/
      FloorImageLayer.jsx     # 平面圖圖層：旋轉/透明度/裁切 clipping，點擊選取
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
    Viewer3D.jsx              # React Three Fiber 3D 場景（佔位，未來 3D 視覺化）
```

### Styles

```
src/styles/
  index.sass                  # 主樣式匯入鏈
  App.sass                    # 全域 grid layout (toolbar / body / sidebar / canvas / panel)
  _variables.sass             # SASS 變數：顏色、尺寸
  _reset.sass                 # CSS reset
```
