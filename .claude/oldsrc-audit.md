# Phase 25 oldSrc Audit — what new /src diverges from /oldSrc

> Triggered 2026-05-26 by user feedback「都略有差別 有些是刪減版 有些是你自己使用自己認為的顏色」.
>
> 目的：把所有 deviation 列出來，user 看完後選哪些要 fix。
>
> **Severity codes**
> - 🔴 **CRITICAL** — 顏色 / 形狀 / 行為跟 oldSrc 不同，會明顯被看到
> - 🟠 **MAJOR**    — 缺欄位 / 缺整個 panel section / 缺 oldSrc 一定有的視覺元素
> - 🟡 **MINOR**    — 細節差別（magic number / padding / font size）
> - 🟢 **OK**       — 跟 oldSrc 對齊 / 正確的 PIXI 移植
> - ⚪ **N/A**       — 沒有 oldSrc 對應檔（PIXI 新基建 / 為 PIXI hybrid 必要的橋接）

---

## Tier 1A — PIXI Layers（物件視覺）

### `apsLayer.js` vs `oldSrc/features/editor/layers/APLayer.jsx`

| 項目 | oldSrc | 我寫的 | severity |
|---|---|---|---|
| Marker fill 頻段色 | 2.4 `#f39c12`, 5 `#4fc3f7`, 6 `#a855f7` | 同上 | 🟢 |
| Marker radius (canvas px @ scale 1) | hit 14, focusHalo 15, directional fan inner 17 outer 36 | radius 9 | 🟡 size 差 |
| 命名 label | `Konva.Text` 11px @ inverseScale, y≈22 | `PIXI.Text` 11px 固定 y=14 | 🟡 |
| **Selection ring 顏色** | 紅 `#e74c3c` (axisLine selected 也用紅) | **黃 `#fbbf24` + 黑 halo** | 🔴 |
| Info pill (showAPInfo) | `${name}\n${freqLabel} CH${ch}/${width}\n${tx} dBm` 11px @ s | `5G CH36/80\n20 dBm` 9px 固定 | 🟡 缺 name + 字級 |
| **Focus halo（17-2）** | indigo `#818cf8` 環，stroke 3 \* inverseScale opacity 0.85 圍繞 focus AP | **完全沒做** | 🟠 oldSrc 選 switch 時 AP 上會亮 |
| **Directional fan**（directional）| `Konva.Arc` innerR 17 outerR 36 angle=beamwidth fill=color opacity 0.18-0.35 | **lineTo+arc+closePath 沒 inner/outer** | 🟠 形狀不對 |
| **Directional selected ring** | 另一 `Konva.Arc` 外環 dashed | 沒做 | 🟠 |
| **Custom pattern polygon** | `patternPolygonPoints(pattern, 34s, axisRad, minDb=-30)` | **完全沒做** | 🟠 自定 antenna 不顯示 |
| **Orientation axis line** | (0,0) 拉到 axis 長 32 \* s，selected 紅 stroke、normal color | 沒做 | 🟠 |
| Drag overlay 來源 | useAPStore.updateAP + Phase 24 26-2 cable freeze | useDragOverlayStore，commit on up | 🟢（架構正確） |
| Per-band visibility | showAPBand 過濾 | 同 | 🟢 |

### `wallsLayer.js` vs `oldSrc/features/editor/layers/WallLayer.jsx`

| 項目 | oldSrc | 我寫的 | severity |
|---|---|---|---|
| Wall body stroke | wall.material.color strokeWidth 4 | strokeWidth 4 | 🟢 |
| Openings render | Sub-segments rendered with opening material color | 同 | 🟢 |
| **EndpointHandle**（selected wall）| Circle radius 7 \* s, 白 fill, 紅 `#e74c3c` 2.5 \* s stroke | **黃 `#fbbf24` fill + 黑 stroke radius 5 固定** | 🔴 |
| Handle hover cursor | crosshair | move | 🟡 |
| **Endpoint snap (drag)** | snapToEndpoint 把拖中 endpoint 吸附到其他 wall 的 endpoint | **完全沒 snap** | 🟠 |
| Endpoint double-click | extend from endpoint (進入 DRAW_WALL with first=該 endpoint) | 沒做 | 🟡 |
| Wall body click | capability-aware | 直接 setSelected | 🟡 沒走 capability 系統 |
| Wall hover outline | hovered → 較粗 outline | 透過 hoverOverlayLayer 畫白 outline | 🟡 |
| Door / window draw mode | 完整 host wall hit-test + opening insertion | DOOR_WINDOW 模式沒做 | 🟠 |

