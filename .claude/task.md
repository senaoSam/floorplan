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

## Phase 5 — Heatmap 重寫（依 heatmap_sample 演算法）

> **背景**：原先基於 NPv1 / .tmp-heatmap 規格的 WebGL 實作於 2026-04-21 全數移除（HeatmapWebGL、HeatmapControl、FormulaNote、ituR2040、rfDefaults、autoPowerPlan、useEditorStore 熱圖相關 state、materials.js 的 ITU-R 欄位、FloorImagePanel 樓板 UI）。
>
> **新規格來源**：`heatmap_sample/`（獨立小專案）
> - `src/physics/` constants / geometry / propagation / scenario
> - `src/render/` heatmap / colormap
> - 演算法：ITU-R P.1238 室內 + Friis blend / image-source 反射 / UTD knife-edge 繞射 / 入射角 secant / 同頻 SINR 聚合
> - 渲染：Canvas 2D coarse grid + bilinear 上採樣 + gaussian blur
>
> **本專案改寫方向**：把 heatmap_sample 演算法**移植進 WebGL fragment shader**（保留 GPU 即時性）
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

### MVP — 把 heatmap_sample 演算法接進主系統（CPU 版，先不 GLSL）

| #    | 狀態 | Task |
| ---- | ---- | ---- |
| HM-1 | ✅   | 橋接層 `src/features/heatmap/buildScenario.js`：把 floor/walls/APs/scopes 轉成 sample 的 scenario 格式（px→m 用 floor.scale；walls 展成 segments 並合併 openings；APs 帶 pos/txDbm/channel/frequency/channelWidth） |
| HM-2 | ✅   | 引擎整合：把 `src/heatmap_sample/render/heatmap.js` + `propagation.js` 改成可被主系統呼叫；頻率改讀 AP `frequency + channel + channelWidth` 算真實中心頻率（取代 sample 寫死 5190 MHz） |
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
| HM-F2 | ⬜   | FloorHole 跨樓層訊號穿透（含垂直範圍判斷）— 依賴樓層垂直模型（elevation），建議與 Phase 6.5 / HM-F3 一起做 |
| HM-F3 | ⬜   | 樓板衰減（`floor.floorSlab*` 資料欄位已保留）— 與 HM-F2 耦合，一併做 |
| HM-F4 | ⬜   | autoPowerPlan 自動功率規劃重建（依賴新 heatmap 完成） |
| HM-F5 | ⬜   | 把 CPU 引擎移植到 WebGL fragment shader（GPU 即時性） |
| HM-F6 | ⬜   | 拖曳中凍結 heatmap 的效能優化（目前任何變動即重算；大場景卡時再加） |

---

## Phase 6.5 — 3D 視圖

### Layer 10 — 3D 視覺化
| #    | 狀態 | Task                                                         |
| ---- | ---- | ------------------------------------------------------------ |
| 10-1 | ⬜   | R3F 基礎場景：平面圖貼圖到地板平面                           |
| 10-2 | ⬜   | 3D 牆體:依 startX/Y → endX/Y 與 topHeight/bottomHeight 生成  |
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
