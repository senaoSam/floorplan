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
| HM-F8  | ✅   | 頻率相依的牆損失（ITU-R P.2040-3，2026-04-26）：每個材質加 `lossB` 頻率指數（取自 P.2040-3 Table 3 — concrete 1.99 / brick 1.21 / drywall 1.62 / wood 1.04 / glass 0.27 / metal 0），per-AP 牆損失 `dbLoss(f) = dbLoss * (f_GHz / 2.4) ** lossB`。`material.dbLoss` 維持 2.4 GHz 標稱 anchor 不變。propagation `rssiFromAp` 算 `fOver24` 一次後 thread 進三條 `accumulateWallLoss` call site。GLSL：wall texture 從 3 → 4 texels/wall（新增 texel3 = lossB），`wallLossOblique` 加 `lossB == 0` short-circuit 跳 `pow()`；renderField FS_FIELD 在 AP loop 內部算 fOver24，renderAp 用 `uFOver24` uniform。**驗收結果**（F5d full gate, ≤1 dB）：refl-min max 0.001 dB ✓、dense-aps max 0.093 dB ✓、basic 維持 HM-F5c-fix-2 的 known 1-cell metal-axis outlier（max 40.8 dB / 1 cell + CCI 54-cell spread），JS vs golden 全 0.000 dB。2.4 GHz 場景數值不變（anchor 校準），5/6 GHz 隨 lossB 物理放大 |

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
4. **HM-drag-lod** — 拖曳期間關 refl/diff（5 行 code，省 22-128× refl/diff 開銷）
5. **HM-drag-solo** — 拖 AP 期間單 AP 模式 / 拖牆期間 freeze（Hamina 風格，3000 AP 規模唯一可行的拖曳絲滑解）

#### 5 項 shader-only 優化（HM-F5i ~ F5m）做完後的預期

**全保真版本**（不靠 drag-lod 妥協、refl + diff 全開、freqN 不降、grid 不降）綜合加速 10-17×：

| 規模 | 全保真拖曳 60 FPS？ | 仍需 drag-lod？ |
| --- | --- | --- |
| 1000 AP / 50K walls   | ✅ 可（~15 ms） | 不需要，可拿掉妥協 |
| 2000 AP / 100K walls  | ⚠️ 邊緣 25-40 FPS | 視場景選用 |
| **3000 AP / 150K walls** | ❌ 全保真 ~100 ms（10 FPS） | **仍需 drag-lod** |

**3000 AP 全保真絲滑超出本輪 5 項範圍** — 受限於 fragment × AP 的乘積量級（4.8 億次評估）。
本輪目標：**1000-2000 AP 全保真絲滑、drag-lod 在小場景退役**；3000 AP 規模仍以 drag-lod 達成「可用級」。

#### 已放棄項目

- **F5e（增量 texel 上傳）**：被「拖曳降畫質」全面 dominate，且對動牆 0 加速；先標延後，實測「拖曳降畫質」不夠時再評估
- **AP merging / decimation（路線 E）**：物理失準，與 JS reference 對齊精神衝突
- **WebGPU compute shader（路線 C）**：相容性考量（task.md 既有約束）
- **WASM 主線**：CPU 加速 2-3× 對 1000 AP 杯水車薪；shader-only 路線下不需要

#### 備註（暫不做，未來參考）

- **拖曳結束從粗版切細版的「閃一下」過渡感**：建議方案是 Konva Image opacity tween（兩 canvas cross-fade ~200ms，~20 行 code）。多數網規工具（Hamina/Ekahau）沒做此 transition，35ms 切換可能根本察覺不到。實測有需要再加。

#### 既有約束

> 純 CPU（JS 或 WASM）在 1000+ AP 規模撐不住，主線是 GPU（WebGL2 shader-only）。
> **不做 WebGPU**（相容性考量）。**不考慮無 WebGL2 環境的 fallback**（2026-04-27 決議：WebGL2 為硬性需求）。

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
| HM-T5  | ✅   | Edge-case fixtures：✅ `__fixtures__/refl-min/`（1 metal wall + 1 AP，反射隔離 debug 用）— 2026-04-25 為 F5c+d 嘗試而建。✅ `__fixtures__/dense-aps/`（100 AP 10×10 jittered + ~600 walls cubicle + metal islands；觸發 HM-F5h cascade gate apCount≥50；驗 aggregated path 在大規模下的數值正確性 + bench 平台）— 2026-04-26。✅ `__fixtures__/dense-walls/`（3 AP + ~50 walls 壓縮在 30×20 m corridor maze；refl=off 純 Friis+walls 路徑壓力測試）— 2026-04-26。**附帶修復**：原 SEEN_BUF=8 cyclic-dedup buffer 在 dense-walls 場景失效（5 dB RSSI / 14 dB CCI friis-baseline drift），bump 到 16 後全 PASS（max 0.093 dB ≤ 1 dB）；basic + refl-min + dense-aps 不 regress。✅ `__fixtures__/cross-floor-tunneling/`（5 樓層 stack + 1 AP 在頂樓 z=14.5 m + rx grid 在地面；無牆/無洞純跨樓層 slab 路徑；rx 由正下方斜伸到角落驗 sec(θ) 從 1.0 走到 3.5 cap）— 2026-04-26。F5d gate max 0.001 dB ✓ |
| HM-T6  | ✅   | Bench 頁面（`#/heatmap-bench`）強化（2026-04-28）：(a) engine selector（all / shader-only / JS-only）預設 shader-only — shader 開發迭代不必每輪付幾秒～幾百秒 JS 成本；(b) `getGL()` 偵測 `gl.isContextLost()` 自動 dispose 重建，`renderAp` / `renderField` 在 `readPixels` 前檢查 context lost 改 throw 取代 silent 全零；(c) walls × aps > 100k 自動 skip brute-force pass 防 Windows TDR（2 秒 GPU watchdog 觸發後 Chrome 全域停權 WebGL 直到瀏覽器重啟），grid path 不受影響；(d) skip / error 在 cell 顯示 `— *` + tooltip 區分 dash 來源。**踩坑紀錄**：bench 100×2000 brute 觸發 TDR 後，cached `glInstance` 指向死 context，後續 run 全部 silent 失敗；Chrome 也會把 WebGL 黑名單，連 prod tab 都壞掉，必須完整重啟 Chrome 才恢復 |