### `switchesLayer.js` vs `oldSrc/features/editor/layers/SwitchLayer.jsx`

| 項目 | oldSrc | 我寫的 | severity |
|---|---|---|---|
| Chassis fill | dark slate `#1f2937` (normal) / kind color (hover invert) | dark slate 固定 | 🟡 沒 hover invert |
| **Chassis stroke selected color** | 紅 `#e74c3c` | **黃 `#fbbf24` (via selectionOverlay)** | 🔴 |
| **Chassis size by port count** | width = 30 \* s \* widthMult (24-port 1×, 48-port 1.5×, ≤12 0.8×) + isCore +2 px height | width by kind (switch 26 / idf 32 / mdf 44 / router 30), 14 高 | 🔴 用 kind 不是 portCount，公式完全不同 |
| **Port row** | 24/48 等 small port dots **per kind color**, equally spaced | 24 個 yellow `#facc15` pip | 🔴 顏色錯 |
| Status LED | top-left corner kind color | 同 | 🟢 |
| **Kind decoration（top edge）**| **oldSrc 完全沒有這設計** — 用 chassis size + label text 區分 | **我自編 IDF=1 bar / MDF=2 bars / Router=天線 mast** | 🔴 fabricated |
| **Kind label text**（"SW" / "IDF" / "MDF" / "RTR"）| Konva.Text 在 chassis 上 | **完全沒做** | 🟠 |
| **Focus halo (17-2)** | dark slate rounded rect at +4 \* s, `#818cf8` indigo stroke 3 \* s opacity 0.85 | 沒做 | 🟠 |
| **Snap status (17-4)** | snapped=綠 dot + dashed cyan foot-drops / loose=灰 dot + 紅 warning | **完全沒做** | 🟠 重要 UX |
| **Hover invert** | hovered + 非 selected → chassis fill kind color, stroke 變 dark | 沒做 | 🟡 |

### `traysLayer.js` vs `oldSrc/features/editor/layers/CableTrayLayer.jsx`

| 項目 | oldSrc | 我寫的 | severity |
|---|---|---|---|
| **Channel border color (selected)** | 白 `#ffffff` (TRAY_SELECTED_BORDER) | 黃 `#fbbf24` (via selectionOverlay) | 🔴 |
| Channel border color (normal) | sys.color | 同 | 🟢 |
| **Magnet halo color** | `rgba(129, 140, 248, 0.12)` indigo | `rgba(255, 255, 255, 0.06)` 白 | 🔴 |
| Channel half-width | widthMm scaled + inverseScale | 固定 3 px world space | 🟡 |
| Border line width | 隨 inverseScale, hovered 2.4 \* s normal 2 \* s | 1.2 px 固定 | 🟡 |
| Centerline dash | sys.color + dash 跟 inverseScale | dash [3, 3] 固定 | 🟡 |
| Body fill | sys.fill (system rgba) | 同 | 🟢 |
| Hover invert | hovered + 非 selected → border = fill 色 / center = 白 | 沒做 | 🟡 |
| **Vertex handles** | 每 vertex 紅 X delete badge + mid-segment insert + split-segment context menu | **handles 只是 yellow dot drag** | 🟠 |
| Endpoint extension cap | startExt/endExt overlay (draw mode 延伸提示) | 沒做 | 🟡 |

### `cablesLayer.js` vs `oldSrc/features/editor/layers/CableLayer.jsx`

