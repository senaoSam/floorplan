# Floorplan Planner — 任務進度（精簡版）

> 設計依據：`.claude/cable-spec.md`、`.claude/layer-architecture-spec.md`、`.claude/client-view-spec.md`
> Progress panel 同步：`src/components/ProgressPanel/ProgressPanel.jsx`
>
> 本檔只列 **還沒做的事** + **已撤回的決策（防重做）**。
> 已完成項目的細節交給 git log。

---

## 現況一句話

**Phase 34 Camera 模式全部完成（34-0~34-5 ✅，2026-06-11 使用者驗收 ok）。**
**Phase 34-V Verkada parity 擴充完成（2026-06，見下表）。**
**Phase 35 相機 4 點校正（含階段 2 真投影）+ 導覽 polish 完成（2026-06-29 驗收 ok，見下表）。**
**Phase 36 Verkada Tier 1&2 擴充完成（2026-06-29 驗收 ok，見下表）。下一個 phase 未定。**

---

## 還沒做的事

### Phase 25 效能家族（全部暫緩，防重做）

> 31-5/6/9/10/11 經 2026-06-01 MCP 壓測**全部暫緩**：單層真實 AP 量級（~300）MVP 全達標，瓶頸只在 1000 AP（真實到不了）。
> **重啟扳機（共用）**：單層 active floor >500 AP 真實需求 + 實測 pan/zoom 卡。
> 完整量測 + 各項細節見 `perf-baseline.md §31-12`、memory `project_31_5_6_deferred_1000ap_benchmark`。
> 31-13（刪 `oldSrc/`）：使用者決定保留到正式上線穩定後才刪，現階段不做。

---

## 已完成（細節見 git log）

