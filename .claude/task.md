# Floorplan — Task List

> ✅ 完成　 🔄 進行中　 ⬜ 待做

---

## Phase 1 — 2D 規劃核心 ✅

### Layer 1 — 畫布基礎
| #   | 狀態 | Task                                                           |
| --- | ---- | -------------------------------------------------------------- |
| 1-1 | ✅   | UI 骨架：Toolbar + SidebarLeft + CanvasArea 佈局               |
| 1-2 | ✅   | Konva Stage 初始化（ResizeObserver 自動填滿容器）              |
| 1-3 | ✅   | Pan / Zoom（滾輪縮放、左鍵平移、中鍵平移）                     |
| 1-4 | ✅   | 匯入圖片 PNG/JPG（Drag & Drop + 點擊選檔、auto fit-to-screen） |
| 1-5 | ✅   | PDF 匯入（單頁，PDF.js 渲染為圖片）                            |
| 1-6 | ✅   | PDF 多頁自動拆樓層（每頁建立獨立樓層）                         |

### Layer 2 — 比例尺
| #   | 狀態 | Task                                                           |
| --- | ---- | -------------------------------------------------------------- |
| 2-1 | ✅   | 手動比例尺：點擊兩點畫量測線，輸入公尺數計算 px/m |

### Layer 3 — 環境建模
| #   | 狀態 | Task                                                      |
| --- | ---- | --------------------------------------------------------- |
| 3-1 | ✅   | 牆體繪製工具：連續線段、ghost 線預覽、右鍵/ESC 停止       |
| 3-2 | ✅   | 牆體材質面板：選取牆體後右側面板顯示材質、高度設定、刪除  |
| 3-3 | ✅   | Scope Zone：繪製建築範圍多邊形（In-Scope / Out-of-Scope） |
| 3-4 | ✅   | Floor Hole（中庭/挑高）：定義信號可跨樓層穿透區域         |

### Layer 4 — 設備部署
| #   | 狀態 | Task                                                        |
| --- | ---- | ----------------------------------------------------------- |
| 4-1 | ✅   | AP 放置：點擊畫布放置 AP 圖標，存入 useAPStore              |
| 4-2 | ✅   | AP 屬性面板：頻段、發射功率、安裝高度、天線模式、名稱、刪除 |
| 4-3 | ✅   | 物件拖曳：任何模式下按住左鍵可拖曳牆體 / Scope / Floor Hole / AP |

---

## Phase 2 — 平面圖增強 & 編輯效率

### Layer 6 — 平面圖操作
| #   | 狀態 | Task                                                          |
| --- | ---- | ------------------------------------------------------------- |
| 6-1 | ✅   | 平面圖旋轉（自由角度 / 90° 步進）                             |
| 6-2 | ✅   | 平面圖透明度調整                                              |
| 6-3 | ✅   | 平面圖裁切（矩形裁切區域）                                    |

### Layer 7 — 編輯效率
| #   | 狀態 | Task                                                          |
| --- | ---- | ------------------------------------------------------------- |
| 7-1 | ✅   | 牆體材質快捷鍵切換（數字鍵 1~6 對應材質）                     |
| 7-2 | ✅   | 批次選取（框選多物件）：統一修改屬性、刪除                    |
| 7-3 | ✅   | 門窗結構：在牆體上設定門/窗段（不同材質 + 高度範圍）          |
| 7-4 | ✅   | Undo / Redo 操作歷史                                          |

---

## Phase 3 — AP 進階規劃

### Layer 8 — AP 型號與自動規劃
| #   | 狀態 | Task                                                         |
| --- | ---- | ------------------------------------------------------------ |
| 8-1 | ✅   | AP 型號資料庫：多廠商 AP 規格（增益、支援頻段、最大功率）    |
| 8-2a | ✅   | 天線模式資料模型 + APPanel UI（方位角、波瓣寬度，無視覺）   |
| 8-2b | ✅   | APLayer 定向扇形視覺化（方位指示、扇形覆蓋）                 |
| 8-2d | ✅   | Custom pattern 內建預設（Patch / Sector 等）+ pattern 預覽    |
| 8-3a | ✅   | 國家頻段資料庫 + 頻道選單依國家過濾                          |
| 8-3b | ✅   | 自動頻道規劃演算法（批次指派，greedy 最小干擾）              |
| 8-3c | ✅   | 放置新 AP 時自動挑選頻道（可開關）                           |
| 8-5 | ✅   | 頻寬設定：支援 20/40/80/160 MHz 頻寬選擇                     |