| 項目 | oldSrc | 我寫的 | severity |
|---|---|---|---|
| **Tray-route color (copper)** | **per-tray system color (sys.color)** | 全部 `#06b6d4` 固定 cyan | 🟠 |
| **Drop-leg dashed at endpoints** | 端點延伸進 tray 那段 dashed (drop-leg)，主幹 solid | 全條 solid (copper) | 🟠 |
| Fiber dash | 長 dash [18s, 8s] | [12, 6] | 🟡 |
| **Fiber color** | trunk system color, **dashed** (不是另外換色) | **我用 rose `#f43f5e`** | 🔴 顏色錯 |
| Fallback Manhattan | 灰 `#9ca3af` dash [14s, 10s] | `#9ca3af` dash [6, 4] | 🟡 |
| **Unroutable badge** | 紅 `#ef4444` Circle radius 8 \* s fill + 白 stroke + "!" Text | 紅 stroke circle radius 14 (no fill, no !) | 🟠 |
| **Selection-driven dim** (17-2) | 沒選 → 1.0；選 AP/SW → 不相關的 opacity 0.18 | 沒做 | 🟠 |
| **Focus highlight band** | HIGHLIGHT_FILL `rgba(129, 140, 248, 0.55)` 粗 indigo band 蓋 focused route 下面 | 沒做 | 🟠 |
| **S2S switch-to-switch links** | 完整 render (紫色 trunk) | 沒做 | 🟠 oldSrc 14-2 |

### `scopesLayer.js` vs `oldSrc/features/editor/layers/ScopeLayer.jsx`

| 項目 | oldSrc | 我寫的 | severity |
|---|---|---|---|
| In-scope fill | `rgba(46, 213, 115, 0.18)` green | `rgba(34, 197, 94, 0.10)` 較暗綠 | 🟡 RGB 不同 + alpha 較低 |
| **In-scope stroke** | `#2ed573` strokeWidth 3 | `rgba(34, 197, 94, 0.65)` 1.5 px | 🔴 顏色 + 寬度 |
| Out-scope fill | `rgba(255, 71, 87, 0.18)` red | `rgba(239, 68, 68, 0.10)` | 🟡 |
| **Out-scope stroke** | `#ff4757` 3 px **dashed [8, 4]** | `rgba(239, 68, 68, 0.65)` solid 1.5 px | 🔴 缺 dash + 顏色 |
| Selection / hover | selected 紅 5 px / hover 白 5 px + shadow blur | 透過 selectionOverlay 但顏色錯 | 🟠 |
| Shadow blur | shadowBlur 4 (normal) / 8 (hover) | 沒做 | 🟡 |
| Drag whole scope | 整 polygon group draggable | 沒做 | 🟠 |

### `floorHolesLayer.js` vs `oldSrc/features/editor/layers/FloorHoleLayer.jsx`

| 項目 | oldSrc | 我寫的 | severity |
|---|---|---|---|
| **Fill** | `rgba(124, 58, 237, 0.20)` purple | `rgba(15, 23, 42, 0.45)` 深灰 | 🔴 |
| **Stroke** | `#7c3aed` purple solid | `rgba(231, 76, 60, 0.85)` 紅 dashed | 🔴 顏色 + 樣式錯 |

### `selectionOverlayLayer.js` & `hoverOverlayLayer.js`

| 項目 | oldSrc | 我寫的 | severity |
|---|---|---|---|
| **Selection 主色** | 紅 `#e74c3c` 統一 (所有 layer) | **黃 `#fbbf24` + 黑外 halo** | 🔴 全 layer 統一錯 |
| Tray 選取 | 白 `#ffffff` (TRAY_SELECTED_BORDER) | 黃 highlight polyline | 🔴 |
| 17-2 Focus halo | `#818cf8` indigo 圍繞 focus device | 完全沒做 | 🟠 |
| Hover overlay (集中式) | oldSrc **沒有集中 hover layer**，hover 在每 layer 自己處理（switch invert / wall thick / scope white+shadow / tray invert+thick） | 統一 white outline | 🔴 概念不同 |

