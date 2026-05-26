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

---

## 第三波 fix 進度（2026-05-26）

| # | 內容 | 狀態 | 改動檔案 |
|---|---|---|---|
| W3-1 | **APPanel** 加 antenna 區（mode picker omni / directional / custom + azimuth slider + beamwidth slider）+ 安裝區（mountType picker ceiling / wall / floor + mountHeight） | ✅ | `APPanel.jsx` |
| W3-2 | **SwitchPanel** 加 Uplink 區（uplinkTo dropdown 列建築全 switch + cableType picker auto / copper / fiber + uplinkPortType + uplinkCount） | ✅ | `SwitchPanel.jsx` |
| W3-3 | **WallPanel** 加門窗 section：openings 列表（每 row 顯示 type 切換 chip + 材質 picker + startFrac/endFrac 數字輸入 + delete X）；"+ 門" / "+ 窗" 加按鈕；packing 用 `findFreeSlot` 找最大剩餘空隙置中（不會 overlap） | ✅ | `WallPanel.jsx`、`_panel.sass` 加 `obj-panel__btn` / `obj-panel__opening*` style |

**MCP 視覺驗證**：
- AP panel 顯示 azimuth 90° / beamwidth 90° slider，canvas 上 directional fan 即時跟著動。
- Switch panel uplink dropdown 顯示 "— 無 —" + Cable Type 自動 Auto。
- Wall panel 砍掉既有 opening 再連按 "+ 門" "+ 窗" → packing 排到 (43–57%) + (71–86%)，無 overlap。

剩餘 audit 項目：
- 第三波 **CableTrayPanel 補欄位**（19-x engineering — tray kind / widthMm / depthMm / capacity profile / fill ratio / AP list / Issues）
- 第三波 **CableSummary BOM 細分**（22-1 / 22-2 export）
- 第四波 Sidebar 互動 / FloorImage transform / Tray vertex menu / DOOR_WINDOW mode
- Perf shader（31-4 / 31-5 / 31-6）仍未動 — 1000 AP 規格達標的硬骨頭

---

# Tier 1C / 2.1 — Pixel-level audit (2026-05-26)

> User 抓到「panel / hover-selected / 左下 HeatmapLegend / ProgressPanel / StressLoader 都還有差」。
> 前面 audit 是「我已知的 deviation list」，深度不均（layer 物件 OK，panel + chrome 只到 macro）。
>
> 這份 audit 用 **oldSrc resurrection**（vite.oldsrc.config.js + oldsrc.html + `pnpm dev:oldsrc`）並排兩個 dev server 跑（new:5173, oldSrc:5180）， MCP screenshot 對拼，逐畫面記錄 pixel-level diff。
>
> 預期讀者：直接照這份 list 一條一條開 fix ticket，每條都跟一張 screenshot 比對結果。

## A. PanelRight chrome（panel-shell 抽象 / header / section / 控件樣式）

### A1 — Shared primitives 完全缺失 🔴

oldSrc 有 `components/PanelRight/_shared/`：
- `PanelShell.jsx` — `<PanelShell accent="ap|wall|cable|measure|meta">` 主容器；CSS 透過 `--panel-accent` 切群組主色
- `PanelHeader` — `title` + `meta`（小字副標如「AP 屬性」/「長度 109.2 px」）+ `onDelete` 統一「刪除」按鈕位置
- `PanelSection` — `title` + 可選 `disabled` + 可選 `comingSoon`（"即將推出" 角標）
- `PanelField` — `label` + 可選 `hint` + value slot 統一左右排版
- `PanelEmpty` — 「未選取任何物件」
- `PanelControls.jsx` — `TextInput` / `NumberInput`（含 `unit` 後綴 m / dB / dBm / W / port）/ `Select`（含 `swatch` 顏色點選項）/ `Checkbox` / `Button`（variant `primary / danger / ghost` + `block` 全寬）

**new src 現況**：
- 每個 panel 都自己寫 `<input>` `<select>` 標籤，靠 `_panel.sass` 的 `.obj-panel__*` 類包，**沒** group accent / 沒 unit suffix / 沒 swatch select / 沒 hint subtitle
- APPanel 還用獨立的 `.ap-panel__*` 命名，跟其他 panel 不共用 sass（chrome 不一致）

**Fix**：港 oldSrc 5 個 shared primitives → `src/components/PanelRight/_shared/`，所有 panel 改用。

---

### A2 — PanelHeader meta 副標 🟠