<!--
移除項目（2026-04-21 與 Heatmap 一併下線）：
  - 8-2c Heatmap 納入定向增益（已隨 HeatmapWebGL 一起刪）
  - 8-4 自動功率規劃（依賴 heatmap 公式，已刪）
重寫 heatmap 時再視需要重做。
-->

---

## Phase 4 — 多樓層

### Layer 9 — 多樓層管理
| #   | 狀態 | Task                                                      |
| --- | ---- | --------------------------------------------------------- |
| 9-1 | ✅   | 樓層切換：SidebarLeft 點選樓層，畫布切換對應圖資與牆體    |
| 9-2a | ✅   | 樓層對齊模式：手動設定偏移、縮放、旋轉（套用到該樓層所有物件的 group transform） |
| 9-2b | ✅   | 參考樓層疊影：對齊面板勾選顯示/隱藏個別樓層 + 共用不透明度滑桿 |
| 9-2c | ✅   | 參考樓層進階視覺化：每樓層自動分配色調、牆體輪廓疊加      |
| 9-2d | ✅   | 參考樓層向量物件疊影：對齊模式下顯示其他樓層 AP / Scope / Floor Hole 輪廓 |

<!--
移除項目（2026-04-21 與 Heatmap 一併下線）：
  - 9-3a/b/c/d/e 樓板衰減 & 中庭 bypass（全部依賴 heatmap shader）
資料欄位保留在 store（floor.floorSlab*, hole.bottomFloorId, hole.topFloorId）
中庭垂直延伸 UI 仍在 FloorHolePanel。樓板衰減 UI 已移除，資料欄位供未來重寫用。
-->

---

## Phase 5 — Heatmap 重寫

> **背景**：原先基於 NPv1 / .tmp-heatmap 規格的 WebGL 實作於 2026-04-21 全數移除（HeatmapWebGL、HeatmapControl、FormulaNote、ituR2040、rfDefaults、autoPowerPlan、useEditorStore 熱圖相關 state、materials.js 的 ITU-R 欄位、FloorImagePanel 樓板 UI）。
>
> **真相來源**：`src/features/heatmap/` 下的 JS 引擎（propagation.js / sampleField.js / buildScenario.js / frequency.js / rfConstants.js / geometry.js）。所有公式、參數、資料結構決策以這份 JS 為準。
>
> 演算法：純 Friis + 顯式牆損失 / image-source 反射（複數 Fresnel + ITU-R P.2040-3 材質） / UTD knife-edge 繞射 / 入射角 secant / 多頻點寬頻平均 / 同頻 SINR 聚合。
>
> 渲染：Konva Image 吃 heatmapGL（WebGL2）的 off-screen canvas — coarse grid + bilinear 上採樣 + gaussian blur + 5-anchor colormap。
>
> **本專案改寫方向**：把 JS 引擎**移植進 WebGL fragment shader**（保留 GPU 即時性），shader 路徑須對齊 JS 引擎的 baseline。
>
> **保留的輸入端資料**（不變動）：
> - walls（含 openings 門窗細分、material.dbLoss）
> - APs（frequency, channel, channelWidth, txPower, antennaPattern, z 安裝高度, streamCount, modelId）
> - scopes（in/out 多邊形）、floor holes（含垂直範圍）
> - floor.scale（px/m）、floor.floorSlab*（資料欄位保留，UI 已移除）
>
> **下游移除**（未來 heatmap 完成後視情況重建）：
> - 自動功率規劃（autoPowerPlan）
> - FormulaNote 公式說明面板
> - Toolbar 環境類型下拉、HeatmapControl 熱圖模式選擇

### MVP — JS 引擎接進主系統（CPU 版，先不 GLSL）

