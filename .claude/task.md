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

### Layer 5 — Heatmap
| #   | 狀態 | Task                                                          |
| --- | ---- | ------------------------------------------------------------- |
| 5-1 | ✅   | 基礎 RSSI 計算（FSPL，不含牆體）+ Canvas 疊加顯示             |
| 5-2 | ✅   | Ray-casting 牆體衰減（Web Worker 背景計算）                   |
| 5-3 | ✅   | WebGL Fragment Shader 即時渲染（取代 CPU Canvas）             |
| 5-4 | ✅   | Co-channel 干擾計算：AP 加入 channel 屬性，改以 SINR 顯示熱圖 |
| 5-5 | ✅   | 多模式熱圖切換（RSSI / SINR / SNR / 頻道重疊 / 預估速率 / AP 數量） |
| 5-6 | ✅   | 柔和色階 + 頻段相關牆體衰減 + 可調環境路徑損耗指數（v1，公式部分已被 Phase 5 PHY-1/2 取代並改寫）|

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
| 8-2c | ✅   | Heatmap 納入定向增益（WebGL shader，cosine-squared 模型）     |
| 8-2d | ✅   | Custom pattern 內建預設（Patch / Sector 等）+ pattern 預覽    |
| 8-3a | ✅   | 國家頻段資料庫 + 頻道選單依國家過濾                          |
| 8-3b | ✅   | 自動頻道規劃演算法（批次指派，greedy 最小干擾）              |
| 8-3c | ✅   | 放置新 AP 時自動挑選頻道（可開關）                           |
| 8-4 | ✅   | 自動功率規劃：依覆蓋需求自動調整 AP 發射功率                 |
| 8-5 | ✅   | 頻寬設定：支援 20/40/80/160 MHz 頻寬選擇                     |

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
| 9-3a | ✅   | 樓板衰減資料模型 + UI：每樓層設定樓板材質與 dB 值（不影響熱圖） |
| 9-3b | ✅   | 樓板衰減納入熱圖：跨樓層 AP 訊號依樓板累積 dB 衰減        |
| 9-3c | ✅   | 中庭穿透例外（v1）：AP 垂直投影落在中間樓層 Floor Hole 內時略過該層樓板 |
| 9-3d | ✅   | 中庭穿透例外（v2）：訊號 3D 斜線穿越點落在 Hole 內即 bypass（per-pixel、shader 判定） |
| 9-3e | ✅   | 中庭垂直延伸範圍：Floor Hole 新增 topFloorId/bottomFloorId，貫穿多層自動生效 |

---

## Phase 5 — Heatmap 公式改寫（對齊 NPv1 / .tmp-heatmap 規格）🔥 優先

> **絕對真相來源**：`.tmp-heatmap/`（特別是 01/02/04/08）—— 所有公式、係數、流程以該文件為準
> **目標**：把目前的 heatmap 公式全部改成 NPv1 等價算法，提升真實性
> **不在範圍**：wasm / Web Worker / WebGPU（未來才做，這裡先用既有 WebGL fragment shader）
> **拖曳即時計算**：可暫時關閉（拖曳期間隱藏熱圖或凍結舊結果），mouseup 後再算
>
> **目前實作差距摘要（對照 .tmp-heatmap）**
> 1. 距離損耗公式錯：缺 PL(d₀=1m) 基準；應為 `FSPL(1m,f) + 10·n·log10(d/d₀)`
> 2. 牆體衰減用「手調 freqFactor 乘數」而非 ITU-R P.2040 (a,b,c,d) 頻率外推
> 3. 牆無厚度 / 無入射角修正（斜射等同正射）
> 4. NLOS 完全無繞射（硬切陰影）—— 缺 Order 1/2 dominant-path search
> 5. 缺 cutoutDistanceMeters（每點都對全部 AP 跑迴圈）
> 6. 缺 clientHeightMeters（接收平面假設 = 地面）
> 7. Noise floor 全頻段共用單值；應 per-band（2.4/5/6 各自）
> 8. Data Rate MCS 表過簡，未對應 802.11ax 標準

### Layer RF-PHY — 物理公式對齊（必做、無卡頓）