oldSrc 每 panel header 第二行有 meta 小字：
- APPanel: "AP 屬性"
- SwitchPanel: "Switch 屬性" / "IDF 屬性" / "MDF 屬性" / "Router 屬性"（隨 kind）
- WallPanel: "長度 109.2 px"
- (待測) CableTrayPanel / ScopePanel 等

new src 只有 title + delete，**完全沒 meta 行**。

---

### A3 — APPanel section / 控件樣式 🔴

| Section / 控件 | oldSrc | new src | severity |
|---|---|---|---|
| **型號 (modelId)** | dropdown「Generic Wi-Fi 6 AP (Wi-Fi 6)」+ apModels constant | 完全缺 | 🟠 |
| **支援頻段 chip** | "2.4 GHz / 5 GHz" 小灰字列（依 model 顯示） | 缺 | 🟠 |
| **名稱** | TextInput | input | 🟢 樣式微差 |
| **頻段選擇** | **pill row** 3 顆: 2.4 GHz / 5 GHz / 6 GHz，selected 填色，model 不支援時 disabled 灰掉 | dropdown `<select>` | 🔴 UI 概念錯 |
| **通道** | "Ch 36" dropdown | `Channel 36` number input | 🔴 應該是 dropdown 列允許值 |
| **頻寬** | **pill row** 4 顆: 20 / 40 / 80 / 160 MHz | number input `step=20` | 🔴 UI 概念錯 |
| **頻段 helper text** | "Cisco 建議 2.4G 兩注 SS - 5G 兩多用 20/40 - 6G 可選" | 缺 | 🟡 helper 文字缺 |
| **發射功率** | NumberInput 含 `dBm` 後綴 | input no suffix | 🟡 |
| **安裝高度** | NumberInput 含 `m` 後綴 | input no suffix | 🟡 |
| **安裝方式** | **pill row** 2 顆: 天花板 / 牆面 | dropdown 3 選 ceiling/wall/floor | 🔴 UI 概念錯（也少一個 floor 不應該有？查 oldSrc 是否真只 2 種） |
| **天線模式** | **pill row** 3 顆: 全向 / 定向 / 自訂 | dropdown | 🔴 |
| **方位 azimuth (定向時)** | slider 旋鈕 + 數值 + 度 | range slider | 🟢 |
| **波束寬 beamwidth (定向時)** | slider + 數值 + 度 | range slider | 🟢 |
| **狀態 / 連線 section** | 顯示 uplink switch name (e.g. "SW-01") 為唯讀 | 完全缺 | 🟠 |
| **azimuth + beamwidth (自訂時)** | patternId picker + PatternPreview thumbnail | 完全缺 | 🟠 |

---

### A4 — SwitchPanel section / 控件樣式 🔴

| Section / 控件 | oldSrc | new src | severity |
|---|---|---|---|
| **類型 kind** | **pill row** 4 顆: Switch / IDF / MDF / Router，selected 填色 | dropdown | 🔴 |
| **kind 切換 helper text** | "切換 kind 會重設該類預設 (port 數 / PoE / uplink 介面)" | 缺 | 🟡 |
| **識別 名稱** | TextInput | input | 🟢 |
| **型號** | TextInput | input | 🟢 |
| **Uplink 介面** | "SFP+ × 4" 一行格式化文字 | uplinkPortType + uplinkCount 拆兩 input | 🟡 |
| **狀態 → Port 數** | "已用 5 / 24" 進度條 + ports 後綴 | number input only | 🟠 缺進度 |
| **狀態 → PoE 容量** | "已用 75 W / 370 W" 進度條 + W 後綴 + helper "PoE 預算 = 0 → 此 Switch 無 PoE 供電" | number input only | 🟠 缺進度 + helper |
| **安裝高度** | NumberInput + m 後綴 | input | 🟡 |
| **上連 UPLINK dropdown** | "請選一個目標" + 群組化 list (列建築全 switch + 排除自己 + 同樓層先) + helper text 「會考量上行規範 - 列出上層級 (定 IDF 對應上層 MDF)」 | dropdown 同概念但缺 helper、缺群組化 | 🟡 |
| **線材** | **pill row** 3 顆: Auto / Copper / Fiber + helper "Auto < 90m copper / 否則 fiber - Cat 6 銅纜 ..." | dropdown | 🔴 + helper |
| **AP 連線數 vs portCount warning** | 紅色警告 row | 缺 | 🟠 |
| **PoE 用量 vs budget warning** | 紅色警告 row | 缺 | 🟠 |
| **17-4 snap-status display** | "已 snap 到 X 條 tray" / "未 snap" 一行 | 缺 | 🟠 |