### GPU 即時化路線（依序執行）

| #      | 狀態 | Task |
| ------ | ---- | ---- |
| HM-F5a | ✅   | WebGL shader MVP：`rssiFromAp` 翻 GLSL（`src/features/heatmap/propagationGL.js` + `sampleFieldGL.js`），walls/APs 打包成 RGBA32F texture、fragment shader 每格掃全部 walls/APs；Friis + 牆穿透 (Z filter) + slab loss + openings + omni/directional 天線 (custom 走 CPU fallback)。反射/複數 Fresnel/繞射/多頻點留給 F5c/F5d。**驗收**：對 `field-friis.json` baseline max diff ~1e-5 dB ≤ 1 dB ✓。HM-T3 引擎切換按鈕 + 瀏覽器 diff page (`#/heatmap-diff`) 也一併實作 |
| HM-F5b | ✅   | Uniform Grid 空間加速（不用 BVH，2D 場景下 grid 構造簡單、shader 無遞迴）：CPU 端按 wall AABB 把每面牆塞進覆蓋的 cells，emit `gridIdxTex` (RGBA32F, nGx×nGy) + `gridListTex` (R32F, flat wall idx)。Shader 用 Amanatides-Woo DDA 沿 ray 走 cells，配 8-slot 循環 buffer 去重。`setUseGrid(false)` 可切回 brute force（debug / bench 用）。**驗收**：basic + refl-min × friis baseline 全部 max diff = 0.000 dB ✓。Bench (`#/heatmap-bench`) 100 AP × 2000 牆 JS 212s vs Shader+grid 408ms → **521× 加速**。**bug 修復（2026-04-26）**：原 DDA 終止條件 `cx < -1 \|\| cx > uGridDims.x` 對「AP/rx 在 grid AABB 外」場景太緊，ray 從外部走入 grid 時第一步就被攔下，根本走不到 wall-bearing cell。改用 parametric `tCur > 1` 終止（追蹤 ray 進入 cell 的 t），保留 cxEnd/cyEnd 早停 + maxSteps 兜底。refl-min fixture 從 max 44 dB → 0.000 dB，basic 不 regress |
| HM-F5c+d | 部分 | **合併處理**：反射 + 複數 Fresnel + 繞射 + 多頻點相干疊加上 shader。**驗收**（F5d gate, full physics baseline）：refl-min max ≤ 0.001 dB **clean PASS**；basic 1/2501 退化點 (10,13) 32 dB（mean 0.019 dB / p95 0.000 dB）；demo 場景 **65/4087 cells > 1 dB**（98% 對齊，主編輯器視覺有等高線可見偏差）。**F5d 嚴格 max ≤ 1 dB gate 沒過**——剩餘 outlier 留給 HM-F5c-fix 處理。實作四子步驟逐步 commit：(0) freqOverrideN opt + diff page sub-step toggle、(1) Fresnel pure-fn parity 72 cases worst 1.17e-6、(2) image-source reflection（修兩個 `normalize((0,0))=NaN` bug：reflection 端點退化 inDir、wallLossOblique zero ray dir）、(3) knife-edge diffraction、(4) Hperp[N]/Hpara[N] band sweep + tauRef phase reference |
| HM-F5c-fix | 部分 | **Endpoint hysteresis 完成（2026-04-26）**：geometry.js + propagationGL.js (×3) 加 `SEG_HIT_EPS = 1e-6` 雙向 padding——u 兩端 + t 上界都 admit ULP-level overflow；JS 也改成同樣 pad 讓兩邊 deterministic。`sampleField.js` cci 結果 clamp 到 `CCI_MIN_DBM = -120` 對齊 shader 的 sentinel。**dense-aps 全 PASS** F5d gate（max 0.155 dB CCI、0.093 dB RSSI/SINR/SNR；原本 80+ 個 > 1 dB outlier 全清），refl-min 不 regress（max 0.001 dB）。剩 **basic (10, 13) 1 cell 32 dB** 是 outlier class (b)「rx 在 metal wall 內 + 共線 → destructive interference fp32 累加到 power=0」，**不是 endpoint 問題、padding 解不了**，留給未來 Kahan summation / double-float 模擬處理。**已嘗試失敗（保留紀錄）**：tauRef phase reference 改善 phase 累加但對退化點 power=0 無效；segSegIntersect 加 SEG_HIT_EPS=1e-5 *reject* ray-endpoint hit 引發災難（reflection legs 全 reject）——本次 pad 是相反方向（admit）所以安全 |
| HM-F5c-fix-2 | ✅ known-issue | **接受 known-issue 收尾（2026-04-26）**：basic fixture (10, 13) m 1 cell metal-axis outlier max 32 dB 接受為已知瑕疵，不再追擊。**理由**：(a) 影響範圍 1/2501 ≈ 0.04% 視覺面積，**single cell 不擴散**（周圍 5×5 = 25 cells 中 24 個 d_rssi = 0.00）；(b) 觸發條件嚴苛——rx 必須精確坐在 metal wall (x=10) 軸線上 + AP 也在同軸 (10, 7.5)，加上 grid 對齊到 0.5 m 才會踩；(c) 物理上是真實的 destructive interference null（reflection 跟 direct path 算術上完全等幅反相），fp32 算出 power=0 在這個 degenerate geometry 下「沒錯」；(d) **不是 round-off 累加問題**——前次 Kahan/Neumaier compensated sum 試過完全無效（max 32.06 dB / 1 cell 一字不差）。**保留紀錄**前次嘗試失敗：Kahan/Neumaier H-accumulator compensated sum；改動已 revert。**未來若需處理**：(a) sentinel + JS fallback（host 端偵測 RSSI < -250 dBm 該 cell 用 JS 重算）或 (b) double-float 模擬，但 ROI 極低暫不投資 |
| HM-F5g | ✅   | **per-fragment all-AP loop + AP 空間 culling**：APs 包進 4-texel-per-AP RGBA32F texture，shader 內 loop over APs 同時做 distance culling（free-space-only RSSI < -120 dBm 直接 skip）；output 從「per-AP R32F grid」變「aggregated RGBA32F (rssi, sinr, snr, cci)」一次到位。重組為兩條 path：scalar fast path（refl=off + diff=off + 無 custom AP）走 single dispatch + 一次 readPixels；refl/diff/custom 場景 fallback 回 renderAp per-AP loop（保留 F5c+d 精度）。**驗收**：friis baseline basic+refl-min 對 JS max 0.093 dB ≤ 1 dB ✓（aggregated path shader fp32 dB↔linear 換算引入新增 ~0.1 dB 偏差，遠低於 gate）；full baseline 走 fallback path 跟 F5c+d 完全一致無 regress（basic 1/2501 outlier 32 dB 留給 HM-F5c-fix）。Bench (#/heatmap-bench) 100 AP × 500 walls JS 15.9s vs Shader+grid **58.6 ms（271× vs JS）**，從原 ~3-4s per-AP path 降到 ~60ms |
| HM-F5h | ✅   | **Cascade tiling（粗→細兩 pass）**：propagationGL 在 renderField 內加 coarse pre-pass — free-space-only RSSI 對所有 AP 算最大值，gridStep × 4 解析度寫 R8 mask（>= cullFloor → alive）。Fine pass shader 讀 mask 在 main() 開頭 early-exit（含 1-cell dilation 避免邊界 artefact）。Gate 在 apCount ≥ 50 才啟動，小場景不付 overhead。**正確性論證**：coarse 用同一個 cullFloor，free-space 是物理上限（牆/slab 只會降低），所以 coarse 給 dead → fine 一定全 cull → 走 -120 sentinel，**數學上零誤差、無需 fixture 驗證**。basic/refl-min 自動走 cascade-off path 行為與 F5g 完全一致。預估死區比例 0.5~0.7 的大場景 1.4~1.7× 加速；coarse pass cost ≈ C/16，aliveRatio<0.94 即穩賺 |
| HM-drag-lod | ✅ | **拖曳期間降畫質（實際生效項，2026-04-27 校正）**：HeatmapLayer 從 useDragOverlayStore 衍生 isDragging（任一 dragAP/dragWall/dragScope 非 null 即為 true）；實際生效的妥協 4 項：(1) `liveMaxReflOrder = 0` + `liveEnableDiffraction = false`（**主刀，省 22-128× refl/diff 開銷**，p50 RSSI delta < 1 dB），(2) `liveCullFloorDbm = -95`（噪聲底以下剪枝，~1.2-1.5×），(3) `liveBlur = 0` + `liveShowContours = false`（後處理暫關，~0 ms 救但減少 overdraw），(4) `liveRssiOnly = (mode === rssi \|\| snr)`（物理等效，跳 CCI per-fragment loop，1.5-3×）。**注意**：原規畫的 `gridStep × 3 + freqOverrideN = 3` 並未實作（liveGridStepM = gridStepM × 1, liveFreqOverrideN = undefined）— 真實效益主要靠關 refl/diff 那一刀。放手 overlay 清空，下一輪 effect 自然回到完整精度（~35 ms） |
| HM-drag-solo | ✅ | **拖曳期間單 AP 模式 / freeze（Hamina 風格，2026-04-27 排入）**：drag-lod 把每幀從 ~150ms 砍到 ~25ms 還不夠 3000 AP 絲滑；本項把「拖曳中算什麼」徹底重劃。**拖 AP**：dragstart snapshot 當前 heatmap canvas 當灰底（淡化 ~30% opacity 留作參考），拖曳期間只跑被拖 AP 的 single-AP RSSI grid（renderAp 1 顆 AP，跳過 aggregated SINR/CCI），畫成全色階 overlay 疊在灰底上 — fragment 從 N_AP loop 降到 1 AP，預期 10-25× 加速（3000 AP 規模 25 ms → 1-3 ms，絕對絲滑）。**拖牆 / 拖 scope**：直接 freeze，dragstart 那張 canvas 維持顯示，dragmove 完全不重算（牆影響全 N_AP 沒省解，freeze 是唯一務實解）。**鬆手**：清掉 freeze / overlay，下一輪 effect 跑完整精算（~35 ms）回到全保真。**視覺權衡**：使用者拖 AP 時注意力 100% 在被拖 AP 的覆蓋圈，其他 AP 熱圖暫時資訊價值 ≈ 0（Hamina/Ekahau 都這樣做）；拖牆期間「凍結」也比「半精度更新」的視覺跳變更穩定。**互斥**：與 HM-F5j 的「LOS field 把 refl/diff 救回拖曳」路線互斥 — 兩條都奔絲滑，drag-solo 走「降資訊量」路線、F5j 走「降算量」路線。drag-solo 工程量小、效果立竿見影，**先做**；F5j 之後評估是否仍需要。**實作（2026-04-27）**：`useHeatmapStore.dragMode: 'live' \| 'solo'`（預設 solo），HeatmapControl 設定面板新增「拖曳模式」下拉。HeatmapLayer 新增 snapshot canvas（dragstart 用 `drawImage(gl.canvas)` 複製到獨立 HTMLCanvasElement）+ `displayMode` state（'main' / 'solo-ap' / 'solo-frozen'）。Solo 拖 AP：以 `aps:[soloAP]` 重建 scenario 跑 sampleFieldGL / sampleField，refl/diff 全保留（單 AP 成本可承受），渲染寫進 gl.canvas，snapshot 在底層 0.3 opacity。Solo 拖牆/Scope：effect 早期 return 不重算，snapshot 在 1.0 opacity 凍結顯示。**鬆手切換無閃爍**：`displayMode='main'` 在 gl.render() 完成後同個 React commit 才設定，瀏覽器無法畫到「snapshot 已隱藏 / main 還沒重繪」的中間幀。Solo 預設、灰底 0.3 無「凍結中」視覺提示 |
| HM-F5i | ✅   | **Refl/Diff 接上 wall grid（shader-only 路線主軸 A，2026-04-27）**：`accumulateWallLossExcept`（反射兩 leg）+ `accumulateWallLossWithHits`（直達 + 繞射兩 leg）改走 Amanatides-Woo DDA `processCellExcept` / `processCellWithHits`，沿用 HM-F5b 同一套 SEEN_BUF=16 cyclic dedup。skip semantics：`if (wIdx == excludeW) continue;` 在 dedup 之前 — 排除牆不佔 SEEN_BUF slot。dispatch 同 F5b：`if (uGridDims.x == 0) brute else grid`。**驗收（F5d full gate, ≤ 1 dB）**：refl-min max 0.001 dB ✓、cross-floor-tunneling 0.001 dB ✓、dense-aps 0.093 dB ✓、dense-walls 0.093 dB ✓、basic 沿襲 HM-F5c-fix-2 known-issue（max 40.8 dB / 1 cell + CCI ~56-cell spread，數字與既有紀錄完全一致 → 不是 F5i regression）。JS engine 不變，`pnpm heatmap:diff` JS-vs-golden 全 0.000 dB。**Bench（full physics, refl=on diff=on，shader+grid vs JS）**：5 AP × 20 walls 5.34×、20 AP × 20 walls 10.13×、20 AP × 100 walls **23.96×**（JS 32.8 s → shader+grid 1.37 s）；grid/brute ratio 從小規模 2.20× 收斂到 (20×100) 1.74×，符合 grid setup overhead 在大規模被攤平的預期（task.md 預估 100 牆約 10× 對齊）。50×100 以上規模 JS 已耗盡可用時間，未實測 |
| HM-F5j | ✅   | **Per-AP LOS field bake（shader-only 路線主軸 B-1，2026-04-27）**：新 `FS_LOS` shader（stop-on-first-hit DDA + Z filter + SEEN_BUF=16 dedup，沿用 HM-F5b wall grid），每 AP 一張 R8 texture 存「AP→rx ray 是否 0 牆 LOS」。`bakeLos()` API + `losCache: Map<apKey, {tex, fbo, hash}>`，hash = `(apX, apY, apZ, gridStepM, originX, originY, nx, ny, rxZM, wallsVersion)`。**Invalidation 選擇性**：AP 移動只 rebake 該 entry；牆編輯（uploadWalls bump wallsVersion）整張 cache 清；APs 增刪自動 evict。**Mode A（strict，預設）**：FS shader LOS=1 → `dirScan = vec2(0.0)` 跳 direct wallScan + dirHits=0 自然 gate 繞射 loop；**反射照跑**（JS reference 反射 loop 跟 dirHits 無關，跳反射會 break refl-min metal-wall 物理）。**Mode B（fast，opt-in via `opts.losFastMode`）**：LOS=1 連反射也跳，預留給未來 drag 路徑，主精算路徑不啟用。**驗收結果**（F5d gate, ≤ 1 dB）：refl-min 0.001 dB ✓、cross-floor-tunneling 0.001 dB ✓、dense-aps 0.093 dB ✓、dense-walls 0.093 dB ✓、basic 沿襲 HM-F5c-fix-2 known 1-cell metal-axis outlier（不是 F5j regression）。JS engine 不變，`pnpm heatmap:diff` 全 0.000 dB。**踩坑**：FS shader 內 JS 註解寫 `` `dirHits>0` `` 反引號提早關閉 template literal，後面 GLSL 整段被 JS parser 當成 code 炸 SyntaxError 白畫面 — 註解內禁用反引號 |
| HM-F5k | ✅   | **AP→corner / AP→wall 鏡像 precompute texture（shader-only 路線主軸 B-2/B-3，2026-04-28）**：CPU bake 兩張 per-AP RGBA32F texture：(a) `uApCornersGeo` (1×N_corners) `.rg = (d1, geomLos)`；(b) `uApWallMirror` (1×N_walls) `.rg = mirrorPoint(AP, wall.a, wall.b)`。Cache keyed by AP id + wallsVersion，uploadWalls / uploadCorners 都觸發 invalidation。**Shader 改動**：反射 loop 用預計算 apImg 取代 per-fragment mirrorPoint（省 1 sub + 1 normalize + 1 dot + 1 sub-mul-mul per wall per fragment）；繞射 loop `geomLos==1` 跳過 s1 DDA（AP→corner 幾何上 0 牆 → s1 保證 (0,0) 不論 Z；Z filter 邊緣仍走 DDA 兜底）。`uApGeoEnabled=0` short-circuit 回原 per-fragment compute（debug parity / 未 bake fallback）。**走 CPU bake 而非新 shader program**：純 2D 幾何，bakeWalls/bakeCorners host 端輕量 snapshot；省一個 program + FBO + readPixels。**驗收結果**（F5d gate, ≤ 1 dB）：refl-min 0.001 dB ✓、cross-floor-tunneling 0.001 dB ✓、dense-aps 0.093 dB ✓、dense-walls 0.093 dB ✓、basic 沿襲 HM-F5c-fix-2 known 1-cell metal-axis outlier。JS engine 不變，`pnpm heatmap:diff` 全 0.000 dB |
| HM-F5l | ✅   | **Refl/diff cull gate（shader-only 路線主軸 C，物理保真，2026-04-28）**：採用 inline FS-only cull 取代另跑 coarse pass — 等價且更簡潔。FS shader 加 `uCullFloorDbm` uniform，`rssiWithReflections` 早期計算 `fsBest = uTxDbm + uAntGainDbi + uRxGainDbi - pathLossDb(dDir, uCenterMHz)`；若 `fsBest < uCullFloorDbm` 設 `cullByFloor=true`。反射 / 繞射 loop 進入條件加 `&& !cullByFloor`，FS-only 已在 floor 以下時整段跳過。**物理論證**：refl 距離 d1+d2 ≥ d（三角不等式）+ Fresnel \|Γ\|≤1 衰減；diff 加 knife-edge 衰減；所以 `FS-only direct < floor` ⇒ refl/diff 也 < floor，跳過為零誤差（與 HM-F5h 同一個 upper-bound 論證）。`uAntGainDbi`（boresight 上限）作為角度增益的嚴格上界，不會誤殺活 cell。直接 Friis 路徑照跑（便宜），輸出 RSSI 仍正確。**為何沒採用 coarse pass**：coarse cost ~5 ops/coarse-fragment 跟 inline FS check 等量級，但 inline 不付新 texture / shader program / readPixels；省下的 dead-cell refl/diff loop 才是大頭。**驗收結果**（F5d gate, ≤ 1 dB，瀏覽器 shader vs golden）：refl-min 0.001 dB ✓、cross-floor-tunneling 0.001 dB ✓、dense-aps 0.093 dB ✓、dense-walls 0.093 dB ✓、basic 沿襲 HM-F5c-fix-2 known 1-cell metal-axis outlier。JS engine 不變，`pnpm heatmap:diff` 全 0.000 dB。Bench 加速比待大場景實測 |
| HM-F5m | ⏸️   | **延後 — 實測 readPixels 不是瓶頸（2026-04-28）**：原假設 N_AP 次 readPixels roundtrip 主導 frame time，實測**不成立**。dense-aps 100 AP + refl + diff full-physics 在瀏覽器跑 ~20.4 秒/frame，其中 readPixels 61×41 R32F × 100 AP = **16.8 ms (0.08%)**。瓶頸在 fragment shader 工作（refl loop × N_walls × NMAX=40 相干和），不是 GPU↔CPU roundtrip。4-AP batch 即使消滅 readPixels 也只省 ~12 ms / 20400 ms = 可忽略。**未來考量**：批次也可降低 dispatch overhead（uniform 設定 + program switch 的 fixed cost）但 dense-aps 100 AP / 20s 場景下 dispatch 成本同樣是噪音。改去做 HM-F5f 找 fragment-side 真熱點（NMAX 降頻、refl/diff loop body 加速）才能移動 needle。**驗收**：N/A（任務未啟動） |
| HM-F5e | ⏸️   | **延後（被 HM-drag-lod dominate）**：增量 texel 上傳僅對「拖一顆 AP」加速，對動牆 0 加速；HM-drag-lod 通用且 ~5 行 code 即可達 8-40× 加速。等 HM-drag-lod 實測拖曳體感不夠絲滑時再評估 |
| HM-F5f | ✅   | **Diff loop cull 重排（2026-04-28）**：把 `cornerDiffractionDb` 純幾何 cull 從 wall scan **之後**提前到 wall scan **之前**。原順序：算 d1/d2/cZM → 跑 s1/s2 兩個 DDA wall scan → 檢查 `s1.y/s2.y > 1` → 算 diff → 檢查 `diff > 40 dB`。新順序：算 d1/d2/cZM → 算 `diff = cornerDiffractionDb(...)` (純 2D 幾何，無 DDA) → 若 `diff >= 1e29 \|\| diff > 40` → continue（**省兩個 DDA wall scan**） → 才跑 s1/s2。**物理零誤差**：兩條 cull 條件獨立（wall hit count vs knife-edge 幾何），cull 結果集合相同，只是改變「哪些被 cull 的 corner 仍要付 wall scan 成本」。**驗收結果**（F5d gate, 瀏覽器 shader vs golden）：refl-min 0.001 ✓、cross-floor-tunneling 0.001 ✓、dense-aps 0.093 ✓、dense-walls 0.093 ✓、basic 沿襲 HM-F5c-fix-2 known 1-cell metal-axis outlier（與 HM-F5l 紀錄一字不差，零 regression）。JS engine 不變。**效能實測**（dense-aps 100 AP × 157 walls × 247 corners + refl + diff，median of 5 runs）：baseline 20.37 s/frame → F5f ON **11.42 s/frame，加速 1.78× / -44% frame time**。**踩坑**：comment 內反引號 `` `s1.y/s2.y > 1` `` 提前關閉 JS template literal 引發 `Unexpected identifier 's1'` 白畫面（HM-F5j 同樣坑） — FS shader template literal 內的註解禁用反引號。**前次嘗試紀錄（保留參考）**：試做「per-corner / per-refl-leg Friis upper bound cull」（在 d1+d2 算完後檢查 `txDbm + uAntGainDbi + uRxGainDbi - pathLossDb(dTotC)` 是否低於 cullFloor）。F5d gate 全 PASS 物理零誤差，但 cull rate 在 fixture/實務密度下趨近於 0%（dense-aps 30×20m 場景 dTotC ≤ 50m → fsBest ≈ -55 dBm 永遠 >> -120 cullFloor），200×100m 合成場景 per-fragment 多 1 次 pathLoss/compare 反而微 regression 1-2%，已 revert。本次成功的 diff cull 重排不付任何「條件 cost」（只是重排既有 cull 條件的執行順序），純省 dead corner 的 wall scan |

### 備援與延伸

<!--
2026-04-27 決議：不考慮無 WebGL2 環境的 fallback，HM-F6（Web Worker CPU fallback）移除。
WebGL2 為本專案的硬性需求；shader 路徑為唯一 runtime 路徑。
JS 引擎僅保留作為 (a) golden test 真相來源 (b) HM-F9 autoPowerPlan worker 內部使用。
-->

| #     | 狀態 | Task |
| ----- | ---- | ---- |
| HM-F9 | ✅   | **autoPowerPlan 進 Web Worker（2026-04-29）**：`src/workers/autoPowerPlan.worker.js` 用 Vite `?worker` import + ES module worker，message 協定 `run` / `cancel`（in-flight `aborted` flag）→ `progress` / `done` / `error`。Worker 直接 import 既有 `runAutoPowerPlan`（演算法不變），onProgress 退化為單純 `postMessage` + 同進程 flag 檢查（main thread 不必 await round-trip）。AutoPowerModal 改成：每次 `handleRun` `new AutoPowerWorker()`、ref 持有、handler 處 progress/done/error、unmount terminate。**scopeMaskFn closure 跨不過 postMessage** → 在 worker 內重建 scenario（autoPowerPlan 本來就在 worker 裡呼叫 buildScenario，從 raw floor/walls/aps/scopes 重建即可）。txMap 序列化為 `Array.from(entries)`，main 端 `new Map(entries)` 還原。Cancel 改 polite — 送 `{type:'cancel'}` 等 worker 回 `{aborted:true}`，UI 走原本 `已取消` 路徑。**保留** onProgress / 8-evaluate throttle：worker thread 不卡 UI，但 throttle 仍提供穩定 progress cadence + cancel checkpoint |
| HM-F4 | ✅   | **autoPowerPlan 自動功率規劃（2026-04-26 起手 / 2026-04-29 cost function v2）**：Greedy + 多起點 (max/mid/min) ±1 dB 局部搜尋。粗 grid 2 m 控成本，scenario walls/scope mask 只建一次（每次 evaluate 只 mutate scenario.aps[i].txDbm 重跑 sampleField）。`src/utils/autoPowerPlan.js` 演算法 + `src/components/AutoPowerModal/` UI（目標 RSSI/SINR 設定、進度條 + ETA、結果預覽 per-AP txPower diff、套用/重新設定/取消，Portal 渲染避開 PanelRight transform）。入口兩處：(a) BatchPanel 多選 AP 時「自動規劃所選 AP 功率」按鈕；(b) SidebarLeft active 樓層 props 下方「自動規劃整層 AP 功率」。每 8 次 evaluate 讓出 main thread + onProgress 可中止。**Cost function v1**（已淘汰）：`cost = (1−coverage) + 0.2 × sinrShortfall`，sinrShortfall 用 sinrLow/inScope 當分母會誘發「放棄邊緣 cell 換 SINR shortfall 變小」反直覺解。**Cost function v2（2026-04-29）**：四個獨立 loss term，每項 [0, 1] 正規化再加權：`L_coverage = 1 − coverage` (w 0.5)、`L_outlier = clip(P95(gap_rssi over in-scope) / 20, 0, 1)` (w 0.2)、`L_quality = covered=∅ ? 1 : clip(mean(gap_sinr | covered) / 15, 0, 1)` (w 0.2)、`L_excess = clip(mean(max(0, tx − txReasonable)) / 10, 0, 1)` (w 0.1)。`txReasonable = clamp(model.maxTxPower[band] − 6, MIN_REASONABLE_TX[band], MAX_REASONABLE_TX[band])`。**設計重點**：(a) coverage / quality 拆兩 term 讓兩者梯度正交（修舊版「放棄邊緣」反直覺解）；(b) outlier 用 P95 in-scope（不是 covered，否則死角剛好被排除看不到）；(c) covered=∅ 時 L_quality=1 避免「沒覆蓋 = 品質沒問題」誤導；(d) 每項先正規化 [0, 1] 再加權，權重才表達「優先序」而非被原始量級放大。UI 新增「規劃品質 = 100 × (1 − cost)」分數顯示 + 四個 term 細項 |
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
| 10-5e | ✅   | **3D heatmap 樓板貼圖（MVP, 2026-04-28）**：active floor 的 heatmap canvas 貼到該樓層地板上方 0.02 m。`src/features/viewer3d/HeatmapPlane3D.jsx` per-floor 跑 buildScenario / sampleFieldGL / heatmapGL（自帶 createHeatmapGL instance — 與 2D HeatmapLayer 的 module-singleton GL 隔離），產出 canvas 用 `THREE.CanvasTexture` 貼 plane，meshBasicMaterial transparent opacity 0.7 + depthWrite false 避免 z-fight。狀態 / mode / 開關全跟 2D 同步（共用 useHeatmapStore），cross-floor physics 透過同一個 buildScenario(crossFloor) 自動繼承。**FloorStack 內 `{isActive && <HeatmapPlane3D ... />}`** — MVP 範圍只 active floor，避免多樓層各跑 sampleFieldGL；多樓層全顯示留作後續迭代。**HeatmapControl 從 Editor2D hoist 到 CanvasArea** 同層級，2D / 3D 視圖共用同一個開關/設定面板，省去切換 view mode 才能調整。**驗收**（瀏覽器 MCP）：3D viewer 地板出現完整 RSSI 色帶 + 等高線；切 SINR mode 即時換色彩 pattern（與 RSSI 視覺差異明顯）；3D 直接點 HeatmapControl 開關按鈕能即時 enable/disable，地板恢復 floor image 無殘留 |
| 10-5f | ✅   | 3D FloorHole 立體視覺化（2026-04-29）：`src/features/viewer3d/FloorHoleVolume3D.jsx` 用 ExtrudeGeometry 把 hole 從 `bottomFloor.elevation` 擠到 `topFloor.elevation + topFloor.floorHeight`（頂樓天花板）為半透明紫色柱體（side α 0.35、stroke α 1.0、`#a855f7` / `#7c3aed`），上下緣 line loop。**渲染位置**：scene root（不在 FloorStack group 內），讓單樓層模式下跨樓層柱體仍完整顯示。非 active 自身樓層套 dim 0.6。ScopeLayer3D 移除 hole 的平面 polygon 渲染（避免和柱體底蓋重複）。**附帶修復 CameraRig 視角被搶 bug**：`useEffect([target,camera,entryPose])` 在「新增樓層」這類 Viewer3D re-render 時，即使 numeric target 不變仍會走 else branch 把 `tweening.current=true` 每幀朝 desired pose 補間 → 搶走 OrbitControls 拖曳輸入。改用 `lastTarget` ref 存上次反應的三個 number，相同就 early return，不動 tweening |

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
| 16-3 | ⬜   | AI 自動偵測牆壁、門、窗（展開為 16-3a ~ 16-3o，見下）|
| 16-4 | ⬜   | AI 自動建議 AP 放置位置                                      |

#### 16-3 AI 牆壁辨識（純前端 OpenCV.js 路線）

> **目標**：使用者上傳平面圖後，自動偵測牆線並轉成 wall segments 寫入 `useWallStore`。
>
> **技術選型**：純前端 OpenCV.js + 自製 pipeline，離線、免後端、隱私好。對 CAD 匯出圖召回 90%+，掃描圖 70-85%，手繪圖 ~50%。配合半自動 review UX 達到「使用者再修幾條就能用」。
>
> **設計理念（evidence-based scoring，非 hard rule pipeline）**：
> - 不要早期硬刪 connected component，改用「標記低可信」逐步累積證據，最後 graph topology 救回短牆
> - 牆 vs 非牆的關鍵 feature：**parallel pair（成對牆厚）** + **oriented ROI 黑像素密度** + **與牆 graph 的拓撲連接性**
> - dominant orientation clustering 取代寫死 0/45/90，支援斜向建築
> - graph-based collinear merge（u/n 投影統一處理任意角度）取代兩兩比對
> - 實心填色牆走 contour + skeletonize 分支，與線條牆 pipeline 並存
>
> **MVP 切入點（先做地基，跑 baseline 再加 feature）**：
> - 第一版只做 16-3a + 16-3b + 16-3c + 16-3e + 16-3f 的最小版本
> - 跑 3-5 張不同風格測試圖看 baseline，再客觀評估後續 feature ROI
> - OpenCV.js 大圖 skeletonize 跑在 Web Worker（沿用 HM-F9 worker pattern）

| #     | 狀態 | Task |
| ----- | ---- | ---- |
| 16-3a | ⬜   | OpenCV.js 整合與圖片載入 pipeline：CDN / 本地 wasm 載入策略、Mat 物件 lifecycle 管理（手動 delete 防 memory leak）、灰階 + 高斯 blur + Otsu / adaptiveThreshold + 反相，二值圖牆線為白、背景為黑 |
| 16-3b | ⬜   | 圖框與外邊界偵測：findContours 找最大封閉輪廓 → 內縮 N px 當分析 ROI，後續所有處理只在 ROI 內，順便解掉「上傳圖有多餘白邊」 |
| 16-3c | ⬜   | Deskew：Hough 統計線段角度直方圖估主方向 → warpAffine 旋轉校正。**必須在角度量化前做**，否則掃描圖歪 2-3° 整片誤判 |
| 16-3d | ⬜   | Connected component scoring（不刪除、只打分數）：對每個 component 計算 area / aspect ratio / stroke thickness / foreground density / 主方向夾角 / 鄰近 component 密度。文字特徵=小面積+局部密集+方向亂；牆特徵=細長+對齊主方向+黑密度高。輸出 confidence map 給後續 stage 參考 |
| 16-3e | ⬜   | 分方向 morphology 強化：horizontal kernel `Size(15,1)` + vertical kernel `Size(1,15)`（kernel 長度依 deskew 後主方向 + 估計牆厚動態調），對角 kernel optional。把水平、垂直牆線連起來，斷裂的虛線變實線 |
| 16-3f | ⬜   | HoughLinesP 線段抽取：minLineLength = imageDiagonal × 0.01~0.03（相對尺度，不要寫死 px）；maxLineGap = estimatedWallThickness × 1.5~3。先估牆厚再決定參數 |
| 16-3g | ⬜   | 角度 clustering（取代寫死 45°）：收集所有線段角度做 1D clustering（k-means / mean shift / histogram peak），找 dominant orientations，依群心吸附。支援 30°/60° 斜向建築 |
| 16-3h | ⬜   | Graph-based collinear merge：node = candidate segment，edge = `angleDiff < tol && offsetDiff < tol && projGap < tol`（用方向向量 u 與法向量 n 的投影統一處理任意角度），connected components 後對每個 component 投影最小/最大端點為合併線段。比兩兩比對乾淨且無順序問題 |
| 16-3i | ⬜   | Wall thickness 估計（parallel pair detection）：對每條合併後線段，往法向量 n 方向掃近距離平行線段，找成對的 → 距離分布做 histogram peak 估典型牆厚。**這是區分「牆」vs「家具邊 / 尺寸線 / 地磚縫」的關鍵 feature**，非牆長直線不會成對 |
| 16-3j | ⬜   | Oriented ROI density scoring：對每條候選線段建 oriented ROI（長度=線長、寬=estimatedWallThickness、方向=line angle），計算前景密度。真牆密度高且穩定，家具/尺寸線密度低 |
| 16-3k | ⬜   | 實心填色牆分支（contour + skeleton）：步驟 16-3a 之後判斷黑像素佔比，超過閾值走 contour 路線。findContours → 過濾非牆 blob → Zhang-Suen thinning（**JS 端實作 + Web Worker 跑大圖**）→ skeleton graph pruning → 轉中心線 + 估局部厚度（distance transform） |
| 16-3l | ⬜   | 候選 confidence scoring 整合：`score = w1·lengthScore + w2·densityScore + w3·pairedLineScore + w4·topologyScore + w5·angleClusterScore − w6·symbolPenalty − w7·borderPenalty − w8·dimensionLinePenalty − w9·textClusterPenalty − w10·furnitureShapePenalty`。權重不寫死，做成可調 preset（CAD / 掃描 / 手繪），之後評估「依輸入特徵自動選 preset」|
| 16-3m | ⬜   | Web Worker 化：OpenCV.js 整套 pipeline 跑在 worker（沿用 HM-F9 pattern：`?worker` import + ES module worker、`run` / `cancel` / `progress` 訊息協定）。大圖 skeletonize 不卡 UI；提供進度條 + ETA + 中止鈕 |
| 16-3n | ⬜   | 半自動 Review UI：偵測完成後進入 review mode，候選牆依 confidence 分層顯示（高=實線、中=虛線、低=半透明）。使用者點擊切換保留/刪除、可手動補畫漏線、確認後一次寫入 `useWallStore`。預設材質取 `MATERIALS.CONCRETE`（與手動繪牆一致），高度用樓層預設值。Review modal Portal 渲染避開 PanelRight transform |
| 16-3o | ⬜   | 整合入口：Toolbar 加「AI 偵測牆壁」按鈕（active floor 必須有 floorImage 才 enable），點擊後跑 worker pipeline → 開 Review UI。完成後寫入 wallStore 走 Undo/Redo（與 7-4 整合，誤判可一鍵還原） |

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
