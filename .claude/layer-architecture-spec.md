# Canvas 渲染架構 — 設計規格

> 多輪設計討論 + PixiJS pivot 收斂版本，2026-05-25。
>
> 雙重對應：
> 1. **短期**：SW + Tray + 50AP 拖曳卡頓（Phase 24 已 ship 解決）
> 2. **長期目標規格**：1000+ AP、5000+ walls、100+ SW、50+ tray、heatmap real-time recompute，30–60 fps 流暢
>
> 落地依據：本 spec + `.claude/task.md` 對應 Phase。

---

## 1. 問題定位

### 1.1 觀察到的現象

| 場景 | 拖曳 AP / SW / Tray 體感 |
|---|---|
| Tray + 10AP | 順 |
| SW + 10AP | 順 |
| SW + Tray + 10AP | 順 |
| **SW + Tray + 50AP** | **卡** |

畫布外操作（hover 熱圖 legend、切 panel、開進度等）任何場景都順。

### 1.2 根因（Phase 24 處理）

所有可互動的向量物件目前全部掛在 [Editor2D.jsx:1710-1947](src/features/editor/Editor2D.jsx#L1710-L1947) 的同一個 `<Layer>`。Konva 在 `dragmove` 是 **per-layer batchDraw** —— 拖任何節點都會把整層 canvas 重畫一遍。

對應卡頓場景：
- `Tray + 10AP`（沒有 SW）：`accessSwitches.length === 0` → 所有 AP unroutable → CableLayer return null，零 cable 節點
- `SW + 10AP`（沒有 Tray）：每條 fallback Manhattan 只有 3 點，cable 節點少
- `SW + Tray + 10AP`：10 條 tray-route，總節點 < 100
- `SW + Tray + 50AP`：50 條 tray-route，估 500–1000 個 cable 子節點，跟 50 個 AP marker 同層每幀 repaint。卡。

### 1.3 元層級的設計原則（過程中確立）

`動一下就回 store + re-render` 是這類大 canvas 系統的根本性能陷阱。原則：

> **Transient state（暫時狀態）不該進 store**。
> mousedown / keypress / hover / 繪製途中都是 transient，活在 ref / local state / dragOverlay。
> 邊界（mouseup / blur / dragend）才 commit 正式 store。

對應的反例與已處理 / 待處理盤點：

| 物件 | 位置 | 狀態 |
|---|---|---|
| AP / Switch / Wall / Scope drag | Editor2D | ✅ 已 dragOverlay |
| Marquee drag | imperative + 獨立 layer | ✅ 已繞開 React |
| **Tray body drag** | `CableTrayLayer.jsx` onTranslate | ✅ Phase 24-30-2 dragOverlay |
| **Tray vertex drag** | `CableTrayLayer.jsx` onVertexDragMove | ✅ Phase 24-30-2 dragOverlay |
| HeatmapControl slider | `HeatmapControl.jsx` 171/179 | ❌ 每 tick 寫 store |
| AlignFloorPanel slider | 98/141/158/181/203 | ❌ 每 tick 寫 store |
| FloorImagePanel slider | 67/94 | ❌ 每 tick 寫 store |

Panel slider 三條未處理，Phase 25 過程或之後可順手收尾。

---

## 2. Phase 24 — Konva Layer 拆分（已 ship）

### 2.1 已完成

| # | 狀態 | 動作 |
|---|---|---|
| 30-1 | ✅ commit `a30139f` | CableLayer 拆獨立 `<Layer listening={false}>` |
| 30-2 | ✅ commit `a30139f` | Tray dragmove → `useDragOverlayStore.tray / trayVertex`，dragend 才 commit |

### 2.2 撤回的 task

| # | 狀態 | 理由 |
|---|---|---|
| 30-3 | ⏸️ 撤回 | Structural / Trays / Devices 三層拆 —— 在 react-konva 環境做會白工，架構決策融入 Phase 25 PixiJS Container 階層 |
| 30-4 | ⏸️ 撤回 | Overlay 拆 visual / interactive —— 同上理由 |
| 30-5 | ⏸️ 撤回 | FloorImage listening=false —— PixiJS Sprite 互動靠 InteractionManager，邏輯重新設計 |
| 30-6 | ⏸️ 撤回 | DragLayer —— PixiJS 不需要（每 Mesh 已是獨立 draw call） |
| 30-7 | ⏸️ 撤回 | Cable focus halo 拆層 —— PixiJS 走 mesh attribute / multi-pass，不再需要 layer 拆 |

### 2.3 Phase 24 的角色定位

Phase 24 是「**ship-able 妥協**」：
- 解掉 SW+Tray+50AP 操作卡頓的臨床問題
- Cable 拖曳期間凍結（跟 Figma / Hamina 同行為）
- 為 Phase 25 PixiJS 改寫鋪路：dragOverlay store / layer 邊界思維 / transient state 原則都已成立

但 Phase 24 不是最終解 —— **1000+ AP 規格 Konva 撞牆**（純 Konva 估算上限 300-500 AP）。Phase 25 才是達標的方案。

---

## 3. Phase 25 — PixiJS hybrid renderer（規格達標方案）

### 3.1 規格目標

| 元素 | 數量 |
|---|---|
| AP | 1000+ |
| Walls | 5000+ |
| Switch / IDF / MDF / Router | 100+ |
| Cable Tray | 50+ |
| Cable routes（衍生）| ~1000，segment ~30000 |
| Heatmap | real-time recompute |
| **流暢度** | **30–60 fps** |

### 3.2 為什麼是 PixiJS hybrid（而非純 Konva / 純 PixiJS / raw WebGL）

| 選項 | 1000 AP 達標 | 工程量 | 維護成本 | 結論 |
|---|---|---|---|---|
| 維持 Konva | ❌ 撞牆 | 0 | 低 | 規格不允許 |
| 純 Konva 改寫 | ❌ 撞牆 | 2–3 週 | 低 | **白工**，要再做一次 PixiJS migration |
| **PixiJS hybrid**（**選**） | ✅ | **3–4 週** | 中 | 標準 PixiJS 處理 99% + 自寫 shader 處理熱點 |
| 全 PixiJS（Graphics）| 邊緣 | 3–4 週 | 中 | Graphics 高頻 mutation 慢，cable/wall 量大會卡 |
| Raw WebGL 全套 | ✅ | 6–8 週 | 高 | DX 災難，scene graph/hit-test/text 全自寫，bug surface 大 |

PixiJS hybrid 的具體分工：
- PixiJS 管產品複雜度（scene graph、viewport、互動 overlay、Sprite、Container、Graphics）
- Custom Mesh + shader 管 bulk simple geometry（walls、cables）
- GPU shader 管 RF heatmap（fragment shader 起步，長期升 WebGPU compute）
- Worker 管 CPU-side task（tile invalidation、R-tree/BVH query、routing/Dijkstra、candidate list preparation）
- React 不直接管理 Pixi objects

### 3.3 八層配置（PixiJS Container 階層）

| # | Layer | 後端 | 量級 | 備註 |
|---|---|---|---|---|
| 1 | Background | renderer background / Graphics | 1 | 深色底 |
| 2 | FloorImage | PIXI.Sprite | 1 | 大圖未來可 tile |
| 3 | **Heatmap** | **既有 raw WebGL2** → PIXI.Sprite（texture） | 1 | MVP 直接接，長期 tile-based + dirty update |
| 4 | **Walls** | **PIXI.Mesh + custom line shader** | 5000 | 1 個 draw call、screen-space width + AA + per-material color + partial buffer update |
| 5 | Scopes / FloorHoles / RefWall / RefVector | PIXI.Graphics（Mesh 若量超過 500） | tens | 量少、互動需求中 |
| 6 | **Cables (derived)** | **PIXI.Mesh + dashed line shader** | ~30000 segments | listening=false、純視覺、`eventMode='none'` |
| 7 | Trays（base + magnet）| PIXI.Container + Graphics | 50 | vertex handle / segment hit / drag 複雜 |
| 8a | Devices — AP markers | PIXI.Sprite + texture atlas / SDF atlas | 1000 | Sprite batching 1 draw call |
| 8b | Devices — Switches | PIXI.Container + Sprite | 100 | 複雜組合、互動多 |
| 8c | Devices — Risers | PIXI.Sprite | ~20 | 小 |
| 9 | Visual overlays（snap halo / draft / badge / unroutable / marquee）| PIXI.Graphics | 動態 | listening=false |
| 10 | Interactive handles（tray vertex/segment / scale draw / crop draw / transformer）| PIXI.Container + Graphics | 動態 | 高互動 |
| 11 | Text labels（AP name / SW name / Tray name / dB readout）| **PIXI.BitmapText** **或 SDF/MSDF**（看 zoom 範圍）| 1000+ glyphs | 大量；**禁用 PIXI.Text** |

Z-order：1 在底、11 在頂。

### 3.4 為什麼這幾層走 custom shader

**只有 3 條 layer 走自寫 shader**：

#### 3.4.1 Heatmap
- 既有 `heatmapGL.js` 是 WebGL2 raw shader
- 整合方式：原本離畫面 canvas → Konva.Image；改成離畫面 canvas → PIXI.Sprite (`PIXI.Texture.from(canvas)`)
- 0 邏輯改動，只換 host

**長期升級路徑**：
- current: GPU fragment shader（已實作）
- next: **tiled fragment shader + AP data texture + dirty tile update**
- future: WebGPU compute shader（PixiJS v8 自動處理 fallback）

#### 3.4.2 Walls — PIXI.Mesh + line shader（新寫）

```
所有 5000 條 wall 塞進一個 Float32Array
每條展成 quad：4 vertices + 6 indices
1 個 draw call 畫全部
```

Shader 要處理：
- **粗線**（quad 展開，screen-space width 維持，世界寬度為主 + min/max clamp）
- **per-material color**（per-vertex color attribute，drives by material loss）
- **AA**（fragment shader smoothstep edge）
- **Opening**（門窗）：**預切成 visible sub-segments**，不走 shader discard

**Stroke width 公式**：
```
finalWidthPx = max(worldWidth * viewportScale, minPx) * devicePixelRatio

啟用 cap 時：
finalWidthPx = clamp(worldWidth * viewportScale, minPx, maxPx) * devicePixelRatio
```
- 預設 real thickness，`maxPx` 不啟用
- 極端 zoom-in 才啟用高 cap（例如 `maxPx = 200`）
- UI 模式切換：`real thickness` ↔ `symbolic line`
- Retina 螢幕乘 DPR

**Opening 更新策略**：
```
dragging:
  freeze full wall mesh
  只更新拖曳中那條 wall / opening 對應的 sub-segments
dragend:
  commit segmentation, batch update geometry buffer
新增 / 刪除 wall:
  append / free-list segment slots，必要時 lazy compact / rebuild
```

5000 條全切估 10-50 ms，drag 中不能跑 → 必須 partial update。

#### 3.4.3 Cables — PIXI.Mesh + dashed line shader（新寫）

同 walls 的 mesh pattern + 三件事：
- **Dash pattern**：fragment shader 用「沿線距離」（per-vertex attribute）對 dash period 取模
  - **Dash period 用 screen-space distance**（不是 world-space），viewport scale uniform 在 shader 換算
  - 沿用現有 [CableLayer.jsx](src/features/editor/layers/CableLayer.jsx) 各 route 類型的 dash semantics（tray run / drop leg / fiber / fallback Manhattan）
  - Attributes：`dashOnPx`、`dashOffPx`、`dashPhasePx`、`routeType`、`routeColor / materialId`
- **多色 per-route**：tray cyan / S2S fiber rose / fallback grey，per-vertex color attribute
- **Focus halo**：第二 pass 畫較粗半透明 indigo band

Cables 純視覺，**`eventMode='none'`**，完全不走 PixiJS hit-test。

### 3.5 AP data texture layout（heatmap shader 用）

```
texture format: RGBA32F（或 RGBA16F 看精度需求）
layout: K=4 rows per AP

row 0: vec4(x, y, z, txDbm)
row 1: vec4(freq, channel, channelWidth, antennaModeEncoded)
row 2: vec4(azimuth, beamwidth, patternId, modelId)
row 3: vec4(reserved0, reserved1, reserved2, reserved3)

物理 texture size: width=K, height=AP_COUNT
1000 AP × 4 row = 4000 texel ≈ 64 KB
```

Shader 讀取：
```glsl
vec4 ap0 = texelFetch(apTex, ivec2(0, apIndex), 0);
vec4 ap1 = texelFetch(apTex, ivec2(1, apIndex), 0);
vec4 ap2 = texelFetch(apTex, ivec2(2, apIndex), 0);
vec4 ap3 = texelFetch(apTex, ivec2(3, apIndex), 0);
```

**更新策略**：整張重 upload（64 KB / ~0.1ms，太便宜不必 partial），AP store 變動觸發 `gl.texImage2D(...)` re-upload。

### 3.6 Tile-based heatmap

1000 AP fragment shader 每 pixel 迭代不可行（O(N_pixel × N_AP)）。必須採：

```
每個 heatmap tile 預先產生 candidate AP list（CPU side，Worker 處理）
  ↓
shader / compute 只迭代該 tile 相關 AP
  ↓
拖 AP 時只 invalidate affected tiles
```

Tile invalidation 條件：
- AP 移動 → 影響半徑 R 內的 tile 全部 dirty
- AP 屬性變動（txDbm / freq / pattern）→ 同上
- Wall 變動 → 寬一點，可能整條 ray 影響的 tile

Worker 負責計算 affected tiles + 維護 candidate list；GPU 負責跑 shader。

### 3.7 Hit-test 策略

| 對象 | 幾何 | Spatial index | 後端 |
|---|---|---|---|
| AP / Switch / Riser | point | **uniform grid**（world-space cell ≈ 50–100 px equivalent） | App-level |
| Wall | line segment AABB | **R-tree / BVH** | App-level |
| Tray segment | line / polyline segment | R-tree / BVH | App-level |
| Scope / FloorHole | polygon AABB | R-tree / BVH | App-level |
| Cables | n/a | 不需要（`eventMode='none'`）| n/a |
| Handles | small UI object | PixiJS InteractionManager | PixiJS |

**Walls click 流程**：
```
PixiJS stage pointer event
→ world coordinate（共用 viewport transform）
→ R-tree query candidate walls
→ line-segment distance test
→ select wall id
```

比讓 PixiJS 對 5000 walls 自動 hit-test 穩。

**Marquee 框選**：rect AABB → spatial index query → AABB-rect intersection → 選擇 set 更新。Walls partial-in-rect 視為選中（沿用既有 policy）。

### 3.8 Hover state 渲染

對 walls / cables（在 Mesh 裡）：

| 物件 | Hover 策略 |
|---|---|
| Walls | `hoverWallId` uniform，shader 判斷 `if (wallId == hoverId)`，1 個 uniform update／hover；不動 attribute buffer |
| Cables | 純視覺，不 hover |
| AP / SW / Tray | PixiJS InteractionManager 標準 hover |

對 1 個 hover wall 用 uniform 就夠（只能 hover 一個 wall 符合 UX）。

### 3.9 Selection 渲染

| 物件 | Selection 策略 |
|---|---|
| Walls | 大量多選 → mesh attribute（per-segment `isSelected` byte attribute，partial buffer update）<br>少量選取 → overlay Graphics |
| Cables | 純視覺，通常不選 |
| Focus halo（被選的 device 的 cable）| Second pass 畫粗的半透明 indigo band |
| AP / SW / Tray | overlay Graphics 畫 selection ring + handles |

### 3.10 Text 渲染

| 量級 | 後端 |
|---|---|
| 大量 AP / SW / Tray labels（1000+ glyphs）| **SDF / MSDF text atlas**（非 BitmapText 也非 Text）|
| 少量 debug / tooltip / hover readout | PIXI.Text 可 |

理由：BitmapText 點陣字 batch 好但 zoom in 會糊；SDF/MSDF 任意 scale 不糊，floor planner zoom in 讀 label 必要。

**生成工具**：`msdf-bmfont-xml` 或 `msdf-atlas-gen` preprocessing。

### 3.11 PixiJS 版本與後端鎖定

```
Phase 25 鎖定：
- PixiJS v8
- WebGPU preferred where available
- WebGL2 fallback
- Mouse-first interaction
- Touch / pinch zoom 留 extension point（Phase 26 後評估）
```

**Required WebGL extensions**：
- WebGL2 內建 ✓
- `EXT_color_buffer_float`（render-to-float texture，heatmap 可能需要）
- 不支援 `EXT_color_buffer_float` 時 fallback：heatmap precision 降為 RGBA8 unorm

**Custom shader 雙寫**：
- 第一版只寫 WebGL2 GLSL，PixiJS WebGPU 跑時自動 fallback
- 第二版補 WGSL，WebGPU 跑時真 GPU
- 第三版升 WebGPU compute（heatmap RF tile compute）

**單一 Shader 物件帶兩種**：
```js
new PIXI.Shader({
  glProgram:  new PIXI.GlProgram({ vertex: glVS, fragment: glFS }),
  gpuProgram: new PIXI.GpuProgram({ vertex: {source: wgslVS}, fragment: {source: wgslFS} }),
})
```

### 3.12 Animation framework

**決定**：用 `app.ticker` + 手寫 ease util（非 tween library）。

理由：
- 動畫場景 5 個都是「單一物件 + 單一屬性 + 固定 ease」（focus halo pulse / selection ring grow-in / hover transition / drag feedback / badge fade）
- 寫一個 50 行的 Tween util 就夠
- 比引入 `@tweenjs/tween.js` 省 20 KB bundle，不需要的通用性不要

```js
// tween util sketch
class Tween {
  constructor(target, prop, fromVal, toVal, durationMs, ease) {...}
  update(deltaMs) { ... target[prop] = interp; if (done) onComplete?.() }
}
const tweens = []
app.ticker.add((delta) => { tweens.forEach(t => t.update(delta * 16.67)) })
```

### 3.13 Worker 分工

PixiJS 渲染與主 RF compute 都在主執行緒（前者 CPU prep + GPU；後者 GPU shader）。Worker 負責 CPU-side：

| Worker task | 用途 |
|---|---|
| Spatial index build / query | R-tree, uniform grid |
| Routing (Dijkstra) | 1000 AP × graph search |
| Tile invalidation candidate | 哪些 tile 受影響 |
| Candidate AP list per tile | shader 跑哪些 AP |
| Geometry preprocessing | Wall sub-segment 切割（openings） |
| Fallback / debug compute | 無 GPU 時降級路線 |

**Worker 不做 RF heatmap field compute**。主 RF compute 永遠 GPU。

### 3.14 Cross-cutting concerns

#### 3.14.1 GPU memory budget
- Hard budget：**< 200 MB**
- Warning threshold：150 MB
- 主要項目：heatmap tile textures、floor image、AP atlas、SDF font atlas、wall/cable mesh buffers、AP data texture、selection/overlay buffers
- 超過時策略：heatmap tile LRU、降 tile resolution、釋放 offscreen buffers、wall/cable mesh LOD、隱藏遠 zoom label

#### 3.14.2 Context loss / restore
所有 custom Mesh / shader / texture layer 必須：
- rebuild geometry buffers
- re-upload textures
- recreate shaders / pipelines
- restore uniforms

**驗證**：
```js
const ext = gl.getExtension('WEBGL_lose_context')
ext.loseContext()
// 驗證 Mesh / shader / texture / AP data / heatmap tiles / wall+cable buffers 全部復原
// 視覺 0 diff 或 within tolerance
// 互動仍可
```
納入 Phase 25 validation。

#### 3.14.3 DPR（retina 螢幕）
PixiJS auto-handles 整體 DPR，但自寫 shader 的 stroke width 公式要乘 DPR：
```
finalWidthPx = max(worldWidth * viewportScale, minPx) * devicePixelRatio
```

#### 3.14.4 Viewport transform 統一
PixiJS layer、heatmap、hit-test、R-tree query 必須共用同一套 world ↔ screen transform。Zoom / pan 後 click、label、heatmap 對不準 = 這條沒守。

#### 3.14.5 Fallback / unsupported browser
```
Primary:     WebGPU if available
Fallback:    WebGL2
Unsupported: 顯示 unsupported browser message
             提供主產品 read-only / non-edit mode link（如有）
```

**不承諾 Canvas 2D fallback 可完整支援 planner**。Canvas 2D 最多 read-only snapshot / degraded preview。

#### 3.14.6 Bundle size 預算
- PixiJS v8 minimal：~190 KB gzip
- 自寫 shader：~5 KB
- SDF font atlas：50–200 KB
- Floor textures、AP atlas
- 整合進主產品時，floorplan 子模組總增量 ≈ 300–500 KB gzip

### 3.15 Profiling metrics

擴充既有 `scripts/perf/bench-harness.js`（Phase 20 26-1-base），新增：

| Metric | 量哪裡 |
|---|---|
| Draw call count | per frame |
| GPU frame time | requestAnimationFrame delta |
| CPU render prep time | tick start → submit |
| Buffer update time | mesh attribute upload |
| Texture upload time | AP data / heatmap tile upload |
| RF shader time | heatmap compute |
| Tile invalidation time | Worker side |
| Hit-test time | spatial query + precise test |
| Label render time | text atlas blit |
| Memory usage | GPU + CPU |
| Shader compile time | one-time cold start |
| Pipeline creation time | WebGPU pipeline |
| Cold-start first render time | page load → first paint |
| Idle FPS | 待機 |
| Pan/zoom FPS | viewport stress |
| AP dragging FPS | single AP drag |
| Wall dragging FPS | single wall drag |
| Heatmap dirty tile update FPS | drag AP 時 |
| Operation latency p50 / p95 / p99 | per metric |

**測試場景**至少包含：
- 1000 AP
- 5000 walls
- 30000 cable segments
- 1000+ labels
- Heatmap dirty tile update
- AP drag preview
- Wall drag preview
- Zoom / pan stress test

### 3.16 Migration 策略：src → oldSrc

```bash
git mv src oldSrc
mkdir src
# 新 src/main.jsx 第一天就要有最小 PixiJS app 骨架
```

紀律：
- 新 `/src` **嚴禁** import `/oldSrc`（破例就喪失乾淨重來意義）
- `vite.config.js` `@` alias 維持 `./src`
- `oldSrc/` 加 `.eslintignore` + vitest glob 排除
- `index.html` 預設指 `/src/main.jsx`，所以新 `main.jsx` 必須立即存在

**Migration 不可逆**：沒有「邊改邊跑舊版」的選項。第一週新 src 可能跑得很慘，要有心理準備。

### 3.17 Layer 改寫順序

由易到難（對應 `task.md` Layer 31）：
1. PixiJS scaffold（Application、Container 階層、viewport）
2. Store wiring（Zustand subscribe imperative）
3. Heatmap 整合（既有 WebGL2 canvas → PIXI.Sprite）
4. Walls Mesh + line shader
5. Cables Mesh + dashed line shader
6. Devices (AP sprite atlas + SW container + Riser sprite)
7. Trays (Graphics + vertex handle)
8. Scopes / FloorHoles / RefWall / RefVector
9. Interactions (InteractionManager + spatial index hit-test)
10. Overlays / Marquee / draft preview / SDF text
11. Validation
12. `oldSrc/` removal

詳細 task ID 對應 `task.md` Layer 31。

---

## 4. Phase 26 — 條件式 follow-ups（Phase 25 完成後重評）

Phase 25 PixiJS hybrid 落地後**先量測 routing + heatmap**，再依照結果走分支。對應 `task.md` Layer 32。

### 4.1 Phase 24 凍結 cable 的解凍

Phase 24 凍結 cable 是 Konva 環境的妥協。PixiJS Mesh + custom line shader 後，cable 渲染成本接近零。是否解凍取決於 `computeRoutes` 在 PixiJS 環境下的 wall-clock：

```
Phase 25 完成 → 量測 computeRoutes @ 50 AP / 1000 AP
                ├─ < 5 ms/frame  → 路線 D：解凍 cable，dragmove 即時重算
                ├─ 5–16 ms       → 路線 B：cable 已是 raw Mesh shader，僅 routing 是瓶頸 → 路線 C
                └─ > 16 ms       → 路線 C：增量 routing（dirty / single-source Dijkstra）
```

**注意**：Phase 25 已將 cable 走 raw shader，所以原 Phase 26 路線 B（「加上 WebGL cable rendering」）**已併入 Phase 25**，不再是 Phase 26 task。剩下 Phase 26 真正要做的是「解凍 + 增量 routing」。

### 4.2 增量 routing 實作備忘（路線 C）

- **Graph topology cache**：trays + risers 結構（nodes + adjacency）跟 tray/riser 位置解耦；AP/SW 位置變動不重建 graph
- **Endpoint snap spatial index**：R-tree / uniform grid，O(log N) 取代 O(N²)
- **Per-AP single-source Dijkstra**：拖一顆 AP 只重算這顆 AP
- **拖 tray vertex**：影響半徑內的 edge weight 更新，受影響 routes 重算
- **拖 tray body（純平移）**：所有 edge weight 不變（同 tray 內 chainage 不變），只更新 cable polyline 座標，不跑 Dijkstra

---

## 5. 拍板決策 summary

| 項目 | 決定 |
|---|---|
| Wall stroke width | `max(worldWidth × scale, 1) × DPR`，`maxPx` 預設不啟用，UI 切 real/symbolic |
| Wall opening update | drag 中只更新拖中那條的 sub-segments，dragend commit；新增/刪除 wall 用 append + lazy compact |
| Cable dash | screen-space distance，沿用 CableLayer.jsx 各 route 類型的 dash semantics |
| AP data texture | K=4 row layout，整張重 upload（不 partial） |
| Spatial index | AP/SW/Riser uniform grid；Wall/Tray/Scope/Hole R-tree；cell size world-space ≈ 50–100 screen-px equiv |
| Hover state（wall）| `hoverWallId` uniform，不動 attribute buffer |
| Selection (wall 大量) | mesh attribute partial upload |
| Selection (wall 少量 / Tray / AP) | overlay Graphics |
| Text | SDF / MSDF atlas（禁 PIXI.Text 大量用） |
| Animation framework | `app.ticker` + 手寫 ease util（非 tween library） |
| PixiJS version | v8，WebGPU preferred，WebGL2 fallback |
| Shader 雙寫策略 | 第一版 GLSL only，PixiJS auto-fallback；第二版補 WGSL；第三版升 compute |
| Worker 分工 | CPU-side（spatial / routing / tile invalidation），**不做 main RF compute** |
| Touch | Phase 25 mouse-first，Phase 26 後評估 |
| GPU memory | hard 200 MB，warning 150 MB |
| Bundle 增量 | ~300–500 KB gzip |

---

## 6. 風險與不確定性

| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| PixiJS v8 + WebGPU 主產品瀏覽器不支援 | 中 | 高 | 自動 WebGL2 fallback，要驗主產品 target browser |
| 自寫 wall / cable shader bugs（dash AA、邊緣 artifact）| 高 | 中 | 31-11 validation 視覺 8 場景對比 oldSrc |
| 1000 AP heatmap fragment shader scale 撞 GPU 限制 | 中 | 高 | Tile-based + AP data texture 兜，再不行升 WebGPU compute |
| Context loss 自寫 shader 沒復原好 | 中 | 中 | Validation 步驟強制測 |
| Phase 25 工程超期 | 高 | 中 | 不可逆 migration，超期時 git rollback 回 Phase 24 + 重新評估 |
| SDF text 工具鏈生疏 | 低 | 低 | preprocessing 一次性 |
| 主產品 bundle 預算不夠 | 中 | 中 | 整合前 confirm 預算 |

---

## 7. 驗收標準

### Phase 24（已完成）
- [x] SW + Tray + 50AP 拖 AP / Switch / Tray body / Tray vertex 都流暢
- [x] 拖曳結束 cable 線正確 snap 到新位置
- [x] 既有 AP / SW dragOverlay 行為不變

### Phase 25 PixiJS hybrid
- [ ] 1000 AP / 5000 walls / 30000 cable segments / 1000+ labels 場景 idle FPS ≥ 30
- [ ] AP drag / Wall drag / Pan / Zoom 操作 FPS ≥ 30
- [ ] Heatmap dirty tile update 流暢（FPS ≥ 30 during drag）
- [ ] 視覺對比 `oldSrc` 8 場景 diff < 5%（aliasing / dash / color tolerance）
- [ ] 4 互動 regression（click / hover / 右鍵 / drag）全 pass
- [ ] Context loss / restore 視覺 0 diff（or within tolerance）+ 互動仍 work
- [ ] GPU memory < 200 MB
- [ ] Cold-start first render < 3s
- [ ] Profiling harness 完整跑過 p50/p95/p99 metric
- [ ] Main 主產品整合接口（`<FloorplanSystem buildingData onSave>`）不變
- [ ] `oldSrc/` 廢棄

### Phase 26（條件式）
- [ ] 量測產出 → 對應路線 C/D 完成後，拖 AP / SW / Tray 期 cable real-time follow（解凍）
- [ ] 全部 Phase 24 凍結機制反向解掉

---

## 8. 對應變更點

| Phase | 主要檔案 |
|---|---|
| 24 step 1+2（已 ship）| `Editor2D.jsx`、`CableTrayLayer.jsx`、`useDragOverlayStore.js` |
| 25 整體 | **全 `/src` 改寫**（`src → oldSrc` rename）|
| 25 入口 / 配置 | `vite.config.js`（alias 維持 `./src`）、`.eslintignore`（加 oldSrc）、`vitest.config.*`（排除 oldSrc）、`index.html`（指新 `/src/main.jsx`）、新 `package.json` 加 `pixi.js@^8` |
| 25 自寫 shader | `src/render/shaders/wallLine.{glsl,wgsl}`、`src/render/shaders/cableDashed.{glsl,wgsl}` |
| 25 整合 | 既有 `src/features/heatmap/heatmapGL.js` 不動，整合層 `src/render/heatmapAdapter.js` 套到 PIXI.Sprite |
| 26 增量 routing | 重寫 `src/features/cable/computeRoutes.js`、新 `src/features/cable/buildGraphIncremental.js`、新 `src/features/cable/spatialIndex.js` |

---

## 9. 最終一句話

> **PixiJS 管產品複雜度。Custom Mesh + shader 管 walls / cables 這種大量簡單幾何。GPU texture / shader 管 heatmap。Worker 管 CPU-side preparation，不管主 heatmap field compute。React 不管理 Pixi object lifecycle。所有高風險項目都要進 profiling / validation：memory、cold-start、operation FPS、context restore、fallback。**