| #     | 狀態 | Task |
| ----- | ---- | ---- |
| PHY-1 | ✅ | **PLE 距離損耗公式重寫**：改為 `PL(d) = FSPL(1m, f) + 10·n·log10(d/d₀)`，d₀=1m。FSPL(1m,f) = `20·log10(f_MHz) - 27.55`。每頻段各自 PLE（2.4G default 3.0、5G 3.3、6G 3.5），可被環境 preset 覆蓋 |
| PHY-2 | ✅ | **ITU-R P.2040 材料模型**：`materials.js` 每材質補 `(a, b, c, d, refFreqMHz, isConductor)`，用 `02-material-models.md §1.2` 表格係數（concrete/brick/drywall/wood/glass/metal）。新增 `wallAttAtFreq(material, freqMHz)` 工具：依公式做頻率外推，取代目前 `dbLoss × freqFactor` |
| PHY-3 | ⏸ | **牆厚屬性**：延後。規格 §1.3 `L = α × d` 的 `α × d` 積分型衰減才需實際 width；目前 refAttDb 已是「典型厚度下總 dB」，PHY-4 用比例修正即可。未來做 zone attenuation（`attenuationDBPerM × travel`）時再加 |
| PHY-4 | ✅ | **入射角修正**：shader 算射線與牆法向的夾角 θ，wall_dB *= 1/max(cos(θ), 0.1) 對應等效厚度 width/cos(θ)。refAttDb 視為正射基準 |
| PHY-5 | ✅ | **Per-band noise floor**：`-95/-95/-95 dBm` 三頻段獨立常數放 `constants/rfDefaults.js`，shader 依 serving AP 頻段選對應值（取代目前單一 `NOISE_DBM`） |
| PHY-6 | ✅ | **clientHeightMeters**：HeatmapSettings 新增 `clientHeightMeters`（預設 1.0m）。AP `installHeight` 已存在；3D 距離 = `sqrt(d_2D² + (apZ - clientH)²)`。納入 PLE 計算（取代純 2D distance） |
| PHY-7 | ✅ | **cutoutDistanceMeters**：HeatmapSettings 新增 `cutoutDistanceMeters`（預設 50m）。shader 內 `if (dist_2D > cutoff) skip AP`，省迴圈 |

### Layer RF-DPM — Dominant Path Model（NLOS 繞射）

| #     | 狀態 | Task |
| ----- | ---- | ---- |
| DPM-1 | ✅ | **Visibility Graph**：每 wall 兩端點 + wallIdx 進 shader uniform（u_vgNodes[32], u_vgNodeWallIdx[32]）。wallKey 變動自動重建（CPU loop 內填）。未建鄰接表（小 N 直接全掃即可） |
| DPM-2 | ✅ | **Order 1 繞射路徑**：shader 對每 (AP, pixel, v) 檢查 `visible(AP,v)` AND `visible(v,px)`（skip v 所屬牆），取 `min(直射, PL(AP→v)+PL(v→px)+diffLoss·θ/90)`。繞射角 θ = acos(dot(d1,d2))，skip 跨樓層 AP（需 3D VG） |
| DPM-3 | ✅ | **diffractionLossDBPer90Deg**：`constants/rfDefaults.js` HEATMAP_DEFAULTS.diffractionLossDBPer90Deg = 6 dB（已在 PHY-1 時預建），shader uniform `u_diffLossPer90Deg` |
| DPM-4 | ⏸ | **Order 2 繞射**：uniform `u_maxDiffOrder` 已加、預設 1；Order 2 需要兩端點對的 PL(v1→v2) 計算，端點集合大時 O(N²) 爆炸；規格文字建議預設 1 即可。延後 |
| DPM-5 | ✅ | **MAX_VG_NODES=32**：受 MAX_FRAGMENT_UNIFORM_VECTORS=1024 限制，超過時 console.warn 並退回 Order 0（u_vgCount=0） |

### Layer RF-RX — RSSI / SNR / SINR / Data Rate 公式對齊

| #     | 狀態 | Task |
| ----- | ---- | ---- |
| RX-1 | ✅ | **RSSI 公式**：`RSSI = TxPower + G_tx(θ,φ) - PL(AP→p)`。確認天線增益已包含（目前 `antennaGain` 已實作，檢查無誤）—— shader 公式 `txPow + gain - pl - wallLoss - slabDb` 與規格 §2.1 1:1 對齊 |
| RX-2 | ✅ | **SNR 公式**：`SNR = RSSI_primary - N_floor(band, BW)`，`N_floor(BW) = wifiNoiseFloor[band] + 10·log10(BW/20)`（PHY-5 完成後已 per-band，公式與規格 §2.3 1:1 對齊） |
| RX-3 | ✅ | **SINR 公式（線性疊加）**：`N_eff = 10·log10(10^(N_floor/10) + Σ 10^(RSSI_intf/10))`，SINR = RSSI_primary - N_eff。check 同/部分頻道重疊 overlap_factor（完全重疊 1.0、部分 0.3~0.7、不重疊 0）。2.4G 相鄰頻道：diff1=0.72, diff2=0.27, diff3=0.04, diff4=0.004, ≥5=0（IEEE 802.11 共識）；5G/6G 僅 primary channel 相同算 1.0 |
| RX-4 | ✅ | **Data Rate MCS 表重寫**：以 `04-heatmap-pipeline.md §2.4` 802.11ax 表為準，建 `(MCS, minSNR, 20MHz/80MHz/160MHz × 1SS/4SS)` 查表。考慮 AP 的 `streamCount` 與 `channelWidth`，輸出 Mbps。實作：IEEE 802.11-2020 §27.5 完整 MCS 0-11 表（0.8μs GI），20/40/80/160 MHz 倍率 1/2/4/8，streams 線性倍率（apModels 加 streamCount per-band） |

