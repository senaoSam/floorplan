產品規格書 (OpenSpec)：Floorplan 網路平面圖編輯與分析模組

> **本文件狀態（2026-08-07 全面校對）**
> 舊版此檔只描述「AP + 牆 + 熱圖 + 樓層」的初期範圍，且有數條承諾與實作不符。
> 本次改為**照實作校對後重寫**：
> - 每條功能標註 ✅ 已實作 / ⚠️ 部分實作 / ❌ 未實作（未實作的**保留不刪**，才不會被當成需求遺漏而重複提案）。
> - 補上舊版整域缺漏的五大領域：**相機 / Client View / 統計 / 網路布線 / 自動規劃**。
> - 校對依據為 `src/`（`oldSrc/` 為 Phase 25 前的死碼，不採計）。
> 詳細進度與決策記錄仍以 `.claude/task.md` 為準；本檔只回答「這個產品有什麼」。

---

## 一、產品背景與目的

本模組為網路規劃工具的核心畫布 (Canvas)。
透過瀏覽器提供 2D/3D 平面圖模擬環境，使用者可匯入實體空間平面圖，
建立具備 Z 軸（高度）概念的 2.5D/3D 物理環境模型，並部署無線存取點 (AP)。

系統結合設備參數與物理障礙物，動態即時運算無線訊號涵蓋範圍 (Heatmap)，
協助網路設計評估與優化。

**範圍已擴張**：除無線規劃外，現另涵蓋監控相機規劃與分析、單一使用者連線體驗模擬、
營運統計儀表板、以及有線布線（Switch / 線槽 / 豎井 / 線材 BOM）規劃。

閉環設計：全前端 + mock 資料，無持久化。未來整合點為
`<FloorplanSystem buildingData={...} onSave={...} />`。

---

## 二、平面圖導入與畫布管理 (Floor Plan & Canvas)

### 支援格式
| 格式 | 狀態 | 備註 |
|---|---|---|
| PNG / JPEG | ✅ | `features/importer/useFloorImport.js` |
| PDF | ✅ | 多頁**自動拆成多樓層**（pdfjs-dist；單頁走圖片路徑） |
| CAD (DWG/DXF) | ❌ **未實作** | 無解析器依賴；檔案選擇器 `accept` 僅 `.png,.jpg,.jpeg,.pdf`。**注意**：DXF *匯出* 已於 22-4 明確撤回（見 task.md），匯入則從未實作 |

### 圖資匯入
- ✅ 拖曳 (Drag & Drop) 匯入 — `features/importer/DropZone.jsx`
- ✅ PDF 自動拆分為多樓層圖層
- ✅ 可刪除頁面 / 調整樓層名稱（F2 改名）

### 畫布預處理（`PanelRight/FloorImagePanel.jsx`）
- ✅ 不透明度 (Opacity) — 滑桿 + 25/50/75/100% 快捷
- ✅ 旋轉 (Rotation) — ±90° 鈕、數值輸入、0-359 滑桿、0/90/180/270 快捷
- ✅ 裁切 (Crop) — `EDITOR_MODE.CROP_IMAGE`，可重裁 / 清除裁切
- ❌ **去色（轉灰階）未實作** — 無任何 grayscale/desaturate/ColorMatrix 濾鏡

### 導覽模式
- ✅ 縮放 / 平移（滾輪縮放 + `EDITOR_MODE.PAN` 平移工具 + Space 暫時平移）
- ✅ 2D / 3D 視角切換（`VIEW_MODE`）
- ❌ **「滑鼠模式 / 觸控板模式」切換未實作** — `render/viewport.js` 只有單一固定
  `ZOOM_PER_NOTCH`，無觸控板 / 捏合分支。（`EDITOR_MODE.PAN` 是*工具*，不是輸入裝置模式）

### 比例尺設定
- ✅ 手動繪製標尺 — `EDITOR_MODE.DRAW_SCALE` → `ScaleDialog` 輸入實際公尺算 px/m
- ⚠️ **AI 自動偵測比例尺** — 有，但**是由門寬回推**（`AIWallsModal.autoScaleFromDoors`：
  取 `type==='door'` 線段長度，≥4 門時取中間 50% 抗離群後平均，除以
  `REAL_DOOR_WIDTH_M = 0.9`）。**已知弱點**：新 AI pipeline 門偵測率極低
  （demo 實測 0~1 門），樣本 1 個時抗離群完全失效，會算出明顯錯誤的比例尺。
  建議補「門 <3~4 個不自動套用」門檻（task.md Phase 50 已記載，未做）。

