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
**Phase 36 Verkada Tier 1&2 擴充完成（2026-06-29 驗收 ok，見下表）。**
**Phase 37 camera 右鍵選單 + 3D camera 三圖 + 3D 唯一光源光影 完成（2026-06-29 使用者驗收 ok，見下表）。**
**Phase 38 熱圖綁定 FOV + 未放置裝置清單 + 3D 動線流線化 完成（2026-07-02 使用者驗收 ok，見下表）。**
**Phase 39 UIUX 規範落地（`.claude/ui-spec.md` U1–U4 全部）完成（2026-07-02 使用者驗收 ok，見下表）。**
**Phase 40 天線俯仰角 tilt（azimuth + tilt，no roll）完成（2026-07-03，commit e6f4ec1，見下表）。**
**Phase 41 熱圖無感重算（粗場秒出 + 波紋過渡 + 非同步 readback）完成（2026-07-03 使用者驗收 ok，見下表）。**
**Phase 42 統計階段 1：Plan 規劃品質面板（A 域）完成（2026-07-06 使用者驗收 ok，見下表）。**
**Phase 43 統計階段 2+3：STATS 獨立模式（B 域聚合 dashboard + C 域趨勢/timelapse）完成（2026-07-08 使用者驗收 ok，見下表）。**
**Phase 44 規劃 vs 實測空間疊合（PM 護城河 backlog）完成（2026-07-08 使用者驗收 ok，見下表）。**
**Phase 45 隱藏 3D 凍結 + 2D/3D 熱圖共用 canvas 完成（2026-07-13 使用者驗收 ok，見下表）。**
**Phase 46 效能第二/三輪（引擎 async 化 + Pixi texture 修正 + marker 免重畫）完成（2026-07-14 使用者驗收 ok，見下表）。SW 機 300 AP 拖曳 long task 累計 3.0s→0.93s（-69%）、最大單筆 777→205ms，效能戰役到此收工。**
**Phase 47 B1 快速正確性修正完成（47-1/3/4/5/7 + 47-24 頻段色 typo，2026-07-20 commit 2c5295d，MCP 驗證通過）。**
**Phase 47 B2 數字可信度完成（47-2/6/8a/9，2026-07-20，MCP 驗證通過；autoChannelPlan 半徑拍板不動）。**
**Phase 47 B3 操作型邏輯 bug 完成（47-14~21，commit eb59e10 + 91c36a7 + 09a5ddf，使用者驗收 ok）。**
**Phase 47 B4 UX/一致性完成（47-22~27，commit 1a4bf16，使用者驗收 ok；含 off-band dim/多頻段 demo/3D toolbar 精簡等使用者追加）。**
**Phase 47 B5 全部完成（2026-07-22，使用者驗收 ok，MCP 通過）：47-12 TX 逐頻段預設 + 47-13 PoE per-port class（Opus 4.8）、47-10 天線增益 + 47-11 材質庫（Fable 5，雙引擎 parity 已驗）。B1~B5 收工，Phase 47 六角色審查缺陷全數清完（47-8b 單台三頻 / 47-6 autoChannelPlan 半徑為 backlog/防重做，非缺陷）。**
**Phase 50 AI 牆改接 cv+graph pipeline API 完成（2026-07-29，commit e242f6d，MCP 驗證通過，見下表）。**
**Phase 51 全部收工（2026-08-10）：51-1~51-11 完成；51-12 後製鏈實作後量測 +25ms／fps 砍半，照門檻整包撤回不做。**
**Camera 3D 目標擬真化完成（2026-08-10 使用者驗收 ok）：人車模型重造（轎車擠出輪廓/衣著輪廓人偶）＋trail 色帶＋選取相機高亮＋2D/3D 共用色彩抖動（trackColor.js）＋步態修復（r3f delta NaN、擺動軸 x→z）。門縫做過又依使用者要求移除（只留門把），細節見 git log。**
**Backlog 清掉兩項：PDF 規劃報告輸出（含新增的 RF 涵蓋率/verdict 頁）、spec.md 全面同步。以上三項 2026-08-10 使用者驗收 ok。**

**★ 2026-08-14：Phase 53 進行中，G1~G5 全部完成（使用者驗收 ok）。** 三輪 bug 獵捕找出 93 條
（含 4 條 critical，其中 2 條會白屏），已分成 10 組 × 5-10h。**G1/G2/G3/G4/G5 ✅ 完成，4 條 critical 全修完。
剩 G6~G10（彼此無依賴）。R1「反射分歧」查證為 harness 誤判、非 bug。
一組一組來，等使用者給組號。** 詳見上方 Phase 53 專節與 `.claude/bug-fix-groups.md`。

---

## 還沒做的事

### Phase 53 三輪 bug 獵捕修復（2026-08-13 立項，**G1/G2/G3/G5 ✅ 完成，剩 G4/G6~G10**）★ 下一個要做的事

> **報告**：`.claude/bug-hunt-2026-08-12.md`（93 條，含每條的失效情境與檔案:行號）
> **分組**：`.claude/bug-fix-groups.md`（10 組 × 5-10h，合計 61-78h）
> **commit**：`27c0887`（兩份文件，無程式碼變更）
>
> 使用者的執行方式：**一組一組來**，給組號才動手。修完一組要瀏覽器驗證再 commit。
>
> **進度**：
> - [x] **G1 白屏與功能阻斷 ✅**（2026-08-13，使用者驗收 ok，MCP 兩輪獨立驗證 0 error）
> - [x] **G2 parity 工具 + 熱圖快取 ✅**（2026-08-13，同上）→ **G3/G4 的前置已解除**
> - [x] **G5 undo/redo 完整性 ✅**（2026-08-13，同上）
> - [x] **G3 GL 引擎正確性 ✅**（2026-08-14，三條 JS/GL 分歧全平,每條都 stash 反證過）
> - [x] **G4 GL 例外與資源回滾 ✅ 主體完成**（2026-08-14，C4/E3/P3-22/23y + contextlost 監聽器）
> - [x] ~~**R1 反射 JS/GL 分歧**~~ **❌ 查證為誤判、非 bug**（2026-08-14；harness 傳了 `itu: 0`）
> - [ ] G6 切樓層殘留 ／G7 命名唯一性 ／G8 單位比例尺 ／G9 效能洩漏 ／G10 UI/匯出
>
> **G1 收工小結（防重做）**：三處 hooks 違規全數修正 ——
> `CalibrationModal.jsx` 的 `useOverlayDismiss` 上移到 early return 之前（對照 `LiveViewModal.jsx:59`）；
> `WallLayer3D.jsx` 的 3 個 `useEditorStore` + `useState` 上移到零長度 return 之前；
> `TrayLayer3D.jsx` 改用 `degenerate` 旗標讓三個幾何 `useMemo` 回 `null`、return 落到 5 個 hook 之後
> —— **後者刻意不照「早退移到最後」的字面修法**，因為那樣 `new BoxGeometry(0,…)` 仍會為退化線段配置 GPU buffer。
> **4 點校正流程首次被完整驗證**（QA 兩輪都被白屏卡住）：四對點 → homography 重投影誤差 0.000000、
> 交叉 Z 字序被擋下且儲存鈕變灰、背景點擊關閉／modal 內按住拖到背景放開不關閉皆正確。
>
> **★ G1 驗證時確認 T13 是真 bug，且症狀比報告更明顯**（已排在 G6 的 P4#7，G1 未動）：
> 同一支相機「關掉再開」，**第一次開是空的（0 點）、第二次開才載入已存的 4 點**。
> 因為 `closeCalibrate` 把 id 設 `null`、`openCalibrate` 又設回同一個 id，
> `useEffect` 的 `[calibrateCameraId]` 在 render 之間看不出變化 → effect 不重跑。
>
> **G2 收工小結（防重做）**：兩份手維護的 `geomSig` 抽成單一 `buildGeomSig()`
> —— **兩份漏的欄位完全一樣**，正是重複簽章必然的失效模式。補進 key 的是
> `losEnabled`/`apGeoEnabled`/`rssiOnly`（parity 三旗標）+ `bypassHoles` 的**頂點座標**。
> `uploadSlabs` 照 `fnv32` 範本補簽章 + `outGridCache.clear()`。
> **實測**：加洞 121 格中 55 格變動最大 40.62 dB；**移動洞**（數量相同座標不同）60 格變動
> ——這是 count-only 簽章會漏掉的關鍵案例。parity 三旗標各自 hits:0/misses:1（真的重算）。
> 30 AP 場景 cold 30 misses → 之後 30/30 hits，**無效能回退**。
> **已知非問題**：`outGridCache` 每個 AP 只有一格（`set(apKey,…)`，hash 存值裡），
> 所以交替切 opts 會互相淘汰、harness 反覆切旗標時每次都 miss —— 既有設計，正常使用不受影響。
>
> **★ 2026-08-14：修好的工具已實際全面掃描引擎（15 情境），這才算 G2 真正完成。**
> 11 個一致（0.000 dB）、**3 個真實分歧**：反射 **10.07 dB / 197 格**、反射+繞射 6.97 dB、
> 同樓板兩洞 **61.24 dB / 44 格**（= P1-7；單洞時 0.000 完全一致 → 確定只在第二個以後的洞）。
> **反射那條是原報告 93 條沒有的新發現**，已加進 G3 表格。
> **比對陷阱（不知道會誤判）**：JS 的無訊號 sentinel 是 `-300`、GL 寫巨大負值（實測 `-453927`），
> 直接相減會得到 677651 dB 這種假數字 —— 必須排除 `< -200 dBm` 的格；
> 排除後 5GHz/6GHz 的真實差異是 **0.000 dB**。G3 寫 harness 前必看。
>
> **G5 收工小結（防重做）**：`FLOOR_SNAPSHOT_KEYS` 採 **allow-list 而非整筆 clone**。
> 排除 `imageUrl`/`imageWidth`/`imageHeight` 的理由很硬：`SidebarLeft.jsx:226` 刪樓層時會
> `URL.revokeObjectURL(floor.imageUrl)`，還原舊 blob URL 會復活死引用變破圖；也排除 `id`/`name`
> （改名不該被牆的 Ctrl+Z 連帶還原）。restore 用 **merge**（`{ ...f, ...floorFields }`）
> 讓排除的欄位保留當前值。`floors` 是**陣列不是 map**，故比對只看當前樓層的 allow-list 欄位。
> **align 拖曳不需額外處理** —— 既有 `schedulePushRaw` 的 coalesce 已足夠（實測 20 次呼叫 = 1 筆）。
> **P3-17 的坑**：`canUndo()` 是**死碼**（Toolbar 直接讀 `undoStack.length`），
> 所以加了反應式 `hasPending`（所有 `_pendingRaw` 寫入走單一 `setPendingRaw()`）並改 `Toolbar.jsx:195`。
> T7 新增 `useAPStore.recountAPCounter()`（從全樓層資料重算，不由呼叫端傳數字）。
>
> **★ 2026-08-14 補驗（真實滑鼠 + 完整回歸 + 效能），這才算 G5 真正完成**：
> ① **真的用滑鼠畫牆**（工具列點「牆/結構」→「畫牆」，在既有端點上點兩下、第二下偏 5px）
> → 吸附真的產生 `startX===endX && startY===endY` 的零長度牆且不崩潰；
> 真的畫 tray 兩點重合亦然 —— **證明報告描述的觸發路徑真的會發生，不只是模擬後果**。
> ② **既有 undo 全面回歸**（都記錄中間狀態，避免 0→0 假通過）：tray / riser / switch 全棟 map /
> tripwire / zone / unplacedCameras / placeCamera / dropFloor **全部正常**。
> ③ **效能**：新訂閱本身 **0.71 微秒/次**（20000 次實測）。align 拖曳 239ms/次是**既有問題**，
> 證據是改樓層名字（我的訂閱早退不做快照）同樣要 248ms，且 **AP 300→5 時成本 239ms→4.85ms**
> （隨 AP 數 scale）→ 瓶頸在 AP 圖層重繪，屬 G9。走快照與早退只差 **1.6ms**。
>
> **建議起手**：G1 + G2 + G5（約 19-24h）覆蓋「會白屏」「讓驗證失效」「改錯無法回退」三類最傷的。
>
> **4 條 critical（3 條已修，只剩 C4）**：
> - ~~`CalibrationModal.jsx:109` vs `:179` —— `useOverlayDismiss` 在 early return 之後 → 白屏~~ **✅ G1 已修**
> - ~~`WallLayer3D.jsx:140-153`（+ `TrayLayer3D.jsx:24`）—— 零長度牆 → 白屏~~ **✅ G1 已修**
>   （**全庫已窮舉確認只有這 3 處 hooks 違規，不必重掃**）
> - ~~`propagationGL.js:2373` —— 加速格網夾在 256 格 × 4m = 只覆蓋 **1024m**~~ **✅ G3 已修**
>   （`cellM` 改成可超過 4m 偏好上限，讓 256 格永遠蓋滿全幅；實測牆幅 1200m 由 67.14 dB → 0.000）
> - ~~`propagationGL.js:3135` —— `SCISSOR_TEST` 無 try/finally，fence timeout 後永久污染~~ **✅ G4 已修**
>   （三條 reject 路徑實測全乾淨；**同時修好 FBO 未解綁與 PBO 洩漏**，並補上全專案第一組
>   `webglcontextlost` 監聽器 —— 這是「狀態被污染但 context 沒死」後果永久的根因）
>
> **★ 4 條 critical 全部修完（G1×2 + G3×1 + G4×1）。**
>
> ~~**最容易被忽略但影響最廣的一條**：`useHistoryStore.js` **完全沒有 import `useFloorStore`**~~
> **✅ G5 已修**（2026-08-13）。`floor.scale`/`floorHeight`/`cropX-Y-W-H`/四個 align 欄位現在都能 undo。
>
> **G3 收工小結（2026-08-14，防重做）**：三條 JS/GL 分歧全平，修前/修後都用 `git stash` 反證過
> （先確認測試在原始碼上**真的會失敗**，再確認修完通過）——
> C3 牆幅 1200m **67.14 dB → 0.000**、P1-9 AP 70m 外 **58.78 dB → 0.000**、P1-7 兩洞 **61.24 dB → 0.000**。
> - **C3 修法**：`cellM = max(cellFloor, spanX/256, spanY/256)`，讓 256 格永遠蓋滿全幅。
>   **關鍵認識**：加速格網是用**牆的 AABB**建的、**不是**場地大小 —— 所以「把一道牆放在 1500m 處」
>   不會觸發（單牆 AABB 很小），必須讓**牆群本身橫跨** >1024m。實測門檻與理論吻合：900m 過、1200m 失敗。
>   **取捨**：大場地 cell 變粗（1500m 幅 → 5.86m/格）換「有衰減」而非「完全沒衰減」；
>   一般樓層（21×21m）cellM 與修前**逐位元相同**。
> - **P1-9 修法**：`maxSteps` 從格網對角線改成實際 Manhattan 走訪距離
>   `abs(cxEnd-cx)+abs(cyEnd-cy)+4`，**5 處 shader 全改**（DDA 從 AP 格起走，AP 可能在格網外很遠）。
> - **P1-7 修法**：打包從「每個(boundary×洞)一筆」改成「**每 boundary 一筆**」，
>   頂點多帶 `ringId` 通道;shader 換成 `pointInAnyPoly` 走訪多環（每環對自己的第一點閉合，
>   否則環間會多一條假邊)。**這是唯一改到 uploadSlabs 打包格式的地方**。
> - ~~**未修**:反射路徑分歧(~10 dB)~~ **❌ 後來查證是誤判**（harness 傳了 `itu: 0`，見下方 R1 結案）。
>
> **★ 第二個 parity 比對陷阱（G3 又踩一次）**：GL 有 `CULL_FLOOR_DBM = -120` 距離剔除，
> JS 一路算到 −300 → 大場地遠處出現 GL=−120 / JS=−273 的**假分歧（看起來 79.9 dB）**。
> G2 記的 −200 門檻**不夠**，要用 **−120**：只比兩邊都 > −120 dBm 的格。
>
> **G4 收工小結（2026-08-14，防重做）**：C4/E3/P3-22/23y 全修 + 補上全專案第一組
> `webglcontextlost`/`webglcontextrestored` 監聽器與 `isDead()`（`getGL()` 改用它，
> 可涵蓋「await 期間才丟 context」，舊的 `isContextLost()` 只在呼叫前輪詢）。
> **★ 驗證抓到我自己的修法不完整，這是「寫完 + 語法通過」抓不到的**：第一版 C4 只包了
> PBO 那段 try，但失敗發生在**分帶繪製迴圈**根本到不了 → scissor 有還原、**FBO 仍綁著**；
> 修完又抓到第三條 —— `renderFieldPrep` 已綁 FBO 而下一行 `isContextLost()` 的拋錯
> **在所有 try 之外**。漏掉的後果是**下一個不相關的繪製會畫進熱圖貼圖裡**。
> **注入方法（可重用）**:hook `clientWaitSync` 回 `WAIT_FAILED`、hook `isContextLost` 回 true、
> 傳假的 `isStale`;PBO 洩漏用 hook `createBuffer` 計數;要殺 singleton 的 context
> 必須**在它建立之前**就 hook `HTMLCanvasElement.prototype.getContext`（否則抓不到那個 canvas）。
> **補驗完成(同日第二輪)**:23d 的「回傳 null 但非 stale」分支 —— 輪 1 強制第一個 target
> 回 null → 只跳過它、第二個仍建成;輪 2 用 4 樓層強制**中間**那層 → 前後都建成(舊碼會放棄整堆)。
> 「失敗後資料編輯會重試」也驗了:強制 `createHeatmapGL` 失敗 → 0 張且 warning 不增長,
> 改牆後 → 2 張建成。
> **為此在 `heatmapStack.js` 加了 `__setNullFieldForFloor()` 測試接縫**(production 恆為 null)——
> ES module namespace 是凍結的,外部無法 stub 引擎回 `null`,這條分支否則**結構上無法驗證**。
> ⚠ 別再用「把 AP 清空」當替代:那走的是既有 `crossFloor` 守衛的 `continue`,**不是這一行**。
>
> **★ R1「反射 JS/GL 分歧」查證為誤判 —— 不是 bug，程式碼沒動（2026-08-14 結案）**
> **根因是我的測試 scenario 傳了 `itu: 0`,而 `itu` 是物件 `{a,b,c,d}` 不是數字。**
> JS `materialEpsC` 是 `if (!itu || itu.metal) return {metal:true}` → `0` falsy → **JS 當金屬**;
> GL 讀 `itu.x = 0` → 退化 `epsC` → **GL 當怪材質**。兩邊算不同材質,難怪差 10 dB。
> 用真實 ITU 材質(`constants/materials.js`,例:混凝土 `{a:5.24,b:0,c:0.0462,d:0.7822}`)
> 重測**原始碼**:混凝土/輕隔間/金屬、AP 在軸上或離軸,全部 **0 dead cells / 0.000 dB**。
> 反射+繞射剩 1.569 dB 的**單一格**已查證是破壞性干涉深谷的 fp32 噪音(左右鄰完全一致)。
> **`Hpara` NaN 的整套推論隨之作廢**(那是餵退化 `epsC` 的下游現象)。
> **我試過的修法(把 `addPathHN` 雙 `inout vec2[NMAX]` 併成 `vec4[NMAX]`)已撤回** ——
> stash 反證後數字完全不變,證明不是原因。
> **教訓**:① 建 scenario 要照真實欄位型別,**優先用 `buildScenario`** 而非手寫;
> ② 這是 Phase 53 第**三**次 harness 假陽性(前兩次:sentinel −300、cull floor −120)——
> **看到大數字先懷疑 harness**;③ stash 反證是最快的判別法。
>
> **修 G7 前必看**：`nextSwitchName` 對 SW/IDF/MDF/RTR **四種前綴共用同一個 counter**，
> demo 那次呼叫消耗了「編號 1」兩次（SW-01 與 IDF-01 都是 seq=1）。
> **不能照抄 `setAPs` 的 `Math.max` 模板**，要先決定是否改成 per-prefix counter。
>
> **6 項未進 group，需使用者先決策或先驗證**（見 groups 檔末節），其中最重要：
> `LayerToggle.jsx:83` 的修法要選 (a) 拆 12 個單欄位 selector 或 (b) 引入 `zustand/shallow`
> —— 後者會是**全專案首例**，等於建立新慣例，不可自行決定。
>
> **三輪已修正的誤判（別照舊報告去修）**：`heatmapStack` 的 `isSoftwareRender` 漏簽章
> 是**誤判**（store 建立時求值一次、全庫無 setter，runtime 恆定，無法 stale）；
> `CoveragePanel.jsx` 在 `CameraTimeline/` 不在 `PanelRight/`；`SwitchLayer3D` 的
> portTextureCache 應為低（key 有界 45 entry）。報告開頭已標注。
>
> **獵捕方法論（若要再開第四輪）**：三輪產量 32 → 29 → 42，**沒有下降，尚未收斂**。
> 資料顯示「換切法」邊際產量遠高於「重讀同樣檔案」—— 第三輪的 15 條資料流問題，
> 按檔案讀的前兩輪一條都沒找到。**已知的明確缺口**：pattern 窮舉那輪的欄位比對
> 只做了 `floor` 一種物件型別，還有 wall/ap/camera/switch/tray/riser 等 11 種沒做
> （`floor` 一種就挖出 3 個位置的 bug）；另外 `obj[key]`、解構重命名這類動態存取
> 是所有 regex 的共同盲區，需換工具（AST）。

### Phase 52 三角色稽核修復（2026-08-11 立項，**四批全部完成**，詳見下方 Phase 52 專節）

> 工程師／QA／普通使用者三個 subagent 平行稽核 + 兩輪交叉對質，共 30 條。
> **批次 1 ✅ → 批次 2 ✅ → 批次 3 ✅ → 批次 4 ✅（皆 2026-08-12 使用者驗收 ok）。**
> **已撤回**：D6（熱圖室外淡化）、D7（窄視窗佈局）—— 使用者決定不做，見「已撤回的決策」表。
> **剩下**：D8 無法重現；D9 的 ②⑤⑥⑦（文案/範例圖/淺色模式）；E8 狀態衛生。皆為 Minor。
> 使用者已剔除「零持久化／儲存鈕／beforeunload」（之後資料來自 API，目前只是 demo）。