### Layer RF-INT — 整合與驗證

| #     | 狀態 | Task |
| ----- | ---- | ---- |
| INT-1 | ✅ | **拖曳即時計算暫時關閉**：拖曳期間 RAF loop 直接 return 凍結 framebuffer，mouseup 後下一幀自動重算（prevKey 比對觸發）。原 P-2 LOD 暫時擱置 |
| INT-2 | ✅ | **單元驗證（Playwright MCP + console）**：FSPL@1m,2.4GHz=40.19（規格 40.05，f=2437 vs 2400 造成 0.14 差）；FSPL@10m=60.19；concrete @ 5GHz = 23.49 dB（比規格 §6 典型 10-15 dB 高，因 refAttDb=12 代表較厚牆；§1.3 公式本身嚴格對齊） |
| INT-3 | ✅ | **整合驗證（MCP 截圖存檔）**：`phy2-03..06` PHY-2 頻段比較；`phy4-visual-01` PHY-4 入射角不對稱陰影；`dpm-01-with-diffraction` DPM 短牆繞射漸層。牆兩側色落差 + 繞射端點附近漸層都符合規格 |
| INT-4 | ✅ | **FormulaNote.jsx 更新**：同步更新 Log-Distance (PHY-1) / RSSI (RX-1) / SINR (RX-3) / 牆體衰減 (PHY-2/4) / Per-band noise (PHY-5) / clientHeight (PHY-6) / Data Rate (RX-4) / 環境 PLE per-band；每節加規格來源標註。DPM 待後續補 |

<!--
==============================================================================
未來範圍（不在 Phase 5 內）：
  - wasm + Web Worker：把 DPM CPU 計算搬出主執行緒
  - WebGPU compute pipeline：取代 WebGL fragment shader
  - 拖曳降採樣（renderScale）+ Dirty Rect：恢復即時拖曳
  - Triangle Grid 校正（env-learning）：需 survey 資料
  - Reflection / multipath：DPM 不做，需 SBR / ray tracing
==============================================================================
-->

---

## Phase 5.5 — 效能優化

### Layer PERF — 拖曳流暢度 & 熱圖即時性
| #     | 狀態 | Task                                                                                         |
| ----- | ---- | -------------------------------------------------------------------------------------------- |
| P-1   | ✅   | AP 拖曳 RAF buffer：拖曳中座標暫存於 ref，以 requestAnimationFrame 更新視覺，放開才提交 store |
| P-2   | ✅   | LOD 拖曳降解析度：拖曳期間 framebuffer 以 renderScale=0.3 渲染（放開恢復 full-res），可調參數 |
| P-3   | ✅   | History store snapshot 非阻塞化：structuredClone 改 async（或 Web Worker / 分層 lazy clone），避免放開操作時 50~100ms 卡頓；補 flushPending() 確保 Undo 正確性 |
| P-4   | ⬜   | WallLayer snap 加 bounding box 快速過濾：避開 O(n) 全掃，並移除 EndpointHandle 重複掃描       |
| P-5   | ⬜   | Editor2D 鍵盤刪除 effect 依賴穩定化：store actions 用穩定 ref，減少 effect 重掛             |
| P-6   | ⬜   | Dirty Rect 區域重繪：雙 framebuffer（static/dynamic）+ scissor test，只重算拖曳中 AP 影響區；SINR / Data Rate 模式 fallback 全畫面 ⚠ 等 Phase 5 (DPM) 完成後重評估，可能因「AP 影響區」形狀改變而需重做或廢棄 |

---

## Phase 6 — Heatmap Grid 重構（對齊 .tmp-heatmap §5/§6）