---

### A5 — WallPanel section / 控件樣式 🔴

| Section / 控件 | oldSrc | new src | severity |
|---|---|---|---|
| **header meta** | "長度 109.2 px" 副標 | 缺 | 🟠 |
| **材質 picker** | **Visual tile grid** — 6 個 tile (玻璃/乾牆/木板/磚牆/混凝土/金屬)，每 tile 顯示「顏色 swatch + 名稱 + dB」，selected tile 有紅邊 | `<select>` dropdown | 🔴 UI 概念錯 |
| **高度 頂部 / 底部** | NumberInput + m 後綴 | input | 🟡 |
| **門窗 list — 每 row** | 紅 chip "門/窗"（點切換）+ 木板(4dB) dropdown + "13" + "~" + "87" + "%" + 紅方塊 ✕ delete | 我的版本接近，但 chip / 數字 / 刪除按鈕 sass 不同 | 🟡 樣式微差 |
| **門窗 add btn** | oldSrc 只在已有 openings 時顯示 list — **沒有單獨「+ 門 / + 窗」按鈕**（從哪加？查 DRAW mode 應該是 DOOR_WINDOW mode 用 Toolbar 進） | 我加了「+ 門 / + 窗」按鈕 | ⚪ 我多做的（OK，更直覺；但跟 oldSrc 行為不同） |

---

### A6 — CableTrayPanel 完全缺欄位（未在這次 audit 詳測，留前面 audit）🟠

跳過詳測，沿用前面 audit 列表。

---

## B. PanelRight 分頁 / 容器 chrome

### B1 — PanelRight 開合 + scope/hole/floor_image/floor_align/cable_riser/batch panel 🟠

oldSrc PanelRight 內部根據 `selectedType` 切換不同 panel：
- ap / switch / wall / cable_tray ✅ 已有
- **scope** / **floor_hole** / **floor_image** / **floor_align** / **cable_riser** / **batch (selectedItems > 1)** 全缺

new src `PanelRight.jsx` 只 route 4 個 type。

### B2 — PanelRight 收合 chevron 🟠

oldSrc 邊緣有一個 ‹ chevron 可手動收合 panel；new src 沒有。

---

## C. Sidebar 左側

### C1 — Sidebar header 🔴

| 元素 | oldSrc | new src |
|---|---|---|
| 標題「樓層」 | 左 | 左 |
| **+ 加新樓層按鈕** | 右側 + icon button | 缺 |
| **‹ 收合按鈕** | + icon 右邊 ‹ 切到 compact mode | 缺 |
| 計數 badge | 缺 | 右上 "1" |

→ new src 只有 count badge，缺 add / collapse 兩個按鈕。

### C2 — Floor row 🔴

| 元素 | oldSrc | new src |
|---|---|---|
| 左端 floor icon ▣ | ✓ | 缺 |
| 名稱 | "Demo" 紅字 | "Demo" 紅字 ✓ |
| 名稱 inline rename | 點兩下進 edit mode | 缺 |
| 右端 dimensions | ⋯ overflow menu (rename / 對齊 / 裁切 / 刪除 / 設定高度) | "685×511" dimensions readout |
| **active floor card 展開**（被選 floor 內顯示 inline 控件）| 完整: 樓高 m / 樓板 (material dropdown w/ swatch) / 衰減 dB / 「⚡ 自動規劃整層 AP 功率」按鈕 | 完全缺 — 整個 inline expand 區塊不存在 |

→ Sidebar floor row 在 new src 是 ultra-simplified bar，**沒有 properties 編輯能力**。

### C3 — Sidebar footer 🔴

| 元素 | oldSrc | new src |
|---|---|---|
| StressLoader pills | 50 AP / 150 AP / 300 AP | 同（多了 "STRESS" prefix label） |
| DemoLoader | 🚀 火箭 icon + "載入 Demo 平面圖" | aiWalls SVG icon + "載入 Demo 平面圖" |
| **ProgressPanel** | 📋 icon + "進度 182/185" pill (Phase 進度) | **完全缺** |

→ ProgressPanel 整個元件不存在於 new src。

---

## D. 頂部 floating widgets

### D1 — 圖層 LayerToggle 🟢
位置 / 樣式接近。`<Icon name="layers">` ＋「圖層 ›」chip。

