# Bug 修正分組計畫

來源:`.claude/bug-hunt-2026-08-12.md`(三輪獵捕,93 條)

## 分組原則

- **同檔案 / 同 pattern / 同修法放一起** — 改一次、驗一次、commit 一次,避免反覆進出同一個檔案
- **不按嚴重度切** — 嚴重度混在一起會讓你在同一個檔案上開好幾次刀
- **每組 5-10 小時**,含「讀懂上下文 + 改 + 瀏覽器驗證 + commit」的完整時間
- **有依賴的組標註順序**,不能亂跳

## 建議執行順序

```
G1 ✅ → G2 → G3 → G4 → G5 → G6 → G7 → G8 → G9 → G10
         ↑                    ↑
      必須在 G3/G4 之前     可與 G6 交換
```

**硬性依賴只有兩條**:
1. **G2 必須早於 G3、G4** — G2 修好 parity 驗證工具(目前永久回報綠燈),否則 G3/G4 改完 GL 引擎無法驗證正確性
2. ~~**G1 必須最早**~~ — **已完成**(2026-08-13),4 點校正的測試阻斷已解除

---

# G1 · 白屏與功能阻斷 ✅ **已完成**(2026-08-13,使用者驗收 ok)

修法明確、都有正確範例可對照、風險低。做完能解除 QA 的測試阻斷。

| # | 位置 | 問題 | 實際修法 |
|---|---|---|---|
| C1 ✅ | `CameraTimeline/CalibrationModal.jsx:109` vs `:179` | `useOverlayDismiss` 在 early return 之後 → 點「校正熱圖」**必定白屏** | hook 上移到 early return 之前(對照 `LiveViewModal.jsx:59`) |
| C2 ✅ | `viewer3d/WallLayer3D.jsx:140-153` | 零長度牆 → hook 數量變化 → 白屏。端點吸附會產生完全相等座標 | 3 個 `useEditorStore` + `useState` 上移到零長度 return 之前 |
| C2b ✅ | `viewer3d/TrayLayer3D.jsx:24` | 同上,退化 tray 線段 | 改用 `degenerate` 旗標讓 3 個幾何 `useMemo` 回 `null`,return 落到 5 個 hook 之後 |
| — | 全庫 | 確認沒有第 4 處 | 已用腳本掃過(10 個候選、7 個誤判),**只有這 3 處**,無需重掃 |

**C2b 刻意偏離字面修法(防重做)**:分組原本寫「early return 移到所有 hook 之後」,但 `bodyGeom`/`centerLineGeom` 的 `useMemo` 直接吃 `len`,照字面搬會讓 `new BoxGeometry(0, …)` 仍為退化線段配置 GPU buffer。改成幾何回 `null` + 最後才 return,行為等價且不浪費資源。

**驗收結果(MCP 兩輪乾淨獨立驗證,全程 0 console error)**:
- C1:4 支相機各開關一輪(8 次 mount/unmount 切換)modal 皆正常
- C2:2D 與 3D 各測;單牆退化↔正常來回 5 次;3D 下連續壓 10 道牆為零長度
- C2b:3D 下 tray 兩頂點疊合;退化↔正常來回 6 次;含「3 點折線只有中段退化」的混合情形
- **4 點校正完整流程首次被驗證**:四對點 → homography 全項有限、重投影誤差 **0.000000**;
  交叉 Z 字序被擋下(儲存鈕變灰 + 警示文案);背景點擊可關閉、modal 內按住拖到背景放開**不**關閉
- 既有 warning 與本組無關:PixiJS ImageSource 一則、`propagationGL.js:2810` readback 多則(= G9 的 P1-14)