| #    | 狀態 | Task |
| ---- | ---- | ---- |
| HM-1 | ✅   | 橋接層 `src/features/heatmap/buildScenario.js`：把 floor/walls/APs/scopes 轉成 scenario 格式（px→m 用 floor.scale；walls 展成 segments 並合併 openings；APs 帶 pos/txDbm/channel/frequency/channelWidth） |
| HM-2 | ✅   | 引擎整合：CPU heatmap 引擎放在 `src/features/heatmap/`（propagation.js / sampleField.js）；頻率讀 AP `frequency + channel + channelWidth` 算真實中心頻率 |
| HM-3 | ✅   | 同頻干擾：只有「頻道實際重疊」的 AP 才計入 SINR（依 channel + channelWidth 計算重疊範圍） |
| HM-4 | ✅   | 門窗穿透：walls 有 openings 時，線段穿越用 opening.material.dbLoss；牆剩餘段用 wall.material.dbLoss |
| HM-5 | ✅   | Scope 過濾：out-of-scope 區域不渲染（alpha=0）；FloorHole 第一版忽略 |
| HM-6 | ✅   | HeatmapLayer：在 Editor2D 的 FloorImageLayer 之上、WallLayer 之下插入 Konva Image 圖層，吃 heatmapGL 的 canvas |
| HM-7 | ✅   | `useHeatmapStore`：enabled、reflections、diffraction、gridStepM、blur、showContours；預設 enabled=false |
| HM-8 | ✅   | 變動驅動重算：監聽 walls / APs / scopes / floor.scale 任何變動即重算（含拖曳中——透過 useDragOverlayStore 把 live 位置套進 scenario） |
| HM-9 | ✅   | Canvas 左下角 Heatmap 開關按鈕 + 懸浮設定面板；hover RSSI/SINR 數值顯示在按鈕上方 |
| HM-10 | ✅  | 更新 FormulaNote：套用新演算法（ITU-R P.1238 + Friis / image-source 反射 / UTD 繞射 / 同頻 SINR） |

### 未來擴充（第一版 MVP 不做，後續再迭代）

| #     | 狀態 | Task |
| ----- | ---- | ---- |
| HM-F1 | ✅   | 天線方向性：納入 AP `antennaPattern`（patch/sector）的方位角 + 波瓣增益進計算；目前 MVP 當 omni |
| HM-F7 | ✅   | 熱圖指標切換：新增 SNR 與 CCI 模式（目前有 RSSI / SINR）。SNR = S − N（忽略干擾）、CCI = 10·log₁₀(ΣI_k)（純同頻干擾強度）。HeatmapControl 加 mode 選單 + 對應色階圖例 |
| HM-F3a | ✅   | 樓板衰減計算：射線穿越 N 個樓層時加總 N × `floor.floorSlabAttenuationDb` |
| HM-F2b | ✅   | Cross-floor 熱圖呈現：所有樓層 AP 都參與，帶各自 elevation + AP.z |
| HM-F2a | ✅   | FloorHole 跨樓層 bypass：射線穿 slab 在 hole XY 範圍內 → 該 slab 不計衰減；含垂直範圍 (bottomFloorId/topFloorId) |
| HM-F3c | ✅   | Slab 斜入射放大：slab loss × sec(θ_i)，clamp ≤ 3.5；cosθ = |Δz|/3D 距離 |
| HM-F2c | ✅   | 跨樓層射線的牆穿透：射線 2D 投影穿過其他樓層的牆時也加牆損；牆僅對 Z 介於 wall.bottomHeight~topHeight 的射線段有效 |
| HM-F2e | ✅   | 牆 Z 範圍過濾：同樓層也應限制 wall 只對 AP/rx 在 wall.bottomHeight~topHeight 內的射線有效（矮隔間不該阻擋高處訊號） |
| HM-F3b | ✅   | 樓板材質 UI：Sidebar 或 FloorPanel 暴露 floorSlabMaterialId + 自動同步 floorSlabAttenuationDb |
### 規模目標 + Roadmap 修訂（2026-04-25 討論結論）

> **天花板**：3000 AP / 150K walls 即時拖曳熱圖（拖 ~25ms / 放 ~150ms，可用級）
> 對照業界場景：大機場、大商場、大學單棟建築、單一校區
> **絕對絲滑（< 16ms）上限約 2000 AP / 100K walls**