### `handlesLayer.js` (wall endpoints + tray vertices)

| 項目 | oldSrc | 我寫的 | severity |
|---|---|---|---|
| Wall endpoint | Circle radius 7 \* s, 白 fill, 紅 `#e74c3c` 2.5 \* s stroke | 黃 `#fbbf24` fill + 黑 stroke radius 5 固定 | 🔴 |
| Tray vertex | 含 delete X badge + insert/split affordance | 黃 dot drag only | 🟠 缺 delete + insert + split |
| Snap to other endpoints | wall handle drag 會 snap | 沒做 | 🟠 |

### `draftOverlayLayer.js`

| 項目 | oldSrc | 我寫的 | severity |
|---|---|---|---|
| DRAW_SCOPE preview color | 綠 `#2ed573` 3px + 黑 5px halo + dash [6,4] | **黃 `#fbbf24` 1.6 px no halo** | 🔴 |
| DRAW_FLOOR_HOLE preview color | 紫 `#a855f7` + 黑 halo + dash | 黃 | 🔴 |
| DRAW_CABLE_TRAY preview color | 系統色 (依 placeTraySystem) | 黃 | 🔴 |
| DRAW_WALL preview | oldSrc Editor2D 內 ghost (查) | 黃 | 🔴 估計也錯 |
| First-vertex snap circle | 進範圍 → 大綠/紫圓提示 | 沒做 | 🟠 |
| 黑色外 halo (contrast) | 所有 layer 都有 | 沒做 | 🟠 |

### `floorImageLayer.js`

| 項目 | oldSrc | 我寫的 | severity |
|---|---|---|---|
| Sprite from Texture.from(url) | Konva.Image | PIXI.Sprite | 🟢 移植正確 |
| Crop 區域 | cropX/Y/W/H clipFunc | 完全沒做 | 🟠 |
| Rotation | floor.rotation 套用 | 完全沒做 | 🟠 |
| Opacity | floor.opacity 套用 | 完全沒做 | 🟠 |
| Align transform | alignOffsetX/Y + alignScale + alignRotation | 完全沒做 | 🟠 |

### Tier 1A summary

🔴 嚴重 deviation 集中在：
- **選取色全 layer 應該紅 `#e74c3c`，我用黃** — 影響 wall handle / switch chassis / scope / tray / 全 layer
- **Switch chassis 設計大量自編**（kind decoration / port color / size 公式）
- **Cable fiber 顏色 fabricated**（我用 rose，oldSrc 用同系統色但 dashed）
- **Scope / FloorHole 顏色 + dash 樣式全錯**
- **Draft preview 顏色全錯**（應該每 mode 一個獨立顏色 + 黑 halo）
- **Magnet halo 顏色錯**（應 indigo 不是白）
- **hoverOverlayLayer 概念錯**（oldSrc 是每 layer 自處理 hover）

🟠 缺失大塊功能：
- AP focus halo（17-2 indigo）
- AP directional fan / custom pattern / axis line
- Switch snap-status indicator（17-4）
- Switch focus halo + kind label
- Cable selection dim others + focus highlight band（17-2）
- Cable drop-leg dashed at endpoints + unroutable !
- Scope selection / hover / drag whole
- FloorImage crop / rotation / opacity / align transform
- Tray vertex delete / insert / split
- Wall endpoint snap + DOOR_WINDOW mode

---

## Tier 1B — Property Panels

### `APPanel.jsx` vs oldSrc (392 LoC)

我有：識別 / 位置 / 無線（freq + ch + width + tx）

oldSrc 還有：
- 🟠 **antenna mode** picker (omni / directional / custom)
- 🟠 **azimuth + beamwidth** sliders (directional)
- 🟠 **patternId picker** + PatternPreview thumbnail (custom)
- 🟠 **mountType** picker (ceiling / wall / floor)
- 🟠 **modelId picker** + AP model list (apModels constant)
- 🟠 **mountHeight** slider
- 🟠 **channel allowed-set warning**（依 regulatoryDomain）
- 🟠 **auto channel button**（greedyChannelAssign trigger）
- 🟡 **PatternPreview** sub-component