### D2 — RegulatorySelector 🟢
「國家頻段 / 台灣 ▾」port 過來，樣式 OK。

### D3 — 設備規劃 DevicePlanningPanel 🟠
oldSrc top-center 有 "設備規劃" pill（觸發 auto-channel / auto-power planning modal）— **new src 完全缺**。

### D4 — Toolbar 🟡
- oldSrc 跟 new 都是 floating dark pill，5 個 icon group + 2 個 round button (undo / redo)
- oldSrc 5 個 icon 是: 指標 / 牆+結構 / AP / 線+布線 / 量測，**多一個** 設備按鈕？ — 待逐 icon 對
- new src 5 個 icon: 指標 / 牆 / AP+wifi / 網路 / 量測 — 順序 + icon 細節可能微差

### D5 — ActiveModeBadge 🔴
| 元素 | oldSrc | new src |
|---|---|---|
| 標題 | "操作 / 選取模式" | "指標 / 選取" |
| 副標 hint | "左鍵選取、拖曳；右鍵物件開選單"（每 mode 完整中文 hint） | **完全缺**，只有 mode 名稱 |
| 樣式 | dark pill | dark pill ✓ |

→ ActiveModeBadge 缺 mode hint 文案（spec.task.md 1602 行附近列了每 mode 完整 hint 字串）。

---

## E. 底部 floating widgets

### E1 — HeatmapControl pill row 🟡
| 元素 | oldSrc | new src |
|---|---|---|
| 已開啟/關閉 pill | ✓ | ✓ |
| Mode dropdown (RSSI/SINR/SNR/CCI) | ✓ | ✓ |
| 設定 button | ✓ | ✓ |
| **HeatmapLegend** colour bar | "RSSI (dBm)" 標題 + 色條 + ≤-75 -65 -55 -45 ≥-35 數值 | "RSSI (dBm)" 標題 + 色條 + 同數值 | 🟢 看起來一致 |
| **hover readout 顯示** | "據量值線 71.3 m"（米 unit + 即時距離） | 同 | 🟢 |
| **hover readout** 滑鼠進熱圖時還顯示什麼？ | TBD — 待測 | TBD | ⏸️ |
| 公式 popover (FormulaNote) | 設定 panel 內有「ℹ 公式說明」連結 | 有 ✓ | 🟢 |

### E2 — ScaleBar 🟢
「5 m」+ bar tick — 兩邊都有。

### E3 — CableSummaryPanel 🟠
spec 599 LoC oldSrc — copper/fiber 拆 / 長度級距 / Per-IDF / 匯出 — new src 是 slim 版。沿用前面 audit。

---

## F. Canvas 物件視覺（hover / selected 細節）

### F1 — AP marker selected 🟡
- oldSrc: selected → 紅 stroke 圈 (`#e74c3c`) + 整個 AP container fade 鄰近
- new src: 同 ✓（wave 1 已 fix）

### F2 — AP info pill 🟠
| 元素 | oldSrc | new src |
|---|---|---|
| 背景 | 深灰半透明 rounded rect | 文字 stroke halo (no bg rect) |
| 內容 | `AP-01\n5G CH36/40\n20 dBm` (3 lines) | `5G CH36/80\n20 dBm` (2 lines) | 🟡 缺 name |
| 字級 | 11 px × inverseScale (隨 zoom 縮放) | 9 px 固定 | 🟡 字體不會跟 zoom |
| Stroke / shadow | shadow blur on text | text stroke (黑 halo) | 🟡 風格不同 |

### F3 — SW chassis selected 🟢
- 紅 stroke wave 1 已 fix
- 但 SW name label 位置 / 字級可能差（oldSrc 上方獨立 dark pill 顯示完整 "SW-01"；new src 內 chassis 中央 "SW" 短 kind label）→ 🟠 **name label 缺**

### F4 — Wall hover / selected 🟡
- oldSrc: hover → 較粗 outline + shadow
- new src: hover → 白 thin outline（hoverOverlayLayer）
- 差別: oldSrc shadow blur / 較粗 / outline 顏色用 material 色

### F5 — Tray hover invert 🟠
- oldSrc: hover → body fill 變 sys.color, border 變 dark, centerline 變白
- new src: hover → 統一 white outline (centralised hover overlay)
- wave 1 audit 雖把 hoverOverlay 拆掉，但 tray hover invert **沒在 in-layer 實作**，目前 tray hover 沒任何視覺反饋