#### 規模 vs 延遲對照表（F5 全套完成後預估）

| 規模 | 拖曳延遲 | 放手精細化 | 體感等級 |
| --- | --- | --- | --- |
| 1000 AP / 50K walls   | ~5 ms  | ~25 ms  | 絕對絲滑 |
| 2000 AP / 100K walls  | ~12 ms | ~70 ms  | 絕對絲滑 |
| **3000 AP / 150K walls** | **~25 ms** | **~150 ms** | **可用（天花板）** |
| 5000 AP / 250K walls  | ~50 ms | ~300 ms | 可忍受 |
| 10000 AP / 500K walls | ~150 ms | ~1 s | 卡 |

walls/AP 比典型 30-60，所以「1000 AP / 50K walls」是合理的「大機場」規模、「3000/150K」是大校區量級。

#### 達到天花板需要的 stage（依序）

1. **F5c+d**（合併）— 反射 + Fresnel + 繞射 + 多頻點，shader 視覺對齊 JS（**must**：不做物理錯）
2. **F5g** — per-fragment all-AP loop + AP 距離 culling（**must**：解 N_AP dispatch overhead，1000 AP 不做就死）
3. **F5h** — cascade tiling（粗→細多 pass，拖牆也救到）
4. **HM-drag-lod** — 拖曳期間 gridStep×3 + freqN 15→3（5 行 code，極低成本）

#### 已放棄項目

- **F5e（增量 texel 上傳）**：被「拖曳降畫質」全面 dominate，且對動牆 0 加速；先標延後，實測「拖曳降畫質」不夠時再評估
- **AP merging / decimation（路線 E）**：物理失準，與 JS reference 對齊精神衝突
- **WebGPU compute shader（路線 C）**：相容性考量（task.md 既有約束）
- **WASM 主線**：CPU 加速 2-3× 對 1000 AP 杯水車薪；留給 HM-F6 fallback

#### 備註（暫不做，未來參考）

- **拖曳結束從粗版切細版的「閃一下」過渡感**：建議方案是 Konva Image opacity tween（兩 canvas cross-fade ~200ms，~20 行 code）。多數網規工具（Hamina/Ekahau）沒做此 transition，35ms 切換可能根本察覺不到。實測有需要再加。

#### 既有約束

> 純 CPU（JS 或 WASM）在 1000+ AP 規模撐不住，主線是 GPU。
> **不做 WebGPU**（相容性考量）。Worker 保留為 CPU fallback 備援。

### Shader 開發工具鏈（HM-F5a 開工前先建好，降低 debug 成本）

> 浮點精度（32-bit vs 64-bit）、uniform 傳遞、texture sampler 模式都是容易踩雷的點。
> 不先建對照機制，改到後面會出現「哪裡飄了不知道」的困境。