### Phase 51 3D 視覺美化（2026-08-06 立項，逐項優化、每項瀏覽器驗收後再下一項）

> **現況盤點（生硬陽春的根源）**：無環境貼圖（IBL）→ meshStandardMaterial 的 metal/rough 發揮不出來全是塑膠平色；
> 纜線全是 1px `lineBasicMaterial` 硬線（`TUBE_RADIUS` 宣告未用）；riser「外框」是 wireframe 圓柱（顯示三角網）；
> 多處 `linewidth={2}` 是 WebGL no-op；格線/背景是最原始的 gridHelper + 死平 `#0f172a`；
> 樓層是零厚度貼圖平面（疊樓像紙片）；label sprite 固定 42px 拉近會糊；segment 數偏低（6/8/16）。
>
> **限制**：不可用 drei（要 React 18）；three 0.167 的 examples jsm 模組可直接 import（同 OrbitControls 模式）。
> **效能紅線**：Phase 45/46 戰果不可回退——隱藏 3D 凍結（`frameloop='never'`）不可破壞；
> 動畫類效果只能在 3D 可見時跑（useFrame 本來就受 frameloop 控管，但別加常駐 rAF）；
> 大改後在 300 AP demo 量一次切 3D 的耗時對照。

#### 批次 A — 全域光影 ✅ 全部完成（2026-08-06，51-1~51-5 逐項使用者驗收）

> **批次 A 收工小結**：三個效能量測點都落在 175–200ms 基準內（IBL 實測中性、其餘皆未回退），
> Phase 45 隱藏凍結完好、無記憶體洩漏、全程 0 console errors。
> **跨項共通決策（防重做）**：① 亮度旋鈕兩支語意不同——`EXPOSURE` 壓全畫面含熱圖、
> `environmentIntensity` 只壓受光面 ② **凡「顏色即數據」的圖層一律不吃霧**（含 `meshStandardMaterial`
> 的 AP 頻段色／Switch 類型色）③ 覆蓋全視野的裝飾層（shader 格線、樓板）必須 `raycast={() => null}`，
> 否則吃掉點選 ④ 對比驗收圖用本地腳本產在 `.playwright-mcp/compare/`（gitignore，不上 artifact）。