### `SwitchPanel.jsx` vs oldSrc

我有：identification (name + kind) / position / mountHeight / hardware (model + portCount + poeBudget)

oldSrc 還有：
- 🟠 **uplinkTo dropdown**（列建築全 switch 供選, 29-3）
- 🟠 **cableType picker** (auto / copper / fiber)
- 🟠 **uplinkPortType** + **uplinkCount**
- 🟠 **wanPortCount / lanPortCount**（Router）
- 🟠 **per-tier downstream count display**
- 🟠 **PoE 用量 vs budget warning** (11-3)
- 🟠 **AP 連線數 vs portCount warning**
- 🟠 **17-4 snap status display**

### `CableTrayPanel.jsx` vs oldSrc

我有：name + system + magnet + vertexCount

oldSrc 還有（19-x engineering panel）：
- 🟠 **Identity** section with color swatch
- 🟠 **Tray kind** (ladder / wire basket / solid / conduit / PVC) — 19-1
- 🟠 **widthMm × depthMm**
- 🟠 **mountHeight + preset picker**（ceiling / wall / under raised floor / custom）— 19-2
- 🟠 **Capacity profile** picker — 19-4
- 🟠 **Per-tray fill ratio** display — 19-4
- 🟠 **AP / cable list inside this tray** — 20-2
- 🟠 **Issues** section
- 🟠 4-section structure (Identity / Load / Path / Issues, 19-5)

### `WallPanel.jsx` vs oldSrc

我有：name + material + topHeight + bottomHeight + length + opening count

oldSrc 還有：
- 🟠 **Openings list** with per-opening edit (type / material / startFrac / endFrac / height)
- 🟠 **Add opening** button (door / window)
- 🟠 wallLossDb display computed via frequency
- 🟠 per-material dB inline info

### `CableSummaryPanel.jsx` vs oldSrc (598 LoC)

我有：total cable length + per-status counts + per-floor + unroutable list

oldSrc 還有：
- 🟠 **BOM 分類**: AP-to-Switch vs S2S 分開 (14-3)
- 🟠 **Copper vs Fiber 分開**
- 🟠 **長度級距**: <30m / 30-90m / >90m
- 🟠 **Per-IDF cable usage** breakdown
- 🟠 **Tray Planning BOM**: 總長 / 彎頭數 / T 接 / 跨接 / 餘料係數 (20-1)
- 🟠 **buildGraph warnings 顯示** (13-2)
- 🟠 **Tier 細分** backbone / distribution / access (29-5)
- 🟠 **匯出 CSV + PDF** dropdown (22-1, 22-2)

---

## Tier 2 — Chrome

### `SidebarLeft.jsx` (~70 LoC vs oldSrc 463 LoC)

我有：title + floor count + floor list + DemoLoader + StressLoader

oldSrc 還有：
- 🟠 **Collapse mode**（compact 36 px width，只 chip）
- 🟠 **Inline rename** floor name
- 🟠 **Per-floor ⋯ menu**（重新命名 / 對齊 / 裁切 / 刪除 / 設定高度）
- 🟠 **Confirm dialog** for removal
- 🟠 **Pending switch confirmation**（ALIGN_FLOOR mode）
- 🟠 **File import** (drag-and-drop PDF / image)
- 🟠 **Floor reorder** (drag-and-drop)

### `PanelRight.jsx`

我有：4 panel routing (ap/switch/cable_tray/wall) + slide-in

oldSrc 還有：
- 🟠 **scope** panel routing
- 🟠 **floor_hole** panel routing
- 🟠 **floor_image** panel routing
- 🟠 **floor_align** panel routing
- 🟠 **cable_riser** panel routing
- 🟠 **batch** panel routing (selectedItems.length > 1)
- 🟠 **toggle collapse button**（邊緣 chevron）

### `HeatmapControl.jsx`