| #      | 狀態 | Task |
| ------ | ---- | ---- |
| HM-T1  | ✅   | Golden test fixture：固定場景（3 AP——同頻對製造 CCI + 異頻 directional + 10 牆 + 2 opening + 2 樓層 + 1 floor hole + 1 in-scope），存在 `src/features/heatmap/__fixtures__/basic/`。雙 baseline：`field-full.json` (full physics) + `field-friis.json` (no refl/diff)。`scenario.js`（輸入）/ `meta.json`（commit hash + timestamp + opts + 引擎指紋 + 雙 baseline stats）。產生器：`__fixtures__/build-golden.mjs`，`pnpm heatmap:golden` 重生 |
| HM-T2  | ✅   | Diff harness 雙路徑：(1) Node CLI `pnpm heatmap:diff` — JS 引擎 vs golden，產 HTML report，純 CPU regression 用；(2) **瀏覽器 #/heatmap-diff** — 真正驗證 shader 的工具（headless WebGL2 不可得，CLI 不能跑 shader）。CLI 詳見 HM-T2、瀏覽器版見 HM-T3b |
| HM-T3  | ✅   | 引擎切換：useHeatmapStore 加 `engine: 'js' \| 'shader'`，HeatmapControl 設定面板加引擎下拉。Shader 路徑失敗（無 WebGL2 / context lost）時 HeatmapLayer fallback 回 JS |
| HM-T3b | ✅   | 瀏覽器 diff page `#/heatmap-diff`：每個 fixture 跑 JS + Shader 兩版，跟對應 baseline (friis/full) 各自 diff，輸出 RSSI/SINR/SNR/CCI 4 channel × (golden/JS/Shader/diff) panel + stats 表 + per-stage gate 切換按鈕。F5a baseline=friis，F5c/F5d baseline=full |
| HM-T4  | ✅   | 每個 F5 子階段定義**驗收門檻**：F5a/b 對 `field-friis` baseline ≤ 1 dB（純 Friis+walls+slab，full parity 預期）、F5c 對 `field-full` ≤ 1.5 dB（缺多頻點）、F5d 對 `field-full` ≤ 1 dB（full parity）。NaN-mismatch 永遠必須 = 0。完整門檻表 + 各階段執行方式見 `src/features/heatmap/__fixtures__/README.md` |
| HM-T5  | 部分 | Edge-case fixtures：✅ `__fixtures__/refl-min/`（1 metal wall + 1 AP，反射隔離 debug 用）— 2026-04-25 為 F5c+d 嘗試而建。⬜ `__fixtures__/dense-walls/`（50+ 牆）、`__fixtures__/dense-aps/`（10 AP 同頻擠壓 SINR/CCI）、`__fixtures__/cross-floor-tunneling/`（斜射穿多 slab 驗 sec(θ)）|

### GPU 即時化路線（依序執行）