- [x] **51-1 IBL 環境貼圖**（✅ 2026-08-06，commit 33cb337，使用者驗收 ok）：`SceneEnvironment` 元件——`RoomEnvironment` 經 `PMREMGenerator` 烘成 envMap 掛 `scene.environment`，全場景 PBR 材質一次到位（其他 viewer3d 檔案零改動）；ambient/hemisphere 0.28/0.25 → **0.12/0.12**（避免與環境光重複計算），KeyLight 不動仍是唯一投影光源。
  **順手修既有 bug**：r3f 7.0.29 設 `gl.outputEncoding = THREE.sRGBEncoding`，但 **three 0.167 已移除該常數（值 undefined）**，等於沒設 → 改用 `outputColorSpace` 明確指定（加 IBL 後不管會過曝）。
  **亮度拍板 = env `0.30` + exposure `0.80`（使用者選最暗組合）**。實測牆面灰階 mean/對比落差：原本 112.7/46.7、env .85 → 205.4/**26.9**、env .45 → 178.8/32.2、**採用值 145.6/35.2**。**反直覺重點（防重做）：環境光越弱、對比越高**（KeyLight 佔比上升）——env 0.85 雖最亮但把牆壓成平板，不要為了「更亮」往上調。掃描表寫在 `SceneEnvironment` 註解裡。
  **兩個旋鈕語意不同**：`EXPOSURE`（檔案上方常數）壓暗**全畫面含地板熱圖**（tone mapping 在著色之後）；`intensity` 只壓受光表面。想「熱圖保持鮮豔、只暗建築」就只降 intensity。
  **驗證**：300 AP 開/關 IBL 穩態 long task 174.6 vs 177.1ms（雜訊內，PMREM 只烘一次故效能中性）、Phase 45 隱藏凍結完好（隱藏 0 幀、切回恢復）、4 次 2D↔3D 循環 texture 穩定 306 無洩漏、0 console errors。Camera 模式另外截圖確認：機身/支架跟著變暗正常，**FOV 錐是 `meshBasicMaterial` 不受光完全不變**（其漸層衰減屬 51-10）。
- [x] **51-2 陰影品質**（✅ 2026-08-06，commit 3ad1127，使用者驗收 ok）：KeyLight shadow frustum 從固定 ±80m 改成**依畫面上實際顯示樓層算包圍半徑**（`shadowRadius` useMemo 吃 `visibleFloors`）——單樓層收緊、切全樓層自動撐大涵蓋整個堆疊。
  **實測（投影樓層包圍盒到 light clip space，非估算）**：±80m 時 452×397 texels / 貼圖使用率 **4.3%** → 貼合後 1780×1563 / **66.3%**，**面積增益 15.4x**（每軸約 4x）。`shadow-mapSize` 維持 2048 沒動。
  **連鎖調整**：① 光源位置改成跟半徑縮放（原固定 60/90/40 偏移，大平面圖會被建築吞掉），方向抽成 `KEY_LIGHT_DIR` 常數 ② bias −0.0005 → **−0.0002 + normalBias 0.02**（每 texel 世界單位縮小 ~4x，舊 bias 會過重讓陰影與物體脫節）。
  **設計決策（防重做）：用包圍半徑，不要改成精確貼合方框。** frustum 在**光源空間**軸對齊而非世界空間，需要多大取決於光照方向；半徑具旋轉不變性，光源怎麼移/平面圖比例多奇怪都不會裁到。犧牲一點解析度換掉「陰影在 frustum 邊緣被切斷」這個更嚴重的失敗模式。
  **驗收注意**：預設畫面下差異不明顯（iso 視角光從右上、牆影多落在其他牆上或建築外，地板又被熱圖蓋住；初次截圖比對僅 0.64% 像素差）——**要關掉熱圖才看得出邊緣銳利度**，疊樓層時上層投到下層樓板的大片陰影最明顯。
  **驗證**：疊 2 樓 frustum 20.33→20.67 自動撐大無裁切、300 AP 穩態 long task ~200ms 與 51-1 基準持平（只改範圍沒動貼圖尺寸故免費）、0 console errors。
  **未做**：`VSMShadowMap`（可調模糊，需重調 bias）——目前 PCFSoft 邊緣已可接受，有需求再評估。
- [x] **51-3 背景漸層 + 場景霧**（✅ 2026-08-06，使用者驗收 ok）：① Canvas 改 `background: transparent` + `gl={{ alpha: true }}`，`.viewer3d` 容器加 CSS 垂直漸層（`#0a0f1d` → `#0f172a` → `#16203a`，原死平色成為中間色階）——用 CSS 不用場景 mesh：零 draw call、不進深度緩衝、不會被幾何遮住 ② `THREE.Fog`（`FOG_COLOR #16203a` 對齊漸層底色）範圍接 51-2 的 `shadowRadius`（near ×1.6 / far ×6.5），故 30m 辦公室與 200m 倉庫霧化程度相對自身一致，且**霧從內容之外才開始，編輯中的樓層完全不霧化**。
  **核心設計決策（防重做）：霧只吃建築，所有「顏色即數據」的圖層一律 `fog={false}`。** three 的霧會套用到**所有** fog-enabled 材質（含 `meshBasicMaterial`），距離會改變顏色 → 使用者判讀的量測值會隨視角漂移。豁免清單：熱圖（`HeatmapPlane3D` + `HeatmapStackPlane3D`）、`CameraOverlay3D`（4 種 overlay 共用同一 mesh）、纜線（dashed+solid）、線槽（邊框+中線）、範圍區（fill+stroke）、AP marker（`matOpts`）、Switch（`matOpts`）、相機 FOV 錐+地面多邊形、名牌 sprite（r3f 的 spriteMaterial **不會**繼承 three 的 `fog:false` 預設，要自己設）。
  **subagent 全面盤點逼出的關鍵漏網**：**AP 頻段色（橘2.4/藍5/紫6）與 Switch 裝置類型色是 `meshStandardMaterial`**——若只照「不受光材質」篩選會整批漏掉，但它們跟熱圖一樣是判讀資料。故規則不是「豁免 unlit」而是**「豁免所有編碼資料的顏色」**。
  **最高風險的一條是纜線**：cyan（正常走線槽）與灰（Manhattan fallback＝需注意）本就相近，霧會把 cyan 去飽和往灰色靠 → 距離遠近會改變一條線路「看起來在說什麼」，屬誤導判讀等級。
  **驗證**：fog `#16203a`/near 32.5/far 132.1；runtime 逐一確認 263 個建築材質吃霧、資料層全豁免、熱圖與 8 個相機 FOV mesh 皆 `fog:false`；300 AP 穩態 191ms（基準 175–200ms 內）；3 次 2D↔3D 循環正常；0 console errors。
  **驗收注意**：正視角最明顯（格線往地平線淡出、背景有上下漸層）；等角較細微，因建築本身在霧範圍外。
- [x] **51-4 漸隱格線**（✅ 2026-08-06，使用者驗收 ok）：新增 `features/viewer3d/GroundGrid3D.jsx`（149 行）——單一 plane + ShaderMaterial 在 fragment shader 程序化畫格線，取代**兩處** `gridHelper`（主場景 + `EmptyScene`）。**1m 細線 / 10m 粗線兩級**，給出舊版均勻格線沒有的比例感。
  **兩個技術重點**：① **距離淡出**（alpha 隨半徑 smoothstep 衰減）——**這件事 51-3 的霧做不到**：霧只把顏色染向霧色但線本身仍不透明，外緣仍會看到矩形邊界，所以必須格線自己淡出 ② **`fwidth()` 螢幕空間導數**維持每條線約 1px 寬，靠地平線處不糊成摩爾紋。plane 只是一個 quad，格線密度來自 shader 不是幾何，故放大不增頂點成本。
  **調校（兩輪，防重做）**：初版淡出起點 25% + 沿用舊 helper 色 `#334155`/`#475569` → **實測建築周圍太淡、失去地面參考作用**。改為 **淡出起點 `FADE_START_FRAC = 0.45`**（近景保滿強度）+ 色提一階 `#3d4d66`/`#5b6e8c` + alpha 0.55/0.9（舊 helper 每條線全不透明，淡出版要多一點對比才撐得住）。半徑從綁 `fogFar`（145m 太遠無意義）改綁 **`shadowRadius × 3.5`**（≈71m），在 fog 的 6.5x 之內淡完 → 格線消失時 plane 自身邊緣還沒進視野。
  **必要防呆**：`raycast={() => null}`——格線鋪滿整個視野，不擋掉會吃掉「點空白處取消選取」。實測選 AP→點空白正常取消、點牆正常選到牆。
  **驗證**：300 AP 穩態 183.3ms（基準 175–200ms 內）；空場景（未載入平面圖）格線+座標軸正常；Camera 模式正常；0 console errors。
  **驗收注意**：要關熱圖才看得到地板格線；正視角最能看出「往地平線消失、無硬邊」。想微調亮度改 `uMinorAlpha`/`uMajorAlpha`，間距改 `cell`/`major` props。
- [x] **51-5 樓板厚度**（✅ 2026-08-06，使用者驗收 ok）：`FloorPlane` 內加 `FloorSlab`（14cm `BoxGeometry`）+ `EdgesGeometry` 邊框描邊，疊樓層從「浮空紙片」變有厚度的建築。`opacity` 沿用 caller 傳入的 `dimOpacity`，非 active 樓層自動跟著淡。
  **座標約定**：樓板掛 **y=0 以下**——y=0 是樓層群組內的可行走表面（牆從 `bottomHeight` 預設 0 長上去、貼圖平面也在 0），掛上面會把平面圖蓋掉。
  **⚠ 開發中踩到的真 bug + 防重做**：初版樓板放 `-thickness/2`，頂面**剛好落在 y=0 與貼圖平面共面** → **z-fighting**：近看樓板出現橫條紋、**俯瞰視角樓板贏走大部分像素把整張平面圖蓋掉變死灰**。修法＝加 `SLAB_GAP_M = 0.004`（4mm）讓頂面嚴格低於貼圖平面。**這個 4mm 看起來像可以清掉的魔術數字，但拿掉 bug 就回來**——註解已標明，對照圖存於 `.playwright-mcp/compare/51-5-C-Z衝突修復.png`（該資料夾 gitignore，重跑對比腳本可再生）。
  **防呆**：樓板與邊框皆 `raycast={() => null}`，不攔截原本要點到樓層/物件的點擊。
  **驗證**：俯瞰平面圖完整無條紋（修復前的失敗症狀）、疊 2 層等角上下樓板邊緣清楚、300 AP 穩態 186.1ms（基準 175–200ms 內）、Camera 模式正常、0 console errors。
  **未做**：最底層 `ShadowMaterial` 承影地面——51-4 的 shader 格線已提供地面參考，再加一層承影面會與格線互相干擾，暫不做。

#### 批次 B — 物件細節（逐圖層打磨）

- [x] **51-6 牆描邊 + 玻璃牆**（✅ 2026-08-06，使用者驗收 ok）：① **描邊**——每面牆 `EdgesGeometry(geometry, 1)` + LineSegments，與 geometry 同 useMemo 重建/dispose；因衍生自同一份 geometry，**門窗開口一併有輪廓**。**1° 門檻**保留盒子/開口銳利邊、濾掉平面上的三角化接縫（0° 會把接縫也畫出來）。顏色 `#94a3b8` 冷灰**不用黑**——在 51-3 深色背景下黑色描邊會被讀成「面與面之間的縫隙」而非邊緣。② **玻璃牆**——`glass` + `low_e_glass` 兩種改 `meshPhysicalMaterial`，參數直接沿用 `OpeningDetail3D` 現成窗玻璃（transmission 0.9 / roughness 0.05 / ior 1.5 / opacity 0.35），同畫面玻璃牆與玻璃窗材質感一致。
  **決策：Low-E 視覺上就是玻璃**（雖 RF 衰減 25dB vs 一般 2dB）——差異由引擎 `dbLoss` 承載，不反映在外觀。**防重做：不要為 Low-E 另做一套更不透明的外觀。**
  **行為改變（刻意）**：玻璃牆 `castShadow={!isGlass}` **不投影**——three 陰影 pass 不理會 transmission，會投出與混凝土相同的實心影子，那是唯一露餡「這不是真玻璃」的地方。
  **玻璃牆描邊 alpha 較高**（0.75 vs 一般 0.4）：玻璃本體幾乎透明，沒有框線整面牆會消失。
  **驗證**：300 AP 穩態 156.3ms（基準內，45 條描邊線近乎零成本）；描邊 `raycast={() => null}` 不影響點選；Camera 模式牆體維持不可選取；0 console errors。對比圖 `.playwright-mcp/compare/51-6-*`（gitignore）。
- [x] **51-7 纜線實體化**（✅ 2026-08-07，使用者驗收 ok）：1px line → **`Line2` + `LineGeometry` + `LineMaterial`**（`worldUnits: true`）。`lineBasicMaterial` 的 `linewidth` 在桌面 GL 後端一律被忽略，所以舊版不管怎麼設都是髮絲線；Line2 把每段展開成面向相機的四邊形，粗細才真的生效。41-postfix 的值比較 memo **原封保留**。
  **⚠ 踩到並修復的效能回歸（防重做，最重要）**：第一版「每線段一個 `PolylineTube`」在 Line2 下爆掉——Line2 每物件帶 instanced geometry + 自己的 shader material，遠重於普通線。300 AP 實測 **19,449 個 Line2 / 穩態 232.3ms / 尖峰 5948ms**，vs 基準 157.3ms / 2112ms（用 `git stash` 前後對照量的），**明確踩線**。
  修法＝新增 `groupRuns()`：把**樣式相同且首尾相接**的線段合併成一條 polyline。不能全部合一條（同路由內 drop leg 虛線、線槽段實線必須區分）；合併條件含「首尾相接」防呆，路由跨樓層又折返的斷點不會被錯接。結果 **843 物件 / 117.5ms / 614ms — 比原始基準還快**（減 draw call 對普通線也是賺的）。
  **線寬拍板 `CABLE_WIDTH_M = 0.10`（非真實 3cm）**：真實 Cat6 約 3cm，在 30m 樓層預設視角下不到一個像素，**第一版就是這樣整條消失**。0.10m 是「看得到又不搶眼、且比 AP drop pole 細」的最小值。**防重做：不要為了物理正確改回 0.03。**
  **量化的誠實註記**：本項改的是線的「實心程度」不是覆蓋面積，整幅像素百分比會低估（0.1%）、纜線色像素數只有 1.08x，兩個數字都會誤導。實際採樣發現渲染後纜線最亮只到 blue=216（非假設的飽和值）。**證據以對比圖為準**（`.playwright-mcp/compare/51-7-*`，C 俯瞰放大最清楚），效能數據才是本項的硬指標。
  纜線設 `raycast = () => null` 不擋後方裝置點選。0 console errors。
- [x] **51-8 Riser / FloorHole 輪廓修正**（✅ 2026-08-07，使用者驗收 ok）：① **Riser**——`wireframe` 圓柱外殼（會畫出每個三角形的邊含側面對角線，看起來像網子）→ 自建 LineSegments：上下兩圓環 + **4 條垂直線**（`RISER_SPINES`）；圓柱 segment 16 → **32**（18cm 半徑下 16 段看得出是多邊形）。② **FloorHole**——上下環的 `linewidth={2}` 是 **WebGL no-op**（實際是髮絲線，在淡紫填充上看不見）→ 改 `Line2`（沿用 51-7 做法）0.12m 世界單位寬；**新增每個角一條垂直線**（使用者要求「變成全立方體」）。
  **設計差異（刻意，非疏漏）**：riser 固定 4 條垂直線（圓柱沒有真實的角，4 條只是勾勒輪廓，太多會變回網子感）；floor hole 每個角一條（多邊形的角是真實幾何邊界）。註解已標明。垂直線各自是獨立 2 點線段，不是一條折線——否則會在「上一角頂點」與「下一角底點」之間畫出不存在的斜線。
  **⚠ 順手抓到的既有 bug（使用者目視發現「線與柱體在不同地方」）**：`ExtrudeGeometry` 在 XY 畫形狀往 +Z 擠出，原本用 `rotation +π/2` 轉正 —— **但這個旋轉把擠出方向送到 −Y，柱體一直是往樓板下方長的**（實測 y −6→0，應為 0→6）。原本框線是髮絲線看不見，沒有參照物所以長期沒被發現；加粗後錯位才現形。**修法＝旋轉改 `−π/2`（擠出朝 +Y）+ 餵給擠出器的形狀 Y 取負**（抵銷該旋轉造成的 Z 鏡像）。**防重做：這兩個改動必須成對，只改其一會變成鏡像或倒插。**
  **驗證（三情境 + 獨立預期值，非拿渲染結果回推）**：① L 形多邊形跨 2 層 x10.07–17.96/z4.82–14.89 ② 單樓層開口 y 0–**3**（正確只跨一層） ③ **旋轉 30°+位移對齊** x19.03–27.40/z3.41–11.79（預期值由 `floorAlign.js` 的 `makeAlignMatrixM`/`applyAlignMatrix` 獨立算出）。三組柱體與框線邊界皆完全一致。另純幾何驗算確認映射是**逐點運算**故與多邊形形狀無關。目視補確認旋轉案例無鏡像（bounding box 相同不代表沒鏡像）。0 console errors。
- [x] **51-9 Switch / AP 造型**（✅ 2026-08-07，使用者驗收 ok，四子項全做）：① **Switch 圓角機箱** `RoundedBoxGeometry`（半徑 0.012 取小，目的是讓邊緣吃到高光，不是做成塑膠感）② **Switch 前面板 port 貼圖**——canvas 畫兩排 port 凹槽 + 綠色連線 LED，貼在前面板薄 quad 上（+0.001 避免與機箱 z-fight）。**決策：貼圖不建模**——48 port 建模要多 ~100 個 box，但面板只會在幾公分寬被看到，貼圖同樣資訊只要一個 draw call；依 port 數快取，同型號 switch 共用一張 ③ **AP 選取脈衝環**——`useFrame` 驅動由內而外擴散淡出（週期 1.6s，scale 1.0→1.5）。選中的 AP 本來就變紅，但密集場景裡那只是「又一個紅色東西」，**動態**才是讓它跳出來的原因 ④ **Label 銳利度**——原本固定 42px 光柵化，HiDPI 或拉近就糊；改 `devicePixelRatio` 超取樣（**上限 ×2 再 ×1.5**，因為 label 依字串永久快取，3x DPR 會讓每個裝置名都吃三倍面積）+ mipmap + anisotropy 4。世界尺寸不變（sprite 用**版面尺寸**縮放而非像素尺寸）。
  **順手消重複**：`APLayer3D` 內的 label 是 `Label3D` 的逐字複製，銳利度修正等於要做兩次 → AP 改用共用元件，刪掉複製（−117 行）。
  **關鍵驗證：脈衝動畫不破壞 Phase 45 凍結**——`useFrame` 受 frameloop 控管，實測隱藏時 **0 幀**、切回 **68 幀**。300 AP（脈衝執行中）穩態 135.1ms 在基準內。0 console errors。
  **對比圖踩到的坑（防重做）**：直接設 `camera.position` **無效**——`CameraRig` 的 OrbitControls 每幀會拉回去，導致前後兩張視角不同（第一版算出「98.2% 變化」的假數字，實際是在比較牆 vs 門）。要固定視角必須用 rig 的 `park(camPos, target)`（它會取消 tween 並同步 controls.target）。修正後為合理的 2.7% / 1.3%。
  **另註**：`RoundedBoxGeometry` **不暴露 `.parameters`**（不像 `BoxGeometry`），驗證是否套用要看 `geometry.constructor.name`。
- [x] **51-10 相機 FOV 漸層衰減**（✅ 2026-08-07，使用者驗收 ok）：① **錐體漸層**——`FovVolume` 本就是 indexed fan（頂點 0 = apex、其餘為地面環），正好對應「近亮遠暗」：apex 用滿色、地面環乘 `FOV_RIM_FALLOFF = 0.25`。原本均勻 alpha 讓鏡頭旁與最遠處覆蓋強度看起來一樣，但這個形狀最該傳達的就是偵測隨距離衰減。因衰減壓暗外側，整體 opacity 0.09/0.16 → **0.14/0.22**，否則遠端幾乎看不見。
  **技術選擇（防重做）：用 `vertexColors` 而非真正的 per-vertex alpha**——`meshBasicMaterial` 會把 vertexColors 乘進基色，但**沒有 per-vertex alpha 通道**；在深色背景上往邊緣變暗讀起來就是衰減，且不必寫自訂 shader。
  ② **地面 footprint 輪廓**——`Line2`（沿用 51-7/51-8）沿多邊形畫封閉環，寬 `FOOTPRINT_WIDTH_M = 0.07`（比開口環 0.12 細，這是覆蓋邊界不是結構邊界），y=0.035 疊在填充 0.03 之上避免 z-fight。原本填充在地板圖上邊緣糊掉，「覆蓋到底在哪停」看不出來——而那正是盲區檢查要問的。
  **未做**：地面多邊形本身的漸層——它是 `ShapeGeometry`，頂點沒有天然的近/遠排序，硬做要重寫三角化，CP 值不對；輪廓線已解決「邊界在哪」的核心問題。
  **驗證**：三視角切換 **0 long task**（相機場景輕量、頂點顏色零成本）、0 console errors。
  **對比圖注意（此圖層固有限制）**：mock 人形是時間驅動的追蹤模擬，**前後兩張必然不同位置**，無法消除。且普通像素差異掃描會被橘色人形帶偏 → 需**只計算綠色通道差異**才能定位到真正的 FOV 變化區。
- [x] **51-11 Scope / 熱圖平面收尾**（✅ 2026-08-10 使用者驗收 ok）：① **scope 邊界描邊**——`ScopeLayer3D` 的 `lineBasicMaterial linewidth={2}` 是 **WebGL no-op**（同 51-8 的坑），實際永遠是髮絲線，在半透明填充上「範圍到哪為止」看不出來 → 改 `Line2`（沿用 51-7/51-8/51-10），寬 `SCOPE_WIDTH_M = 0.07`。**寬度階層理由**：比開口環 0.12、纜線 0.10 細——scope 是**規劃邊界不是實體物**，該讀成註記；與 51-10 相機覆蓋輪廓同級。`raycast = () => null`（環鋪滿整個 zone，不擋掉區內物件點選）。
  ② **熱圖邊緣羽化**——做在 **`heatmapGL` FS_COLORMAP**（唯一寫出 alpha 的地方），只乘 alpha **不動 rgb**（顏色即 RSSI 讀值，不可位移）。因 2D/3D 共用同一張 canvas（Phase 45），一處實作**兩邊同時生效且必然一致**。
  **⚠ 走過的死路（防重做，兩條都別再試）**：**(a) PIXI mask 行不通**——PIXI v8 sprite mask 是**二元覆蓋**，mask 內的 per-fill alpha 直接被丟棄。實測把整個 mask 設 alpha 0.15，畫面**0 px 變化**（不是幾何寫錯：我先做到 tiling 完全正確——maxCover 1 / 0 double-covered / 0 uncovered / tiledArea 350035 = planArea 精確相等、alpha ramp 0.083→1 單調——結果仍完全無效）。**(b) canvas 2D composite 行不通**——`gl.canvas` 是 WebGL2 canvas，`getContext('2d')` 回 null，寫了會靜默 no-op。
  **只羽化「未被牆框住」的邊**（`computePadding` 已判定的 unframed 邊，直接複用它的結論，不重新推導）：牆框住的邊，場真的到那裡就停（建築外殼），硬切是**事實**要保留；沒牆的邊才是取樣邊界造成的假象。`EDGE_FEATHER_M = 1.5`（demo 實測 34.2px = 5% 平面寬，非「看起來很寬」的錯覺——白邊看起來寬是因為平面圖矩形遠大於建築本體，那圈本來就已經很淡）。曲線用 **smoothstep**（`k*k` 會把整條帶壓暗成一圈灰邊）。
  **`heatmapStack`（3D 全樓層）刻意不羽化**：它取樣**恰好**是平面矩形、無 PAD_M 邊界外資料，羽化只會淡掉真實讀值；且疊層是背景脈絡。已在該處加註。
  **驗證**：UV 數學獨立驗算（rect 寬高 = imgW/fullW、imgH/fullH 完全相符；34.2 = 1.5×22.83）；**y 軸翻轉陷阱**——`FS_SAMPLE` 有 `1.0 - vUv.y`、colormap pass 沒有，故世界 top 落在 **高 v 端**，side 順序以 UV 表達並加註；raycast 防呆用**行為**驗（掃 37 次點擊全部命中牆/物件，**沒有一次**被 scope 環攔截）；2D/3D 共用 canvas 確認 `sameCanvas: true`；planQuality 數字不受影響（由 `sampleField` 直接算，與渲染像素無關）；**300 AP 穩態 long task 174ms（基準 175–200ms 內）**、0 console errors。
  對比圖：`.playwright-mcp/compare/51-11-A-scope邊界描邊.png`、`-B-in-scope綠邊界.png`、`-C-3D熱圖邊緣羽化.png`、`-D-2D熱圖邊緣羽化.png`（gitignore）。

#### 批次 C — 後製特效（最後評估，效能風險最高）

- [x] **51-12 EffectComposer 後製鏈 — 實作後量測不過，已整包撤回（2026-08-10）**。**結論：不做。Phase 51 到此收工。**
  照本項自訂的門檻「做前先量測，過不了效能紅線就不做」執行：完整實作（`PostFx3D.jsx` + 四個 layer 的 `userData.selectKey` 標記）→ 量測 → **回退**。程式碼已刪，只留下這則紀錄與 `DevBridge`。
  **實測（Intel UHD 770／1340×952／300 AP／等角／熱圖開，非 SwiftShader）**：
  | 情境 | ms/frame | fps |
  |---|---|---|
  | 無 composer（同場次基準） | ~34.3 | 29.1 |
  | RenderPass+Outline+Bloom+Output | **59.4** | **16.8**（p95 201ms） |
  **+25ms／1.73×，fps 幾乎砍半**——遠超紅線（Phase 45/46 好不容易把 300 AP 拉到可用）。**明確不做。**
  **逐 pass 成本（interleaved 中位數，同場次）**：Outline ≈ 0、Bloom ≈ 0（都在雜訊內）、**SSAO +3.5~7.4ms**；**SSAO 降半解析度 33.74 vs 全解析度 33.75＝完全沒省**——它的成本在整場景 depth/normal prepass，不在 AO 解析度，**沒有便宜的旋鈕可調**。（故即使只上 Outline+Bloom 也已經是上表的 59.4ms，問題不只 SSAO。）
  **⚠ 量測陷阱（防重做，最重要）**：直接拿 `gl.render()` 對比 composer 會得到「composer 比較快」的荒謬結果（實測 0.74×）。原因＝**畫進 default framebuffer 要付瀏覽器合成成本（33.8 vs 26.6ms，約 7ms）**，而 composer 畫進 offscreen target 不用付。**任何後續比較都必須讓基準也畫進 render target**，否則結論相反。
  **另外兩個踩到的架構衝突（若日後重啟需先解）**：① composer 最後一道 pass 是全螢幕 quad，預設不透明，會蓋掉 51-3「CSS 漸層透過透明 canvas 透出來」的做法（背景變全黑，連帶 51-4 格線淡出失去可淡入的底色）。試過 `CustomBlending`／`NoBlending`／把漸層改成 `scene.background` 貼圖三種解法。② **不是** double tone-mapping——查 three 原始碼 `WebGLPrograms.js:164-175` 確認 tone mapping 只在 `currentRenderTarget === null` 時套用，RenderPass 畫進 target 故不會重複，這條假設已排除。
  **保留下來的東西**：`Viewer3D.jsx` 的 **`DevBridge`**（DEV-only `window.__r3f = {gl, scene, camera, size, invalidate}`）。r3f 7 把 store 藏在 context、canvas 元素上沒有把手，先前**完全無法**從 MCP/devtools 量測 3D；本項所有數據都靠它才拿得到，日後任何 3D 效能工作都需要。對照既有的 `window.__pixiApp` / `__scene` / `__stores` 慣例。

### Phase 49 自動規劃 AP 放置（auto place）— 已實作，待使用者驗收（2026-07-23 起）

> Spec 與所有拍板決策見 `.claude/auto-place-spec.md`。
> 三模式（fresh 重新規劃／fixed 固定數量／fill 補洞）+ 頻段選擇 + 完整頻道指派
> （`greedyChannelAssign` 新增 `fixedChannels` 參數）+ ghost 預覽層（`ghostAPsLayer`）
> + what-if 熱圖（heatmapAdapter 併入 previewAps，memoized 不破指紋）
> + 預覽態 docked 小卡不擋畫布。
> 演算法：候選格 → 覆蓋矩陣 → set cover 貪婪 → relocate。
> 同期：autoPowerPlan 修復 + ~100x 提速已 commit（9dde23c）。
>
> **2026-07-27 使用者驗收回饋 → 四輪修正**（細節與實測數據全在 spec）：
> 1. **室內偵測**（`utils/indoorMask.js`）— 原本 AP 會被放到牆外空地（demo 10 顆中 6 顆）。
>    flood fill 自動辨識建築範圍，候選點與評分格都套；牆沒接好時退回全範圍 + UI 明示。
> 2. **格距校準** — `gridStepM` 2→1 m、`candStepM` 4→2 m。候選格才是關鍵瓶頸：
>    demo 從「10 顆 / 93.3% / 未達標」變成「7 顆 / 97.2% / 達標」。
>    加 `stopReason` + `targetMet`，未達標不再假裝成功。
> 3. **移除預覽** — 紅環「✕」標出將被移除的 AP；併修 heatmapAdapter 只加不減
>    導致 what-if 熱圖虛胖（實測落差達 13 dB）。
> 4. **原地保留** — 重跑時位置沒變的 AP 不刪不加（原本會洗掉手動調過的功率/頻道）。
>
> 另修 overlay dismiss（`hooks/useOverlayDismiss.js`）：7 個 modal 的
> 「modal 內按下 → 背景放開」誤關問題。

### Phase 48 樓層對齊修復 — 全部完成（Bundle 1+2，2026-07-23；防重做決策保留如下）

> **已拍板決策（防重做）**：
> ① 對齊語意統一為**米空間**（`src/utils/floorAlign.js` 為唯一正典；圖片幾米由各層比例尺回答）；
> ② 跨樓層計算遇未校正比例尺的樓層 → **排除＋警告**（不要 fallback 硬套 active 比例尺）；
> ③ `alignScale` 保留（僅圖紙比例誤差修正，正常恆 1）；
> ④ 基準樓層採**方案 C**（`alignAnchorFloorId`，預設最底層）。
>
> **Bundle 2 已完成**：buildScenario 跨樓層幾何（AP／牆線段／中庭 bypass）過
> `T = A_active⁻¹ ∘ A_other`，active 維持 identity → scenario 座標系不變、雙引擎自動同步。
> MCP 驗證：scenario 手算 5 case 全對、場峰值位移 198px/期望 200、GL cache round-trip
> bit-exact、JS vs GL 質心 0.0px、排除警告生效。細節見 git log。

### Phase 48+ 3D 全樓層熱圖 — 完成（2026-07-23，A 策略；防重做備註）

> UI＝3D 右上「🌡️ 全樓層熱圖」開關（預設關，熱圖未開/單樓層模式反灰）。
> **A 策略拍板落地**：只在「3D 可見＋開關開」時逐層背景算（每層自己的 rx 高度＋完整跨樓層
> 模型，`buildCrossFloorData` 與 2D adapter 共用）；指紋快取（store refs＋熱圖設定）——
> 開關/視圖切換無資料變更時**零重算**（MCP 驗：rev 不變）；資料變更 debounce 重算。
> **防重做**：不要改成 always-on ×N（吃掉 Phase 46 效能戰果）；要更即時再升級 C 策略
> （idle 補算），骨架已留（heatmapStack.js 的 fingerprint/ensure 分離）。
> 核心檔：`features/viewer3d/heatmapStack.js`、`HeatmapStackPlane3D.jsx`、
> `features/heatmap/buildCrossFloor.js`。

### 效能殘餘（Phase 46 收工後暫緩，防重做）

> 2026-07-14 拍板收工。SW 機 300 AP 拖曳剩餘 ~0.93s long task 的組成與「還能做但 CP 值低」的候選：
> ① 拖曳中被拖 AP 的**纜線 gDynamic 每幀重畫**（虛線 drop leg 逐段細分三角化，buildLine 家族 ~350ms）——候選：拖曳中改實線 ghost、放開才畫虛線。
> ② 放開後全量重算的 CPU fold 單筆 ~165ms RunMicrotasks——候選：再切片。
> ③ 首次拖曳的 per-size FBO/LOS 一次性配置 ~156ms `checkFramebufferStatus`（同場次後續拖曳不付）——候選：idle 時預熱 drag 尺寸。
> ④ SwiftShader 全場光柵化固有成本（最大單筆 205ms 的主體）——要再降是靜態層快照（texture cache）等級工程，歸 Phase 25 效能家族扳機。
> ⑤ `heatmapAdapter` SW/HW 降級門檻（1500/20000）仍是 PLACEHOLDER 未校準。
> **重啟扳機**：使用者再回報拖曳卡頓，或單層 >500 AP 真實需求。

### Phase 47 六角色審查缺陷修復（2026-07-20 立項）

> 來源：設計師 / PM / RF 工程師 / 新手 / 演算法 / 邏輯 六個角色 subagent 全專案掃描。
> 已由使用者剔除（未來串 API 解決，**不修**）：零持久化、`buildingData/onSave` 整合契約、AI 牆偵測外部服務依賴、Stats/相機 mock 資料與 40px/m fallback、dev widget（DemoLoader/StressLoader/ProgressPanel，正式版整塊移除）。
> 下列為「即使 demo 版也算錯數字 / 踩得到的真 bug」，與串不串 API 無關，須修。

#### 建議動工順序（2026-07-20 拍板，按 CP 值＝影響÷風險排批次，跨越 P 分層）

> **P0–P3 是嚴重度/類別分層，不是動工順序。** 實際動工照下面批次 B1→B5。每條 task 標題末尾標 〔B?〕。
> 原則：先撿「低風險高影響、改動小驗證快」的，再進大改動；操作型 bug 優先於觀感。

| 批次 | 內容 | 為何這個順序 |
|------|------|--------------|
| **B1 快速正確性修正** | 47-24(僅頻段色 typo 那條) → 47-1 → 47-3 → 47-7 → 47-4 → 47-5 | 改動極小（多為改常數/一行取負）、影響大、驗證快；先讓引擎不再算錯數字。47-1 JS+shader 各一行；47-3/47-7 改常數。 |
| **B2 數字可信度（算法/語意）** | 47-2 → 47-6 → 47-8a → 47-9 | 影響報表/規劃數字正確性，需動邏輯但不動全鏈。 |
| **B3 操作型邏輯 bug** | 47-14 → 47-15 → 47-18 → 47-16 → 47-17 → 47-19 → 47-20 → 47-21 | 「操作就踩到」，優先於觀感；47-14/15/18 使用者最易觸發。 |
| **B4 UX/一致性** | 47-22 → 47-23 → 47-24(其餘 token) → 47-25 → 47-26 → 47-27 | 47-22 比例尺指引影響大但需設計 UI 流程，成本高於改常數故排 B4；其餘為收斂性清理。 |
| **B5 大工程（非急迫）** | 47-10 → 47-11 → 47-12 → 47-13 | 牽動較廣、非急迫；材質庫/天線增益/PoE class 可獨立慢慢做。 |

> 註：47-24 拆兩處出現——頻段色 typo（一字元、撞警告橘）併入 B1 隨手修；其餘色彩 token 收斂留 B4。

> **B5 分模型 + effort 決策（2026-07-21 拍板）**：B1~B4 全程 Opus 4.8。B5 依「牽動面 × 失敗代價」分模型——
> - **47-10（天線增益，JS+shader 雙引擎同步）、47-11（材質庫，動 materials.js＋可能牆資料結構＋UI）：用 `claude-fable-5`，effort `high`。** 這兩條牽動最廣、要同時 hold 住多處不變量，用最強模型降低漏改/破壞已驗證 parity 的機率，錢花在刀口上。
> - **47-12（TX 預設，評估＋查表）、47-13（PoE per-port class，邏輯＋對比 switch 埠級）：用 Opus 4.8，effort `high`。** 有明確 spec/資料、改動面收斂，Opus 綽綽有餘。
> - Fable 的 API 差異（thinking 永遠開、refusal fallback、需 30 天資料保留）在 Claude Code harness 內對開發是透明的，非負擔。**切模型須使用者手動 `/model`**——Fable 那兩條開工前先切到 Fable。
> - 護城河仍是 MCP 並排驗證（對 Opus/Fable 一視同仁）＋嚴格照 spec/oldSrc、不准自行設計。

#### P0 — 物理/演算法正確性（會直接算錯數字，最優先）

- [x] **47-1【高】〔B1〕Knife-edge 繞射符號反轉**（✅ commit 2c5295d，MCP 驗：符號表 v>0 回正損耗、diff>40 cull 復活、實場繞射 on/off 截圖確認補陰影不灌爆）：`knifeEdgeLossDb` 回傳的是負值繞射增益 Gd，呼叫端當正損耗「加」進 path loss → 繞射越深訊號越強（陰影區被灌爆）。旁證：`if (diff > 40) continue` 恆不觸發（死碼）。預設 `diffraction:true` 即走此路。**JS + shader 同步**取負。
  - `src/features/heatmap/propagation.js:87-93`（回傳取負）、`:411`（驗算）；`src/features/heatmap/propagationGL.js:749-758`、`:1112`。
- [x] **47-2【中】〔B2〕planQuality scope 過濾失效**（✅ commit 6c6afe8，MCP 驗：加 out-scope 蓋右半後 coverage 89.2%→81.5%、盲區面積 77→68m² 分母縮小；迴圈內自呼 scopeMaskFn + 界外 row/col 剪除）：面板靠 NaN 濾 out-of-scope，但 `sampleField` 已改全矩形取樣不寫 NaN（註解明說），排除區被算進涵蓋率分母與盲區面積。修：迴圈內自呼 `scenario.scopeMaskFn(x,y)`。附帶：`nx=ceil(w/step)+1` 多一排界外格，面積略高估。
  - `src/features/heatmap/planQuality.js:86`、`src/features/heatmap/sampleField.js:53-55`。
- [x] **47-3【中】〔B1〕Client View 資料速率頻寬倍率錯**（✅ commit 2c5295d，MCP 驗：80MHz=1202、160MHz=2403；widthRateMultiplier 已刪）：用 11n/ac 的 2.08/4.34/8.68，11ax 正確為 2.0/4.19/8.38。80MHz MCS11 2SS 顯示 1245 應為 1201；160MHz 顯示 2489 應為 2402（人盡皆知值）。另 `channelWidths.js` 有第三套沒人用的 `widthRateMultiplier`（2.1/4.5/9.0），一併收斂。
  - `src/features/clientView/dataRate.js:84-89`；`src/constants/channelWidths.js:64-69`。
- [x] **47-4【低】〔B1〕聚合 shader 缺 0.25m 水平距離 clamp**（✅ commit 2c5295d，best-AP+CCI 兩迴圈加 max(length(dxy),0.25) 對齊 JS；shader 編譯 0 error、聚合場正常）：`FS_FIELD`/CCI 迴圈無 clamp，AP 正下方一格與 JS/per-AP 路徑差 ~0.1-0.6dB，違反雙引擎一致性不變量。
  - `src/features/heatmap/propagationGL.js:1542-1544`、`:1600-1602`。
- [x] **47-5【低】〔B1〕probeAt zM 優先序潛伏**（✅ commit 2c5295d，MCP 驗：caller zM=1m 優先、hover 無 zM fallback scenario 5m）：`scenario.rxElevationM ?? rx.zM` 讓 scenario 蓋過呼叫端 client 高度，crossFloor 一啟用即靜默忽略使用者高度。改 `rx.zM ?? scenario.rxElevationM ?? 0`。
  - `src/features/heatmap/hoverProbe.js:8`。

#### P1 — RF 領域語意缺口（工具核心價值，讓真實設計翻車）

- [x] **47-6【高】〔B2〕頻道衝突改用公尺 + 頻寬相交**（✅ commit 6c6afe8，MCP 驗：ch36@80 vs ch44@20 近距報 1 對、ch36 vs ch149 不報、ch36 相距 20m 不報；detectChannelConflicts 收 floor.scale 用 12m 門檻 + apsShareSpectrum）。**決策（2026-07-20 拍板）**：只改 detectChannelConflicts（報表數字）；`autoChannelPlan.js` 的 greedyChannelAssign `interferenceRadius=300px` **不動**——它是頻道指派演算法的鄰居啟發式（非物理干擾距離），改它要動 3 個呼叫端且改變已驗證的 auto-plan/DemoLoader 行為，CP 值不對。**防重做**：不要再把 autoChannelPlan 半徑改公尺。
  - `src/features/heatmap/planQuality.js`（已改）；`src/utils/autoChannelPlan.js:35`（保留 300px）。
- [x] **47-7【高】〔B1〕雜訊底隨頻寬抬升**（✅ commit 2c5295d，MCP 驗：serving AP 20→160MHz SNR 降 9.03dB、20→80 降 6.02dB、RSSI 不變；三處同步 clientView SNR/SINR + JS aggregate + shader RSSI-only/full）：`widthNoiseDelta()`（`+10log10(W/20)`）是死碼無呼叫者，160MHz SNR 高估 ~9dB → MCS/速率虛胖。接進熱圖引擎與 clientView 逐頻段雜訊底。
  - `src/constants/channelWidths.js:73-75`（無呼叫者）、`src/features/heatmap/rfConstants.js:4`、`src/store/useClientViewStore.js:52`。
- [x] **47-8a【高】〔B2〕顯示層分頻段篩選**（✅ commit 6c6afe8，MCP 驗：3 頻段 demo 切 6GHz 後熱圖只剩該台 AP 場、其餘紅色，0 errors）：在 heatmapAdapter buildScenario 前按 `String(ap.frequency)===bandFilter` 篩 active + cross-floor aps + totalApCount；store 加 `bandFilter`（預設 all）+ `setBandFilter`；HeatmapControl 主控列加下拉（全部/2.4/5/6GHz）。**MCP 逼出的 bug + 已修**：idleInputs fingerprint 漏 bandFilter → 切 band 被 idleInputsEqual 判定無變化而跳過重算（熱圖不變）；補 `bandFilter: hm.bandFilter` 進 fingerprint 後生效。**不動 AP 資料結構、不碰 shader 物理**，純 render 前 filter。**增強（2026-07-20 使用者提議，commit 088c26a）**：切單一頻段時，非該頻段的 AP marker **半透明化 alpha 0.3（不隱藏）**，明確傳達「存在但不屬於當前檢視頻段」（對標 Verkada）。2D `apsLayer.bandDimAlpha`（訂閱 heatmap store）+ 3D `APLayer3D` 折進既有 dimOpacity。MCP 驗 2D/3D 皆生效、0 errors。
  - `src/render/heatmapAdapter.js`（filter + fingerprint）、`useHeatmapStore.js`、`HeatmapControl.jsx`、`apsLayer.js`、`APLayer3D.jsx`。
- [ ] **47-8b【backlog，不現在做】單射頻→多射頻 AP 模型**：現況一台 AP = 一個 radio（單 `frequency`/`channel`），model 已有 `supportedBands`/per-band 欄位但引擎只用單頻。要讓一台同發三頻需把 AP 展開成 N 個 radio 訊號源，**牽動全鏈**（buildScenario 展開、shader AP texture 打包、channel 面板 per-band、SINR/CCI 同頻干擾、Client View 關聯、統計負載）+ 風險破壞已驗證 parity。**CP 值不對**：47-8a 做完後痛點大幅緩解，雙頻可用「放兩顆」workaround。**重啟扳機**：使用者明確需要單台三頻建模，或 47-8a 的 workaround 造成實際規劃困擾。
  - `src/constants/apModels.js`（supportedBands 現成）、`buildScenario.js:187-204`。
- [x] **47-9【中】〔B2〕secondary coverage 視圖**（✅ commit 6c6afe8，MCP 驗：coverage 89.2% / secondary 43.6%，secondary ≤ coverage 不變式成立）：`sampleField` 加 opt-in `redundancyThresholdDbm` → 每格達門檻 AP 數（Uint8，reuse 現成 perAp 零額外 probe，預設不算不影響熱圖效能）；planQuality 算 `secondaryCoveragePct`（≥2 台達門檻的 in-scope 面積比）；DevicePlanningPanel 加「雙重涵蓋（≥2 台）」列（語音/漫遊備援白話 title）。
  - `src/features/heatmap/sampleField.js`、`planQuality.js`、`DevicePlanningPanel.jsx`。
- [x] **47-10【中】〔B5〕AP 型號逐頻段天線增益是死資料**（✅ 2026-07-22，Fable 5，使用者驗收 ok，MCP 驗：只換 model → JS RSSI 差正好 +1/+2/+3dB；GL delta = JS delta = 3.000、GL vs JS 絕對差 0.00；GL cache A→B→A round-trip=0；0 errors）：`apModels.js` 加 `getAPAntennaGain(ap)`（讀 model per-band `antennaGain`，未列頻段回 undefined）；buildScenario AP entry 加 `antGainDbi`；propagation.js `apGainDbi()` peak 從寫死 `AP_ANT_GAIN_DBI` 改 `ap.antGainDbi ?? AP_ANT_GAIN_DBI`（omni/directional/custom 三分支同步）；sampleFieldGL 三處 `_antGainDbi` 打包 + 兩處 cache hash 改用有效增益（否則換 model 吃舊快取）。**雙引擎不變量已驗**。
  - `src/constants/apModels.js`、`buildScenario.js`、`propagation.js`、`sampleFieldGL.js`、`FormulaNote.jsx`（第 7 節文案）。
- [x] **47-11【中】〔B5〕材質庫**（✅ 2026-07-22，Fable 5，使用者驗收 ok，MCP 驗：7 材質、金屬 30dB 全頻持平、Low-E 2.4/5/6G=25/32/33dB；customDb 雙引擎 delta 44.43=44.43；WallPanel 自訂衰減欄覆寫/解除正常；0 errors）：**決策（2026-07-22 拍板）**＝金屬 20→**30dB**（電梯井/機房級中間值）；新增 **Low-E 玻璃**（anchor 25dB@2.4 + lossB 0.3 → 5G≈32/6G≈33，落在 25-40 實測範圍；反射用金屬係數＝鍍膜強反射物理）；逐面牆 **customDb 覆寫欄**（WallPanel 材質列下方，留空=用材質值，只覆寫 anchor dB、lossB/反射/色沿用材質）。buildScenario expandWall 讀 `wall.customDb ?? material.dbLoss`；uploadWalls signature 已蓋 lossDb 故 GL 自動失效重算。
  - `src/constants/materials.js`、`buildScenario.js`（expandWall）、`WallPanel.jsx`、`FormulaNote.jsx`、`CLAUDE.md`（材質數 6→7）。
- [x] **47-12【中】〔B5〕預設 TX 20dBm 偏熱**（✅ 2026-07-22，Opus 4.8，使用者驗收 ok，MCP 驗：demo AP 2.4G=11/5G=15/6G=15dBm 不再全 20）：**決策（2026-07-22 拍板）＝逐頻段合理預設**。apModels.js 加 `DEFAULT_TX_POWER_DBM = {2.4:11, 5:15, 6:15}` + `getDefaultTxPower(band)`（單一來源，對齊 47-23 常數收斂）；三個 AP 建立點（FloorplanSystem 手動放置 / DemoLoader / StressLoader）+ buildScenario fallback 全改引用。取企業實務範圍（2.4G 8–14 / 5G 14–17）中間偏典型值，6G 對齊 5G。
  - `src/constants/apModels.js`（新常數+helper）、`FloorplanSystem.jsx`、`DemoLoader.jsx`、`StressLoader.jsx`、`buildScenario.js:194`。
- [x] **47-13【低】〔B5〕PoE per-port class 協商檢查**（✅ 2026-07-22，Opus 4.8，使用者驗收 ok，MCP 驗：3bt AP 連 3at switch→classShort count=1 + UI 顯示「⚠ 需 802.3bt」，switch 改 3bt→警告消失非恆真，0 errors）：**決策（2026-07-22 拍板）＝完整 per-port class 協商**。apModels.js 加 per-model `poeClass`（3af/3at/3bt）+ `POE_CLASSES` 元資料（rank/perPortWatt 15.4/30/60W）+ `getAPPoeClass`/`getPoeClassMeta`；`poeWattage` 改 worst-case（fallback 15→18W）。useCableStore per-kind default 加 `poePortStd`（access 3at / idf 3bt / core 無）。SwitchPanel connected 迴圈算 `classShort`（AP rank > port rank），PoE 區加「每埠供電」下拉 + 警告 hint，已連 AP 清單標「⚠ 需 802.3bt」。
  - `src/constants/apModels.js`、`src/store/useCableStore.js`、`src/components/PanelRight/SwitchPanel.jsx`、`SwitchPanel.sass`。

#### P2 — 邏輯/狀態 bug（demo 操作就踩得到）

- [x] **47-14【中】〔B3〕STATS 唯讀模式可 Delete 刪 AP/Switch**（✅ commit eb59e10，使用者驗收 ok）：加 `readOnly` capability（STATS + CLIENT_VIEW）；Delete handler + PanelRight 在 readOnly 模式 no-op / 不開物件編輯面板（含面板顯示，2026-07-20 拍板一起擋）。MCP 驗 STATS 選 AP Delete 存活、SELECT 正常刪。
  - `src/render/modeCapabilities.js`（readOnly flag）、`FloorplanSystem.jsx`（Delete guard）、`PanelRight.jsx`（面板 gate）。
- [x] **47-15【中】〔B3〕刪樓層漏清相機/軌跡**（✅ commit eb59e10，使用者驗收 ok）：confirmRemove 補呼叫 `useCameraStore.clearFloor` + `useTrackingStore.clearFloor`。MCP 驗 camera clearFloor 5→0。
  - `src/components/SidebarLeft/SidebarLeft.jsx`。
- [x] **47-16【中】〔B3〕「＋放置」相機後 Ctrl+Z 相機徹底消失**（✅ commit 91c36a7，使用者驗收 ok）：history snapshot 納入 org-level `unplacedCameras`（一律存 before-pool，因 placeCamera 同一 set() 改 pool+camerasByFloor）。MCP 驗 undo 後相機回 unplaced pool（pool 3→2→3）。
  - `src/store/useHistoryStore.js`。
- [x] **47-17【中】〔B3〕Switch 刪除/新增的跨樓層 uplinkTo 副作用不被 undo 還原**（✅ commit 91c36a7，使用者驗收 ok）：snapshot 的 switches 從單樓層 array 改成全建築 `switchesByFloor` map，restoreSnapshot 整份還原。MCP 驗跨樓層 uplink 刪→undo 還原、同樓層 switch undo 無回歸。
  - `src/store/useHistoryStore.js`（takeSnapshot/restoreSnapshot/commitPending/onStoreChange 全改 switchesAll）。
- [x] **47-18【中】〔B3〕DRAW_WALL Backspace 誤刪既有牆**（✅ commit eb59e10，使用者驗收 ok）：draftModeController 追蹤 `sessionWallIds`（commitWall push、新 anchor reset），Backspace 只 pop 本 chain 仍存在的牆，非 walls[length-1]。MCP 驗 45 牆未畫即 Backspace 全保留。
  - `src/render/draftModeController.js`。
- [x] **47-19【低】〔B3〕刪樓層後死快照卡住 undo 堆疊**（✅ commit 91c36a7，使用者驗收 ok）：`useHistoryStore.dropFloor(floorId)` 清該樓層 undo/redo 快照 + pending raw；SidebarLeft.confirmRemove 呼叫。MCP 驗 dropFloor 移除死快照、保留 active 樓層項。
  - `src/store/useHistoryStore.js`、`src/components/SidebarLeft/SidebarLeft.jsx`。
- [x] **47-20【低】〔B3〕複製相機連 calibration 帶走 → 假「已校正」**（✅ commit 09a5ddf，使用者驗收 ok）：ContextMenuMount + CameraPanel.handleDuplicate 解構加 `calibration: _omitCal` strip。MCP 真 UI 驗：原相機有 calibration、複製鈕產生的副本 calibration=false。
  - `src/components/ContextMenu/ContextMenuMount.jsx`、`CameraPanel.jsx`。
- [x] **47-21【低】〔B3〕雜項**（✅ commit 09a5ddf，使用者驗收 ok）：① ContextMenuMount menu-target-removed 的 closeContextMenu 從 render 期間搬進 `useEffect`（targetExists 判斷）——MCP 驗刪 target 後 menu 自動關、無 "cannot update while rendering" 警告 ② `viewport.js` Space keydown 加 `isTypingTarget` guard ③ `camerasLayer.js` drag/rotate 兩個 onMove 加 `isCameraMode()` guard ④ history onStoreChange：`_pendingRaw.floorId !== floorId` 時先 flushPending 再建新 raw（跨樓層第一步可 undo）。

#### P3 — UX / 一致性（demo 展示會出糗）

- [x] **47-22【高】〔B4〕比例尺靜默失敗指路**（✅ commit 1a4bf16，使用者驗收 ok）：heatmap store 加 `scaleMissing` flag（heatmapAdapter 在 enabled+無 scale 時 set true）；HeatmapControl 顯示「⚠️ 尚未設定比例尺」notice + 「設定比例尺」鈕（進 DRAW_SCALE）。MCP 驗 flag true/false 正確切換。**未做**：「匯入樓層後 scale=null 常駐入口」（DRAW_SCALE 已可從 toolbar 進，未加常駐入口，範圍收斂）。
  - `src/store/useHeatmapStore.js`、`heatmapAdapter.js`、`HeatmapControl.jsx`。
- [x] **47-23【高】〔B4〕-67 門檻收斂單一來源**（✅ commit 1a4bf16，使用者驗收 ok）：新增 `src/constants/coverage.js`（`COVERAGE_THRESHOLD_DBM=-67` + `COVERAGE_TARGET_PCT=90`），四處引用（ClientView store / DevicePlanningPanel / association fallback / useStatsTimeStore gapThreshold）。**決策（2026-07-21 拍板）：相機 coverageTargetPct 80% 不動**（FOV 覆蓋屬不同物理量，非 RSSI）——**防重做：不要把相機 80 改成 90**。熱圖色階 anchor 不塞 -67（視覺 ramp，非涵蓋計算，不動）。STATS gapThreshold 用共用常數即標明固定（未加獨立 UI 入口）。
  - `src/constants/coverage.js`（新）、`useClientViewStore.js`、`DevicePlanningPanel.jsx`、`association.js`、`useStatsTimeStore.js`。
- [x] **47-24【中】〔B1+B4〕色彩 token 收斂**（✅ B1 typo commit 2c5295d；B4 危險紅+開關色 commit 1a4bf16，使用者驗收 ok）：`_variables.sass` 加 `$danger`/`$danger-hover`/`$danger-soft`；各面板 #ef4444/#f87171/#e74c3c(危險語意) 收成 token（10 檔）；熱圖開關「開啟」#ef4444→`$accent`。**決策（2026-07-21 拍板）：只收危險紅+開關色**——「暗玻璃底 %dark-glass / 三種 radius / chip active 畫法統一」深度視覺重構**未做**（風險/CP 值不對，留 backlog）；頻段色留 JS（apsLayer FREQ_COLOR 已統一，sass 用不到）。
  - `_variables.sass`、各面板 sass、`HeatmapControl.sass`。
- [x] **47-25【中】〔B4〕內部黑話外漏**（✅ commit 1a4bf16，使用者驗收 ok）：引擎下拉 F5a→「精確（完整物理）/快速（GPU 加速）」；SidebarLeft/DevicePlanningPanel/BatchPanel/AutoPowerModal 的 greedy→白話；CableSummary/APPanel「Manhattan fallback/Unroutable/Z drop/slack」→「直角走線（未沿線槽）/無法接線/垂直落線/預留餘量」。
  - `HeatmapControl.jsx`、`SidebarLeft.jsx`、`CableSummaryPanel.jsx`、`APPanel.jsx`、`BatchPanel.jsx`、`DevicePlanningPanel.jsx`、`AutoPowerModal.jsx`。
- [x] **47-26【中】〔B4〕版面避讓**（✅ commit 1a4bf16，使用者驗收 ok）：① CameraTimelineBar center 改吃 `--right-dock`（`left: calc((100% - dock)/2)`）不被 PanelRight 蓋 ② **3D 隱藏 2D overlay**：CanvasArea `is3D` gate 左上/左下 stack + 時間軸 + 比例尺；ActiveModeBadge 3D 回 null ③ **3D Toolbar 精簡（2026-07-21 使用者拍板方案）：只留 AP/Camera/Stats 世界切換鈕**，藏第二行工具列 + Undo/Redo + 操作提示——世界切換在 3D 仍可用（實測點 Camera 切世界維持 3D）④ `--tl` stack 加 `max-height + overflow-y auto`（矮視窗可捲）。MCP 驗切 3D→2D overlay 消失/恢復、世界切換可用、0 errors。
  - `CameraTimelineBar.sass`、`CanvasArea.jsx/.sass`、`Toolbar.jsx`、`ActiveModeBadge.jsx`。
- [x] **47-27【低】〔B4〕hit target / 殘留樣式**（✅ commit 1a4bf16，使用者驗收 ok）：SidebarLeft 樓層輸入框 hover 泛紅殘留 bug→中性藍邊；CameraListPanel del/live + TrendPanel close 18px→24px hit target；StatsDashboard `fmtBps` 死碼移除、`linkMbps` 單位「M」→「Mbps」、rank-name 加 `title`。**未做**：三套 toast 中心點統一（觀感細節，CP 值低，留 backlog）。

#### 保留為 backlog（缺口非 bug，依產品優先序拍板）

- [x] **PDF 規劃報告輸出**（✅ 2026-08-10 使用者驗收 ok）：新增 `src/features/cable/exportPlanningPdf.js`。
  **重要發現**：oldSrc **已有**完整實作（Phase 22-2，封面+每層+AP線纜+S2S+線槽BOM+警告），Phase 25 port 時漏掉（CSV 是明確撤回、PDF 只是沒 port）→ 依嚴格重構規則**照原結構移植**，非重新設計。
  **port 必須改的三處**：① `capturePlanPng` 從 Konva stage 改吃 `{app, world}`，經 `getSceneRefs()` 取得（production build 也能用）② routes/switchLinks/warnings 改用現成 `getCachedRoutes` 一次取得（取代 oldSrc 的 buildPlanningSnapshot）③ tray fill 改在此地用 `computeTrayCableLoads`+`computeTrayFill` 現算（不吃外部傳入的 map，避免 caller 遞進過期快照）。
  **新增 oldSrc 沒有的 RF 半邊**（backlog 要求的「涵蓋熱圖 + verdict」）：**RF COVERAGE 頁**——逐樓層跑 `computePlanQualityStats`（Phase 42 同一引擎，故 PDF 與畫面 verdict **不可能不一致**）列涵蓋率 / 雙重涵蓋 / 盲區 % / 盲區面積 / **PASS ∣ BELOW TARGET** 判定（只給 verdict 那格上色，整列染色會跟表格打架）；未校正比例尺的樓層報 **NOT MEASURED** 不硬算（沒比例尺的涵蓋率無意義）。另把**頻道衝突**併進警告頁。
  **jsPDF 只有拉丁字型 → 三處 CJK 必須處理（不然出 `??`）**：`CAPACITY_PROFILES.label`（"Planning（25% / 40%）"）改用 value + 數值比率描述；`CAPACITY_STATUS.label`（注意/滿載/超出）用 `FILL_STATUS_EN` 對 status **key** 映射英文；樓層名等使用者字串走 `asciiSafe`。封面的「非 ASCII 轉寫」註記改成**只有真的發生時才印**。graph warnings 本身已是英文（實查）。
  **驗證（不是只看有沒有下載）**：用專案現成 `utils/pdfUtils.renderAllPdfPages` 把 7 頁**渲染成圖逐頁目視**——7 頁 / 全 A4 橫向 842×595pt；RF 頁數字（84.3% / 39.8% / 15.7% / 112m²）與 live 引擎實測**逐項相符**；AP 線纜表 5 筆長度合計 71.30 = 封面 71.3、線槽 25.84 = 封面 25.8（內部自洽）；頻道衝突正確報 AP-03(CH36/40) vs AP-04(CH40/40)、空的 Unroutable/Graph 區段正確省略；真按鈕點擊路徑產生 `floorplan-report-2026-08-07.pdf`，執行中按鈕 disabled + label 顯示進度後復原；0 console errors。
  **UI**：`CableSummaryPanel` 底部「📄 匯出規劃報告 PDF」（此面板本就是全建築彙總，是唯一合理位置；PNG 匯出在樓層右鍵選單，兩者不衝突）。walls/scopes/regulatoryDomain 用 `getState()` 點擊時讀、**不訂閱**（否則每次改牆都重 render 這個面板）。
  對比圖：`.playwright-mcp/compare/51-B-PDF匯出鈕.png`（gitignore）。
- [ ] **容量/airtime 規劃**：純覆蓋工具，缺高密度場域容量輸入（Ekahau Capacity Planner 對標）。
- [ ] **A/B plan diff、漫遊重疊區**：原有 backlog，待拍板。
- [x] **spec.md 同步**（✅ 2026-08-10 使用者驗收 ok）：`.claude/spec.md` 全面重寫（171 → 約 300 行）。方法＝**逐條拿 spec 去對 `src/`**（subagent 全庫掃 + 人工覆核關鍵值），每條標 ✅ 已實作 / ⚠️ 部分 / ❌ 未實作；**未實作的保留不刪**（刪掉會被當成需求遺漏而重複提案）。
  **抓到 6 條與實作不符的舊承諾**：① **CAD 匯入未實作**（accept 只有 `.png,.jpg,.jpeg,.pdf`，無解析器依賴）② **去色/灰階未實作**（opacity/旋轉/裁切三項有）③ **滑鼠 vs 觸控板模式未實作**（viewport 只有單一固定 ZOOM_PER_NOTCH；`EDITOR_MODE.PAN` 是*工具*不是輸入模式）④ **自訂材質未實作**（materials.js 硬編碼 7 種；現有的是「選內建」+「單面牆 customDb 覆寫」兩件事，不是使用者自建材質庫）⑤ **Fill top & bottom 未實作**（只有兩個手動輸入框）⑥ **AI 偵測 scope zone / 電梯井未實作**（AI 只回 wall/door/window，完全不碰 useScopeStore；垂直貫穿物只有手動的中庭與豎井）。
  **另兩條語意需修正**：樓層對齊實作是**數值滑桿 + 疊圖目視**，不是舊 spec 寫的「用對齊點（樓梯/電梯）解算」；熱圖指標是 **4 種**（多 SINR）不是 3 種。自動比例尺**是**有（門寬回推）但標注已知弱點（門偵測率低 → 樣本不足時抗離群失效）。
  **補上舊版整域缺漏的五大領域**：相機/CCTV、Client View、統計（兩態）、網路布線、自動規劃；並收錄不可違反的架構決策（JS 引擎不可移除、3D read-only、BOM 是 Planning BOM、warning ≠ code violation）、效能紅線、以及已撤回清單（避免重複提案）。
  **順手發現需使用者決策（未改，非本次範圍）**：`AIWallsModal.jsx:27-28` 把 `API_BASE_URL` 與 `API_TOKEN` 硬編碼成前端常數 → **會隨 bundle 出貨到瀏覽器**。內部服務尚可，正式對外前需改後端代理或短期憑證。已記在 spec §十二 風險清單。

---

### Phase 52 三角色稽核修復（2026-08-11 立項，尚未開工）

> **來源**：2026-08-11 三個 subagent 平行稽核 —— 資深工程師（`src/` 靜態全掃，不開瀏覽器）／資深 QA（Playwright 探索式 + 破壞性測試）／普通使用者（IT 網管人設，不看文件不看碼）。
> 之後跑**兩輪交叉對質**（工程師裁決 QA/User 的實測、QA 用瀏覽器實證工程師的靜態推論），逆轉 4 條結論，詳見本節末「交叉對質逆轉」。
> **全程只讀**，未改任何檔案。截圖在 `.playwright-mcp/`（前綴 `qa-` / `ux-` / `verify-`，gitignore）。
>
> **已剔除（使用者 2026-08-11 拍板，不要再提案）**：**零持久化 / 無「儲存」鈕 / reload 資料全失** —— 使用者回覆「之後資料都會來自 API，目前只是 demo，自然無所謂」。
> 這符合 spec §十二.1 設計；整合後 `buildingData` 由 API 進、`onSave` 出，本地存檔在架構上多餘。連帶 `beforeunload` 警告一併不做。
> 使用者那條抱怨（U-06）的本質是「不知道自己在看 demo」的認知落差 → 已收斂進 **52-D4（mock 標示）**。

#### 批次 1 — 立即修 ✅ 全部完成（2026-08-12 使用者驗收 ok）

> **收工小結**：四項全數 MCP 實測通過、0 console errors。實作中修正了兩處原計畫的錯誤，記在各條目內：
> ① A1「一行 `clearHistory()`」**不夠** —— 還有 debounce 中的 pending 快照會在 300ms 後補推回去；
> ② A2 的下限 0.5 px/m **訂錯層次**（拿記憶體成本當輸入驗證），使用者實測「量 147px 說是 300 公尺」被誤擋。

- [x] **52-A1 Demo 載入後 Ctrl+Z 全毀**（✅ Critical）：載入 Demo 後不做任何操作按一次 Ctrl+Z → **45 牆 + 5 AP + 4 相機全消失**，且工具列「復原」鈕此時是 **enabled**，等於介面主動邀請使用者清空全場。
  **根因**（工程師定位，非 off-by-one）：`useHistoryStore.js:245-265` 存的確實是「變化前」狀態，邏輯正確；問題是 `DemoLoader.jsx:156-157` 的 `setWalls`/`setAPs` 被 `useHistoryStore.js:268-275` 的 subscribe 捕捉，把「載入前的空樓層」推進 stack（`undoStack.length === 1`，內容 `walls:[], aps:[]`）。**漏呼叫 `clearHistory()`**（該函式已存在，`:128`）。
  **實作修法（比原計畫多一步）**：**光呼叫 `clearHistory()` 會失效** —— 它原本只清 stack，但 `_pendingRaw` 仍在 debounce 中，`DEBOUNCE_MS` 後 `commitPending()` 照樣把那筆空快照推回去，症狀完全不變。故 `clearHistory` 本身改成**同時取消 pending**（clearTimeout + cancelIdle + `_pendingRaw = null`，比照 `dropFloor:134-139` 既有寫法），再由 `DemoLoader`／`StressLoader` 於載入後呼叫。改動前全專案**無任何呼叫端**，故變更其語意零回歸風險。
  **`AIWallsModal` 刻意不加**（原計畫寫「同理檢查」，檢查結論是不該加）：AI 偵測牆是使用者主動操作，undo 應該要能還原到偵測前 —— 加了反而變成 bug。
  **不影響 redo**（`:110-123` 對稱實作正確，與使用者實測「Redo 可救回」一致）。
  **驗證**：載入 Demo 後等 1.2s（超過 debounce+idle）`undoStack === 0`、復原/重做鈕皆 disabled；Ctrl+Z 後 45 牆／5 AP／4 相機全數不動；真實編輯（addAP）→ undo → redo 仍完全正確；50 AP 壓測填充後 stack 亦為 0。
  **次症狀不修（設計取捨）**：畫 2 段牆只扣一格 stack —— `DEBOUNCE_MS = 300` + `:198` `if (!_pendingRaw)` 只保留最初那份，屬拖曳合併的**設計意圖**，對離散操作誤傷。要修需區分連續/離散來源（M），本批不做。
- [x] **52-A2 比例尺無上限 → 分頁 OOM**（✅ Critical）：量 20px 卻輸入 5000 公尺 → `scale = 0.004 px/m` → `sampleField.js` 以 `imageSize/scale` 開網格並配置**四個** Float32Array → 實測 2.94e11 格／**4385 GB** → 立即 OOM。只驗 `> 0`（`min="0.01"` 只是瀏覽器提示，Enter 路徑繞過）。
  **原計畫錯在分層，已修正（防重做）**：初版照計畫把 `setFloorScale` 夾在 **0.5–5000 px/m**，使用者立刻實測踩雷 —— 「量 147px、輸入 300 公尺」得 0.49 px/m 被誤擋，但那是**完全合法的園區平面圖**（整張圖約 2.2 km）。0.5 這個數字是從「熱圖記憶體吃不消」反推的，**拿效能成本當輸入驗證是錯的分層**：使用者輸入合不合理，與熱圖算不算得動，是兩件事。
  **正式修法＝兩層各司其職**：
  ① `useFloorStore.js` `MIN_PX_PER_M` 放寬到 **0.05**（1000px 圖 ≈ 20 km），純粹當**打錯字防呆**；`MAX_PX_PER_M 5000` 不變；非有限值/≤0 直接拒收（回傳原 state）。兩個寫入點（`ScaleDialog`、`AIWallsModal.jsx:214` AI 自動比例尺）仍都匯流此處。
  ② **`sampleField.js` 新增 `fitGridStep()`＋`MAX_GRID_CELLS = 4_000_000`**：格數超過上限就**自動放大取樣間距**（不是拒算），大場地照樣出圖只是變粗。`sampleFieldGL.js` 的 sync 與 async 兩條路徑同樣套用（import 同一個 helper，避免兩邊漂移）。`sampleField` 本來就回傳 `gridStepM`，故下游定位自動跟著走。
  **實測**：任何合法比例尺（0.05→5000）記憶體都穩定在 **~61 MB**；**1 km 以下完全不受影響**（demo 48m、200m、1000m 皆維持 0.5m 全解析度），1 km 以上平滑降解析度無斷崖（1100m→0.55m、1500m→0.75m）；原 OOM 案例被雙重擋住。
  **③ 錯誤訊息也修過一輪**（使用者第二次回報）：初版寫「比例尺 0.03 px/m 超出合理範圍（0.05–5000），請確認輸入的距離」—— **單位混用**（限制是 px/m、卻叫人確認公尺），且 5000 這個上限與使用者剛輸入的「5000 公尺」同數字純屬巧合、必然誤讀。改成用**輸入框的單位**講話並隨量測長度換算：「這個距離不合理 — 這段 241 px 最多只能是 4,820 公尺」。上下限會因 px/m 取倒數而**左右對調**，故顯示時 max 用 floor、min 用 ceil，確保講出來的數字使用者真的填得進去。
- [x] **52-A4 AP 撞名（PDF 出現兩列同名 AP-01）**（✅ Major）：Demo 已有 AP-01~05，新放的也叫 AP-01。**匯出 PDF 的 AP CABLES 表出現兩列 `Demo AP-01`**，施工人員無法分辨哪條線走哪顆 AP。
  **根因**：`useAPStore.js setAPs` **不推進 `globalAPCounter`**（只有 `addAP` 會）。Demo 用 `setAPs` 灌 5 顆 → counter 仍為 0。
  **修法**：新增 module 級 `highestAPNumber(aps)`（掃 `^AP-(\d+)$` 取最大），`setAPs` 以 `Math.max(current, highest)` 推進 counter —— **只增不減**，故對「某層只有低號 AP、他層有高號」也安全。
  **`AutoPlaceModal.apNameBase()` 保留但註解改寫**：原本是繞過此 bug 的 workaround，現改為「保險」（使用者手動改名仍可能高於 counter），不刪以免手改名情境回歸。
  **驗證**：載入 Demo 後 `globalAPCounter === 5`、`nextAPName() === 'AP-06'`，實際放一顆確實得 AP-06；50 AP 壓測填充後 counter 跳到 50、下一顆 AP-51；未命名清單／`AP-01b` 之類近似名不誤判；空陣列與 null 安全。
- [x] **52-D4 統計頁 mock 標示強度失衡**（✅ 使用者剔除 A5 後升一級）：「● 即時」綠點 11px、綠 `rgb(16,185,129)`、置於面板**頂端**；「即時聚合 — mock 資料」免責 10px、灰 `rgb(154,163,181)`、壓在面板**最底**。**聲稱即時的訊號比澄清是假資料的訊號更大更亮更靠上。**
  使用者差點截圖去跟老闆報告「有一台 AP 掛了」。QA 判定**功能邏輯正確**（`DemoLoader.jsx:104` 只有 demo AP-03 釘 `mockStatus:'offline'`，使用者自畫的 AP 一律無），純呈現誤導。
  **修法（三處齊改，缺一都還是會被誤讀）**：① 標題列加琥珀 `MOCK` 徽章（`&__mock-badge`，9px/700/`#fbbf24`，`cursor: help` + title 說明），與 ● 即時同一列 ② 「● 即時」→「**● 即時（mock）**」，讓最醒目那行自己帶上限定詞 ③ 底部說明擴充為「本頁所有數值（含告警與『規劃 VS 實測』落差）皆為示範用 mock 資料」—— 把 PM 護城河那塊 mock 對 mock 的比較也一併涵蓋。
  **驗證**：徽章與 live 文字 `getBoundingClientRect().top` 同為 75px（確認同級而非又被塞到底部）。

#### 批次 2 — 會產出「看起來很權威的錯誤數字」✅ 全部完成（2026-08-12 使用者驗收 ok）

> **收工小結**：六項全數 MCP 實測通過、0 console errors。兩處超出原計畫的發現記在條目內：
> ① B5 除了 `setWalls`，**overlay blob URL 也要擋**（敗方發布會 revoke 掉勝方的圖 → 破圖）；
> ② B4 的上限使用者實測後從 200m 收到 **20m**，且 AP 安裝高度改為**綁該樓層天花板**而非固定值。

- [x] **52-A3 相機模式假比例尺**（✅ Critical；工程師發現 → QA 實測證實）：未設 scale 時靜默套用 `40 px/m`。**同一張圖、同兩台相機，唯一差別是有無 scale**：無 scale → 涵蓋率 **96.0%**／盲區 8.8 m²／**✓ 已達標**；真實 scale 22.83 → **38.3%**／盲區 414 m²／未達標。無 scale 時**完全沒有任何提示**。
  **決定性對照**：同一張無 scale 樓層，Wi-Fi 側明確拒算「尚未設定比例尺，無法計算涵蓋率」（`buildScenario.js:163` 回 null + `heatmapAdapter` `setScaleMissing`）。**同一個 App 兩套標準。**
  根因 `coverageStats.js:23`（`fovRasterize.js:20,72`、`trackingBinder.js:40`、`mockTracks.js:150` 同樣 fallback，共 9 處）。`CameraPanel.jsx:49` 已算了 `hasScale`，統計路徑沒去用它。
  **注意**：這條與 demo 資料無關，換了真 API 資料照樣會錯，而且錯得很有說服力。
  **修法（只改「統計」不改「渲染」）**：`computeCoverageStats` 開頭 `if (!floor?.scale) return { scaleMissing: true }`，`CoveragePanel` 收到就整塊換成「尚未設定比例尺，無法計算涵蓋率」+ 操作提示（比照 `DevicePlanningPanel:142` 的既有文案）。solo 那塊也加 `!soloStats.scaleMissing` 護欄（目前 early-return 走不到，但順序若變不會印出 NaN%）。
  **`camerasLayer` / `tracksLayer` / `blindSpotLayer` 的 `FALLBACK_PX_PER_M` 刻意保留** —— 那些是**繪圖**路徑，沒有 scale 就畫不出東西；拒繪只會變成空白畫面。分界是「**會被當成數字報出去的才拒算**」。
  **驗證**：同一組相機，無 scale → `{scaleMissing:true}`（不再有 coveredPct）；有 scale 22.83 → 照常 52.6%／盲區 318 m²（確認沒有過度拒算）；UI 實測無 scale 樓層進 Camera 模式顯示拒算文案且畫面無任何百分比。
- [x] **52-B1 PDF 多樓層熱圖系統性錯層**（✅ High；工程師算術 → QA 實測證實）：`exportPlanningPdf.js:319-321` 切樓層後固定等 **220ms**，但 `heatmapAdapter.js:1082` 的 floor store 訂閱是 **400ms** debounce。220 < 400 是**算術上的必然，不是偶發競態**。
  QA 實測（真實 `capturePlanPng` + `heatmapFrameBus`）：切到 B 樓層後第 220ms，`getHeatmapFrame().floorId` **仍是前一層 A**；第一張正確 frame 要到約 **1457ms**。同時點 bake 出的 PNG：220ms = 528KB（A 的 5-AP 場）vs 正確 409KB。**交給客戶的報告第 2 頁起熱圖會是上一層的。**
  **修法**：新增 `waitForFloorRepaint(floorId)` —— 訂閱 `heatmapFrameBus`，等它發布的 frame `floorId` 等於目標樓層才繼續，之後再 settle 220ms 讓 sprite 合成完。**兩個必要的逃生口**：① 熱圖關閉時永遠不會有 frame → 直接走固定 delay ② 4s timeout，GL 卡住不能讓整個匯出吊死。
  **順手修**：整段 per-floor 迴圈包 `try/finally`，`originalFloorId` 還原移進 `finally`（原本中途拋錯會把使用者留在錯誤樓層）。
  **驗證**：獨立重現 bug——切樓層後第 220ms `getHeatmapFrame().floorId` 仍是舊樓層，正確 frame 在 **874ms** 才到；同一次切換用兩種策略各 bake 一次，固定 220ms 得 524,962 bytes、等 bus 得 600,842 bytes（**實質不同的圖**）。端到端：2 樓層 PDF 6 頁 4.8s、還原原樓層正確；熱圖關閉時 708ms 完成（沒有吃到 timeout）。
- [x] **52-B2 相機校正交叉四邊形 → 座標變 `Infinity`**（✅ Critical，工程師已實際執行驗證）：`applyHomography` 沒有 `w ≈ 0` 防護。交叉（bowtie）四邊形產生的 H **非奇異**（`solveLinear8` 的 pivot 檢查抓不到），但其「無窮遠線」正好穿過相機畫面：
  ```
  solveHomography 回傳非 null（Save 鈕可按，因為只 gate 在 !H）
  pt(300,225)  w=0.000e+0  ->  { x: Infinity, y: -Infinity }
  ```
  `CalibrationModal.jsx:27-36` 的 `quadArea` 用了 `Math.abs()`（`:35`），**正好抹掉判斷交叉所需的正負號**；`quadWarn` 只顯示文字警告、不擋存檔。污染值經 `useTrackingStore.js:58-77` 寫進 `tracksByFloor` 持久化。
  **修法（三層）**：① `applyHomography` 在 `w` 非有限或 `|w| < 1e-9` 時回 **`null`**（不是回 Infinity 讓下游猜）② `CalibrationModal` 新增 `isConvexQuad()` —— 逐角 cross product **正負號需一致**，任一反轉即為交叉；兩個 pane 都要通過，否則 `canSave=false`、儲存鈕 disabled、狀態列給明確文案（「四點順序交叉成『Z 字』…請依同一方向重點」）③ `reprojectionError` 遇到 null 直接回 `Infinity`，不把 NaN 平均成一個看似正常的數字。
  **`quadArea` 保留不動**：它負責的是「太小／太接近共線」的精度警告，與凸性是兩件事；但註解已標明它的 `Math.abs` 正是掩蓋交叉的原因，避免日後有人拿它去做凸性判斷。
  **驗證**：bowtie 的 H **仍非奇異**（證實 pivot 檢查抓不到，必須另判）；掃 441 點有 21 點落在消失線（y=150，正是交叉處）**全部回 null、零個 Infinity/NaN 逸出**；`isConvexQuad` 對順時針/逆時針皆 true、交叉/共線/凹四邊形皆 false；關鍵對照——bowtie 與正常矩形的 `Math.abs` 面積分別是 0 與 120000，**面積無法區分**（bowtie 剛好抵消為 0 是巧合，換個交叉形狀就不為 0），凸性判斷才是對的工具。
- [x] **52-B3 `Math.max(0, NaN)` 夾不住 NaN，網格資料靜默遺失**（✅ High，承 B2）：實測 `Math.max(0, NaN) === NaN`，此慣用法只擋得住有限範圍值；`grid[NaN] += 1` 在 TypedArray 上**靜默丟棄**。若是 `Infinity` 則夾到最後一格，所有軌跡堆到右下角 → 產出「看起來合理但完全錯誤」的熱圖。
  位置：`occupancyGrid.js:57-58`、`analyticsStats.js:294-295, 498-499`。**修法**：三處索引前一律 `if (!Number.isFinite(x) || !Number.isFinite(y)) continue`。
  **同時堵住上游**：`useTrackingStore.reprojectCameraTracks` 改用 `project()` helper——`applyHomography` 回 null 的樣本**直接丟棄**（不寫進 store）並統計 `dropped` 數量 `console.warn` 提示校正有問題。這樣壞座標連進 store 的機會都沒有，B3 的 gate 是第二道防線。
  **驗證**：`Math.max(0, NaN) === NaN` 確認；舊行為重現——NaN 寫入靜默消失、Infinity 堆進最後一格（`lastCellValue: 1`）；新行為——四個樣本（NaN/Infinity/-Infinity/正常）只有正常那個落格，最後一格為 0。
- [x] **52-B4 樓高/衰減 dB/AP 安裝高度缺 `max`**（✅ Major）：樓高輸入 999999 → 3D 中纜線衝出畫面、牆面與樓板嚴重 z-fighting、場景不可用；AP 屬性面板線長顯示 **1000009.06 m（約 1000 公里）**且外觀像正常估算值，**會直接寫進 BOM**。
  負值已正確擋下（min 生效），問題**只在缺 max**。對照組：AP 發射功率有正確夾值（輸 99999 → 夾成型號上限 23）。
  **`max` 屬性本身無效**：`NumberInput` 只把 `max` 傳給原生 input，**鍵入可繞過**（同 ScaleDialog 的 Enter 繞過）。一律在 handler 夾（比照 txPower 的既有寫法）。
  **上限經使用者實測後修正（防重做）**：初版訂 200m，使用者問「設 100 在 3D 看得到嗎」——追查後確認 **`floorHeight` 是樓層間距不是牆高**（牆高由每面牆自己的 `topHeight` 決定，Demo 全 3m），所以**單層改樓高 3D 幾乎沒變化是正常的**，要多樓層才看得出來。它實際餵三條下游：① 3D 堆疊 `floorStacking` ② `computeRoutes` 的 `floorHeight - ap.z` 垂降 ③ tray `ceiling` preset。因為同時是纜線垂降長度，200m 仍會產生 197m 的單條垂降進 BOM → **收到 20m**（涵蓋中庭/廠房/體育館）。
  **AP 安裝高度改綁樓層天花板**（不用固定值）：`maxMountHeight = min(該樓層 floorHeight, MAX_FLOOR_HEIGHT_M)`。AP 裝在自己樓層天花板之上本來就沒意義，而那正是荒謬垂降的來源。
  **驗證**：樓高輸 999999 → 20、100 → 20、20 → 20、3 → 3；衰減 99999 → 100；AP 高度在 3m 樓層輸 999999 → 3，把樓高改 10m 後上限自動變 10。多樓層堆疊 elevation 隨樓高正確縮放（3/10/20）。20m 兩層 3D 截圖確認畫面內、纜線正常（`.playwright-mcp/b2-floorheight-20m-3d.png`），該圖右側面板顯示 AP-01 線長 29.76m（含垂降 17.30m）——正是收緊上限的理由。
- [x] **52-B5 AI 牆偵測「取消後重跑」會復活前一次**（✅ High）：`AIWallsModal.jsx:151` 的 `run()` 內 `cancelRef.current = false` —— 「開始偵測」→「取消」→ 再「開始偵測」，第二次把 flag 設回 false，**讓仍在 await 中的第一次跑復活**，一路執行到 `:213 setWalls`（整層取代）。兩次都寫牆，後完成者覆蓋先完成者。
  另 `setGeminiPreview` 會 revoke 前一個 blob URL，敗方的 `result.overlayUrl` 指向已撤銷 URL → 破圖。
  **修法**：`cancelRef`（單一布林）→ `runIdRef`（單調遞增）。`run()` 開頭 `const runId = ++runIdRef.current`，`cancelled = () => runIdRef.current !== runId`；取消與關窗都只做 `runIdRef.current += 1`（**永不重設**，所以被放棄的 run 無法復活）。
  **計畫沒寫到、實作時補的一條**：除了 `setWalls`，**overlay blob URL 也必須擋**——`setGeminiPreview` 會 revoke 它當前持有的 URL，敗方若在此發布會**把勝方的疊圖 revoke 掉變破圖**。故在 `createObjectURL` 之前就 bail。
  **五個檢查點**：取得 jobId 後、輪詢迴圈條件、輪詢結束、**`setWalls` 之前（破壞性寫入）**、overlay/denoised 建 URL 之前、`setResult` 之前。

#### 批次 3 — 資源洩漏 ✅ 全部完成（2026-08-12 使用者驗收 ok）

> **工程師觀察（決定修復成本）**：這組有共通模式 —— **每個缺陷旁邊就有一個寫對的對照組**，是覆蓋率問題不是知識問題，照隔壁抄即可。
>
> **收工小結**：六項全數實測通過、0 console errors。兩個超出原計畫的發現記在條目內：
> ① C6 的成本模型**原稽核寫錯**（不是 cells×APs，是 cells×APs×**walls**）；② C1 的 1.4 GB VRAM 推估**未能獨立驗證**（見下方「未驗證項」）。
>
> **驗證方法論教訓（比修法本身更重要，防重蹈）**：第一輪驗證有兩個指標是**假通過**——
> ① Label3D cache 讀到 `size: 0`，是 `await import()` 拿到 HMR 後的另一個 module instance（playwright-mcp-notes §9 的坑）。
> **「我親手改名 38 次，cache 卻是 0」本身就不合理，當下就該停下追問，而不是接受這個「沒看到問題」的結果。**
> 修法：診斷 hook 一律掛 `window`（與 `__stores` 同一 instance），不要用 `await import()` 讀。
> ② Pixi `_managedTextures` 計數對「故意製造的洩漏」也不動 —— **敏感度測試失敗的指標必須丟棄**，不能因為它「看起來沒問題」就當通過。
> **通則：先證明指標會動（對已知壞情況有反應），再信它的「沒問題」。** 一個「什麼都沒發生」的結果 ≠ 一個「證明沒問題」的結果。

- [x] **52-C1 樓層底圖 texture 永不釋放**（✅ Critical）：`floorImageLayer.js:12-18, 58-66` 每次載入都 `new window.Image()` → `Texture.from(img)` 拿到全新 ImageSource（**繞過 Pixi v8 Cache**，因為 Cache 以 source 物件為 key），而 `clearSprite()` 用 `destroy({ texture: false })` 明確不刪 texture。
  **觸發**：3 層 4000×3000 平面圖來回切樓層 30 次 → **約 1.4 GB VRAM 永不回收**。
  `refOverlayLayer.js:23-29,51-55`（ALIGN_FLOOR 參考疊圖）是**同一份複製碼、同樣漏**，且每次進出對齊模式都重跑，額外還漏 `ColorMatrixFilter`（持有 GL program）。**兩處共用同一個 helper 一起修。**
  **修法**：新增 `features/floorImage/floorTextureCache.js` —— 以 **`imageUrl` 為 key** 的 module 級 cache + **引用計數**，`acquire()`/`release()` 成對；最後一個 holder 放手才 `texture.destroy(true)`。兩個 layer 共用同一份（`refOverlayLayer` 的 `loadTextureFromUrl` 整段刪除），並補 `ColorMatrixFilter.destroy()`。
  **三個容易漏的釋放點**（都已處理）：① `floorImageLayer` 快速切樓層時，輸掉 race 的那次 load 必須 `release()`（否則 cache 永遠抓著沒人畫的 texture）② `refOverlayLayer` 的 sprite 在 texture 載入完成前就被 destroy 時同理 ③ load 失敗時 cache entry 自我刪除，不留下 refs>0 的殭屍。
  **驗證（使用者在旁觀察 Performance monitor）**：兩樓層來回切 40 次 —— texture cache **全程恆為 1 筆 / refs 1**，且**跟著 active floor 換**（Demo→V2→Demo，舊碼是兩張都永久留著）。JS heap 走勢：起始 39MB → 峰值約 800MB（使用者截圖，我的取樣點只抓到 578MB）→ 靜置後 **88MB 打平**（連續五次讀數相同）。使用者截圖顯示**五個完整鋸齒週期、每個週期底線同高**、收尾一條水平直線，DOM Nodes 亦回到 500 基線。
  **WeakRef 決定性測試**：追蹤每次切換產生的 sprite —— 10 次切換留 3 個（看似可疑），但 **40 次切換只留 1 個、39 個被回收**。存活數**不隨次數成長** → 是 GC 延遲不是滯留。（`usedJSHeapSize` 只反映 V8 要了多少記憶體，無法區分垃圾與洩漏，不可單獨當判準。）
- [x] **52-C2 `Label3D` texture cache 無上限**（✅ High）：`Label3D.jsx:20-22, 60-72` module 級 `Map` 以**使用者可編輯的裝置名稱字串**為 key，永不 evict、永不 `dispose()`。每個 entry 是一張 canvas + 帶完整 mipmap 鏈、最高 3× 超取樣的 GPU texture。**在 3D 中改名時每按一個鍵就產生一個新 key**（`"AP-0"`, `"AP-01"`, …）。
  **對照組**：`SwitchLayer3D.jsx:40` 同樣模式但 key 是夾在 4–48 的 port 數（上限 45 筆）—— 寫法本身沒錯，錯在 key 的基數。
  **修法**：`LABEL_CACHE_MAX = 256` + LRU。命中時 `delete`+`set` 刷新順序（Map 保序），確保**畫面上正在用的 label 不會被一連串改名擠掉**；evict 時 `texture.dispose()`。256 足夠涵蓋 300 AP + switch + camera 同時在場。
  **驗證（讀 app 真實 instance，非 `await import()`）**：3D 中逐字打一個 52 字名稱 → cache **5 → 57**（重現洩漏行為，證明指標會動）；再連續改名 400 次 → 57→157→**256→256→256**，撞頂後打平，eviction 確實觸發。舊碼此時應為 457 且持續成長。
- [x] **52-C3 `heatmapGL` 無 context-loss 處理**（✅ Med-High）：全檔 0 個 `isContextLost` —— TDR 後 `render()` 持續對死 context 畫圖，**畫面永久空白**。另 `createHeatmapGL()` 失敗後 `gl` 沒設回 null，每次 compute 都重試建 context。
  **對照組**：`propagationGL`/`sampleFieldGL` 都有處理（`sampleFieldGL.js:42` 會 dispose + 重建）。
  順帶：`useHeatmapStore` 有 `scaleMissing`/`simplifiedLargeScene` 通知管道，卻沒有 WebGL2 不可用的管道 → 使用者只看到開關是開的但沒東西。
  **修法（三件）**：① `heatmapGL` 匯出 `isContextLost()` ② `heatmapAdapter` 新增 `dropIfContextLost()` —— 偵測到就 dispose GL 並**連帶重建 sprite/texture/maskG**（兩者都包著 `gl.canvas`，只換 GL 會留下指向死 canvas 的 sprite），`ensureSprite()` 進入時先檢查 ③ init 失敗改為 latch `glUnavailable`（原本 `gl` 留 null，每次 compute 都重試建 context）+ 新增 store 旗標與 `HeatmapControl` 提示，補齊與 `scaleMissing` 對等的通知管道。
  **語意界線**：`glUnavailable` 只代表**永久不可用**（不支援／建立被拒）；**單純 context lost 由 adapter 靜默重建**，不打擾使用者。
  **驗證**：`WEBGL_lose_context` 真的弄丟 context → `isContextLost()` false→true，其後 `dispose()` 不拋錯；`glUnavailable` 旗標存在且正常情況為 false。
- [x] **52-C4 `heatmapStack.paintGL` 洩漏整個 WebGL2 context**（✅ Med-High）：`heatmapStack.js:41-44, 162-181` 的 `paintGL` 是 module 全域的第三個 WebGL2 context，driver 的 teardown 清了 timer 和 unsubs，**就是沒呼叫 `paintGL.dispose()`**。瀏覽器有 context 數量硬上限（約 8–16），本專案已有 Pixi、three、propagationGL、heatmapGL 幾個常駐，逼近上限會讓 C3 的 context loss 更容易發生。
  **修法**：teardown 補 `paintGL.dispose()` + `paintGL = null`，並**先 `generation += 1`** —— in-flight 的 `ensureStack()` 在 `await` 後有 `isStale()` 檢查（`:124`）才輪到用 `paintGL`（`:127`），bump 後它會提前 return，不會碰到已釋放的 context。
  **驗證**：15 次 attach/detach 後，連開 6 個 canary WebGL2 context 全部成功（未耗盡配額），app renderer 仍正常。
- [x] **52-C5 圖片匯入三個缺陷擠在四行**（✅ Medium）：`useFloorImport.js:25-32` —— ① 沒有 `img.onerror`，損壞的 PNG 永遠不觸發 `onload`，「載入圖片中…」**永久卡住**且 `isLoading` 擋掉後續匯入 ② `:32` 的 object URL 純粹用來探測尺寸、從未 revoke，而 `useFloorStore.js:112` 又為同一個 File 建**第二個** URL（只有這個會在刪樓層時 revoke）→ 每次匯入固定洩漏一個 blob ③ PDF 失敗只 `console.error`，使用者零回饋（`showUiToast` 已存在但未使用）。
  **修法**：探測尺寸改成 `await` 一個帶 `onerror` 的 Promise，object URL 在 `finally` 裡 revoke；`setLoadingMsg(null)` 統一移進外層 `finally`；catch 發 `showUiToast` 並**帶檔名**（多檔拖曳時才知道是哪個壞）。
  **驗證（走真實 file input，非模擬）**：丟壞掉的 PNG → 不卡「載入圖片中…」、跳出「「corrupt-plan.png」匯入失敗：檔案可能已損毀或格式不支援」、樓層數不變；**緊接著匯入正常圖片仍成功**（1→2 樓層）——這條最關鍵，舊碼的 `isLoading` 被永久卡住後，之後任何匯入都會被擋掉。
- [x] **52-C6 規劃品質面板在主執行緒同步全樓層掃描**（✅ Medium）：`planQuality.js:75` 的 `sampleField` 是**同步**的直接跑主執行緒。`useAPStore` 每個 action 都回傳新陣列 identity，所以拖曳 AP 時 `DevicePlanningPanel.jsx:61-68` 的 effect 反覆重入，200ms debounce 只是延後而非避免凍結。**此路徑沒有走 Phase 46 建立的非同步管線。**
  **原稽核的成本模型是錯的（防重做）**：報告寫 cells×APs（估 1.48e9）。照這個實作 `MAX_SAMPLE_WORK` 後**完全沒生效** —— 實測 100×75 m 只有 7,752 格 × 300 AP = 2.3 M，遠低於任何合理預算，但耗時仍是 12.9 秒。隔離變因後真正的驅動是**牆**（每條取樣射線都要測所有牆段）：300 AP 固定下 0 牆 1,195 ms / 150 牆 3,792 ms / 300 牆 6,807 ms / 600 牆 12,945 ms，**線性於牆數**。
  **修法**：`fitQualityStep()` 以 **cells × APs × walls** 為預算（`MAX_SAMPLE_WORK = 100_000_000`，由上述實測反推），超過就把取樣間距**放粗**（cells ∝ 1/step²，故 step 乘上超額的平方根），上限 8 m。選這個槓桿是因為本面板輸出的是**涵蓋率百分比與盲區位置**，都不需要公尺級解析度；另外兩個選項更糟（搬進 worker 要移植整條 propagation；拒算等於砍功能）。
  **驗證**：100×75 m / 600 牆 **12.9 s → 0.98 s**，且 50/150/300 AP 都約 0.9 s（不再隨量成長）。**Demo 樓層完全未受影響**：6/39/247 ms 與修改前逐項相同，涵蓋率百分比亦相同（預算未觸發，維持 1 m 全解析度）。

> **批次 3 未驗證項（誠實標註，不要當成已驗證）**：
> ① **C1 的「1.4 GB VRAM」是稽核推估，我沒有獨立量到** —— 驗到的是 JS 端 sprite 可回收、cache 不累積、heap 回到基線。真正的 GPU 記憶體要用 DevTools Memory 或 `chrome://gpu` 才量得到。
> ② **C4 只證明「context 沒被吃光」（6 個 canary 都建得起來），沒有直接數 context 數量** —— 屬間接證據。
> ③ **`ColorMatrixFilter.destroy()` 沒有獨立驗證 GL program 真的釋放**。
> ④ 長時間（數十分鐘）真實操作未做，MCP 不適合。
> ⑤ CPU 曲線顯示**每次切樓層仍是重操作**（熱圖重算，規律衝到 100%）——屬 Phase 41/45/46 既有範疇，非本批造成，但確實還在。

#### 批次 4 — UX ✅ 完成（2026-08-12 使用者驗收 ok；D6/D7 未做，見末段）

> 使用者總評：「還不會用 —— 但它離『會』只差一個匯出按鈕」
>
> **三個超出原計畫的發現**（防重做）：
> ① **D5 的真因是 dead code** —— `DropZone` 元件文案本來就完全正確，但**從未被 mount**（Phase 25 移植後成孤兒），且 import 了已刪除的 `useWarmupStore`；因為沒人掛它，這個壞 import 從來沒暴露（我掛上去 dev server 直接 500 才發現）。所以「一片黑沒引導」不是沒做，是沒接上。**連帶：拖放匯入這次才第一次真的可用**（之前拖曳檔案到畫布沒有接收者）。
> ② **D2 的修法與稽核建議相反** —— 報告說「移進 worker」，但實測 `greedyChannelAssign` 300 AP 只要 **15ms**；卡的是 `setAPs` 後的同步重繪（store commit 161ms + 後續阻塞 274ms）。搬 worker 只會搬走那 15ms，凍結原封不動。
> ③ **獨立複驗才抓到的**：3D 下「匯出 PNG」是啟用的，但拿到的是 2D 平面圖（位元組數與 2D 匯出**完全相同 1,487,814**，因為 `capturePlanPng` 烘 2D 場景）。第一輪只驗「2D 下能不能匯出」，沒問「別的模式下會拿到什麼」——正是這批要消滅的那種誤導。已修成 3D 時 PNG 變灰＋「僅能在 2D 檢視下匯出」。

- [x] **52-D1 匯出功能做得很好，但藏到沒人找得到**（✅ Major，純擺放位置問題）：**兩個入口都不在 Toolbar**（已確認 `Toolbar.jsx` 無任何匯出入口），且預設狀態下**根本不在 DOM 裡**，肉眼掃描不可能找到 ——
  | 功能 | 位置 | 條件 |
  |---|---|---|
  | PNG | `SidebarLeft.jsx:427-434` 樓層列 hover → `⋯` 選單第 4 項（**緊鄰紅色「刪除樓層」**） | `disabled={!floor.imageUrl}` |
  | 7 頁 PDF 報告 | `CableSummaryPanel.jsx:550-559`，掛載於 `CanvasArea.jsx:65` | `hasFloor && !inCameraMode`；面板 `:102 useState(true)` **預設收合**，展開後還要捲過 BOM/階層/長度級距/TRAY BOM/容量規則才到底部 |
  **使用者原話**：「我完全沒有理由去點『線纜總結』找報告 —— 我要的是整份規劃，不是算線材。」
  **修法**：新增 `components/ExportMenu/`，掛在 TopBar（「API 測試」與 2D/3D 之間）。兩項各帶一行說明（PNG 顯示目前樓層名、PDF 列出內容），因為使用者連「這份 PDF 裡有什麼」都得打開才知道。**原有兩個入口刻意保留不動** —— Phase 51-B 已拍板「PDF 放 CableSummaryPanel 是唯一合理位置」，這是**新增顯眼入口**而非搬遷，已學會舊路徑的人不受影響。
  **狀態處理**：無樓層／無底圖時 PNG 變灰並說原因；**3D 時 PNG 變灰**（見上方發現 ③）；PDF 執行中按鈕顯示進度（「產生 Demo (1/2)...」）並 disabled。
  **驗證**：兩項都真的產出檔案（`floorplan-Demo-2026-08-12.png`／`floorplan-report-2026-08-12.pdf`）；PDF 執行中連按三下 + 嘗試開選單 → 按鈕 disabled、選單開不了、**只下載一次**；匯出中抽換 active floor → 完成後正確還原原樓層。
- [x] **52-D2 「📻 自動頻道」凍結畫面且零回饋**（Major）：QA 三顆按鈕對照實測 ——
  | 按鈕 | 5 AP | 300 AP | 進度條 | 進度文字 | 取消 | 主執行緒 |
  |---|---|---|---|---|---|---|
  | 📍 自動規劃 AP 放置 | 47ms | 68ms | ✅ | ✅ | ✅ 中止 | 不凍結（最大 frame gap 18ms） |
  | ⚡ 自動規劃整層 AP 功率 | 49ms | — | ✅ | ✅ | ✅ 中止 | 不凍結 |
  | **📻 自動頻道** | — | **同步阻塞 296–379ms／累計凍結 2715ms／約 5.8s 才恢復** | ❌ | ❌ | ❌ | **完全凍結** |
  根因 `DevicePlanningPanel.jsx:70-79 runAutoChannel` 同步無 worker（與 52-C6 同一個面板、互相加成）。
  **修法（與稽核建議不同，見上方發現 ②）**：不搬 worker。改為 `channelBusy` 狀態 + **雙 rAF** 讓瀏覽器真的把 busy 畫出來，再做重活；按鈕文字變「⏳ 指派頻道中（N 顆）…」並 disabled。少了雙 rAF，paint 與 commit 會落在同一幀，使用者還是什麼都看不到。
  **不要去改 AutoPlaceModal 的進度條 —— 那裡沒壞。**
  **驗證**：300 AP 下按鈕標籤觀測到 `⏳ 指派頻道中（300 顆）…` → `📻 自動頻道`，busy 狀態確實在凍結前出現。
- [x] **52-D3 術語零解釋**：RSSI/SINR/SNR/CCI 四個下拉選項**無任何 tooltip**（只有整個選單一句「最強 AP 的接收功率」）；色階只有 `≤-75 … ≥-35` 沒有「可視訊／堪用／很差」分級。使用者原話：「四個數字對我來說是天書。」
  **對照組（產品內就有正解）**：Camera 模式「52.6% 地板已涵蓋／目標 80%／未達標／盲區 318 m²」使用者**完全不用人教就看懂**；自動規劃對話框「業界慣例以 5 GHz 做覆蓋設計」是全站最好的說明文字。**把那種口氣搬到 Wi-Fi 這邊。**
  **修法**：`modes.js` 每個 mode 加 `plain`（白話名）+ `plainHelp`（這項在回答什麼）。下拉顯示 `RSSI（訊號強度）`、每個 option 帶 `title`、select 本身與 hover 讀值四列也都帶說明。**acronym 保留為主標籤**（業界與其他工具都這麼叫），白話名並列而非取代。
  **色階分級只給 RSSI**：`RSSI_BANDS` 用慣用規劃門檻（-75 / -67 / -55；-67 就是本專案既有的涵蓋目標預設）。**SINR/SNR/CCI 刻意不做** —— 沒有公認的白話對應，自己編會比不寫更糟。
  **驗證**：hover 到 -69 dBm 直接顯示「-69 dBm — 訊號差」；切到 SINR/SNR/CCI 分級正確消失；無 hover 時顯示「差 ／ -67 起堪用 ／ 可視訊」當圖例。
- [x] **52-D5 空狀態零引導 + 前置條件不足時零回饋**（Major）：① 打開一片黑，沒有一句話說「第一步請先匯入平面圖」，使用者**從頭到尾沒找到匯入按鈕在哪** ② 未載入樓層時點「無線 AP」再點畫布 **完全無反應無提示**，使用者以為程式壞了連點好幾下 —— 而旁邊的 50/150/300 AP 按鈕**卻懂得變灰**，同一排標準不一。
  **修法**：① `CanvasArea` 在 `!hasFloor && !is3D` 時掛 `DropZone`（見上方發現 ①：元件與文案本來就在，只是沒被 mount；順手移除它對已刪除 `useWarmupStore` 的 import）② `Toolbar` 新增 `MODES_NEEDING_FLOOR` —— 無樓層時這些工具**變灰 + title「需先匯入平面圖」**，並在 `handleItemClick` 補 toast 當後備（disabled 按鈕不觸發 onClick，兩者互補）。指標類（選取/框選/平移）不設限，空畫布上無害。
  **邊界（實測確認正確）**：有比例尺但**無底圖**的樓層 → 工具**保持啟用**（那仍是合法畫布）、DropZone 正確隱藏。
  **驗證**：空畫布顯示虛線框與三行文案；此時 AP 工具四項全灰且帶提示；**真實拖放 PNG 到畫布成功（0→1 樓層）含拖曳中視覺回饋** —— 這條路徑在本批之前完全沒有接收者；DropZone 不遮工具列與「載入 Demo」（`elementFromPoint` 實測）。
> **52-D6 / 52-D7 已撤回**（2026-08-12 使用者決定不做）—— 詳見本檔「已撤回的決策」表。
- [ ] **52-D8 多樓層 React `unique key` warning ×2**（Minor）—— **無法重現，刻意未改**：`SidebarLeft.jsx:49:18` 與 `Viewer3D.jsx:286:23`（`FloorStack`）**兩處都已有正確的 `key={floor.id}`**（前者用 `React.Fragment key`）。實測 2 樓層／3 樓層／reorder／刪除／進出 3D，攔截 `console.error` **零 key warning**。可能是稽核當時的舊版本，或 React 每個元件只警告一次而當時已被觸發過。
  **不為了勾掉一條而亂改沒壞的程式碼**；若日後真的看到，請附重現步驟再處理。
- [x] **52-D9 小瑕疵集合**（各 S，可一起做）：① AP 名稱可存純空白 `"   "` → 畫布標籤與屬性面板標題列變空白、報告中無法識別 ② **AP 編號跳號**（套用自動規劃後 AP-01,02,05...12 共 10 顆；成因是 fresh 模式移除同頻段 AP-03/04 後新號從 06 續編，`AutoPlaceModal.jsx:196` 先算 `base` 但 `:201` 逐顆 `addAP` 又各自推進 counter；資料無誤純觀感/可追溯性，真正該做的是套用前講清楚「將移除 2 顆」）③ 刪除相機後 `liveViewCameraId` 未清（UI 無可見故障，狀態衛生）④ **STATS 模式熱圖圖例與開關仍顯示啟用但畫面無熱圖**（`heatmap.enabled === true` 卻被 `layerVisibilityBinder` 抑制，控制項與畫面不一致）⑤ 最小縮放（scale 0.05）時底圖與熱圖**完全沒畫出來**，只剩 5 個原尺寸 AP 標籤重疊成不可讀黑塊 ⑥ 範例圖是住家（bed 2/double garage/patio）不是辦公室 ⑦ 深色主題無淺色/列印模式（截圖貼進白底 Word 突兀、印出來整頁黑）。
  **本批完成 ①③④**：① AP 名稱全空白時**失焦還原**成下一個編號（不擋輸入，清空重打仍可用）③ `removeCamera` 連帶清 `liveViewCameraId` ④ `CanvasArea` 在 STATS 也隱藏 `HeatmapControl`（原本只擋 CAMERA，所以 STATS 出現「開關說開著、畫面卻沒圖」）。
  **②⑤⑥⑦ 未做**：② 編號跳號資料無誤、真正該做的是套用前講清楚「將移除 N 顆」（屬 AutoPlaceModal 文案）⑤ 最小縮放退化 ⑥ 換辦公室範例圖（需素材）⑦ 淺色/列印模式（整站主題工程，範圍遠大於本批）。
  **驗證注意**：AP 名稱那條**必須用真實 focus/blur 測**。合成 `new Event('blur')` 不會觸發 React（它委派 `focusout`），我一度以為修法失效，實際用 Playwright 真輸入 + 真點擊他處即正確還原成 `AP-06`。
> **批次 4 剩下的**：**52-D6 / 52-D7 已撤回**（使用者決定不做，見「已撤回的決策」表）。
> **52-D9 的 ②⑤⑥⑦** 與 **52-D8**（無法重現）見各條說明。

- [ ] **52-E8 選取狀態跨樓層殘留**（降級為狀態衛生，QA 實測後**不急**）：切樓層/刪樓層後 `selectedId`/`selectedType` 不清（仍指向前一層的 AP）。
  **工程師原推論「會顯示幽靈面板或綁錯物件」經 QA 實測不成立** —— ID 全域唯一，`PanelRight` 用 `activeFloorId` 查不到就 render null，右側面板是空白；「此類型的屬性面板即將推出」需要 `selectedType` 無對應路由才會出現（注入 `'gateway'` 才觸發），正常切樓層走不到。
  **修法（順手做）**：`FloorplanSystem.jsx:890-899` 已有追蹤 `prevFid` 的樓層切換 subscriber（目前只清 scale draft），加一行 `clearSelected()`；`confirmRemove`（`SidebarLeft.jsx:219-243`，已清 7 個 store + history）補同一行。

#### 已查核並確認乾淨（負面結果，避免重工）

- **Zustand getter 訂閱：零違規**。`getWalls`/`getAPs` 等 getter 存在於 store 但**無人訂閱**，CLAUDE.md 規則被確實遵守。無跨 store 循環相依、無 self-feedback set。
- **JS ↔ shader 物理一致性**：逐條比對 `pathLossDb`(27.55/dEff 0.5)、`indoorLossPerM`、`SLAB_SEC_CAP 3.5`、`sec` 0.2 夾取、`SQRT2` 激發、0.05/0.02 剔除門檻、`1e-30` **全部鏡像且有註解標明**。shader 的 `NMAX=40` 與 JS `ceil(160/4)=40` 恰好相等（最大頻寬 160 MHz），無分歧。
- 零長度牆、`log10(0)`、0 顆 AP、flood fill（顯式 stack 並在 push 時標記）、`contour` 迴圈上限、worker 生命週期、`localStorage`/`JSON.parse`（**全專案零使用**）、24 個 Pixi layer 的 Graphics 重用、`heatmapAdapter`/`propagationGL` 的 dispose、viewer3d 各層 geometry/material dispose、rAF/timer/DOM listener 清理 —— **皆正確**。
- QA 已驗證正常：畫牆多點連續繪製、Esc 清 draft、連續 12 次極速點擊放 AP 無掉點無重複 id、輸入框聚焦時 Delete 被正確攔截、Redo 每次都能完整還原、**未設比例尺時 Wi-Fi 側正確拒算並給 CTA**、AP 發射功率正確夾值、縮放 clamp（max 40／min 0.05 無溢位）、36 次極速切換 9 種模式 0 error、PNG/PDF 匯出內容與 App 內數字**逐項相符**（84.3%／39.8%／15.7%／112m²；線長 71.3m 加總正確）。

#### 交叉對質逆轉（單一角色測不出來的，記錄方法論）

| # | 初判 | 逆轉後 | 意義 |
|---|---|---|---|
| 1 | User：「完全找不到匯出，沒東西能給老闆」 | QA 拿出實體 7 頁 PDF + PNG → User 二次確認後**收回**，改為「藏太深」 | 成本從「開發新功能」降到「搬個按鈕」（52-D1） |
| 2 | User：「自動規劃卡 33 秒無回饋」 | 工程師讀碼證明該顆有 worker+進度條+取消 → QA 實測 47ms；**真兇是隔壁的📻自動頻道**（5.8s 全凍結） | **若只信使用者，會去修沒壞的那顆**（52-D2） |
| 3 | 工程師靜態稽核**完全漏掉** Undo 全毀 | QA 與 User 各自獨立踩到；但根因（`DemoLoader` 漏一行 `clearHistory()`）只有讀碼定位得出來 | 兩種方法互補，缺一不可（52-A1） |
| 4 | 工程師：E-08 選取殘留會綁錯物件（High） | QA 實測 ID 全域唯一、面板 render null，實際使用者不可見 → **降級** | 避免一次過度修復（52-E8） |

> **誠實標註**：QA 未複現到 33 秒（最重壓測 5.8s），可能是使用者機器較慢或連按多次 —— **兇手可定案，數字不可**。
> **未測到區域**：檔案匯入全鏈（無合法平面圖檔）、AI 牆偵測（會打外部真實 API）、多樓層真實情境（需兩張真實底圖）、拖曳物件到畫布外、貼上多行文字。

---

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
| 34    | **Camera 模式完整落地**（34-0~34-5，2026-06-11 驗收）：CAMERA mode（畫布只剩底圖+牆）+ camera 放置/拖曳/旋轉 + FOV visibility polygon（牆遮擋、玻璃/窗穿透、門擋視線；人移動相反：玻璃擋人、門可走）+ mock 一天軌跡（seedable、避牆、雙峰）+ 偵測語意 live icons（FOV 內實色/外灰 ghost、車=俯視車形朝行進方向）+ 人流熱圖（人流量/停留/動線三檔+時段篩選）+ 盲區圖 + 計數線（分方向、端點可拖、右鍵/Esc 取消）+ 分析區域（全區選取可拖、逐時長條圖）+ 回放 timeline（scrubber/倍速/日循環）。畫布標籤白字+深色描邊適應任意底圖。設計共識與驗收細節：memory `project_camera_mode_phase34`。新增 stores：useCameraStore/useTrackingStore；新增 scene layers：cameraFov/cameras |
| 35    | **相機 4 點校正 + 導覽 polish**（2026-06-29 驗收 ok）：① 4+4 點校正 modal（平面圖 4 點 + mock 相機畫面 4 點 → 前端真求 frame→floor homography，`utils/homography.js` solveHomography/invertHomography）② 品質防呆：四邊形過小/共線即時橘色警告（**不顯示重投影誤差**——4 對點恰定恆為 0 是假精度）；步驟提示跟著 active pane（① 在平面圖上方、② 在相機畫面上方）③ **階段 2 真投影**：軌跡綁定相機 FOV（projectTracks）+ 經 homography 投影；**first-freeze 模型**（首次校正不位移、重校才位移；baseSamples 不可變、frameSamples 凍結），消費者（熱圖/計數線/趨勢/3D）零改動 ④ **純手動校正**（對標 Verkada，無 auto 預設——曾做 auto 但「畫面四角↔地面正方形」非真實光學投影，撤除）；未校正→軌跡用平面座標顯示（demo 不空），已校正綠徽記、未校正提示 ⑤ Device List hover：清單↔marker 雙向高亮 + mock CCTV live 縮圖 ⑥ 占用趨勢點長條跳時間 ⑦ 回放時鐘到秒 HH:MM:SS ⑧ 重構：抽共用 FOV rasteriser + wrapAzimuth 抽 utils/angle。新增：homography/frameConstants/projectTracks、useTrackingStore.reprojectCameraTracks、CalibrationModal、utils/angle。決策與驗證細節：`.claude/verkada-notes.md` §L4/§L5。**未來 live 版**接真實相機主機後校正才對位真實偵測，現 plan/mock 版校正驗證數學正確性 |
| 34-V  | **Verkada parity 擴充**（2026-06，branch `feat/verkada-parity`，對標 Verkada 平面圖 camera 功能，調研+差距表見 `.claude/verkada-notes.md`）：① 熱圖 timelapse 時間推移（占用窗沿日滑動，按鈕自動縮窗）② FOV 偵測脈動 + 由內而外水波擴散環（牆裁切）③ 裝置線上/離線狀態（綠/橘點、離線錐暗+不偵測+計盲區；`deviceStatus.js`：undefined=online，僅 status==='offline' 才離線）④ 占用趨勢面板（逐時長條、可拖、左下）⑤ 即時影像 mock popover（canvas CCTV 畫面、離線雪花）⑥ 覆蓋率報表（涵蓋%/盲區/重疊備援/平均重疊；目標門檻 pass/fail；最大盲區定位=移畫面+開盲區遮罩+脈動環，遮罩 4.5s 自動恢復；單台相機 solo 貢獻）⑦ 重疊覆蓋 overlay（黃=1台/藍綠=≥2台）⑧ 型號預設（dome/bullet/turret/wide/fisheye）⑨ 相機清單面板（多選批次改型號/狀態/刪除、區域分組、可收合、點列定位）⑩ 複製相機 ⑪ 高度快設 ⑫ 方位角 ±15°/對準中心。新增：deviceStatus/detectionBus/coverageStats/overlapLayer/gapMarkerBus/gapMarkerLayer/exportless、cameraModels 常數、CoveragePanel/TrendPanel/CameraListPanel/LiveViewModal。**已撤回**：門禁/環境感測器多裝置（偏離 camera 主線，整包丟棄）、CSV 匯出（使用者喊停）。Code review（2026-06）：無 bug，僅可選重構（3 rasterizer 重複/wrapAzimuth 重複）未做 |
| 36    | **Verkada Tier 1&2 擴充**（2026-06-29 驗收 ok，effort=ultracode+workflows，roadmap 見 `.claude/verkada-notes.md` Tier 1/2）：① 抽共用 `features/cameras/mockCctv.js drawCctvFrame`（合併 LiveViewModal/HoverThumb/CalibrationModal 三處重複 mock CCTV 畫格；加 `renderMode:'mock'\|'stream'` seam 留給未來真實串流，touch 只一檔）② 統一 hover store（cameras 從 `useCameraStore.hoverCameraId` 遷到 `useHoverStore` type:'camera'，刪舊欄；camerasLayer + CameraListPanel 同步）③ 全樓層占用趨勢報表（Tier2 #4）：`generateWeekTracks` 生 7 日 mock（seed-per-day，每天 distinct 數不同；track 帶 `day` 欄）+ `analyticsStats.computeDayRollup`（day-level Set 去重）+ TrendPanel 逐時/逐日切換 + 人數/人·秒/車數 metric 切換（**CSV 匯出曾加後移除——尊重 34-V「CSV 撤回」決策，2026-06-29 使用者確認**）；day-0 消費者（熱圖/計數/3D/校正）零改動，週資料只在面板內 memoize 不入 store ④ Device List 側欄（Tier 1 #3b，**只列攝影機對標 Verkada**——「AP+camera 統一」原為自編延伸、Verkada Device List 無 WiFi AP，已捨棄）：CameraListPanel 從 CAMERA 模式 floating 浮窗升級成 **docked 常駐左欄**（掛 App.jsx，SidebarLeft↔CanvasArea 間，預設顯示、寬 260；多選/批次/分組/雙向 hover/縮圖全保留；切走自動回收空間）⑤ 清單列 📹 鈕（Tier2 #6）直接 openLiveView，stopPropagation 不誤觸選取。**排除**：多裝置型別（門禁/環境感測器，尊重 34-V 撤回）。新增：mockCctv.js、$device-list-width；MCP 驗證 0 console errors。設計共識與取捨：memory `project_tier1_2_devicelist_plan` |
| 37    | **Camera 右鍵選單 + 3D camera 三圖 + 3D 唯一光源光影**（2026-06-29 MCP 自測 ok，effort=ultracode+workflows）：① **Camera 右鍵 context menu**（對標 AP）：camerasLayer container pointerdown button=2 → openContextMenu({targetType:'camera'})（armed draw tool 時跳過讓 analyticsLayer draw-cancel 仍生效）；ContextMenuMount 加 camera 分支 `buildCameraItems`；選單 6 項：重新命名/選取/⧉複製相機/📹即時影像/🎯校正熱圖/刪除。**需在 modeCapabilities.js CAMERA_CAP 加 allowContextMenu:true**（emptyCap 預設 false，否則整個選單不渲染）。複製相機無 store action，inline 複製 CameraPanel.handleDuplicate 邏輯（generateId('cam')+strip id/name+nextCameraName+x/y+24）。② **3D 顯示 camera 三分析圖**（盲區/重疊/占用）：新建 `features/viewer3d/CameraOverlay3D.jsx`（BlindSpot/Overlap/Occupancy 三 sub-plane），仿 HeatmapPlane3D（offscreen canvas→CanvasTexture→floor-aligned plane），**重用 2D rasteriser**（`fovRasterize.rasterizeCoverageCounts` 供盲區/重疊、`occupancyGrid.computeOccupancyGrid/renderOccupancyCanvas` 供占用）使 3D 與 2D 像素一致；**跟隨 2D store 開關**（showBlindSpots/showOverlap/occupancyMode）+ CAMERA mode + active floor gate；各 plane 不同 y-lift（occupancy 0.03/overlap 0.04/blind 0.05）避免 z-fight；texture 在 unmount/off 釋放。③ **3D 唯一光源 + 明顯光影**（不分 mode）：Canvas 開 `shadows`（PCFSoft）；`KeyLight` 元件（directionalLight castShadow、跟樓層 center、intensity 1.1、shadow-mapSize 2048、frustum ±80m、shadow-bias -0.0005）；ambientLight 弱化 0.6→0.28 + hemisphereLight 0.25 微弱補光。**注意**：frustum 固定 ±80m，超大樓層或遠離 active center 的堆疊樓層陰影會裁切（已知設計取捨）。新增：CameraOverlay3D.jsx。④ **3D 動線（flow）立體箭頭**（37b，2026-06-30）：occupancy flow 模式在 CameraOverlay3D 加 `FlowArrows3D`——**單一 THREE.InstancedMesh** cyan(#06b6d4) cone，instanceCount=可見格數（frac≥0.04，cap 4000），matrix 在 useMemo/useEffect off-frame 算（非每幀）；重用 `computeFlowGrid`（vx/vy 現成不重算）；px→world 對齊 HeatmapPlane3D（floor 旋 -PI/2，cell 中心→world，Y=0.06 疊在熱圖 plane 上方）；cone 朝 (vx,0,vy) 方向。實測 demo 580 箭頭、效能無虞。⑤ **全物件參與陰影**（37b）：Switch(pole+body)/Tray body/Riser body/Track 人車 7 mesh +castShadow；AP/Camera body/門 leaf +receiveShadow；門框+窗框+sill +cast/receive（共 22 flag）。**跳過**（three.js 無法投影）：line（纜線/tray 邊框/中線）、sprite（AP label）、meshBasicMaterial（FOV 體/riser wireframe）、meshPhysicalMaterial 玻璃。MCP 自測：右鍵 6 項+複製/live 有效、3D 三圖各自可見、3D 動線箭頭指向正確、全物件陰影明顯、0 console errors ⑥ **3D 控制面板整理**（37c，2026-06-30）：移除 Log Camera（debug-only，連 handler 一起刪）；新增「🔄 自動旋轉」toggle 鈕（沿用既有 OrbitControls autoRotate idle spin 機制，速度 0.6；CameraRig 暴露 `setAutoRotate`，使用者拖曳時 OrbitControls `start` 事件經 `onAutoRotateStop` 回呼把按鈕 state 同步關閉）；右上角 `viewer3d__panel` 從「透明容器散落按鈕」改成**統一深色玻璃面板**（dark-glass 外框+邊框+圓角，對齊 CoveragePanel/TrendPanel）+ 標題「3D 視圖」+ 可收合 caret（收合只剩標題列）。MCP 自測：Log Camera 已無、自動旋轉前後截圖視角確實轉動、面板有外框+收合正常、0 console errors |

| 38    | **熱圖綁定 FOV + 未放置裝置清單 + 3D 動線流線化**（2026-07-02 使用者驗收 ok）：① **占用/動線熱圖裁切到相機 FOV 覆蓋區**（Verkada §J3「熱圖只渲染在 FOV 內」）：共用 `fovRasterize.buildFovMaskGrid`（online-only、牆裁切、對齊各 grid 自己的 cols/rows/cellPx）；`computeOccupancyGrid`/`computeFlowGrid` 接 `maskFn`（caller 建遮罩、grid 內套用保證對齊）；streamline 積分在遮罩邊界截斷（bilinear 會漏過邊界 1-2 格）；`useCameraStore.clipHeatmapToFov` toggle「FOV 內」預設開（熱圖控制列，推移鈕右邊）；2D/3D 共用同一 maskFn 像素一致。② **未放置裝置清單**（Verkada Add Cameras）：`unplacedCameras` org-level pool（非 per-floor）+ `addUnplacedCamera`（進 pool 就取號，計數器連號）/`placeCamera`（放樓層中心）/`removeUnplacedCamera`；CameraListPanel 加搜尋框（同時過濾已放置+未放置）+「尚未放置」區段（琥珀虛線圈、＋放置鈕）；demo 種 2 台未放置。③ **3D 動線改流線平面**：`FlowArrows3D`（InstancedMesh 圓錐）→ `FlowPlane3D` — octant-bins commit `8c39e49` 後 flow.cells 變每 bin 一筆（一格最多 8 筆），圓錐版同點疊 8 支變糊（回歸）；新版用 2D 同一份 `computeFlowGrid(cellM 1.5)+computeStreamlines` 畫到 offscreen canvas（×2 supersample cap 2048）貼地面 plane（Y_FLOW 0.06），`useFrame` 30fps 重繪爬行動畫（frameloop 可見時 always）。④ **流線配色**（2D/3D 同步）：通道 cyan→**fuchsia 0xe879f9**（跳出 FOV 青綠/藍車色系）；箭頭=**黑色 stroked「>>」**（兩個相連 > 線條，非實心飛鏢），尺寸/線寬低於通道一階當方向記號。**中途撤回**：3D「主導 bin 圓錐」方案（仍是立體物、斜看變噪點，直接對齊 2D 流線） |

| 40    | **天線俯仰角 tilt**（2026-07-03，commit e6f4ec1；azimuth + tilt 兩自由度，no roll）：① AP 加 `tiltDeg`（-90~+90，+為上仰，預設 0；directional/custom 適用，omni 不變）② **雙引擎同步**：propagation.js apGainDbi 垂直偏角 =（rx/AP 高度差 ÷ 水平距離的仰角）− tilt，gain = Gh + Gv；custom 的 Gv 用同組水平樣本近似、directional 兩平面同錐 taper；propagationGL per-AP uniform `uAntTiltDeg` + aggregated AP texture t3.y 打包 tilt，apGainAt 鏡射 JS 公式；sampleFieldGL grid cache 簽名含 tiltDeg ③ APPanel 俯仰角欄位與方位角並排；PatternPreview3D 上下拖曳改為調 tilt（放開才 commit，Shift+拖曳保留觀察視角）④ APLayer3D custom lobe 把 tilt 烘進幾何、directional cone 內層 group 旋轉俯仰；FormulaNote §7 補垂直增益公式。**當時未納入**：AP `mountType`（ceiling/wall）與 tilt 預設值互動、legacy（tilt 前語意）對照開關 |
| 41    | **熱圖無感重算**（2026-07-03 使用者驗收 ok）：① **二段渲染**——idle 重算先粗場（≥1.0m、關 refl/diff → aggregated）秒級上畫，細場（使用者品質）背景算完無縫換底；drag solo/live 路徑不動 ② **Hamina 式波紋過渡**——新場**立即全尺寸上畫**（移動 AP：舊 blob 立刻消失、新等高線直接最終大小），疊加漂移 value-noise 擾動（`WOBBLE_AMP_DB 1.6`／`LAMBDA 2m`（使用者調校）／`DECAY 900ms`／hold cap 4s，旋鈕在 heatmapAdapter.js）至細場落地後收斂；**撤回**第一版舊場→新場 dBm 內插（舊 blob 內縮/新 blob 從中心長大，觀感錯誤）③ **41-5 非同步 readback**：PBO+fence（不再 sync readPixels stall）+ per-AP 分批送件 `SUBMIT_BATCH=4`（防 GPU command-buffer 反壓，300 AP 曾一個 13s task）+ aggregated 主 pass scissor 分帶 `ceil(apCount/24)`（拆 2.4s 不可搶佔 GPU atom）+ `sampleFieldGLAsync` mutex 序列化（2D/3D 共用 instance）+ generation counter 丟過期結果；3D HeatmapPlane3D 跟進 async ④ 41-6 CPU 聚合切片 ~5ms/塊 ⑤ fingerprint-skip（`lastIdleInputs`）回歸 idle 路徑 ⑥ **solo 放開交棒**：畫面完全不動直到粗場換底（撤回「快照拉回全亮」——舊位置閃回/新位置消失）⑦ isSoftwareRender 關動畫直接跳變。**驗證**：sync/async 引擎 4 field bitwise 一致；5 AP 移動 0 long task；300 AP 冷啟 13s→250ms，殘餘 ~1.9s 經關熱圖對照證實為 apsLayer/3D/routing 既有成本（效能家族範疇，扳機 >500AP）。Worker 方案確認不做，殘餘卡頓再重啟。**41-postfix（2026-07-03 使用者回報 300 AP 放開仍先卡再動畫）**：profiler 歸因出兩個非熱圖元兇 + 一個 41-5 回歸 bug——① `CableLayer3D` 每次 AP 變動全量重算 routes 且 pts3 全新 ref → ~2000 段 line geometry 重建（主因）→ `PolylineTube` 改**值比較 memo**（座標沒變不重建）② `APLayer3D` APMarker 無 memo → 300 marker 全重 render → `React.memo`（updateAP per-item immutable 保證 ref 穩定）③ **syncEpoch guard**：solo 拖曳的 sync 計算會大量淘汰 losCache/apGeoCache（deleteTexture），in-flight 的 3D async job（其 cancelled flag 不知 2D 在拖）batch 醒來 bind 已刪 texture（INVALID_OPERATION + 汙染 grid cache）→ sync `sampleFieldGL` 入口 bump epoch，所有 in-flight async 在下個 await 檢查點作廢。實測 300 AP 放開 max long task **2995ms → 258ms**、GL 警告 97→0；3D 反應性驗證無回歸（纜線重佈/熱圖更新正常） |
| 39    | **UIUX 規範落地**（2026-07-02 驗收 ok，規範+實作狀態見 `.claude/ui-spec.md`）：① z-index token 化（8 階，`_variables.sass`，禁裸數字）② 四角 stack container（CanvasArea `__overlay--tl/--bl`，面板入堆疊不再寫死座標——A2/A3/A4/A5 消失）③ 右側避讓 `--right-dock` CSS 變數（PanelRight 開啟時 3D 面板/ClientPanel/ScaleBar 平移讓位——修 A1「3D 選物遮右上面板」）④ 全域 UiToast + 刪除策略統一（單刪即刪+undo toast、批次>1 ConfirmDialog，四個刪除入口全覆蓋）⑤ 模式切換一次性說明 toast（CAMERA/CLIENT_VIEW）+ 3D「唯讀」徽記 ⑥ 收合符號統一 SVG chevron、熱圖鈕固定標籤、✕ 關閉配對提示、hint 常駐（Toolbar z 提到 badge 之上蓋過）⑦ ALIGN Esc=完成、F2 改名實作、keyboard guard 補 SELECT/contentEditable（`utils/isTypingTarget`）、alert→toast、內部用語清除、樓層 grip ⠿、`.camera-list` 浮動死碼刪除 ⑧ **dev widget（Demo/Stress/Progress）移至 SidebarLeft 最下方**（使用者指示：不入畫布 overlay，正式版整塊移除）。發現免修：3D 選取 highlight 與切模式清 selection 本already存在。MCP 驗證 0 console errors，截圖 `.playwright-mcp/ui-01~06` |
| 42    | **統計階段 1：Plan 規劃品質面板（A 域）**（2026-07-06 使用者驗收 ok，設計共識見 `.claude/stats-mode-spec.md` + memory `project_stats_spec_two_mode`）：三角審查（QA/User/PM）定案「統計不新增第三 mode」——A 規劃品質併進既有 `DevicePlanningPanel`（Plan/非 camera 模式顯示），B/C 之後進 Live。① 新 `features/heatmap/planQuality.js`：`computePlanQualityStats`（`buildScenario`+JS `sampleField` gridStep 1.0m、refl/diff off，掃 RSSI grid 依門檻算涵蓋率/盲區/盲區面積 m²/最大盲區 image-px 定位，分母=非 NaN in-scope 格）+ `detectChannelConflicts`（同 band+同 channel+距離<300px、去重每對一筆）② `DevicePlanningPanel` 加「規劃品質」section：涵蓋率 hero + 進度條（綠填/紅底盲區/白目標標記）+ 目標門檻可調（預設 90%）+ 達標紅綠燈 verdict + 盲區/頻道衝突/訊號門檻(-67 可調 -85~-55) rows + ◎ 定位最大盲區（viewport 置中，用 `getSceneRefs().app.canvas` rect）；debounce 200ms 且僅展開時算；門檻/目標為面板本地 state（不共用 clientView 語意）③ sass 配色對齊 CoveragePanel（綠 #10b981/橘 #f59e0b）。**MCP 驗證**（demo 5AP/45 牆/scale 22.83）：涵蓋率 89.1%/盲區 10.9%·81m² 面積自洽、compute 9ms、衝突偵測正負向皆正確（同頻近距報 1 對、遠距不誤報）、定位盲區 viewport 移動、0 console errors，截圖 `stats-a-plan-quality.png`。**未做**：B/C（Live 聚合/趨勢，階段 2/3）、PM 差異化 backlog（規劃 vs 實測空間疊合） |
| 43    | **統計階段 2+3：STATS 獨立模式（B 域聚合 dashboard + C 域趨勢/timelapse）**（2026-07-08 使用者驗收 ok）：**定位修正**——原 spec 說「B/C 進 Live」，但專案無 Live editorMode，經使用者拍板改為**新增 `EDITOR_MODE.STATS` 獨立唯讀模式**（memory `project_stats_spec_two_mode` 的「乾淨兩態」在無 Live mode 下具體化為此）。**資料地基**：`features/stats/statsSource.js`——`deriveTopology`（單一真相：seed 撒 client（AP-centric 高斯散佈，**不依賴 scope**，避免污染規劃熱圖）→ `buildCandidates` 真算每 client 連哪台 AP+RSSI+band；AP↔switch 用 `getCachedRoutes`；LLDP port groupBy 編號；`occupancyFactor(ts)` 日夜曲線；AP 可帶 `mockStatus:'offline'` 釘死狀態，否則 seed ~90% online）+ `getSnapshot(building,floorId,{ts})`（spec §1.2 shape，INV-1~10 自洽 by construction）+ `getTimeSeries`（掃 range 每 bucket 一次 getSnapshot 取值，實測 24 點 44ms，與 scrubber 停駐點同函式零漂移）。**共用 seed**：`utils/seededRng.js`（mulberry32+hashStringToSeed，抽共用不動 camera 版）。**時間源**：`store/useStatsTimeStore.js`（anchorTs 即時邊緣/playheadTs 顯示時刻/playing/speed，dashboard+overlay 共訂閱，比照 useTrackingStore 模式；epoch ms 非日內秒）。**UI**：① `components/StatsDashboard.jsx`（右側 dark-glass docked 面板）：KPI tiles + 連線裝置趨勢 24h 長條圖 + scrubber（▶播放/range 拖桿/×1×60×300；togglePlaying 從 live edge 按▶會倒帶到窗口起點避免瞬間 goLive；rAF 播放 dt clamp 0.25s；即時徽記+回即時鈕）+ 告警清單 + AP 負載排行 + Switch PoE/LLDP 鄰居 + 頻段分布 + client MAC 下鑽；點列跳定位（setActiveFloor+setSelected）；hover 列→useHoverStore→圖上脈動環 ② `features/stats/statsOverlayLayer.js`（overlays layer）：**AP 負載 badge**（對標 Meraki/Aruba：數字 pill+狀態色綠<15/黃<25/紅≥25，Text pool 固定螢幕大小；**撤回**初版「負載光暈圈」——使用者指出圓圈=涵蓋範圍既有語意會誤讀）+ **離線 AP 灰「離線」badge+灰環**（不只少數字）+ hover 白青脈動環；讀 useStatsTimeStore.playheadTs（timelapse 拖動整個 dashboard+光暈跟著變）③ `EDITOR_MODE.STATS` + `STATS_CAP`（唯讀，keepLayers floorImage/devicesAP/devicesSW/walls）④ Toolbar：STATS 與 camera 並排最前的 direct 頂層鈕（divider 移到 statistics 後），Icon 加 `stats` 長條圖 ⑤ **STATS 隱藏 RSSI 熱圖**（`layerVisibilityBinder` heatmap `!inCamera && !inStats`，統計光暈才不被彩色場干擾）。**DemoLoader**：AP-03 釘 `mockStatus:'offline'`、加第 2 台 idf switch（拓樸有料）；**移除**曾補種的 3 scope（會把規劃熱圖限制在 scope 內——回歸，已改 AP-centric 撒點）。**MCP 驗證**：INV-1~10 全通過、日夜曲線（夜4/尖峰54/午休14/週日18）、可重現 deep-equal、掃24點44ms、timelapse 拖4am→KPI 37→6 同步、跨時間不變式零漂移、離線 AP-03 四處一致（圖/告警/KPI/排行）、切模式生命週期無 crash、0 console errors。**注意**：播放連續滾動因 MCP headless rAF 降頻無法自動驗，倒帶+時間前進已證實，需前景實測。**未做**：PM backlog（規劃 vs 實測空間疊合）、A/B plan diff、漫遊重疊區 |
| 44    | **規劃 vs 實測空間疊合（PM 護城河）**（2026-07-08 使用者驗收 ok）：STATS 內標出「規劃說 ≥門檻（該有訊號）但實測 client RSSI <門檻（實際差）」的落差點——平面圖工具獨有、dashboard 給不了的空間洞察。① `statsSource.js`：client 同時帶 `theoreticalRssiDbm`（傳播模型算）+ `rssiDbm`（實測=理論−環境劣化）；`measuredDegradationDb`（依 3m 網格 seeded、~38% 問題格重劣化 22–40dB 模擬死角，其餘 1–4dB）——比例調高確保白天穩定有落差（實測 9/24 小時有、尖峰數個）② `useStatsTimeStore`：`showGapOverlay` toggle + `gapThresholdDbm` ③ `statsOverlayLayer.js`：落差 client 位置畫**紅鑽石（白框加大 11px，落在 AP 密集處也跳出）** ④ `StatsDashboard`「規劃 VS 實測」section：落差點數 + 顯示 toggle（無落差時灰字提示拖白天）。**過程修的 4 個問題**（都使用者回報）：❶ 負載光暈圈誤讀成涵蓋範圍→改數字 badge（已在 Phase 43）❷ **定位落差點按鈕移除**（會硬移畫面、第一個點任意、價值低）❸ apStatus 改「只 mockStatus 釘死、其餘一律 online」（移除隨機 flapping，離線固定 AP-03 方便測試；連帶 rng 流偏移→落差場景變，靠提高問題格比例補回）❹ **overlay redraw 漏 `scene.requestRender()`**——本 app 按需 render（`app.ticker.stop()`），toggle 落差只改 Graphics 幾何卻沒請求重繪，導致「要 hover floorplan 才顯示」；加 requestRender 後 toggle 立即生效（此 bug 亦是先前 MCP 截不到紅鑽石的同源）；另 statsTime 訂閱只在 playheadTs 變才 recompute（toggle 不重算 44ms snapshot）。**MCP 驗證**：seek 白天 toggle 不 hover 紅鑽石立即出現（10 落差一堆紅鑽石）、AP-03 跨時段固定離線、0 console errors。**未做**：A/B plan diff、漫遊重疊區 |

| 45    | **隱藏 3D 凍結 + 2D/3D 熱圖共用 canvas**（2026-07-13 使用者驗收 ok）：使用者回報軟體渲染機（硬體加速關閉→SwiftShader）300 AP 拖曳很卡。**Profiler 歸因**（trace 解析腳本抽 long task + CPU profile）：3.4s long task 中 57% 來自**隱藏中的 Viewer3D**——2D 模式下 Viewer3D 常駐 mounted 只用 CSS 藏，`frameloop='demand'` 仍隨每次 store 變動重繪整個 3D 場景（含陰影），HeatmapPlane3D 隱藏中重算、CableLayer3D 每次 AP 位移重跑 dijkstra；unmount A/B 驗證版實測 long task 3432ms→1468ms、最大單筆 777ms→232ms。**正式修法（凍結而非 unmount）**：① Viewer3D 隱藏時 `frameloop='never'`（invalidate 全 no-op；r3f 7.0.29 `setFrameloop` 不會自動重啟 loop，新增 `WakeOnVisible` 在 hidden→visible 邊緣補一次 invalidate）② CableLayer3D：computeRoutes 手動輸入 ref 快取（隱藏凍結、重入輸入沒變直接沿用=秒切保留、有變才 re-route 一次）+ 隱藏時回傳快取 element tree 讓 reconciliation bailout（**null 路徑也必須寫快取**，否則會復活更舊的樹）③ **2D/3D 熱圖共用 canvas**（回答「兩邊要分開算嗎」→ 不必）：新增 `render/heatmapFrameBus.js` 小 pub-sub，heatmapAdapter `paintCanvas` 每次上畫廣播 canvas+padding 對位、`hide()`/銷毀廣播 null；HeatmapPlane3D **全檔重寫成純消費者**（刪自有 GL context+sampleFieldGLAsync 整條計算路徑+凍結/暖身邏輯），CanvasTexture 包 2D canvas、UV offset/repeat 裁 padding（flipY 下 v 從 canvas 底算）、只在 3D 可見時訂閱（隱藏零成本）、重入拿 `getHeatmapFrame()` 最新一張。**效果**：3D 熱圖零計算成本（繼承 2D 粗場秒出+大場景降級）、2D/3D 像素級一致、300 AP 切 3D 熱圖從幾十秒（3D 舊路徑無大場景降級，MCP 實測 60s 才落地）變 +400ms 即現。**中途撤回**：HeatmapPlane3D「輕場景隱藏暖身」patch（修首次進 3D 空窗）——共用 canvas 後不需要，已刪。MCP 驗證：5 AP 切 3D 即時、2D 移 AP 重入正確跟上、熱圖開關 plane 同步、300 AP +400ms 完整呈現，全程 0 console errors |

| 46    | **效能第二/三輪：熱圖引擎 async 化 + Pixi 修正 + marker 免重畫**（2026-07-14 使用者驗收 ok；三份 trace 逐輪歸因驅動，SW 機 300 AP 拖曳 long task 3.0s→1.25s→0.93s、最大單筆 777→205ms）：① **per-size render target 快取**（propagationGL）：out/outField/mask 從單一可變尺寸改為每尺寸一份（`makeSizedTargets`，LRU cap 6）+ losCache key 加 grid size（`@@${nx}x${ny}`）+ 年齡汰換（LOS_STALE_BAKES 32；**汰換必須用 AP-part 比對**，整 key 比對會讓粗細場互相驅逐）——消除 coarse(1.0m)↔fine(0.5m) 交替時整批 texture realloc + `checkFramebufferStatus`（強制 GPU 同步）；殘餘的 cfs 只剩首次拖曳 per-size 一次性配置 ② **solo/live 拖曳改 async 管線**（heatmapAdapter）：drag 幀不再同步 `sampleFieldGL`+`readPixels` stall，改 latest-wins 單格佇列 + `runDragLoop`（PBO+fence async，1 幀延遲換主執行緒零等待）；**教訓：latest-wins 只作用於佇列**——第一版把「有新請求」放進 isStale 會殺進行中計算，拖曳事件比計算快時每個計算死在半路、疊層凍在第一幀（starvation）；isStale 只留 `!dragSessionOn`（放開後 idle 接管，遲到的 drag paint 直接丟）③ **拖曳輸出解析度減半**（DRAG_OUT_SCALE 0.5）：採樣 grid 之外連 colormap 輸出 canvas 也減半（光柵化+Pixi 上傳都 1/4），sprite scale 自動補償、blur 半徑同步縮放，放開回滿解析度 ④ **Pixi v8 CanvasSource resize bug 修正**（使用者回報「拖曳中熱圖放大好幾倍/全紅」）：③ 讓共用 canvas 首次在執行期改尺寸，`source.resize()` 後 JS 側 source/frame/uvs 全一致但**場景渲染取樣到舊尺寸 GL 配置**（extract/讀 canvas 都會重新上傳所以看起來對，只有螢幕合成錯→初期誤判為測試假影，使用者實測逼出）；修法：尺寸變化時整顆 texture 重建（顯式 `new CanvasSource` 繞過 `Texture.from` 的 resource 快取），只在拖曳開始/結束發生 ⑤ **apsLayer 拖曳移動免重畫**：`drawAP` 幾何本畫在 local(0,0)+`container.position` 定位，`applyDragOverlay` 卻每移動幀全量重畫（circle/fan 筆劃重新三角化+Text 重設，SW 機 ~500ms buildLine+126ms flush 純白做）；改為首幀全畫、移動幀只 `position.set`（拖曳中 hover 被抑制、視覺狀態不會中途變）。**MCP 驗證**：solo/live 兩模式拖曳中疊層正確（牆影/blob 跟手）、放開回滿解析度、5AP 拖曳 0 long task、300AP 拖曳單筆 154ms、0 console errors。**trace 解析腳本**（long task 抽取+CPU profile 歸因+bucket 分類）在 scratchpad，重建成本低、未入 repo |

| 50    | **AI 牆改接 cv+graph pipeline API**（2026-07-29，commit e242f6d，MCP 驗證通過）：AI 偵測牆壁從「Gemini 清圖 → 舊 `analyzetovec.onrender.com/vectorize`」換成 `https://floorplan.senao.net` 的 **Floorplan cv+graph pipeline**（7 支 API 的非同步 job 佇列，GPU 一次一張）。新服務**自帶 Stage-A 去噪**（CNN 或傳統 cv），所以原圖直接上傳即可——**砍掉 Gemini 整段**（~90 行：清圖 prompt/base64 轉換/`extractFirstImagePart`）+ **API key 欄位**（使用者不用自備 key）+ **解析度 remap**（新服務回傳的座標本來就是原圖像素座標系，不需換算）。① **AIWallsModal 新流程**：`POST /jobs`（multipart）→ 輪詢 `GET /jobs/{id}`（1.5s 間隔／5 分鐘逾時／顯示排隊位置）→ 取 `lines[]` → 既有 `floorplanFromLines` → `setWalls`。**只用 3 支**：`/coords` 刻意不打——完成的 job response 裡已含同一份 `lines[]`（實測逐欄位比對一致），省一次往返。② **演算法選單**（7 種，預設 **cnn**；伺服器自己的預設仍是 v1，所以 `algorithm` 一律明確帶）。實測 demo：cnn 34 牆/861ms vs v1 67 牆/262ms——cnn 慢 ~3x 且牆數少一半，但選單可即時切換 + 「重新偵測」不必關窗重開。③ **`/denoised` 中間圖**（規格後來新增的第 7 支）：CNN denoiser 向量化前的**乾淨 4 色線稿**（實測像素統計剛好 4 色：白底/黑牆/藍窗/黃門——與被砍掉的 Gemini prompt 幾乎同一套配色，證實 CNN 取代了 Gemini 那一步）。**可用條件 `cnn*` + `output=full` 兩者皆須成立**，前端**不硬寫規則**而是看 job 回報的 `denoised_url` 是否為 null（避免與後端脫節），實測 v1 完全不發那次註定 404 的請求。純診斷用途：線稿乾淨但牆很爛 → 怪向量化；線稿本身就髒 → 換 algorithm。④ **ApiTestModal**（新，header「API 測試」鈕）：一鍵跑完 7 支，逐列顯示 method/path/HTTP 狀態色/耗時 + job 狀態徽章 + 座標明細 + `method`/`profile`/`provenance`（**shape 隨演算法而異**，cv+graph 給 `graph_status`/`cv_dedup`，CNN 給 `arch`/`weights`——勿寫死解析）；base URL 與 token 為可編輯欄位。⑤ **ImageLightbox**（新，共用）：兩個 modal 的疊圖/線稿都可放大（🔍 鈕或點縮圖）；**原始尺寸顯示不縮放**（縮圖已是 fit-to-width，再縮就失去意義），過大時**在框內捲動**（實測 900px 視窗下 overlay 1373px 寬：框內捲動、`document`/`body` 均無水平溢出）；Esc 用 **capture phase + stopPropagation** 只關檢視器不連帶關掉 host modal；點圖片本身不關（避免捲動誤觸）。**PNG 一律 fetch→blob→createObjectURL** 而非 `<img src>`（要帶 `Authorization` header），故不觸發下載；object URL 在重跑/關窗/unmount 三處 revoke，放大檢視在 revoke 前先關（否則抓著失效 blob 變破圖）。**已知遺留（非本次造成）**：`useAIPreviewStore` 在 `src/` **無畫面消費者**（`GeminiPreviewButton` 只存在 oldSrc、Phase 25 未 port），故 overlay 存進 store 目前只在 modal 開著時看得到。**實測發現的品質問題（未改，待決策）**：新 pipeline **門偵測率極低**（demo v1 僅 1 門、cnn 與 test-floorplan 皆 **0 門**），而自動比例尺靠門寬推算——1 個樣本時「取中間 50% 抗離群」防護完全失效（實測算出整層樓寬僅 17.6m）。建議補「門 <3~4 個就不自動套用比例尺」門檻。**另實測確認**：`output` 的 `full`/`algo` 差異**只有 overlay 那張圖**（`lines[]` 兩者完全相同、耗時也相同 1574ms），`algo` 模式 `coords_url` 仍有值但 `/overlay`、`/denoised` 皆 404；`floorplanFromLines` 的**合併幾乎不觸發**（`gapTolerance` 僅 1px，實測同軸線段縫隙 20~307px，22 條進 22 條出），真正在做事的是 4px 端點吸附 |

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
| Verkada Tier 3（多站 Sites/Subsites 導覽、Google Maps 地理定位） | 2026-07-02 使用者確定不做——本專案維持單站閉環畫布，不做導覽 IA / 地圖底圖級改動 |
| **52-D6 熱圖套室內遮罩／室外淡化** | 2026-08-12 使用者決定不做。稽核回報「熱圖滿江紅，但紅的大多在草地/屋外空地，紅色面積比房子還大」，使用者第一反應誤判成網路很爛；`indoorMask.js` 與自動規劃的「僅室內放置」都已存在，技術上可行。**撤回理由：這會改變所有人看到的熱圖預設行為，且室內判定失準時會在圖上開破洞——代價高於誤讀風險。** 若日後重啟，優先考慮「室外淡化 alpha」而非「室外不畫」（資訊不刪，只是不搶戲） |
| **52-D7 視窗 <1196px 佈局重疊 + resize 不重新 fit** | 2026-08-12 使用者決定不做。實測：1190px 時「設備規劃」面板 right=619 vs 工具列 left=616 重疊，1024px 重疊 86px 導致文字無法點擊（1280px 正常，斷點約 1196px）；另 1600→1024 resize 後 viewport scale/pan 不變，平面圖以 1085×809 畫在 764×552 canvas 裡，只看到放大的一角。**撤回理由：實際使用寬度都在斷點之上，不值得為此改動 Phase 39 的四角 stack 避讓體系。** 重啟扳機＝真的要在筆電/分割視窗使用。resize 自動 fit 若要做，只在「畫布明顯裝不下」時觸發，不可每次 resize 都拉回去（會覆蓋使用者刻意的縮放） |
| 51-12 EffectComposer 後製鏈（Outline / Bloom / SSAO） | 2026-08-10 實作後實測：300 AP 從 34.3ms(29fps) → **59.4ms(16.8fps)**，+25ms／1.73×，p95 201ms。SSAO 降解析度完全不省（成本在 depth/normal prepass）。另與 51-3 透明 canvas + CSS 天空漸層架構衝突。細節與量測陷阱見 Phase 51 該條 |

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