我有：pill + mode select + 設定 panel + 公式 + Legend + readout

oldSrc 額外：
- 🟡 hover readout 有 **best AP highlight**
- 🟡 hover readout 顯示 meters position

### `Toolbar.jsx`

我有：5 group + Undo/Redo (disabled)

oldSrc 還有：
- 🟠 **AI walls action**（aiWalls icon trigger）
- 🟠 **Confirm dialog** when switching mode while ALIGN_FLOOR

### `CanvasArea.jsx`

我有：FloorplanSystem + Toolbar + LayerToggle + ActiveModeBadge + HeatmapControl + CableSummary + ScaleBar + RegulatorySelector

oldSrc 還有：
- 🟠 **DevicePlanningPanel**（auto channel / auto power）
- 🟠 **3D view switching** (Viewer3D)

### `DemoLoader`

| 項目 | severity |
|---|---|
| 🗺 emoji → SVG `aiWalls` icon | 🔴 user 明確抓到的 deviation |
| 缺 compact mode | 🟡 |

---

## Tier 3 — Wholesale ports（cp 過來的）

| 檔案 | 狀態 |
|---|---|
| `Icon/Icon.jsx` | 🟢 完全照搬 |
| `Tooltip/Tooltip.jsx + .sass` | 🟢 完全照搬 |
| `RegulatorySelector/*` | 🟢 完全照搬 |
| `ScaleBar/ScaleBar.jsx + .sass` | 🟢 完全照搬（新加 ScaleBarMount.jsx bridge）|
| `ContextMenu/ObjectContextMenu.jsx + TrayContextMenu.sass` | 🟢 完全照搬 |
| `ConfirmDialog/*` | 🟢 完全照搬 |
| `FormulaNote/*` | 🟢 完全照搬 |
| `HeatmapControl/HeatmapLegend.jsx` | 🟢 完全照搬 |
| `LayerToggle/*` | 🟢 完全照搬 |
| `StressLoader/StressLoader.jsx` | 🟡 jsx 照搬 BUT 內聯 DEFAULT_AP_MODEL_ID + DEFAULT_CHANNEL_WIDTH（因 apModels.js / channelWidths.js 沒 port）|
| `StressLoader/StressLoader.sass` | 🔴 整個重寫了（fixed → flex inline）|
| `TopBar/*` | 🟡 3D button 加 disabled，其他照搬 |

---

## Tier 4 — Fabricated（無 oldSrc 對應檔）

| 檔案 | 是否合理 |
|---|---|
| `render/scene.js` | ⚪ 必要 |
| `render/viewport.js` | ⚪ 必要 |
| `render/heatmapAdapter.js` | ⚪ 必要 |
| `render/heatmapHoverBinder.js` | ⚪ 必要 |
| `render/layerVisibilityBinder.js` | ⚪ 必要 |
| `render/draftModeController.js` | ⚪ 必要 |
| `store/useViewportStore.js` | ⚪ 必要 |
| `store/useHoverStore.js` | 🔴 概念錯（oldSrc 是 in-layer 處理，我搞集中化）|
| `store/useDraftStore.js` | ⚪ 必要 |
| `store/useHistoryStore.js` | ⚪ stub |
| `components/Toolbar/ActiveModeBadge.jsx + .sass` | 🔴 位置 / 配色 / accent 都自編。Phase 24-4 spec 提到應有，但 oldSrc 我沒讀過 mode-hint banner 實作 |
| `components/ScaleDialog/*` | 🟡 oldSrc 有 `features/editor/ScaleDialog.jsx`，我沒對照就自寫 |
| `components/ScaleBar/ScaleBarMount.jsx` | ⚪ React state bridge |
| `components/ContextMenu/ContextMenuMount.jsx` | ⚪ store↔menu bridge |
| `components/PanelRight/_panel.sass` | 🟡 我自定 `.obj-panel` 共用 chrome；oldSrc 各 panel 自有 sass |

---

## Stores