| #      | 狀態 | Task |
| ------ | ---- | ---- |
| HM-F5a | ✅   | WebGL shader MVP：`rssiFromAp` 翻 GLSL（`src/features/heatmap/propagationGL.js` + `sampleFieldGL.js`），walls/APs 打包成 RGBA32F texture、fragment shader 每格掃全部 walls/APs；Friis + 牆穿透 (Z filter) + slab loss + openings + omni/directional 天線 (custom 走 CPU fallback)。反射/複數 Fresnel/繞射/多頻點留給 F5c/F5d。**驗收**：對 `field-friis.json` baseline max diff ~1e-5 dB ≤ 1 dB ✓。HM-T3 引擎切換按鈕 + 瀏覽器 diff page (`#/heatmap-diff`) 也一併實作 |
| HM-F5b | ✅   | Uniform Grid 空間加速（不用 BVH，2D 場景下 grid 構造簡單、shader 無遞迴）：CPU 端按 wall AABB 把每面牆塞進覆蓋的 cells，emit `gridIdxTex` (RGBA32F, nGx×nGy) + `gridListTex` (R32F, flat wall idx)。Shader 用 Amanatides-Woo DDA 沿 ray 走 cells，配 8-slot 循環 buffer 去重。`setUseGrid(false)` 可切回 brute force（debug / bench 用）。**驗收**：basic + refl-min × friis baseline 全部 max diff = 0.000 dB ✓。Bench (`#/heatmap-bench`) 100 AP × 2000 牆 JS 212s vs Shader+grid 408ms → **521× 加速**。**bug 修復（2026-04-26）**：原 DDA 終止條件 `cx < -1 \|\| cx > uGridDims.x` 對「AP/rx 在 grid AABB 外」場景太緊，ray 從外部走入 grid 時第一步就被攔下，根本走不到 wall-bearing cell。改用 parametric `tCur > 1` 終止（追蹤 ray 進入 cell 的 t），保留 cxEnd/cyEnd 早停 + maxSteps 兜底。refl-min fixture 從 max 44 dB → 0.000 dB，basic 不 regress |
| HM-F5c+d | 部分 | **合併處理**：反射 + 複數 Fresnel + 繞射 + 多頻點相干疊加上 shader。**驗收**（F5d gate, full physics baseline）：refl-min max ≤ 0.001 dB **clean PASS**；basic 1/2501 退化點 (10,13) 32 dB（mean 0.019 dB / p95 0.000 dB）；demo 場景 **65/4087 cells > 1 dB**（98% 對齊，主編輯器視覺有等高線可見偏差）。**F5d 嚴格 max ≤ 1 dB gate 沒過**——剩餘 outlier 留給 HM-F5c-fix 處理。實作四子步驟逐步 commit：(0) freqOverrideN opt + diff page sub-step toggle、(1) Fresnel pure-fn parity 72 cases worst 1.17e-6、(2) image-source reflection（修兩個 `normalize((0,0))=NaN` bug：reflection 端點退化 inDir、wallLossOblique zero ray dir）、(3) knife-edge diffraction、(4) Hperp[N]/Hpara[N] band sweep + tauRef phase reference |
| HM-F5c-fix | ⬜ | **Outlier numerical hardening（HM-F5c+d 後續）**：解決退化幾何點上的 fp32 偏差。**已知 outlier 樣態**：(a) 「rx 坐落 wall 端點/內部」→ 相鄰 wall 共享 endpoint 時 t/u=1 邊界 fp32 round-off race（demo y=18 整排 10-25 dB drift），(b) 「rx 在 metal wall 內 + AP↔wall 共線」→ 多 path 完全 destructive interference fp32 累加到 power=0（basic (10,13) 32 dB、demo (8,9) 40 dB）。**修法候選（依優先序）**：(1) wait — F5g 重組 pipeline 後重驗（pipeline aggregated grid + AP loop in shader 改變累加順序，**50-60% 機率自然修掉大部分**）；(2) endpoint dedup — `u in [0,1)` left-inclusive tie-break + canonical wall ordering（解 endpoint 共享，**graphics 業界標準**）；(3) Kahan summation / 兩個 float 模擬 double — 解 fp32 累加極限，但成本高（每個 H 累加要 ~2× 操作）；(4) 改 demo wall 位置 offset 0.1m 避開整數倍 grid 取樣（**不修 root cause 但實務有效**）。**驗收目標**：F5d gate basic + refl-min + demo full physics 全部 max ≤ 1 dB（F5g 完成後若仍有 > 5 dB outlier 才啟動）。**已嘗試失敗**：tauRef phase reference 改善 phase 累加但對退化點 power=0 無效；segSegIntersect 加 SEG_HIT_EPS=1e-5 reject ray-endpoint hit 引發災難（reflection legs 全 reject）|
| HM-F5g | ⬜   | **per-fragment all-AP loop + AP 空間 culling**（解 N_AP dispatch overhead）：把 APs 也包進 RGBA32F texture，shader 內 loop over APs 同時做 distance culling（距 fragment 太遠的 AP 直接 skip，因功率太低無意義）；output 從「per-AP grid」變「直接 aggregated grid」（best AP RSSI + 同頻 SINR/SNR/CCI 都在 GPU 算完）。**目的**：1000 AP 從 ~30s（per-AP host loop）降到 ~50-100ms。需重組 sampleFieldGL — readPixels 拿掉，純 GPU pipeline + Konva 直接吃 GL canvas。**驗收**：(a) 對 `field-full` baseline 不可 regress F5c+d 既有對齊水準；(b) 重驗 demo 場景 outlier 數量（HM-F5c-fix 期望 F5g 順便解決）|
| HM-F5h | ⬜   | **Cascade tiling（粗→細多 pass）**：先粗網格（gridStep ≈ 2m）找哪裡 RSSI > -80 dBm，只在「有訊號」區域用細網格 (0.5m) 渲染。可選 3 層 cascade（4m / 1m / 0.5m）。對動牆也救到（牆動了重算還是會經過 tiling 過濾死區）。預估在 F5g 之上再 1.5-2× 加速 |
| HM-drag-lod | ⬜ | **拖曳期間降畫質**：useDragOverlayStore 已追蹤 isDragging，HeatmapLayer 改成拖曳時 gridStep × 3 + freqSamples 15→3（~5 行 code）。**位置/牆/AP 形狀全正確**，只是邊緣糊 + 反射區數值抖 ±5 dB；放手立刻精細化重算（35ms 內）。實測類似 Hamina/Ekahau 的 UX。對「拖曳體驗」是 game changer，比 F5e 通用且便宜 |
| HM-F5e | ⏸️   | **延後（被 HM-drag-lod dominate）**：增量 texel 上傳僅對「拖一顆 AP」加速，對動牆 0 加速；HM-drag-lod 通用且 ~5 行 code 即可達 8-40× 加速。等 HM-drag-lod 實測拖曳體感不夠絲滑時再評估 |
| HM-F5f | ⬜   | 大場景調優：profile 3000 AP + 150K 牆實際耗時，若 < 60 Hz 則針對熱點優化（branch coherence、texture layout、uniform cache） |

