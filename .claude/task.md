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
| PHY-1 | ⬜ | **PLE 距離損耗公式重寫**：改為 `PL(d) = FSPL(1m, f) + 10·n·log10(d/d₀)`，d₀=1m。FSPL(1m,f) = `20·log10(f_MHz) - 27.55`。每頻段各自 PLE（2.4G default 3.0、5G 3.3、6G 3.5），可被環境 preset 覆蓋 |
| PHY-2 | ⬜ | **ITU-R P.2040 材料模型**：`materials.js` 每材質補 `(a, b, c, d, refFreqMHz, isConductor)`，用 `02-material-models.md §1.2` 表格係數（concrete/brick/drywall/wood/glass/metal）。新增 `wallAttAtFreq(material, freqMHz)` 工具：依公式做頻率外推，取代目前 `dbLoss × freqFactor` |
| PHY-3 | ⬜ | **牆厚屬性**：Wall 資料模型新增 `width`（公尺，預設取材質 width，concrete 0.2m、drywall 0.1m 等），UI 暫不曝露（後續再加）。傳進 shader |
| PHY-4 | ⬜ | **入射角修正**：shader 算射線與牆法向的夾角 θ，等效厚度 = `width / max(cos(θ), 0.1)`，wall_dB *= eff_thickness / width |
| PHY-5 | ⬜ | **Per-band noise floor**：`-95/-95/-95 dBm` 三頻段獨立常數放 `constants/rfDefaults.js`，shader 依 serving AP 頻段選對應值（取代目前單一 `NOISE_DBM`） |
| PHY-6 | ⬜ | **clientHeightMeters**：HeatmapSettings 新增 `clientHeightMeters`（預設 1.0m）。AP `installHeight` 已存在；3D 距離 = `sqrt(d_2D² + (apZ - clientH)²)`。納入 PLE 計算（取代純 2D distance） |
| PHY-7 | ⬜ | **cutoutDistanceMeters**：HeatmapSettings 新增 `cutoutDistanceMeters`（預設 50m）。shader 內 `if (dist_2D > cutoff) skip AP`，省迴圈 |

### Layer RF-DPM — Dominant Path Model（NLOS 繞射）

| #     | 狀態 | Task |
| ----- | ---- | ---- |
| DPM-1 | ⬜ | **Visibility Graph 預計算**：CPU 端建構牆端點圖（節點=端點，邊=兩端點 LOS 無遮擋）。`useWallStore` 變動時重建。傳入 shader 為 uniform array（端點座標 + 鄰接表） |
| DPM-2 | ⬜ | **Order 1 繞射路徑**：shader 對每個 (AP, pixel) 嘗試所有對 AP/pixel 都可見的端點 v：`PL = pathLossOnSegment(AP→v) + pathLossOnSegment(v→pixel) + diffLossPer90Deg × (turnAngle/90)`。取 min(直射, 各 Order 1) |
| DPM-3 | ⬜ | **diffractionLossDBPer90Deg 設定**：HeatmapSettings 新增（預設 6 dB），UI 暫不曝露 |
| DPM-4 | ⬜ | **Order 2 繞射（可選）**：兩個繞射點。預設關閉（成本高），HeatmapSettings 加 `maxDiffractionOrder`（預設 1）。shader 用 macro 條件編譯避免無謂開銷 |
| DPM-5 | ⬜ | **MAX_VG_NODES 上限**：避免端點過多炸 shader uniform 容量；超過時退回 Order 0（純直射）並 console.warn |

### Layer RF-RX — RSSI / SNR / SINR / Data Rate 公式對齊

| #     | 狀態 | Task |
| ----- | ---- | ---- |
| RX-1 | ⬜ | **RSSI 公式**：`RSSI = TxPower + G_tx(θ,φ) - PL(AP→p)`。確認天線增益已包含（目前 `antennaGain` 已實作，檢查無誤） |
| RX-2 | ⬜ | **SNR 公式**：`SNR = RSSI_primary - N_floor(band, BW)`，`N_floor(BW) = wifiNoiseFloor[band] + 10·log10(BW/20)`（已對，但需切到 per-band noise） |
| RX-3 | ⬜ | **SINR 公式（線性疊加）**：`N_eff = 10·log10(10^(N_floor/10) + Σ 10^(RSSI_intf/10))`，SINR = RSSI_primary - N_eff。check 同/部分頻道重疊 overlap_factor（完全重疊 1.0、部分 0.3~0.7、不重疊 0） |
| RX-4 | ⬜ | **Data Rate MCS 表重寫**：以 `04-heatmap-pipeline.md §2.4` 802.11ax 表為準，建 `(MCS, minSNR, 20MHz/80MHz/160MHz × 1SS/4SS)` 查表。考慮 AP 的 `streamCount` 與 `channelWidth`，輸出 Mbps |

### Layer RF-INT — 整合與驗證

| #     | 狀態 | Task |
| ----- | ---- | ---- |
| INT-1 | ⬜ | **拖曳即時計算暫時關閉**：AP/牆 mousedown 期間隱藏熱圖（或凍結 framebuffer 不重算），mouseup 後重算一次。先把公式對清楚再恢復即時 |
| INT-2 | ⬜ | **單元驗證**：寫測試或在 console 印出比對 — FSPL@1m,2.4GHz=40.05 dB、@10m,2.4GHz=60.05 dB；concrete 牆 5GHz 應約 10-15 dB（依 ITU 公式驗算） |
| INT-3 | ⬜ | **整合驗證**：5m × 5m 空房間中央 AP，預期熱圖近圓形對稱；加一面 concrete 牆，背面明顯衰減（>10 dB 落差）；加一面短牆，繞射處應見漸層而非硬陰影 |
| INT-4 | ⬜ | **FormulaNote.jsx 更新**：右側公式說明面板同步顯示新公式（PLE / ITU-R / DPM） |

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

## Phase 6 — 3D 視圖

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