| 檔案 | 狀態 |
|---|---|
| `useEditorStore.js` | 🟡 重新港但少了 alignRefFloors / alignRefOpacity / show3DAllFloors |
| `useFloorStore.js` | 🟠 缺 importImageFloor / importMultipleFloors / floorSlabMaterialId / floorSlabAttenuationDb |
| `useWallStore.js` | 🟢 wholesale |
| `useAPStore.js` | 🟢 wholesale |
| `useCableStore.js` | 🟢 wholesale |
| `useHeatmapStore.js` | 🟢 wholesale |
| `useScopeStore.js` | 🟢 wholesale |
| `useFloorHoleStore.js` | 🟢 wholesale |
| `useDragOverlayStore.js` | 🟢 wholesale |
| `useHoverReadoutStore.js` | 🟢 wholesale |

---

## 全局 Summary — 影響面 vs 工程量

### 🔴 CRITICAL — 7 個視覺主題（user 明確指出「我自選顏色」）

1. **選取色全 layer 統一錯**：紅 `#e74c3c` → 黃。影響 wall handle / switch / scope / tray / 全 layer。**fix 容易**：改 1 個常數
2. **Switch chassis 完全自編**：kind decoration（IDF/MDF/Router top 邊條 / 天線）、size 公式（用 kind 不是 portCount）、port pip color。**fix 中等**：重新照 oldSrc 算 widthMult + 拿掉 kind decoration + port pip 用 kind color
3. **Cable fiber 顏色 fabricated**：rose → 應跟 copper 同系統色但 dashed
4. **Magnet halo 顏色**：白 → indigo `rgba(129, 140, 248, 0.12)`
5. **Scope / FloorHole 顏色 + dash**：近似但不同 RGB + 缺 dash + 缺 shadow
6. **Draft preview 顏色**：全用黃 → 應按 mode 分（scope 綠 / hole 紫 / wall 系統色），且加黑 halo
7. **DemoLoader icon**：emoji → SVG（user 明確抓到的）
8. **hoverOverlayLayer 概念錯**：應 in-layer 處理 hover，不集中

### 🟠 MAJOR — 缺失功能塊（oldSrc 有但我跳過 / 簡化）

主要分類：
- **focus halo（17-2 indigo）** — AP / switch / cable 統一概念（選 SW 時相關亮、其他暗）
- **Switch snap status（17-4）** — UX 重要
- **AP antenna** directional fan / custom pattern polygon / axis line
- **完整 property panels** — 4 個 panel 都 slim 版，缺 60%+ 欄位
- **CableSummary BOM 細分** — copper/fiber/tier / 長度級距 / export
- **Floor image transform** — crop / rotation / opacity / align
- **Sidebar 互動** — collapse / rename / 每樓層 menu / file import
- **Tray vertex 編輯** — delete / mid-insert / split / endpoint extension

### 🟡 MINOR — 細節差別

magic number (radius / strokeWidth / dash pattern / font size) / 內聯 const / sass 改寫 — 多數可最後一起調

### 🟢 OK / ⚪ 必要新基建

所有 cp 的檔案 + PIXI 必要 bridge

---

## 建議優先順序（如果要 fix）

1. **第一波 fix（半天）**：8 個 CRITICAL 全 fix — 視覺一致性立刻拉滿
2. **第二波 fix（1-2 天）**：focus halo + snap status + directional AP fan — 視覺缺失功能補回
3. **第三波 fix（3-5 天）**：4 panel 補完所有 oldSrc 欄位 + CableSummary BOM 細分 — 內容對齊
4. **第四波 fix（1-2 天）**：Sidebar 完整互動 + Floor image transform + Tray vertex edit
5. 之後做 perf shader（31-4 / 31-5 / 31-6）

第一波 + 第二波就讓視覺 100% 對齊。第三 + 第四波是功能對齊。

---

## 第一波 fix 進度（2026-05-26）