**★ 順帶驗出 T13 是真 bug,且症狀比報告更明顯**(排在 G6 的 P4#7,本組未動):
同一支相機「關掉再開」,**第一次開是空的(0 點)、第二次開才載入已存的 4 點**。
因為 `closeCalibrate` 把 id 設 `null`、`openCalibrate` 又設回同一個 id,
`useEffect` 的 `[calibrateCameraId]` 在 render 之間看不出變化 → effect 不重跑。
修 G6 P4#7 時一併處理。

---

# G2 · 修好 parity 驗證工具 + 熱圖快取失效(6-8 小時)★ 必須在 G3/G4 之前

**這組的價值不在直接修 bug,而在讓後續 GL 修改能被驗證。**

| # | 位置 | 問題 |
|---|---|---|
| 23c | `heatmap/sampleFieldGL.js:171-186` + `:402-415` | `geomSig` 漏 `losEnabled`、`apGeoEnabled`、`rssiOnly` — 而這兩個 flag 存在的目的**就是 parity 驗證**。diff harness 跑兩次拿到同一份快取,永遠回報「差異 0.000 dB」 |
| P1-8 | 同上 | `geomSig` 也漏 `bypassHoles`(樓板開孔多邊形,真實物理輸入) |
| E2 | `heatmap/propagationGL.js:2435` | **第二道缺口**:`uploadSlabs()` 不清 `outGridCache`(`uploadWalls:2235`、`uploadCorners:2323` 都清,唯獨 slabs 沒有)→ 兩道防線同時失效 |
| 23e | `viewer3d/heatmapStack.js:46-50` | ~~漏 `isSoftwareRender`~~ **第三輪確認是誤判,不必修**(該值 store 建立時求值一次、全庫無 setter,runtime 恆定) |

**注意**:`bypassHoles` 與 `uploadSlabs` **必須一起修**,只修一處無效。

**驗收**:移動/新增/刪除 FloorHole 後熱圖立即更新(目前完全不變);用 `{ apGeoEnabled: false }` 跑 parity 應該看到真實差異而非 0.000。

**參考範本**:`propagationGL.js:2203/2304` 的 `fnv32(flat)` 是對實際上傳 bytes 做雜湊,**結構上不可能漏欄位**,是最強的一類簽章;`heatmapAdapter.js:981 idleInputs` 示範了把衍生旗標也折進指紋。

---

# G3 · GL 引擎正確性(8-10 小時)

需要 G2 先完成才能驗證。這組是純數值/圖形問題,需要對照 JS 參考實作。

| # | 位置 | 問題 | 數字 |
|---|---|---|---|
| C3 | `propagationGL.js:2373-2374` | `nGx/nGy` 夾在 256 × `cellM` 上限 4m = 格網只覆蓋 **1024m**。超出範圍的牆進了列表但 DDA 永遠讀不到 → **完全不衰減** | 1500×800m 場地損失 476m 寬條帶 |
| P1-9 | `propagationGL.js:454-463`(+ 4 處複製) | DDA `maxSteps` 只按格網對角線設限,AP 遠離牆 AABB 時步數提前燒完 | 60 道牆在 21×21m + AP 在 60m 外 → 牆損耗 0 |
| P1-7 | `propagationGL.js:2454-2461` | 同一 boundary 多個 FloorHole,只有第一個能豁免樓板衰減(後續 record 的 `slabDb=0` 無法替第一筆豁免) | 第二個洞下方偏弱 12 dB |

**共同性質**:三條都是 **JS/GL 分歧**,JS 參考實作(`propagation.js:70-86` 暴力掃全牆)是對的。修完應該用 G2 修好的 parity 工具比對。

**驗收**:超過 1024m 的區域牆有正常陰影;AP 遠離牆區時牆損耗正常;同一樓板兩個洞下方熱圖對稱。

---

# G4 · GL 例外路徑與資源回滾(5-6 小時)

| # | 位置 | 問題 |
|---|---|---|
| C4 + E3 | `propagationGL.js:3135-3164` | `SCISSOR_TEST` 無 try/finally,`waitFence` 三條 reject 路徑會讓 scissor 永久污染 module-singleton context → 熱圖只剩一條窄帶,**fence timeout 不算 context lost 所以永不自我復原,必須重載頁面**。**附帶兩個洩漏**:`bindFramebuffer(null)` 也不執行;PBO 每次失敗漏一顆(`PBO_POOL_MAX = 32` 永遠補不回) |
| P3-22 | `render/heatmapAdapter.js:259-273` | context loss 復原沒清 `snapSprite.mask`(`:569` 指派了同一個 `maskG`)→ PIXI 踩已釋放資源,整個畫布變黑且 `requestRender` 已死。修法還需重設 `soloActive = false` |
| 23y | `viewer3d/heatmapStack.js:69-156` | `ensureStack` 是 async 但**完全沒有 try/catch/finally**。退回的同步 `sampleField` 若自己拋錯無第二層保護;`createHeatmapGL()` 也在 catch 之外 → 部分樓層留新場、其餘留舊場,且 fingerprint 沒更新形成每 250ms 一次的失敗迴圈 |
| 23d | `viewer3d/heatmapStack.js:124` | 把正常的 `null`(stale 訊號)當失敗直接 return → 混世代堆疊且**不碰任何東西永不修正** |

**架構層面建議**:全專案**沒有註冊 `webglcontextlost`/`webglcontextrestored` 監聽器**,全靠呼叫前輪詢 `isContextLost()`。這是「狀態被污染但 context 沒死」後果永久的根本原因,可考慮在此組一併加上監聽器。

**參考範本**:`heatmapAdapter.js:592-632 runDragLoop` 的 finally 不只重設旗標,還重新排程 await 縫隙中落地的新請求——正是 C4 該套用的形狀。

**驗收**:軟體渲染 + 300 AP 反覆切換熱圖模式不會出現橫條紋或整片消失。

---

# G5 · undo/redo 與歷史完整性(8-10 小時)★ 影響最廣

| # | 位置 | 問題 |
|---|---|---|
| T1 | `store/useHistoryStore.js:31-54` | **完全沒有 import `useFloorStore`** → `floor.scale`、`floorHeight`、`floorSlabAttenuationDb`、`cropX/Y/W/H`、以及 **ALIGN_FLOOR 的四個 align 欄位**全部無法 undo。量錯比例尺 → 全樓層線纜長度/覆蓋面積/熱圖網格錯十倍,**只能重新量** |
| P3-17 | `useHistoryStore.js:92-97` | `undoStack.length === 0` 檢查在 `flushPending()` **之前** → 第一筆編輯後 300-800ms 內 Ctrl+Z 完全沒反應、按鈕還是灰的 |
| P3-18 | `useHistoryStore.js:110-123` | `redo()` 不 flush → 300ms 內按 Ctrl+Y 會用舊快照覆寫剛做的編輯,且 undo 堆疊從此非時序 |
| P1-12 | `useHistoryStore.js:100-102` | 跨樓層 undo 靜默 return(不提示、不跳樓層),而**工具列按鈕還亮著** |
| T7 | `useAPStore.js:88` + `useHistoryStore.js:61` | `setAPs` 的 `Math.max` 永不回退 → undo 後 AP 名稱跳號,手動改名可造成撞名 |

**工時偏高的原因**:T1 不是加一行 import。需要決定哪些 floor 欄位進快照(全部?還是排除 `imageUrl` 這類不該回退的?)、新增 store 訂閱、以及處理 align 拖曳這個**連續滑鼠操作**如何接進既有的 300ms debounce 機制。

**驗收**:量錯比例尺後 Ctrl+Z 能還原;ALIGN_FLOOR 拖歪後能 undo;第一筆編輯後立刻 Ctrl+Z 有效;跨樓層 Ctrl+Z 有明確提示或自動跳樓層。

---

# G6 · 切樓層 / 切模式的狀態殘留(6-8 小時)

同一個 pattern 的 12 條,一次清乾淨。**baseline 事實**:`useFloorStore.setActiveFloor` 只做 `set({ activeFloorId: id })` 什麼都不清,而切樓層唯一的全域清理是 `FloorplanSystem.jsx:899-909` 且只做 scale 兩項。

| # | 位置 | 殘留物 | 後果 |
|---|---|---|---|
| P0-5 / P4#1 | `FloorplanSystem.jsx:899` | 不呼叫 `clearDraft()` | 1F 點了 5 個 scope 頂點 → 切 2F 按 Enter → 用 **1F 座標**寫成 2F 的 scope,熱圖據此裁切 |
| P4#2 | `draftModeController.js:80` | `sessionWallIds` | 1F 畫三段 → 切 2F 點一下 → Backspace 把三個 id 全 pop 掉,**1F 那三段的 step-back 永久喪失** |
| T6 | `useDraftStore.js` `clearDraft()` | 不清 `doorWindowDraft` | 門的橘色預覽色帶在 PLACE_AP 模式無法消除 |
| T5 / P4#4 | `useCameraStore.js:55-56` | `drawTool` / `draftPoint` | 切模式回來後點畫布畫 tripwire 而非放相機;跨樓層則用 1F 錨點在 2F 建線 |
| P4#3 | `cameras/trackingBinder.js:155` | `prevHById` | 2F 校正後回 1F,改個相機名字就讓 1F 軌跡**整批平移變形** |
| P4#5 | `useClientViewStore.js:145` | `reset()` 是**死碼**(全庫從未呼叫) | 1F 的 client 座標套到 2F 的 AP 重算,面板顯示一組看起來正常的假數據 |
| P1-13 / P4#6 | `useCameraStore.js:46` | `liveViewCameraId` | 切走彈窗消失、切回**自己跳回來**並重啟 rAF |
| P4#7 | `CalibrationModal.jsx:82` | `calibrateCameraId` + effect 依賴 | 切樓層來回後點第 4 點,H 混用不同 letterbox 換算 |
| 23t / P4#8 | `cameras/gapMarkerLayer.js:30` | marker 無樓層守衛 | 琥珀光環在 2F 閃現 1F 的座標 |
| P4#9 | `useAutoPlaceStore.js:12` | `previewAps` | 見 P0-3(下組) |
| P1-24 | 右側面板 | 切樓層後變 300px 空白欄 + 左下探測讀數殘留上一層數據 |
| 23n | Client View | 0 AP + 熱圖關閉後粉紅覆蓋層仍蓋滿平面圖 |

**建議做法**:採用報告中認定最穩健的模板 — **「transient payload 自帶 floorId + 每個讀者自己比對」**(`useAutoPlaceStore` + `ghostAPsLayer:55` + `heatmapAdapter:195` 就是這個寫法,即使沒人清理也不會畫錯樓層)。另外 `clientViewBinder:299-332` / `trackingBinder:129-140` 的 `prevMode` 邊緣偵測模式可照抄成 `prevFid`。

**注意**:P4#1 是 P4#2 的**觸發前提**,兩條必須同修才有效。

---

# G7 · 命名唯一性與跨樓層參照(5-6 小時)

| # | 位置 | 問題 |
|---|---|---|
| E1 / P1-10 | `useCableStore.js:453` + `DemoLoader.jsx:170-196` | `setSwitches` 不推進 counter,而 **DemoLoader 是唯一呼叫端且正在踩**:載入 demo 後手放第一台 switch 就叫 `SW-01` 撞名,進 PDF 線材表無法區分 |
| 23j | `useCameraStore.js:99` / `:166` / `:197` | `setCameras`/`setTripwires`/`setZones` 同型,目前無呼叫端 → **待爆地雷** |
| T2 | `useCableStore.js:515-527` | `clearFloor` 不清跨樓層 `uplinkTo` → 刪掉放 MDF 的樓層後,`statsSource.js:234` 算成已用埠(虛高)但 `computeRoutes` 靜默跳過(BOM 消失)→ **兩份報表互相矛盾** |
| 23o | 命名 | 跨樓層 switch 同名,PDF 只印名稱無法分辨 |
| F5-4 | `useCameraStore.js:46/51` + `useAutoPlaceStore.js:12-18` | 四個懸空 id 刪樓層時未清 |

**修法比 `setAPs` 模板複雜**:`nextSwitchName` 對 SW/IDF/MDF/RTR **四種前綴共用同一個 counter**,demo 那次呼叫消耗了「編號 1」兩次(SW-01 與 IDF-01 都是 seq=1)。補 `Math.max` 需要 per-prefix 掃描 → **修之前先確認命名語意是否該改成 per-prefix counter**。

**參考範本**:`useAPStore.js:78-89` 的 `setAPs` + `highestAPNumber`;`removeSwitch:425-438` 的整棟樓 uplink 掃描。

---

# G8 · 單位、比例尺與魔術數字(6-8 小時)

`floor.scale` 與樓高的傳播問題,一次統一。

| # | 位置 | 問題 | 數字 |
|---|---|---|---|
| 23f / T-F2-1 | `blindSpotLayer.js:92-102`、`overlapLayer.js:86-96`、`occupancyLayer.js:239-255` | snapshot 漏 `floor.scale`(**還漏 `imageWidth/Height`**)→ 校正比例尺後遮罩定格舊尺度 | 遮罩洞面積偏大 **3.07 倍**,假覆蓋多 207% |
| T10 | `cameras/fovRasterize.js:20`、`:72` | 52-A3 只補了一半:`coverageStats` 移除了 `?? 40`,但它呼叫的共用 rasteriser 內部仍是 `?? 40`,而 `overlapLayer.js:51` 直接吃那一層 | 畫面說有覆蓋、數字說量不出來 |
| T9 | `Viewer3D.jsx:41`/`:251` vs `camerasLayer.js:42` vs `CameraOverlay3D.jsx:17` | 2D 用 40、3D 用 **100**、3D 內部又自己宣告一份 40 | 3D 覆蓋範圍相對樓板放大 2.5 倍 |
| T3 | `draftModeController.js:96` | 牆高硬寫 `3.0`,不跟隨 `floor.floorHeight` | 樓高 6m 時 RF **完全不扣牆損**(Z filter 判定射線從牆頂飛過) |
| E5 | `computeRoutes.js:141`、`useCableStore.js:174` | `floorHeight` 家族另外兩處硬編碼(後者是 **store 自己**硬寫別的 store 已匯出的常數) | |
| E5b | `trackingBinder.js:40`、`mockTracks.js:150`、`analyticsStats.js:253`、`occupancyGrid.js:31` | `FALLBACK_PX_PER_M` 家族另外四處(後兩者用 `\|\|` 而非 `??`,**scale = 0 也落 fallback**) | |
| 23g | `constants/cameraModels.js:48-55` | `min(fovDeg, 120)` 把魚眼的**水平**環景當垂直視角 → 9m 算成 2.39m | 覆蓋面積**少算 93%** |
| P2-28 | `PanelRight/WallPanel.jsx:50` | 全站唯一用像素顯示長度(`長度 98.8 px`) | |

**建議**:先抽出 canonical helper(例如 `getPxPerM(floor)` 與 `getFloorHeight(floor)`),再把所有站點改成呼叫它。這樣同時解掉現有 bug 與未來的分歧。

---

# G9 · 效能與資源洩漏(5-7 小時)

| # | 位置 | 問題 | 數字 |
|---|---|---|---|
| 23h | `CameraTimeline/TrendPanel.jsx:106-114` | `useMemo` 在 early return **之前**且 deps 沒有 `show`/`view` → 面板關著也跑一整週模擬軌跡 | 30 道牆凍結 **5.1 秒**、60 道牆 **12.9 秒** |
| T-F6 / 23i | `trackingBinder.js:155-174` | `prevHById` 跨樓層沒重建 → 每次切回樓層白等一輪重算(與 G6 那條同根因,可一起修) | 疊加上面 → 每次切樓層 5 秒 |
| P2-15 | `viewer3d/ScopeLayer3D.jsx:88` + `:154` | `ShapeGeometry` 無 dispose,且 `:154` 的 JSX prop 每 render 產生新陣列 → **兩層 useMemo 永不命中** | 3 個 scope 拖曳相機一分鐘 ≈ **10800 個 geometry 滯留** |
| P2-16 | `viewer3d/FloorHoleVolume3D.jsx:110` | `ExtrudeGeometry` 無 dispose,`items` deps 含 `activeFloorId` | 每切一次樓層每個洞洩漏一個(本檔最重的 buffer) |
| 23r | `Viewer3D.jsx:946-948` + `:994` | `visibleFloors` 每 render 新陣列 → `shadowRadius` memo 永久失效 | 單層檢視滑過 AP 就重跑整個樓層迴圈 |
| E4 | 12 處 `?? []` selector | 空陣列字面值 → 該 store 每次變更都重繪。**3D 那批系統性偏高**(全樓層模式下多數樓層沒有 tray/scope/switch,鍵天然缺失) | |
| P1-14 | `propagationGL.js:2810` | 300 AP + 熱圖縮放掉到 **8 FPS**,256 次 WebGPU readback 警告 | 建議縮放中 debounce 熱圖重算 |
| 23x | `viewer3d/SwitchLayer3D.jsx:40/:75` | `portTextureCache` 無淘汰(**第三輪降為低**:key 有界 45 entry) | 與 `Label3D.jsx:20-40` 的 LRU 規範不一致 |
| 23w | `cameras/trackColor.js:63` | module cache 無上限,track id 每次重產都全新 | 連按 20 次約 15 萬 entry |
| T11 | `viewer3d/heatmapStack.js:35` | per-floor frame 快取無刪樓層清理,canvas 是全解析度(4000×3000 級) | 多次匯入/刪除大圖累積數百 MB |
| 23v | `cameras/analyticsLayer.js:401` | `detach()` 少了 `removeChild`(僅 StrictMode/HMR 影響) | |

**參考範本**:`WallLayer3D.jsx:115-138`(useMemo + 獨立 cleanup effect + null guard)是最標準寫法;`CameraLayer3D.jsx:231-262` 的 ShapeGeometry 與 ScopeLayer3D:88 **幾乎逐字相同但有 dispose**,是最直接的修法參照。

---

# G10 · UI/UX 與匯出正確性(7-9 小時)

| # | 位置 | 問題 |
|---|---|---|
| P0-2 / 23k | `.canvas-area__overlay--bl` / `.cable-summary` | 父容器 `pointer-events: none` 但子元素**沒補回 `auto`** → 真滑鼠點不到面板(只有合成 click 有效);面板預設展開遮住畫布 **16.8%**,「匯出 PDF」按鈕落在 y=607 熱區 → **連點兩下無預警下載 PDF** |
| P0-4 | `ConfirmDialog.jsx:23-30` | 沒有 focus trap,Tab 焦點跑出對話框(`activeElement` 變 body),Enter 仍刪除 53 個物件;預設焦點在紅色「刪除」上。註解寫了條件但**從未實作** |
| P0-3 | `AutoPlaceModal.jsx:190-205` + `.sass:15-24` | 預覽時 overlay 刻意 `pointer-events: none` 讓側欄可點,但 `handleApply` 用點擊當下的 `activeFloorId` → 8 顆 AP 寫到錯樓層、座標無意義,該移除的舊 AP 靜默沒移除 |
| 23l / P1-13 | `LiveViewModal` | 可見 484×336 但容器 **1180×852 且 `pointer-events: auto`** 攔截整個畫布;Esc 關不掉 |
| 23m | `.app__body` | flex 溢出(1440px 視窗需 1740px)+ `overflow-x: hidden` → 左側 sidebar 被推到 x=-273 **且無捲軸可拉回** |
| 23 / 23b | `exportPlanningPdf.js:244` | 封面「APs with a cable route」= AP 總數(unroutable 也算);`fallback-manhattan` 也當已布線 |
| 23z / P2-26 | PNG 匯出 | 把選取狀態的**紅圈**一起輸出、拉線被隱藏、無圖例無比例尺 |
| 23p | PDF | 2F 有底圖卻印「no plan image imported」 |
| P1-11 | 名稱編輯 | F2 改名後 Delete 清空名稱,**Esc 不還原** |
| P3-19 | AP 拖曳 | 可拖出平面圖外藏進 UI 底下,仍參與熱圖與線纜計算 |
| P3-20 | `draftModeController.js:270-278` | scope 只畫 2 點按 Enter → 靜默丟棄零回饋;且**畫牆右鍵=結束、範圍右鍵=取消**,同手勢兩種相反意義 |
| P3-21 | AP 面板 | 發射功率輸入負值不 clamp 而是沿用前值 |
| P2-25 | 1024×768 | 工具列壓住「設備規劃」入口;開右側面板後復原/重做被蓋住 |
| P2-27 | Camera 模式 | 左鍵=直接放相機,與 AP 模式「左鍵=選取」心智模型相反 |
| P2-29 | 刪除 | 單物件直接刪、多物件才確認;框選模式下選單一牆按 Delete 曾完全沒反應 |
| P2-30 | 空樓層 | 仍顯示「線纜總結 87.5m」(全案數字混在每層 UI) |
| P2-31 | 工具列 | 圖示要點兩下、僅 30px 無文字 |
| E8 | `CableSummaryPanel.jsx:96`、`Toolbar.jsx:171`、`SidebarLeft.jsx:189` | 三處 timer 未清:匯出失敗 toast 洩漏 closure、**菜單自己閉合**、PNG 內容與檔名不符 |
| E6 | `RiserPanel.jsx:35` + `:58-59` | 排序與**顯示**都讀不存在的 `f.elevation`(兩個獨立失效點) |
| P0-6 | `cable/buildGraph.js:330-351` | riser 垂直段讀 `floor.elevation` → 長度恆為 0,Dijkstra 把跨樓層當免費 |

**工時偏高的原因**:條數多但多數單條很小(改 CSS 一行、加 clamp、補 focus trap)。建議按子主題分批 commit:①pointer-events / 佈局 ②焦點與鍵盤 ③匯出正確性 ④輸入驗證與回饋。

---

# 未進任何 group(需要先決策或先驗證)

| 項目 | 為什麼不排 |
|---|---|
| `LayerToggle.jsx:83-96` 回傳新物件 | 修法有兩個選項:(a) 拆成 12 個單欄位 selector(與現行慣例一致)(b) 引入 `zustand/shallow` — 但那會是**全專案首例**,等於建立新慣例。**需要你決定** |
| E7 `statsOverlayLayer.js` 缺 `useWallStore` 訂閱 | 同一函式旁邊有「刻意排除 scopes」的先例,不確定這是漏還是刻意。**先驗證**:STATS 模式畫一道穿過 AP 與 client 的牆,看 badge 客戶端數是否立刻變動 |
| T8 框選批次刪除漏 3 種型別 | 目前 marquee 不產出 camera hit 所以不可觸發。但 toast 無條件說「已刪除 N 個」有說謊風險。**看你要不要現在補** |
| P1-7 熱圖被 scope 裁切 | QA 標為「疑似設計行為」,需與 PM 確認 |
| 無比例尺時 `rasterizeCoverageCounts` 仍用 40 畫圖 | 報表拒絕給數字但圖照畫,**產品行為需確認** |
| 23q `?? 3` vs `DEFAULT_FLOOR_HEIGHT_M` | 目前值恰好一致、無可見錯誤。已併入 G8 一起改,單獨不值得排 |

---

# 工時總表

| Group | 主題 | 工時 | 前置依賴 |
|---|---|---|---|
| ~~G1~~ ✅ | ~~白屏與功能阻斷~~ **已完成 2026-08-13** | ~~5-6 h~~ | — |
| G2 | parity 工具 + 熱圖快取 | 6-8 h | — |
| G3 | GL 引擎正確性 | 8-10 h | **G2** |
| G4 | GL 例外與資源回滾 | 5-6 h | **G2** |
| G5 | undo/redo 完整性 | 8-10 h | — |
| G6 | 切樓層/模式狀態殘留 | 6-8 h | — |
| G7 | 命名唯一性與跨樓層參照 | 5-6 h | — |
| G8 | 單位/比例尺/魔術數字 | 6-8 h | — |
| G9 | 效能與資源洩漏 | 5-7 h | — |
| G10 | UI/UX 與匯出 | 7-9 h | — |
| | **合計** | **61-78 h**(剩 **56-72 h**) | |

## 分批建議

若想更早看到成效,前三組(G1 + G2 + G5,約 19-24 小時)覆蓋了「會白屏」「讓驗證失效」「改錯無法回退」三類最傷的問題,做完系統的可信度會明顯提升。**G1 已完成,下一步建議 G2 + G5。**

G3/G4(GL 引擎)可以延後,因為它們的症狀是「熱圖數字不對」而非「操作壞掉」,且需要較專注的數值驗證時段。