| Phase | 範圍 |
|-------|------|
| 7–8   | Cable 基礎建設：Switch/IDF/MDF、AP↔SW routing、Cable Tray/Riser graph、PoE/port 容量、Cable Summary BOM + warnings |
| 10–14 | S2S routing、BOM 分類、3D cable 視覺、Tray 編輯/工程屬性、Planning BOM、context menu、CSV/PDF/PNG export |
| 17–18 | Mode capability matrix + 左右鍵分工；UI 分群、Toolbar 浮動 panel、PanelShell、active mode badge、color-legend |
| 20–24 | 效能（memo/fingerprint/drag freeze）、3D 強化、Switch kind 差異化、Konva layer 拆分 |
| 25    | PixiJS hybrid 全功能 port（Bundle 1–52 + parity gaps 853eeef + heatmap 等高線 byte-identical）+ 32-C 增量 routing + 32-E cable 靜動分層（殘影回歸已驗證消除） |
| 26–27 | perf-baseline 文件脈絡警示；heatmap polish audit 實測後全部不做（品質已達標） |
| 33    | **Client View 完整落地**（33-0~33-17）：CLIENT_VIEW mode + simulate（band/hysteresis/MCS/data rate）+ ClientPanel + association/coverage（門檻 -67 可調）+ indoorLoss 距離模型 + 位置記憶 + 手動鎖定 AP（右鍵選單）+ 單台 AP 涵蓋（紅色）+ CV hover 回饋。語意/架構決策見 `.claude/client-view-spec.md` + 下方引擎決策 |
| 34    | **Camera 模式完整落地**（34-0~34-5，2026-06-11 驗收）：CAMERA mode（畫布只剩底圖+牆）+ camera 放置/拖曳/旋轉 + FOV visibility polygon（牆遮擋、玻璃/窗穿透、門擋視線；人移動相反：玻璃擋人、門可走）+ mock 一天軌跡（seedable、避牆、雙峰）+ 偵測語意 live icons（FOV 內實色/外灰 ghost、車=俯視車形朝行進方向）+ 人流熱圖（人流量/停留/動線三檔+時段篩選）+ 盲區圖 + 計數線（分方向、端點可拖、右鍵/Esc 取消）+ 分析區域（全區選取可拖、逐時長條圖）+ 回放 timeline（scrubber/倍速/日循環）。畫布標籤白字+深色描邊適應任意底圖。設計共識與驗收細節：`.claude/phase34-verify.md`、memory `project_camera_mode_phase34`。新增 stores：useCameraStore/useTrackingStore；新增 scene layers：cameraFov/cameras |
| 35    | **相機 4 點校正 + 導覽 polish**（2026-06-29 驗收 ok）：① 4+4 點校正 modal（平面圖 4 點 + mock 相機畫面 4 點 → 前端真求 frame→floor homography，`utils/homography.js` solveHomography/invertHomography）② 品質防呆：四邊形過小/共線即時橘色警告（**不顯示重投影誤差**——4 對點恰定恆為 0 是假精度）；步驟提示跟著 active pane（① 在平面圖上方、② 在相機畫面上方）③ **階段 2 真投影**：軌跡綁定相機 FOV（projectTracks）+ 經 homography 投影；**first-freeze 模型**（首次校正不位移、重校才位移；baseSamples 不可變、frameSamples 凍結），消費者（熱圖/計數線/趨勢/3D）零改動 ④ **純手動校正**（對標 Verkada，無 auto 預設——曾做 auto 但「畫面四角↔地面正方形」非真實光學投影，撤除）；未校正→軌跡用平面座標顯示（demo 不空），已校正綠徽記、未校正提示 ⑤ Device List hover：清單↔marker 雙向高亮 + mock CCTV live 縮圖 ⑥ 占用趨勢點長條跳時間 ⑦ 回放時鐘到秒 HH:MM:SS ⑧ 重構：抽共用 FOV rasteriser + wrapAzimuth 抽 utils/angle。新增：homography/frameConstants/projectTracks、useTrackingStore.reprojectCameraTracks、CalibrationModal、utils/angle。決策與驗證細節：`.claude/verkada-notes.md` §L4/§L5。**未來 live 版**接真實相機主機後校正才對位真實偵測，現 plan/mock 版校正驗證數學正確性 |
| 34-V  | **Verkada parity 擴充**（2026-06，branch `feat/verkada-parity`，對標 Verkada 平面圖 camera 功能，調研+差距表見 `.claude/verkada-notes.md`）：① 熱圖 timelapse 時間推移（占用窗沿日滑動，按鈕自動縮窗）② FOV 偵測脈動 + 由內而外水波擴散環（牆裁切）③ 裝置線上/離線狀態（綠/橘點、離線錐暗+不偵測+計盲區；`deviceStatus.js`：undefined=online，僅 status==='offline' 才離線）④ 占用趨勢面板（逐時長條、可拖、左下）⑤ 即時影像 mock popover（canvas CCTV 畫面、離線雪花）⑥ 覆蓋率報表（涵蓋%/盲區/重疊備援/平均重疊；目標門檻 pass/fail；最大盲區定位=移畫面+開盲區遮罩+脈動環，遮罩 4.5s 自動恢復；單台相機 solo 貢獻）⑦ 重疊覆蓋 overlay（黃=1台/藍綠=≥2台）⑧ 型號預設（dome/bullet/turret/wide/fisheye）⑨ 相機清單面板（多選批次改型號/狀態/刪除、區域分組、可收合、點列定位）⑩ 複製相機 ⑪ 高度快設 ⑫ 方位角 ±15°/對準中心。新增：deviceStatus/detectionBus/coverageStats/overlapLayer/gapMarkerBus/gapMarkerLayer/exportless、cameraModels 常數、CoveragePanel/TrendPanel/CameraListPanel/LiveViewModal。**已撤回**：門禁/環境感測器多裝置（偏離 camera 主線，整包丟棄）、CSV 匯出（使用者喊停）。Code review（2026-06）：無 bug，僅可選重構（3 rasterizer 重複/wrapAzimuth 重複）未做 |
| 36    | **Verkada Tier 1&2 擴充**（2026-06-29 驗收 ok，effort=ultracode+workflows，roadmap 見 `.claude/verkada-notes.md` Tier 1/2）：① 抽共用 `features/cameras/mockCctv.js drawCctvFrame`（合併 LiveViewModal/HoverThumb/CalibrationModal 三處重複 mock CCTV 畫格；加 `renderMode:'mock'\|'stream'` seam 留給未來真實串流，touch 只一檔）② 統一 hover store（cameras 從 `useCameraStore.hoverCameraId` 遷到 `useHoverStore` type:'camera'，刪舊欄；camerasLayer + CameraListPanel 同步）③ 全樓層占用趨勢報表（Tier2 #4）：`generateWeekTracks` 生 7 日 mock（seed-per-day，每天 distinct 數不同；track 帶 `day` 欄）+ `analyticsStats.computeDayRollup`（day-level Set 去重）+ TrendPanel 逐時/逐日切換 + 人數/人·秒/車數 metric 切換 + CSV 匯出（**註：與 34-V「CSV 撤回」衝突，2026-06-29 待確認**）；day-0 消費者（熱圖/計數/3D/校正）零改動，週資料只在面板內 memoize 不入 store ④ Device List 側欄（Tier 1 #3b，**只列攝影機對標 Verkada**——「AP+camera 統一」原為自編延伸、Verkada Device List 無 WiFi AP，已捨棄）：CameraListPanel 從 CAMERA 模式 floating 浮窗升級成 **docked 常駐左欄**（掛 App.jsx，SidebarLeft↔CanvasArea 間，預設顯示、寬 260；多選/批次/分組/雙向 hover/縮圖全保留；切走自動回收空間）⑤ 清單列 📹 鈕（Tier2 #6）直接 openLiveView，stopPropagation 不誤觸選取。**排除**：多裝置型別（門禁/環境感測器，尊重 34-V 撤回）。新增：mockCctv.js、$device-list-width；MCP 驗證 0 console errors。設計共識與取捨：memory `project_tier1_2_devicelist_plan` |