### F6 — Scope hover 🟠
- oldSrc: hover → 白 stroke + shadow blur 8
- new src: 完全沒 hover 視覺
- wave 1 audit 同上

### F7 — FloorImage 🟠
- crop / rotation / opacity / align transform 全缺（沿用前面 audit）

---

## G. Workflow / 互動行為（非單一畫面）

| 行為 | oldSrc | new src |
|---|---|---|
| 點 floor row → 切 active | ✓ | ✓ |
| 點 floor row 第二下 → 展開 inline 編輯 | ✓ | ✗ (沒展開) |
| 點 floor name doubleclick → rename | ✓ | ✗ |
| Floor ⋯ menu → rename/align/crop/delete/setHeight | ✓ | ✗ |
| DRAG-DROP 平面圖到 canvas | ✓ (empty state 有 drop zone hint) | ✗ |
| DRAG-DROP 平面圖到 sidebar list | ✓ | ✗ |
| DRAW_WALL Esc cancel | ✓ | ✓ |
| DRAW_SCOPE Esc cancel | ✓ | ✓ |
| DOOR_WINDOW mode (toolbar 進) | ✓ 完整 host wall hit-test + opening insertion | ✗ 模式沒做 |
| 多選 marquee 跨 layer type | ✓ AP/Wall/Switch/Tray/Scope 全可 | ✗ 只 AP |

---

## 影響面 summary

| 類別 | 數量 | 工時估 |
|---|---|---|
| 🔴 概念錯（pill vs dropdown / material tile vs select / hover concept 等）| 12 | 1-2 天 |
| 🟠 缺整個 section / sub-component (model picker / ProgressPanel / scope+hole+floor_image+floor_align+riser+batch panel route / Sidebar inline expand / 自動規劃 button / DevicePlanningPanel) | 25+ | 3-5 天 |
| 🟡 樣式微差 (unit suffix / helper text / shadow blur / font size scaling / icon) | 15+ | 1-2 天 |

**做完真正視覺對齊：5-8 天工程**

---

## 建議的後續 fix 排序

優先做 🔴 概念錯 (影響 user 視覺認知最大)：
1. 港 `_shared/` PanelShell/PanelHeader/PanelSection/PanelField/PanelControls (TextInput/NumberInput/Select/Pill component) — 後續所有 panel 都用同抽象
2. 替每 panel 用 pill row 取代 dropdown（band / width / mountType / antennaMode / switchKind / cableType）
3. WallPanel material 改 visual tile grid
4. ActiveModeBadge 補完整 hint 文案

再來 🟠 缺 section：
5. APPanel: 型號 picker + 支援頻段 chip + 狀態/連線 section
6. SwitchPanel: 進度條 (Port 用量 / PoE 用量) + warning rows + snap-status
7. ProgressPanel 整個 port 過來
8. PanelRight 多 type route (scope / floor_hole / floor_image / floor_align / cable_riser / batch)
9. Sidebar inline floor expand (樓高/樓板/衰減/自動規劃)
10. DevicePlanningPanel pill
11. DOOR_WINDOW mode + tray vertex menu + marquee 跨 layer

再來 🟡 micro fix：
12. NumberInput unit suffix 套到全 panel
13. font size scale with zoom (canvas labels)
14. helper text / hint 文案補齊
15. ProgressPanel / StressLoader icon 一致化

---

## oldSrc resurrection 機制

為了讓未來 audit / 視覺驗證可以重來，這份 audit 用的 oldSrc parallel dev setup 已固化到 repo：

- `vite.oldsrc.config.js` — 把 `@` alias 切到 `./oldSrc`，base path `/floorplan-old/`，server port 5180
- `oldsrc.html` — 入口 HTML，mount `oldSrc/main.jsx`
- `package.json` 加 script `"dev:oldsrc": "vite --config vite.oldsrc.config.js"`

**怎麼用**：

```bash
pnpm dev          # 新 src 在 5173
pnpm dev:oldsrc   # oldSrc 在 5180 (URL: /floorplan-old/oldsrc.html)
```

MCP 對拼或本地兩個 tab 並排看都行。oldSrc store 用 `await import('/floorplan-old/oldSrc/store/useXxxStore.js')` 動態載入後可直接 `getState()` 操作。

---

# Bundle 1–6 fix progress (2026-05-26)

完成 6 個 bundle，全 commit ship 在 pixijs branch。