| # | 內容 | 狀態 | 改動檔案 |
|---|---|---|---|
| C1 | 選取色全 layer 統一改紅 `#e74c3c`，tray 改白 `#ffffff` | ✅ | `selectionOverlayLayer.js`、`handlesLayer.js`、`switchesLayer.js` |
| C2 | Switch chassis 改 portCount 公式 + isCore 高度 + kind 色 port pip + KIND_LABEL | ✅ | `switchesLayer.js`、新增 `switchChassis.js` 共用 util |
| C3 | Cable 移除 fiber rose 顏色；AP route 一律 cyan `#22d3ee`，drop-leg 端點 dashed | ✅ | `cablesLayer.js` |
| C4 | Tray magnet halo 改 indigo `rgba(129, 140, 248, 0.12)` | ✅ | `traysLayer.js` |
| C5 | Scope in 綠 / out 紅 dashed；FloorHole 改 purple 實線 | ✅ | `scopesLayer.js`、`floorHolesLayer.js` |
| C6 | Draft preview 改 per-mode 顏色（wall cyan / scope 綠 / hole 紫 / tray cyan / scale 黃）+ 黑 halo | ✅ | `draftOverlayLayer.js` |
| C7 | DemoLoader icon emoji → SVG | ✅ 早已 done（用 `<Icon name="aiWalls">`）| — |
| C8 | Hover overlay 拆 in-layer：switch 在 layer 自做 invert，hoverOverlay 只剩 AP + Wall | ✅ | `switchesLayer.js`、`hoverOverlayLayer.js` |

**MCP 視覺驗證**：dev server 5175 + DemoLoader 載入 + 注入 scope / hole / select switch，screenshot 顯示：
- 選中 SW 出現紅外框 ✓
- 綠 / 紅 dashed scope polygon ✓
- 紫 floor hole 實線 ✓
- Tray 周圍淡 indigo magnet ✓
- AP route cyan 主幹 + dashed drop-leg ✓
- DRAW_SCOPE / DRAW_FLOOR_HOLE draft 個別顯示綠 / 紫 + 第一頂點 halo ring ✓

---

## 第二波 fix 進度（2026-05-26）

| # | 內容 | 狀態 | 改動檔案 |
|---|---|---|---|
| W2-1 | **17-2 AP focus halo** — 選 SW 時，每顆 routing 到該 SW 的 AP 出現 indigo `#818cf8` ring | ✅ | `apsLayer.js`、新增 `focus/focusedDevices.js` 共用 util |
| W2-2 | **AP directional fan 改 annular wedge** — inner radius `AP_RADIUS+2` outer `+18`，不再從原點切片 | ✅ | `apsLayer.js` |
| W2-3 | **17-2 Switch focus halo** — 選 AP 時 destination SW 出現 indigo rounded-rect ring | ✅ | `switchesLayer.js` |
| W2-4 | **17-4 Switch snap status** — snapped 綠 `#22c55e` 角落圓 dot + dashed cyan foot-drop 到每條 magnet 內 tray；loose 灰 dot + 紅 `#ef4444` ! warning | ✅ | `switchesLayer.js`（用既有 `computeSwitchSnaps`）|
| W2-5 | **17-2 Cable focus dim + indigo highlight band** — 沒選 → 全 1.0；選 AP / SW → 不相關 route opacity 0.18；focus 的 route 底下加 indigo `rgba(129, 140, 248, 0.55)` 寬 band（HIGHLIGHT_WIDTH 10） | ✅ | `cablesLayer.js` |
| - | **FloorplanSystem injection 補 `useCableStore` 給 APsLayer、`useAPStore` 給 SwitchesLayer** | ✅ | `FloorplanSystem.jsx` |

**MCP 視覺驗證**：選 SW 後，related AP 出現 indigo halo ring、cable 顯示 indigo highlight band 在線下、SW chassis 出現紅選取邊 + 綠 snap dot + green LED + green port pips + "SW" label。Directional AP 顯示 annular wedge fan（不是切片）。

剩餘 audit 項目：第三波 panel 補欄位、第四波 Sidebar / FloorImage transform / Tray vertex menu。Perf shader（31-4 / 31-5 / 31-6）仍未動。