---

## 三、環境建模 (Environment Modeling)

### 3.1 AI 自動化偵測
外部 HTTP pipeline（`AIWallsModal.jsx`，非同步 job 佇列：`POST /jobs` → 輪詢 `GET /jobs/{id}`），
7 種演算法可選，服務自帶去噪 Stage-A。

| 目標 | 狀態 | 備註 |
|---|---|---|
| 牆壁 | ✅ | 回傳 `lines[]` → `utils/floorplanFromLines.js` → **整層取代**該樓層牆 |
| 門 | ✅ | 以**牆上開口 (opening)** 表示，非獨立門物件；材質 WOOD、高 0~2.1m |
| 窗 | ✅ | 同上，材質 GLASS、高 0.9~2.1m（舊版 spec 未列，實際有） |
| 建築範圍 (Scope) | ❌ **未實作** | Scope 只能手繪（`EDITOR_MODE.DRAW_SCOPE`）；AI 流程完全不碰 `useScopeStore` |
| 電梯井 | ❌ **未實作** | 無偵測。垂直貫穿物只有**手動**放置的中庭（`DRAW_FLOOR_HOLE`）與豎井（`PLACE_RISER`） |

- ✅ 支援手動調整與修正（偵測後照常編輯）

### 3.2 牆體與物件建模
**材質與衰減**（`constants/materials.js`）：
- ✅ 內建 **7 種**材質，依 2.4GHz dB 遞增：Glass(2) → Drywall(3) → Wood(4) → Brick(8)
  → Concrete(12) → Low-E Glass(25) → Metal(30)。預設 CONCRETE。
- ✅ **逐面牆 `customDb` 覆寫**（只覆寫 2.4GHz anchor，材質的 lossB / 反射係數 / 顏色沿用）
- ❌ **「自訂材質」未實作** — `materials.js` 是硬編碼常數，無新增 / 編輯材質的 UI 或 action。
  現有的是「從內建清單選」+「單面牆覆寫 dB」兩件事，不是使用者自建材質庫。

**高度設定 (Z-Axis)**：
- ✅ Top Height / Bottom Height（各自獨立數值輸入，step 0.1m）
- ✅ 可建立門、窗等懸空物體（靠上述高度區間 + opening）
- ❌ **「Fill top & bottom 自動補齊」未實作** — 只有兩個手動輸入框，無「到頂 / 落地」按鈕

**牆體操作**：
- ✅ 手動繪製與編輯
- ✅ **Tab / Shift+Tab 切換材質**（`DRAW_WALL` 模式循環 `MATERIAL_LIST`，
  有選取牆時同時改該牆材質；`MaterialToast` 顯示回饋）。同一 Tab 鍵在 AP 模式切頻段、
  Switch 模式切類型。

### 3.3 樓層孔洞與範圍
- ✅ 樓層孔洞 / 中庭 (Void)：定義挑高區域，訊號可跨樓層穿透（`useFloorHoleStore`）
- ✅ In-Scope（計算區）/ Out-of-Scope（排除區）：`useScopeStore`。
  **語意**：Scope 是**純視覺 / 統計區域篩選**，以向量遮罩實作，不改熱圖引擎取樣。

---

## 四、設備部署與樓層管理 (Device & Multi-floor)