> **目標**：從 per-pixel 直算改成「稀疏 grid 計算 + shader 插值顯示」，對齊規格架構
> **不在範圍**：wasm / Web Worker / WebGPU（保留 WebGL 2.0 fragment shader 內做 render-to-texture）
> **動機**：
> 1. 規格 §5.1 動態 grid 解析度 + §5.3 clientHeightMeters + §6 正三角形網格是 NPv1 基礎架構
> 2. 鋪路 env-learning (`AttenuatingTriangleField`) 的 per-cell 衰減值儲存
> 3. 降低 fragment shader uniform loop 壓力（grid 像素數 << viewport 像素數）
>
> **架構**：
> - **Pass 1 (compute)**：quad 渲染到 Float32 texture（如 250×250），每 texel = 對應 grid cell 的 `(RSSI_primary, RSSI_secondary, SNR, …)` 多通道結果
> - **Pass 2 (display)**：quad 讀 grid texture + bilinear 插值 + 色階映射 → 輸出 canvas

### Layer GRID — 計算 grid 化（WebGL FBO render-to-texture）

| #     | 狀態 | Task |
| ----- | ---- | ---- |
| GRID-1 | ⬜ | **Framebuffer 與 Float32 Texture 建置**：`EXT_color_buffer_float` 已啟用；建 R32F 或 RGBA32F texture（RGBA 可一次存 4 通道：primary/secondary RSSI + SNR + Rate hint） |
| GRID-2 | ⬜ | **Pass 1 compute shader**：將現有 main() 重寫為「輸出 RSSI 到 texture」；viewport 設為 grid 解析度（不是 canvas 解析度） |
| GRID-3 | ⬜ | **動態 grid 解析度**：HeatmapSettings 新增 `gridCellSizeMeters`（規格 §5.1 預設 0.5m）；grid 大小 = scope bbox / cellSize（clamp 到 [64, 512]）|
| GRID-4 | ⬜ | **Pass 2 display shader**：讀 grid texture、依 canvas pixel 對應位置做 bilinear，再做色階；mode 切換不需重算 grid（換色階即可） |
| GRID-5 | ⬜ | **多通道輸出**：grid texture R/G/B/A 各存一個值（RSSI_primary / RSSI_secondary / SNR_serving / data_rate_hint），顯示 pass 依 mode 取對應通道 |
| GRID-6 | ⬜ | **Scope clamp**：grid texture 外（scope-out）輸出 sentinel 值（如 −999），顯示 pass 見 sentinel 輸出透明 |

### Layer GRID-TRI — 正三角形網格（§6，選做）

| #     | 狀態 | Task |
| ----- | ---- | ---- |
| TRI-1 | ⬜ | **三角網格生成**：依 cellSize 產生正三角形網格（而非方形）；每 cell 頂點座標存 texture |
| TRI-2 | ⬜ | **射線切片累加**：射線從 AP 到 rx 切成三角 cell 片段，每 cell 查 attTriangleField 累加衰減 |
| TRI-3 | ⬜ | **env-learning hook**：預留 `AttenuatingTriangleField` 資料結構，每 triangle 存 per-band 修正 dB |

<!--
==============================================================================
Phase 6 先做 Layer GRID（方形 grid），視覺應與 Phase 5 per-pixel 幾乎一致。
Layer GRID-TRI 是 §6 規格要求的「正三角形」變體 + env-learning 接點，可延後。

完成 Phase 6 後的效能評估決策點：
  - 若 JS 主執行緒算 grid 還是卡 → 評估 Phase 6.5 wasm/worker
  - 若 GPU pass 1 已足夠快 → 繼續 Phase 7 (3D)
==============================================================================
-->

---

## Phase 6.5 — 3D 視圖

### Layer 10 — 3D 視覺化
| #    | 狀態 | Task                                                         |
| ---- | ---- | ------------------------------------------------------------ |
| 10-1 | ⬜   | R3F 基礎場景：平面圖貼圖到地板平面                           |
| 10-2 | ⬜   | 3D 牆體：依 startX/Y → endX/Y 與 topHeight/bottomHeight 生成 |
| 10-3 | ⬜   | 3D AP 標記：依 x/y/z 座標顯示，含安裝高度差異                |
| 10-4 | ⬜   | 3D Scope / Floor Hole 視覺化                                 |
| 10-5 | ⬜   | 3D 多樓層堆疊顯示，樓層間訊號穿透視覺化                     |

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
| 15-2 | ⬜   | Client 連線品質模擬：以 Phase 5 RX-4 MCS 表為基礎，加 client uplink 視角（client TX 較低，比 downlink 弱 5-10 dB）|
| 15-3 | ⬜   | Client 漫遊路徑視覺化（路徑上連線品質變化）                  |
| 15-4 | ⬜   | Wi-Fi 6E / Wi-Fi 7 模擬支援：在 Phase 5 RX-4 802.11ax 表上擴 802.11be（MCS 12-13、320 MHz 頻寬）|

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