### 備援與延伸

| #     | 狀態 | Task |
| ----- | ---- | ---- |
| HM-F6 | ⬜   | Web Worker CPU fallback：無 WebGL2 環境（舊瀏覽器 / headless）降級回 JS 引擎並丟 Worker 避免卡 UI |
| HM-F4 | ⬜   | autoPowerPlan 自動功率規劃重建（依賴 F5 即時熱圖才有好的反覆搜尋效率） |
| HM-F2d | ⬜  | 跨樓層反射/繞射（高成本；牆需升級成 3D 平面、image-source 在 3D 做；第一版貢獻小，先擱） |

<!--
2026-04-25 翻案：拖曳降畫質從 quick-win 升為主線（HM-drag-lod）。
理由：F5g+h 完成後 1000 AP/50K walls 仍要 ~25ms/frame，未達絕對絲滑；
拖曳降畫質 5 行 code 帶來 8-40× 加速、覆蓋拖 AP 跟拖牆兩種場景，
比原計畫 F5e（增量上傳，僅救拖 AP）通用得多。
-->

### 其他（低優先）

| #      | 狀態 | Task |
| ------ | ---- | ---- |
| HM-B1  | ⬜   | Gaussian blur 改善 / 參數微調 / 關閉選項（使用者要求先排到後面） |

---

## Phase 6.5 — 3D 視圖

### Layer 10 — 3D 視覺化
| #    | 狀態 | Task                                                         |
| ---- | ---- | ------------------------------------------------------------ |
| 10-1  | ✅   | R3F 基礎場景：平面圖貼圖到地板平面                           |
| 10-2  | ✅   | 3D 牆體:依 startX/Y → endX/Y 與 topHeight/bottomHeight 生成（實心 Box，厚度 0.1 m，材質顏色） |
| 10-2b | ✅   | 3D 牆體 openings 鏤空（ExtrudeGeometry + 結構化門窗：門框 / 門扇 / 門把，窗框 / 玻璃 / 窗台） |
| 10-2c | ✅   | 3D 牆體選取 / hover 視覺化：與 2D 選取同步（selected=紅 emissive、hover=白 emissive） |
| 10-3  | ✅   | 3D AP 標記：依 x/y/z 座標顯示，含安裝高度差異（圓柱+環+垂直桿） |
| 10-3b | ✅   | 3D AP 天線方向性視覺化：directional=圓錐 / custom=極座標水平輪廓 |
| 10-3c | ✅   | 3D AP 選取 / hover 視覺化 + 名稱 label（CanvasTexture sprite billboard） |
| 10-3d | ✅   | AP mountType UI 啟用（APPanel + BatchPanel）+ 3D 視覺差異（wall 模式豎立面朝 azimuth，移除垂直桿，加掛架小方塊） |
| 10-4  | ✅   | 3D Scope / Floor Hole 視覺化（地板平鋪多邊形 + 外框）         |
| 10-5a | ✅   | 3D 多樓層堆疊：floor.floorHeight（預設 3 m）+ computeFloorElevations，所有樓層同時渲染，切換 active 樓層時相機平滑上下移動 |
| 10-5b | ✅   | 非 active 樓層的牆 / AP / Scope 視覺弱化（dimOpacity 0.28 套到所有 material） |
| 10-5c | ✅   | 單樓層 / 全樓層切換（Viewer3D 左上 toggle + useEditorStore.show3DAllFloors） |
| 10-5d | ✅   | `floor.floorHeight` 編輯 UI（SidebarLeft active 樓層下方 inline 輸入） |
| 10-5e | ⬜   | 3D heatmap 樓板貼圖：每個樓層的 heatmap canvas 貼到對應 elevation 的地板上（依賴 HM-F2/F3） |
| 10-5f | ⬜   | 3D FloorHole 立體視覺化：把 hole 的垂直延伸範圍（bottomFloorId→topFloorId）畫成半透明柱體（依賴 HM-F2a 的資料欄位） |