> **引擎架構決策（2026-06-02，不可違反）**：JS 傳播引擎（propagation.js）**不可移除**——Client View 後 JS 是「單點查詢主力」（probeAt/coverage/hover），shader 只負責 heatmap 整圖。基礎物理常數兩邊須一致。詳見 memory `project_clientview_js_engine_role`。
>
> **association/coverage 語意（2026-06-03 確立）**：藍色 = 「良好訊號涵蓋」（RSSI ≥ coverageThresholdDbm 預設 -67），不是「連不連得到」（實際可關聯到 -85）；藍色外仍可能連得到只是弱。多 AP 取聯集。

---

## 已撤回的決策（防重做，不要再提案）

| ID | 撤回理由 |
|----|----------|
| 12-4 Hybrid routing | 17-3 switch hub 落地後痛點消失，沒人抱怨 |
| 21-1 Vertical tray / conduit | Hamina 無此物件；Riser 已涵蓋跨樓層垂直走線；conduit 無實際 routing 價值 |
| 21-2 / 21-3 Zone box | TIA-568 consolidation point 用在有線工位 cabling；分散需求已由 IDF/MDF + uplinkTo 涵蓋 |
| 22-3b SVG export | Konva 無內建 SVG renderer（自製 ~10× 工程）；PNG + PDF 已覆蓋 95% 情境 |
| 22-4 DXF export | AutoCAD 交付在純 AP planner 工作流外；PDF + PNG 已足夠 |
| Phase 19 Auto IDF | IDF 真實選位是空間語意（弱電間/機房），非幾何最佳化；使用者再次確認不必要 |
| 26-2-P4 CableLayer imperative Konva | 視覺 ~1% pixel diff + 無效能改善 |
| 30-3 ~ 30-7 Konva 多層拆分 | react-konva 環境做會白工；融入 Phase 25 PixiJS Container 階層 |
| 31-4 Wall Mesh + line shader | 5000 wall 對 GPU trivial，Graphics + batching 撐得到；日後實測卡頓再重啟 |

---

## Design Principles（後續所有 phase 都遵守）

| 主題 | 原則 |
|---|---|
| **3D = read-only** | Z 軸屬性一律在 **2D panel 編輯**；3D 只負責高度視覺化 |
| **Capacity rule** | tray fill 用 `capacityProfile`，**不**寫死「NEC 40%」 |
| **Color legend** | tray 顏色用 owner / company / discipline standard，不綁地區法規 |
| **垂直走線只用 Riser** | 不另做 vertical tray / conduit 物件 |
| **BOM = Planning BOM** | planning estimate，**不是**施工 final BOM |
| **Warning ≠ Code violation** | 寫「exceeds selected fill rule」，不寫「code violation」 |

---

## 嚴格重構規則（未刪 oldSrc 前一直適用）

**這是「重構」不是「改寫」不是「重設計」。**
- 一切 **顏色 / 大小 / 角度 / 寬度 / alpha / dash / hover 位置 / cursor / 文案 / spacing / radius / icon / 字級** 嚴格照 oldSrc
- 絕對不要自選、自編、自加、自優化
- 不確定就 **MCP 並排**（`pnpm dev:oldsrc` on 5180）對照 + grep `oldSrc/...` 抓常數
- commit message 標明每個數值的 oldSrc 出處
> 註：Phase 34 Camera 是**全新功能**（oldSrc 無對應物），不受此規則約束；視覺風格對齊現有新 src 慣例即可。