### 4.1 AP 設備屬性
- ✅ 座標 (X, Y, Z)，Z 為安裝高度
- ✅ 頻段 2.4 / 5 / 6 GHz（頻段色：2.4 `#f39c12` / 5 `#4fc3f7` / 6 `#a855f7`）
- ✅ 發射功率，**逐頻段預設** `{2.4: 11, 5: 15, 6: 15}` dBm（`getDefaultTxPower`）
- ✅ 天線模式：Omni / Directional（含 Azimuth）/ Custom pattern
- ✅ **俯仰角 tilt**（-90~+90，Phase 40；JS 與 shader 雙引擎同步）
- ✅ 逐型號 per-band **天線增益** `antennaGain`（Phase 47-10）
- ✅ 安裝方式 Ceiling（天花板）/ Wall（牆面）— `mountType`，3D 依此改造型
- ✅ 頻道 + 頻寬（20/40/80/160MHz），PoE class（3af/3at/3bt）
- ✅ 視覺回饋：3D 顯示高度差異、天線場型預覽（2D + 3D）
- ⚠️ **一台 AP = 一個 radio**（單 `frequency`/`channel`）。單台同發三頻**未實作**
  （task.md 47-8b，判定 CP 值不對；workaround = 同位置放多顆）

### 4.2 樓層對齊 (Multi-floor Alignment)
- ⚠️ **對齊方式與舊 spec 不同**：實作是**數值 / 滑桿 + 疊圖目視**
  （`AlignFloorPanel`：`alignOffsetX/Y`、`alignRotation`、`alignScale`，
  可直接在畫布拖曳樓層，並顯示其他樓層半透明參考疊圖）。
  ❌ **「用對齊點（樓梯 / 電梯）解算轉換」未實作** — 無 landmark 點對物件。
- ✅ 對齊語意統一為**米空間**（`utils/floorAlign.js` 為唯一正典）
- ✅ 基準樓層 `alignAnchorFloorId`（預設最底層）
- ✅ 樓板材質與 dB 值，影響垂直訊號傳播
- ✅ 跨樓層計算遇未校正比例尺的樓層 → **排除 + 警告**（不 fallback 硬套）

---

## 五、動態熱圖與計算邏輯 (Dynamic Heatmap)

### 即時更新條件
✅ 移動 AP / 調整高度 / 改牆體材質或高度 / 調整頻段與功率 — 皆即時重算。

### 計算模型
- ✅ 3D 距離（含 Z 軸高度差）、自由空間路徑損耗 (FSPL)
- ✅ 牆體阻擋：依材質 dB + 判斷高度區間是否真的擋到
- ✅ 反射（image-source，可關）、**繞射（knife-edge，可關）**
- ✅ 多樓層傳播：樓板衰減 + 中庭 (Void) 直接穿透
- ✅ 雜訊底隨頻寬抬升（`+10log10(W/20)`）
- ✅ **雙引擎**：JS (`propagation.js`) 與 WebGL2 shader (`propagationGL.js`)。
  **不可違反的架構決策**：JS 引擎**不可移除** — Client View 之後 JS 是「單點查詢主力」
  （probeAt / coverage / hover），shader 只負責整圖 heatmap。改物理公式**兩邊必須同步**。

### 指標切換
✅ **4 種**（舊 spec 只列 3 種）：`rssi` / `sinr` / `snr` / `cci`。
CCI 為「越低越好」（`signBetter: 'low'`，圖例順序自動翻轉）。
另有頻段篩選（全部 / 2.4 / 5 / 6GHz，非當前頻段的 AP marker 半透明化）。

### 視覺化
- ✅ 即時渲染 + dBm 色階 + 等高線 + 模糊
- ✅ 2D / 3D **共用同一張 canvas**（`render/heatmapFrameBus.js`）→ 像素級一致、3D 端零計算成本
- ✅ **無感重算**（Phase 41）：粗場秒出 → 細場無縫換底 + 波紋過渡；非同步 GPU readback
- ✅ 邊緣羽化：未被牆框住的平面圖邊界做 alpha 漸隱（避免把「取樣邊界」誤讀成「涵蓋斷崖」）

---

## 六、相機規劃與分析 (Cameras / CCTV) — 舊 spec 完全未涵蓋

獨立主模式 `PRIMARY_MODE.CAMERA`（畫布只留底圖 + 牆）。對標 Verkada 平面圖功能。