---

## Phase 7 — 網路基礎設施

### Layer 11 — Switch & PoE
| #    | 狀態 | Task                                                         |
| ---- | ---- | ------------------------------------------------------------ |
| 11-1 | ⬜   | Switch 放置與屬性面板（型號、port 數、PoE 預算）             |
| 11-2 | ⬜   | AP ↔ Switch 連線：自動計算所需埠數                           |
| 11-3 | ⬜   | PoE 電力預算計算，過載警告提示                               |
| 11-4 | ⬜   | MDF / IDF 堆疊設定                                           |

### Layer 12 — 走線管路
| #    | 狀態 | Task                                                         |
| ---- | ---- | ------------------------------------------------------------ |
| 12-1 | ⬜   | Cable Tray 路徑繪製：設備間的線纜走線                        |
| 12-2 | ⬜   | 自動計算線長（依走線路徑 + 比例尺）                          |
| 12-3 | ⬜   | Cable Riser 垂直升降點（多樓層配線）                         |

### Layer 13 — 多設備支援
| #    | 狀態 | Task                                                         |
| ---- | ---- | ------------------------------------------------------------ |
| 13-1 | ⬜   | IPCam 放置與屬性面板（視角錐形、解析度、FoV）                |
| 13-2 | ⬜   | Gateway 放置與屬性面板                                       |
| 13-3 | ⬜   | 通用 IoT 設備放置（感測器等第三方設備）                      |

---

## Phase 8 — 容量規劃 & Client 模擬

### Layer 14 — 容量規劃
| #    | 狀態 | Task                                                         |
| ---- | ---- | ------------------------------------------------------------ |
| 14-1 | ⬜   | 容量區域（Capacity Zone）繪製 + 子區域                       |
| 14-2 | ⬜   | 各區域設定預期 client 數、頻段分佈比例                       |
| 14-3 | ⬜   | 各 AP radio 負載狀態視覺化，過載以紅色標示                   |
| 14-4 | ⬜   | 6 GHz client 比例調整，影響容量分配                          |

### Layer 15 — Client 體驗模擬
| #    | 狀態 | Task                                                         |
| ---- | ---- | ------------------------------------------------------------ |
| 15-1 | ⬜   | Client 裝置類型設定（手機/筆電/IoT，頻段支援、噪聲水平）    |
| 15-2 | ⬜   | Client 連線品質模擬（需等 Phase 5 Heatmap 重寫完成）        |
| 15-3 | ⬜   | Client 漫遊路徑視覺化                                        |
| 15-4 | ⬜   | Wi-Fi 6E / Wi-Fi 7 模擬支援                                  |

---

## Phase 9 — AI 輔助 & 進階視覺化

### Layer 16 — AI 自動化
| #    | 狀態 | Task                                                         |
| ---- | ---- | ------------------------------------------------------------ |
| 16-1 | ⬜   | AI 自動量測比例尺（辨識圖面標註）                            |
| 16-2 | ⬜   | AI 自動描繪建築範圍（Scoping）                               |
| 16-3 | ⬜   | AI 自動偵測牆壁、門、窗、電梯結構                            |
| 16-4 | ⬜   | AI 自動建議 AP 放置位置                                      |

### Layer 17 — 進階顯示
| #    | 狀態 | Task                                                         |
| ---- | ---- | ------------------------------------------------------------ |
| 17-1 | ⬜   | 人流熱區顯示：定義人流密度區域，疊加於平面圖                 |
| 17-2 | ⬜   | WiFi Client 訊號模擬顯示：終端裝置各位置連線品質             |

---

## 整合（未來）
| #   | 狀態 | Task                                                                     |
| --- | ---- | ------------------------------------------------------------------------ |
| I-1 | ⬜   | 將 floorplanService 切換為真實 API（替換 mock data）                     |
| I-2 | ⬜   | 封裝為可嵌入主產品的 `<FloorplanSystem>` 元件（props in / callback out） |
| I-3 | ⬜   | 專案管理：建立專案時設定國家（影響頻段規範）+ 環境類型                   |