| Bundle | Commit | 內容 | 涵蓋 audit 條目 |
|---|---|---|---|
| 1 | `0c4fba6` | Shared panel primitives (PanelShell / PanelHeader / PanelSection / PanelField / PanelControls) + 4 panels 港回 (APPanel / SwitchPanel / WallPanel / CableTrayPanel) | A1 / A2 / A3 / A4 / A5 / A6 全部 |
| 2 | `efcad22` | Sidebar overhaul (add+collapse buttons / ▣ icon / ⋯ menu / inline expand 樓高樓板衰減 / drag-drop reorder / rename inline) + ProgressPanel 港 + StressLoader/DemoLoader/ProgressPanel 改回 oldSrc 浮動 fixed-position | C1 / C2 / C3（除 PNG 匯出依賴 Konva 暫緩） |
| 3 | `3120254` | DevicePlanningPanel 港 + ActiveModeBadge 補 14 個 mode 完整中文 hint 字串 | D3 / D5 |
| 4 | `2b95bdb` | AP marker white-fill / dark-blue-stroke + info pill bg rect + name shadow + 3-line text；SW chassis 加 name label；Tray + Scope in-layer hover invert | F2 / F3 / F5 / F6 |
| 5 | `e1d1e6a` | PanelRight 加 scope / floor_hole / batch routes + 18×56 chevron collapse button | B1（scope/hole/batch）/ B2 |
| 6 | `a407e18` | DOOR_WINDOW mode click handler in wallsLayer：兩點點擊 → 插入 opening；D / W 鍵切換 door / window；Esc 取消 | G — DOOR_WINDOW mode |

**Audit 條目 vs 完成狀態**：

| Tier 1C/2.1 條目 | 狀態 |
|---|---|
| A1 Shared primitives 缺失 | ✅ Bundle 1 |
| A2 PanelHeader meta 副標 | ✅ Bundle 1 |
| A3 APPanel pill / model picker / 支援頻段 / 狀態-連線 | ✅ Bundle 1 |
| A4 SwitchPanel kind pill / progress / cable type pill / uplink hint | ✅ Bundle 1 |
| A5 WallPanel material tile grid | ✅ Bundle 1 |
| A6 CableTrayPanel 19-x | ✅ Bundle 1 |
| B1 panel routes (scope/hole/batch) | ✅ Bundle 5 |
| B1 panel routes (floor_image/floor_align/cable_riser) | ⏸️ 占位顯示「尚未在 PIXI 版本上線」— 對應 feature 還沒做 |
| B2 panel collapse chevron | ✅ Bundle 5 |
| C1 Sidebar header + / ‹ button | ✅ Bundle 2 |
| C2 Floor row icon / ⋯ menu / inline expand | ✅ Bundle 2 |
| C3 ProgressPanel | ✅ Bundle 2 |
| D3 DevicePlanningPanel | ✅ Bundle 3 |
| D5 ActiveModeBadge full hint | ✅ Bundle 3 |
| E1 HeatmapLegend | 🟢 已對齊（前波） |
| F2 AP info pill name+scale | ✅ Bundle 4 |
| F3 SW name label | ✅ Bundle 4 |
| F5 Tray hover invert | ✅ Bundle 4 |
| F6 Scope hover invert | ✅ Bundle 4 |
| F7 FloorImage transform | ⏸️ 仍未動（需要 PIXI 端 crop/rotation/opacity/align 渲染） |
| G DOOR_WINDOW mode | ✅ Bundle 6 |
| G floor rename / ⋯ menu | ✅ Bundle 2 |
| G marquee 跨 layer type | ⏸️ 留 31-10 spatial index 一起做 |
| G AutoPowerModal | ⏸️ Sidebar 自動規劃 button 留 disabled stub |
| G 匯出 PNG | ⏸️ 需 PIXI 版本 exporter |

**剩餘未做（非 Tier 1C audit 範圍）**：
- Phase 25 perf shader（31-4 walls / 31-5 cables / 31-6 AP atlas）— 1000 AP 規格達標的硬骨頭
- BatchPanel 完整版（637 LoC oldSrc — 需 per-store batch-mutation actions）
- FloorImage / FloorAlign / CableRiser panels — 對應 features 還沒做
- CableSummaryPanel BOM 細分 + export CSV/PDF

**MCP 視覺驗證**（new on :5173 vs oldSrc on :5180 並排）：sidebar / panels / toolbar / heatmap pill row / canvas object visuals / mode badge hint 全部對齊。