- ✅ 相機放置 / 拖曳 / 旋轉；型號預設（dome / bullet / turret / wide / fisheye）
- ✅ **FOV visibility polygon**：牆遮擋、玻璃 / 窗穿透、門擋視線
- ✅ 盲區圖、重疊覆蓋 overlay（黃=1台 / 藍綠=≥2台）、覆蓋率報表（涵蓋% / 盲區 / 平均重疊）
- ✅ 人流分析：mock 一天軌跡（可重現 seed、避牆、雙峰）、人流量 / 停留 / 動線三檔熱圖
- ✅ 計數線（分方向）、分析區域（逐時長條圖）、回放 timeline（scrubber / 倍速）
- ✅ 裝置線上 / 離機狀態、即時影像 mock popover、未放置裝置清單、Device List 側欄
- ✅ **4 點校正**：平面圖 4 點 + 相機畫面 4 點 → 前端真解 homography（`utils/homography.js`），
  軌跡經投影對位。**刻意不顯示重投影誤差**（4 對點恰定恆為 0，是假精度）。
- ✅ 熱圖可裁切到 FOV 覆蓋區；3D 顯示盲區 / 重疊 / 占用三圖（重用 2D rasteriser 保證像素一致）
- ⚠️ 相機 `coverageTargetPct` 預設 **80%**（與 Wi-Fi 的 90% 不同，FOV 覆蓋是不同物理量，**刻意不統一**）
- ❌ 多站 Sites / 地圖底圖導覽 — **已撤回，不做**（維持單站閉環畫布）
- ❌ 門禁 / 環境感測器等多裝置型別 — **已撤回**

---

## 七、Client View（單一使用者連線體驗）— 舊 spec 完全未涵蓋

模式 `EDITOR_MODE.CLIENT_VIEW`。回答「站在這個點的使用者，實際體驗如何」。

- ✅ 指標：關聯到哪台 AP、RSSI、SNR / SINR、MCS、**資料速率**（11ax 正確倍率 2.0/4.19/8.38）
- ✅ 漫遊 hysteresis、手動鎖定 AP（右鍵選單）、單台 AP 涵蓋（紅色）
- ✅ 涵蓋語意：藍色 = **良好訊號涵蓋**（RSSI ≥ `COVERAGE_THRESHOLD_DBM` 預設 -67），
  **不是**「連不連得到」（實際可關聯到約 -85）。多 AP 取聯集。
- ✅ 室內距離模型 (indoorLoss)、位置記憶、hover 回饋

---

## 八、統計 (Statistics) — 舊 spec 完全未涵蓋

**定案為兩態，不新增第三 mode**：
- **A 域 — 規劃品質**：併入既有 `DevicePlanningPanel`（Plan 模式顯示）。
  涵蓋率 hero + 進度條、目標門檻可調（預設 `COVERAGE_TARGET_PCT` 90%）、達標紅綠燈、
  盲區面積、**雙重涵蓋（≥2台）**、頻道衝突（公尺 + 頻寬相交判定）、◎ 定位最大盲區。
- **B/C 域 — `EDITOR_MODE.STATS` 獨立唯讀模式**：
  ✅ KPI tiles、連線裝置 24h 趨勢、時間 scrubber（播放 / 倍速 / 回即時）、告警清單、
  AP 負載排行（badge 數字 pill，**不用光暈圈**——圓圈=涵蓋範圍已有語意會誤讀）、
  Switch PoE / LLDP 鄰居、頻段分布、client MAC 下鑽、
  **規劃 vs 實測空間疊合**（紅鑽石標出「規劃說夠但實測不足」的落差點）。
- 資料源 `features/stats/statsSource.js` 為 seeded mock（單一真相，10 條不變式自洽）。
  **原則：後端只給原始資料，統計由前端自己算。**

---

## 九、網路布線 (Cable / Switch / Tray / Riser) — 舊 spec 完全未涵蓋

工具群「網路布線」6 個工具。

- ✅ Switch / IDF / MDF（逐類型差異化造型與預設）、PoE 埠容量、
  **per-port class 協商檢查**（AP 需 3bt 接 3at switch → 警告）
- ✅ AP↔Switch 自動 routing（沿線槽 / Manhattan fallback / 無法接線三態）、S2S uplink
- ✅ Cable Tray（工程屬性：寬 / 深 / 掛高 / system）、Riser（跨樓層垂直走線）
- ✅ **Planning BOM**：長度 / 材質（銅 / 光纖）/ 長度級距 / 階層（backbone / distribution / access）
- ✅ 線槽填充率 (fill) 與容量瓶頸
- ✅ **PDF 規劃報告匯出**（封面 / RF 涵蓋率與達標判定 / 每層平面圖快照 / AP 線纜表 /
  S2S / 線槽 BOM / 警告）
- ✅ PNG 平面圖匯出
- ❌ CSV / SVG / DXF 匯出 — **已撤回，不做**
- ❌ Vertical tray / conduit 物件 — **已撤回**（垂直走線只用 Riser）
- ❌ Zone box / consolidation point — **已撤回**
- ❌ Auto IDF 自動選位 — **已撤回**（真實選位是空間語意，非幾何最佳化）

### 設計原則（不可違反）
| 主題 | 原則 |
|---|---|
| 3D = read-only | Z 軸屬性一律在 **2D panel 編輯**；3D 只負責視覺化 |
| Capacity rule | tray fill 用 `capacityProfile`，**不**寫死「NEC 40%」 |
| Color legend | tray 顏色用 owner / company / discipline standard，不綁地區法規 |
| BOM | 是 **Planning BOM**（估算），**不是**施工 final BOM |
| Warning ≠ Code violation | 寫「exceeds selected fill rule」，不寫「code violation」 |

---

## 十、自動規劃 (Auto Planning) — 舊 spec 完全未涵蓋

- ✅ **自動 AP 放置**（`utils/autoPlacePlan.js` + worker）：三模式
  （fresh 重新規劃 / fixed 固定數量 / fill 補洞）+ 頻段選擇 + 頻道指派 +
  ghost 預覽層 + what-if 熱圖 + 移除預覽（紅環✕）+ 原地保留（不洗掉手動調過的參數）。
  **室內偵測** `utils/indoorMask.js` flood fill，避免把 AP 放到牆外空地；
  牆沒接好時退回全範圍並在 UI 明示。未達標會回報 `stopReason`，**不假裝成功**。
- ✅ **自動功率規劃**（`utils/autoPowerPlan.js` + worker，熱圖驅動貪婪）。
  **定位**：業界通常只在 runtime RRM 做這件事；本工具在規劃階段提供。
  效能量級：50AP≈6s / 300AP≈50s。**未做**：套用前熱圖預覽。

---

## 十一、系統特性與技術約束

### 特性
跨平台瀏覽器操作、多格式平面圖（PNG/JPG/PDF）、AI 牆體偵測、2D/3D 視覺化、
多樓層設計與訊號穿透、即時動態 Heatmap、相機與布線規劃、統計與體驗模擬。

### 技術約束（`CLAUDE.md` 為正典，此處僅摘要）
React **17.0.2**（`ReactDOM.render`）、react-konva 17.x（Phase 25 後主渲染改 **PixiJS v8**）、
`@react-three/fiber` **7.0.29**、Zustand v4、**純 JavaScript（無 TypeScript）**、
`.sass` 縮排語法（不用 `.scss`）、Vite + pnpm、Node 20.x、路徑別名 `@` → `./src`。

### 效能紅線（Phase 45/46 戰果，不可回退）
- 3D 隱藏時 `frameloop='never'` 凍結
- 2D/3D 熱圖共用 canvas（3D 端零計算）
- 拖曳走非同步管線（不 stall 主執行緒）
- 基準：SW 渲染機 300 AP 穩態 long task 約 175–200ms

---

## 十二、已知風險 / 待決事項

1. **零持久化**：全 mock，重整即失。整合契約 `buildingData` / `onSave` 尚未接。
2. **AI 服務金鑰**：`AIWallsModal.jsx` 將 `API_BASE_URL` 與 `API_TOKEN` 硬編碼為
   前端常數，會**隨 bundle 出貨到瀏覽器**。內部服務尚可，正式對外前需改為
   後端代理或短期憑證。
3. **自動比例尺可信度**：見 §二（門偵測率低 → 樣本不足時抗離群失效）。
4. **熱圖降級門檻**：`heatmapAdapter` SW/HW 門檻（1500 / 20000）仍是
   **PLACEHOLDER 未校準**。
5. **dev widget**：DemoLoader / StressLoader / ProgressPanel 為開發用，正式版整塊移除。
6. **容量 / airtime 規劃未做**：目前是純覆蓋工具，缺高密度場域容量輸入
   （對標 Ekahau Capacity Planner）。
