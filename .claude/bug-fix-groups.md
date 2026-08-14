# Bug 修正分組計畫

來源:`.claude/bug-hunt-2026-08-12.md`(三輪獵捕,93 條)

## 分組原則

- **同檔案 / 同 pattern / 同修法放一起** — 改一次、驗一次、commit 一次,避免反覆進出同一個檔案
- **不按嚴重度切** — 嚴重度混在一起會讓你在同一個檔案上開好幾次刀
- **每組 5-10 小時**,含「讀懂上下文 + 改 + 瀏覽器驗證 + commit」的完整時間
- **有依賴的組標註順序**,不能亂跳

## 建議執行順序

```
G1 ✅ → G2 ✅ → G3 ✅ → G4 ✅(R1 除外) → G5 ✅ → G6 → G7 → G8 → G9 → G10
                                                      ↑
                                                 可與 G6 交換
```

**硬性依賴兩條都已解除**:
1. ~~**G2 必須早於 G3、G4**~~ — **已完成**(2026-08-13)。parity 工具已可偵測真實差異,**G3 已用它完成並反證**
2. ~~**G1 必須最早**~~ — **已完成**(2026-08-13),4 點校正的測試阻斷已解除

**下一步建議 G4**(同樣吃 G2 的 parity 工具、同屬 GL 領域,趁上下文還熱),或無依賴的 G6/G7/G8/G9/G10 任一。

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

# G2 · 修好 parity 驗證工具 + 熱圖快取失效 ✅ **已完成**(2026-08-13,使用者驗收 ok)

**這組的價值不在直接修 bug,而在讓後續 GL 修改能被驗證。**

| # | 位置 | 問題 | 實際修法 |
|---|---|---|---|
| 23c ✅ | `heatmap/sampleFieldGL.js:171-186` + `:402-415` | `geomSig` 漏 `losEnabled`、`apGeoEnabled`、`rssiOnly` — 而這兩個 flag 存在的目的**就是 parity 驗證**。diff harness 跑兩次拿到同一份快取,永遠回報「差異 0.000 dB」 | 三個 flag 都進 key |
| P1-8 ✅ | 同上 | `geomSig` 也漏 `bypassHoles`(樓板開孔多邊形,真實物理輸入) | 折入**頂點座標**(非只數量) |
| E2 ✅ | `heatmap/propagationGL.js:2435` | **第二道缺口**:`uploadSlabs()` 不清 `outGridCache`(`uploadWalls:2235`、`uploadCorners:2323` 都清,唯獨 slabs 沒有)→ 兩道防線同時失效 | 照 `fnv32` 範本補簽章 + `outGridCache.clear()` |
| 23e | `viewer3d/heatmapStack.js:46-50` | ~~漏 `isSoftwareRender`~~ **第三輪確認是誤判,不必修** | 未動 |

**兩份重複的 geomSig 已抽成單一 `buildGeomSig()`**:原本 aggregated 與 per-AP 兩條路徑各有一份手維護的副本,而**兩份漏的欄位完全一樣**——這正是重複簽章必然的失效模式。抽成一個函式後結構上不可能再分歧。

**驗收結果(MCP 兩輪乾淨獨立驗證,全程 0 console error)**:
- **FloorHole 真的會改熱圖了**:10×10m 單樓板加洞 → 121 格中 55 格變動、最大 40.62 dB;移除後回復
- **移動洞**(數量相同、座標不同)→ 60 格變動。**這是 count-only 簽章會漏掉的關鍵案例**,證明折入頂點座標是必要的
- **parity 工具復活**:用 `__gridCacheStats` 證明 `losEnabled:false` / `apGeoEnabled:false` / `rssiOnly:true` 三者各自都是 **hits:0 / misses:1**(真的重算),修好前它們與 baseline 共用同一筆快取
- **無效能回退**:30 AP 場景 cold 30 misses → 之後每次都 **30/30 hits**;相同輸入兩次仍 bit-identical 0.000

**已知的非問題(防誤判)**:`outGridCache` 是 `set(apKey, …)`,**每個 AP 只有一格**(hash 存在值裡),所以交替切換 opts 會互相淘汰 → harness 反覆切 flag 時每次都 miss。這是既有設計、非本次改動造成;正常使用 opts 固定,快取照常命中。

**★ 修好的工具已實際用來全面掃描引擎**(2026-08-14,15 個情境)——**這才算 G2 真正完成**,不只是「工具修好」。
結果:11 個情境 GL/JS 完全一致(0.000 dB),**3 個情境有真實分歧**(反射 10.07 dB、反射+繞射 6.97 dB、
同樓板兩個洞 61.24 dB)。完整表格與 sentinel 陷阱說明見下方 G3 專節的「parity 全面掃描」。
**其中反射那條是原報告 93 條沒有的新發現。**

**參考範本**:`propagationGL.js:2203/2304` 的 `fnv32(flat)` 是對實際上傳 bytes 做雜湊,**結構上不可能漏欄位**,是最強的一類簽章;`heatmapAdapter.js:981 idleInputs` 示範了把衍生旗標也折進指紋。

---

# G3 · GL 引擎正確性 ✅ **已完成**(2026-08-14,使用者驗收 ok)

需要 G2 先完成才能驗證。這組是純數值/圖形問題,需要對照 JS 參考實作。

**三條全修完,且每條都用 stash 反證過測試有效**(先確認測試在原始碼上會失敗,再確認修完會通過):

| # | 修法 | 修前(baseline) | 修後 |
|---|---|---|---|
| C3 | `cellM` 改成可超過 4m 偏好上限:`max(cellFloor, spanX/256, spanY/256)`,讓 256 格永遠蓋滿全幅 | 牆幅 1200m → **67.14 dB / 516 格** | **0.000 dB** |
| P1-9 | `maxSteps` 從格網對角線改成**實際 Manhattan 走訪距離** `abs(cxEnd-cx)+abs(cyEnd-cy)+4`(5 處 shader 全改) | AP 70m 外 → **58.78 dB**;95m 外 → **41.95 dB** | **0.000 dB** |
| P1-7 | 打包從「每個(boundary×洞)一筆」改成「**每 boundary 一筆**」,頂點加 `ringId` 通道;shader 換成 `pointInAnyPoly` 走訪多環 | 兩個洞 → **61.24 dB / 44 格** | **0.000 dB** |

**C3 的關鍵認識(差點測錯)**:加速格網是用**牆的 AABB** 建的,**不是**場地大小。所以「把一道牆放在 1500m 處」不會觸發 —— 單一道牆的 AABB 很小。要觸發必須讓**牆群本身橫跨** >1024m。實測門檻與理論完全吻合:牆幅 900m 通過、**1200m 失敗**。

**P1-7 的正確性不只看 parity**:單獨驗過物理方向 —— 左洞下方 −80.18 → −37.17 dB(25dB 樓板 × sec 被正確豁免),右洞只在「兩洞都有」時才變亮,無洞處的中央值完全不動。UI 實測兩個洞都有明顯亮區(修前只有第一個)。

**驗收結果(兩輪不同幾何,全程 0 console error)**:
- 輪 1:兩洞/三洞、牆幅 1200/2000m、AP 70/95m 外 → 全 0.000;6 項回歸(單牆/多 AP/繞射/單洞/無洞/雙樓板)全 0.000
- 輪 2:**4 個洞跨 2 個樓板**、L 形牆群幅 1800m、對角遠距叢集、5GHz 雙牆、指向性+tilt → 全 0.000(最大 0.001 為 fp32 噪音)
- 真實 UI:多樓層 + 兩個真 FloorHole,熱圖**兩個洞都有亮區**

**效能取捨(明確記錄)**:C3 讓大場地的 cell 變粗(1500m 幅 → 5.86m/格、2000m → 7.81m/格)換取「有衰減」而非「完全沒衰減」。一般樓層(21×21m 幅)cellM 與修前**逐位元相同**,零影響。

| # | 位置 | 問題 | 數字 |
|---|---|---|---|
| C3 | `propagationGL.js:2373-2374` | `nGx/nGy` 夾在 256 × `cellM` 上限 4m = 格網只覆蓋 **1024m**。超出範圍的牆進了列表但 DDA 永遠讀不到 → **完全不衰減** | 1500×800m 場地損失 476m 寬條帶 |
| P1-9 | `propagationGL.js:454-463`(+ 4 處複製) | DDA `maxSteps` 只按格網對角線設限,AP 遠離牆 AABB 時步數提前燒完 | 60 道牆在 21×21m + AP 在 60m 外 → 牆損耗 0 |
| P1-7 | `propagationGL.js:2454-2461` | 同一 boundary 多個 FloorHole,只有第一個能豁免樓板衰減(後續 record 的 `slabDb=0` 無法替第一筆豁免) | **實測 61.24 dB / 44 格**(單洞時 0.000 dB 完全一致 → 確定只在第二個以後的洞) |
| **新** | 反射路徑(`maxReflOrder ≥ 1`) | **2026-08-14 用修好的 parity 工具掃出來,原報告沒有這條**。反射開啟時 GL 與 JS 分歧 | **10.07 dB / 197 格**;加繞射 6.97 dB / 153 格 |

**共同性質**:三條都是 **JS/GL 分歧**,JS 參考實作(`propagation.js:70-86` 暴力掃全牆)是對的。修完應該用 G2 修好的 parity 工具比對。

**驗收**:超過 1024m 的區域牆有正常陰影;AP 遠離牆區時牆損耗正常;同一樓板兩個洞下方熱圖對稱。**以上三項 2026-08-14 全部實測通過。**

**剩下的分歧交給 G4/後續**:反射路徑(~10 dB)本組未動 —— 它與這三條的成因不同(不是格網或打包問題),見下方掃描表。

---

## ★ G2 修好後跑的 parity 全面掃描(2026-08-14 實測,可當 G3 回歸基準)

15 個情境比對 `sampleFieldGL` vs `sampleField`(JS 參考)。**比對時必須排除 sentinel 格**(見下方注意事項),否則數字無意義。

| 情境 | 最大差異 | 判定 |
|---|---|---|
| 自由空間 / 單面牆 / 多 AP / 12 面牆 | **0.000 dB** | ✅ 一致 |
| 繞射(牆緣 + corner) | **0.000 dB** | ✅ 一致 |
| 指向性天線 / tilt | **0.000 dB** | ✅ 一致 |
| 樓板無洞 / 單洞 / 雙樓板 | **0.000 dB** | ✅ 一致 |
| 5GHz / 6GHz(80/160MHz) | **0.000 dB** | ✅ 一致 |
| **反射 `maxReflOrder:1`** | **10.07 dB / 197 格** | ❌ **新發現,未在報告中;G3 未修** |
| **反射 + 繞射** | **6.97 dB / 153 格** | ❌ 同上 |
| ~~同樓板兩個洞~~ | ~~61.24 dB / 44 格~~ | ✅ **G3 已修 → 0.000 dB** |

**⚠ 第二個比對陷阱(2026-08-14 又踩一次)**:GL 有 `CULL_FLOOR_DBM = -120` 的距離剔除(低於此值的 AP 不可能貢獻訊號或 CCI,剔除是精確最佳化),JS 則一路算到 −300。所以**大場地遠處會出現 GL=−120 / JS=−273 的假分歧(看起來 79.9 dB)**。上面的 sentinel 門檻 −200 **不夠**,要用 **−120**:比對時只取兩邊都 > −120 dBm 的格。這是「明明沒 bug 卻追了半天」的第二個來源。

**兩點結論**:
1. ~~**P1-7 得到實測數字**~~ **✅ G3 已修**:GL 曾完全忽略第二個洞,現在兩洞/三洞/四洞皆 0.000 dB。
2. **反射路徑是新發現的分歧**(~10 dB),原報告 93 條裡沒有。**已併入 G4**(見下方 R1)。

**⚠ 第一個比對陷阱(不知道會誤判)**:兩個引擎對「無訊號」格的表示法不同 —— JS 寫 `-300`,GL 寫巨大負值(實測 `-453927`)。直接相減會得到 **677651 dB** 這種荒謬數字,看起來像大 bug 其實是 sentinel 差異。**排除 `< -200 dBm` 的格之後,5GHz/6GHz 的真實差異是 0.000 dB。** 寫 harness 時務必先過濾。

---

# G4 · GL 例外路徑與資源回滾 ✅ **主體完成**(2026-08-14;R1 未修,見下)

| # | 位置 | 問題 | 狀態 |
|---|---|---|---|
| C4 + E3 ✅ | `propagationGL.js:3135-3164` | `SCISSOR_TEST` 無 try/finally,`waitFence` 三條 reject 路徑會讓 scissor 永久污染 module-singleton context → 熱圖只剩一條窄帶,**fence timeout 不算 context lost 所以永不自我復原,必須重載頁面**。**附帶兩個洩漏**:`bindFramebuffer(null)` 也不執行;PBO 每次失敗漏一顆(`PBO_POOL_MAX = 32` 永遠補不回) | 已修 |
| **R1**(併入) | 反射路徑,`maxReflOrder ≥ 1` | **2026-08-14 用 G2 修好的 parity 工具掃出來的新分歧,原報告 93 條沒有**。開反射時 GL 與 JS 參考實作差 **10.07 dB / 197 格**;加繞射為 6.97 dB / 153 格。反射關閉時完全一致(0.000),所以問題確定在 image-source 反射那段。G3 已排除格網覆蓋(C3)、DDA 步數(P1-9)、樓板打包(P1-7)三個成因,**這條是獨立的第四個成因**。JS 參考實作在 `propagation.js`,GL 在 `renderAp` 的 refl 迴圈 |
| P3-22 ✅ | `render/heatmapAdapter.js:259-273` | context loss 復原沒清 `snapSprite.mask`(`:569` 指派了同一個 `maskG`)→ PIXI 踩已釋放資源,整個畫布變黑且 `requestRender` 已死。修法還需重設 `soloActive = false` | 已修 |
| 23y ✅ | `viewer3d/heatmapStack.js:69-156` | `ensureStack` 是 async 但**完全沒有 try/catch/finally**。退回的同步 `sampleField` 若自己拋錯無第二層保護;`createHeatmapGL()` 也在 catch 之外 → 部分樓層留新場、其餘留舊場,且 fingerprint 沒更新形成每 250ms 一次的失敗迴圈 | 已修 |
| 23d ✅ | `viewer3d/heatmapStack.js:124` | 把正常的 `null`(stale 訊號)當失敗直接 return → 混世代堆疊且**不碰任何東西永不修正** | 已修**並已專門驗證** |

**架構層面**:✅ 已補上全專案第一組 `webglcontextlost`/`webglcontextrestored` 監聽器 + `isDead()`,`getGL()` 改用它(可涵蓋「await 期間才丟 context」,而舊的 `isContextLost()` 只在呼叫前輪詢)。

**參考範本**:`heatmapAdapter.js:592-632 runDragLoop` 的 finally 不只重設旗標,還重新排程 await 縫隙中落地的新請求——正是 C4 該套用的形狀。

---

## G4 驗證結果(2026-08-14,兩輪獨立,全程 0 console error)

**★ 驗證抓到我自己的修法不完整 —— 這是「寫完 + 語法通過」絕對抓不到的**:
第一版 C4 只包了 PBO 那段 try,但失敗發生在**分帶繪製迴圈**(第一個 try),根本到不了 → scissor 有還原、**framebuffer 仍綁著**。修完再測又抓到第三條:`renderFieldPrep` 已經綁 FBO,而下一行的 `isContextLost()` 拋錯**在所有 try 之外**。兩處都補才三條路徑全乾淨。
**漏掉的後果**:失敗後 FBO 還綁在熱圖 output target,**下一個不相關的繪製(PIXI、3D stack 的 paintGL)會畫進熱圖貼圖裡**。

| 項目 | 輪 A | 輪 B | 注入方法 |
|---|---|---|---|
| G3 回歸(12 項) | 全 **0.000 dB** | 4 項不同數值全 0.000 | 確認沒弄壞 G3 |
| C4 scissor + FBO | 三條路徑全乾淨 | 15 次交錯失敗後乾淨 | 強制 `WAIT_FAILED` / stale / context-lost |
| E3 PBO 洩漏 | 10 次 reject 漏 **0** 顆 | 15 次失敗漏 **0** 顆 | hook `createBuffer` 計數 |
| E3 雙重釋放 | 24 次 submit 只建 4 顆、無 aliasing | — | 檢查同批 handle 是否共用 buffer |
| contextlost 監聽器 | 熱圖**每次都復原**(441/441) | — | 在 singleton 建立**之前**裝 hook 才殺得到它 |
| P3-22 | solo 拖曳中殺 context → 存活、熱圖重建不變黑 | — | 截圖確認 |
| 23y | — | 失敗只 1 次、3 秒 **0 增長** | 注入 `createHeatmapGL` 失敗;未修會 ~12 次 |
| 300 AP 反覆切換 | — | 8 次切換後熱圖完整無條紋 | **G4 正式驗收條件** |

**補驗完成(2026-08-14 第二輪,兩輪獨立,0 error)**:

| 項目 | 結果 |
|---|---|
| **23d**「回傳 null 但非 stale」 | 輪 1(3 樓層,強制**第一個** target 回 null)→ 只跳過它、**第二個仍建成**;輪 2(4 樓層,強制**中間**那層)→ 前後兩層都建成(3 張→2 張)。**舊碼會放棄整個堆疊** |
| **失敗後資料編輯會重試** | 強制 `createHeatmapGL` 失敗 → 0 張、warning 1 次不再增長;接著改牆 → **2 張建成、warning 沒再增加**。證明「commit fingerprint 打斷重試」與「資料編輯會重試」兩者兼得 |

**為什麼要加測試接縫**:ES module namespace 是**凍結**的,外部無法 stub 引擎回傳 `null`;而引擎只在真 stale 時回 `null`(那會走另一條分支)。所以在 `heatmapStack.js` 加了 `__setNullFieldForFloor()`(production 永遠是 `null`,只有測試會設),否則這條分支**結構上無法驗證**。第一次我試圖用「把 AP 清空」繞過,但那走的是既有的 `crossFloor` 守衛 `continue`,**根本不是我改的那一行** —— 記在這裡以免下次又誤判。

**仍未修**:**R1**,見下方獨立段落。

---

## R1 · 反射路徑 JS/GL 分歧 —— **未修,但已有完整診斷資產**

**觸發條件(已精確縮到)**:AP 恰好落在「軸對齊牆的垂直軸」上,使**鏡像點、AP、rx 三點共線**。
- 垂直牆 + AP 同列 → 11 格死掉(`-300`);水平牆 + AP 同行 → 11 格
- **斜牆 → 0 格**;AP 偏 0.5m 離軸 → **0 格**
- 與材質無關(**金屬也死**)、與 N 無關(N=1/5/auto 都死)、與加速結構無關(`losEnabled:false`/`apGeoEnabled:false` 都死)

**10 輪 shader 探針的量測結果(每層輸入都證明是好的)**:

| 量測項 | 失效列 | 正常列 | 判定 |
|---|---|---|---|
| 反射路徑數 / `dTot` | 1 / 15→5 | 1 / 15.13→5.39 | 正常 |
| `rxDbRef` / `ampRef` | −42.96…−31.92 / 5.03e-3…1.79e-2 | 幾乎相同 | 正常 |
| `rxDbDir` / `ampDir` | −32.90…−47.32 / 1.60e-2…3.05e-3 | 幾乎相同 | 正常 |
| `Hperp[0]`(直接後 / 反射後) | 有限 | 有限 | **正常** |
| **`Hpara[0]`** | **NaN** | 有限 | ❌ |
| `powerSum` | NaN → `linToDb` 的 `max(lin,1e-30)` 夾成 −300 | 2.4e-3…9.6e-3 | ❌ |

**關鍵發現:NaN 只在 `Hpara`,`Hperp` 全程乾淨。**
這很反直覺 —— 直接路徑寫進去的是 `perpDir = paraDir = vec2(ampDir, 0.0)`(**完全相同的值**)、同一個 `addPathHN` 呼叫、同一組相位,結果一個好一個壞。

**已排除**:`fresnelGamma`/`cdiv`(金屬走硬編碼 `vec4(-1,0,-1,0)` 也死)、幾何(fp32 重算 `segSegHit` 的 `den`/`t`/`u`/`cosI`/`d1`/`d2` 全有限良態)、物理抵銷(振幅比 0.21~1.12,差 2~5 倍不可能歸零)。

**下一步方向**:`addPathHN` 收兩個 `inout vec2[NMAX]` 陣列參數而**只有第二個**壞 —— 疑似 GLSL 對雙 `inout` 陣列參數的處理,或 shader 內某處越界寫入污染了第二個陣列。可考慮把兩個陣列合併成單一 `vec4[NMAX]` 規避。

**測試方法備註**:per-AP 的 output target 是 **R32F**(只有 `.r` 回讀得到),所以探針值必須編碼進單一 float;想同時看多個值要嘛換 RGBA32F target、要嘛一次只留一個探針(我最後一輪就是因為兩個探針互相覆蓋而讀到 `float(N)` 的假值)。

**驗收條件**:開反射(`maxReflOrder:1`)時 GL/JS parity 回到 0.000 dB —— 用 G3 建立的 harness,記得濾掉 `<= -120 dBm` 的格(見上方兩個比對陷阱)。

---

# G5 · undo/redo 與歷史完整性 ✅ **已完成**(2026-08-13,使用者驗收 ok)

| # | 位置 | 問題 | 實際修法 |
|---|---|---|---|
| T1 ✅ | `store/useHistoryStore.js:31-54` | **完全沒有 import `useFloorStore`** → `floor.scale`、`floorHeight`、`floorSlabAttenuationDb`、`cropX/Y/W/H`、以及 **ALIGN_FLOOR 的四個 align 欄位**全部無法 undo | 新增 `FLOOR_SNAPSHOT_KEYS` allow-list + 訂閱 + restore 用 merge |
| P3-17 ✅ | `useHistoryStore.js:92-97` | `undoStack.length === 0` 檢查在 `flushPending()` **之前** → 第一筆編輯後 300-800ms 內 Ctrl+Z 完全沒反應、按鈕還是灰的 | flush 移到檢查之前;另加 `hasPending` 反應式狀態餵工具列 |
| P3-18 ✅ | `useHistoryStore.js:110-123` | `redo()` 不 flush → 300ms 內按 Ctrl+Y 會用舊快照覆寫剛做的編輯 | `redo()` 也先 flush |
| P1-12 ✅ | `useHistoryStore.js:100-102` | 跨樓層 undo 靜默 return(不提示、不跳樓層),而**工具列按鈕還亮著** | 自動跳到該快照的樓層再 rewind(undo/redo 皆同) |
| T7 ✅ | `useAPStore.js:88` + `useHistoryStore.js:61` | `setAPs` 的 `Math.max` 永不回退 → undo 後 AP 名稱跳號,手動改名可造成撞名 | 新增 `recountAPCounter()`,restore 後從全樓層資料重算 |

**T1 的兩個設計決定(防重做)**:
1. **採 allow-list 而非整筆 clone**。排除 `id`/`name`(識別性,改名不該被牆的 Ctrl+Z 連帶還原)與 `imageUrl`/`imageWidth`/`imageHeight`——因為 `SidebarLeft.jsx:226` 刪樓層時會 `URL.revokeObjectURL(floor.imageUrl)`,還原舊 blob URL 會復活死引用變成破圖。
2. **restore 用 merge 而非取代**(`{ ...f, ...floorFields }`),所以刻意排除的欄位保留**當前值**,不會被還原也不會被清掉。
3. `floors` 是**陣列不是 map**,任何樓層的改動都產生新 ref → 比對只看**當前樓層的 allow-list 欄位**,否則改別層名字/換排序都會塞一筆多餘快照,把真正的步驟擠出 50 格上限。

**align 拖曳不需額外處理**:`viewport.js:278` 每次 mousemove 都呼叫 `setAlignTransform`,而既有的 `schedulePushRaw` 只保留**最初**那份 raw、其餘 coalesce——實測 20 次連續呼叫確實只產生 **1 筆** undo 步驟。

**P3-17 的額外一步**:`canUndo()` 其實是**死碼**(工具列直接讀 `undoStack.length`),所以光改它不會讓按鈕變亮。改成在 store 放反應式 `hasPending`(所有 `_pendingRaw` 寫入都走單一 `setPendingRaw()` 以免漂移),`Toolbar.jsx:195` 改讀 `undoLen > 0 || hasPending`。

**驗收結果(MCP 兩輪乾淨獨立驗證,全程 0 console error)**:
- 比例尺 22.83 → 2.283(量錯 10 倍)→ Ctrl+Z 精確還原;redo 也正確重做
- floorHeight / 樓板衰減 / crop / align 四欄位(含 alignScale 1.35、alignRotation 0.42)全部可 undo,4 步逐一退回起始值
- align 連續拖曳 20 次 → **1 筆** undo 步驟
- 改樓層名字 → **0 筆**快照(allow-list 正確排除)
- 第一筆編輯後**不等 debounce** 立刻 undo → 成功(牆與 floor 欄位各驗一次),`hasPending` 立即為 true
- 交錯編輯(floor 欄位 + 牆)→ 2 筆獨立步驟,互不污染
- T7:AP-06 → undo → counter 6 回到 5 → 再放仍是 **AP-06**(不跳號);連加兩顆再連退兩次亦正確
- P1-12:在 2F 改樓高 → 切回 1F 按 Ctrl+Z → **自動跳回 2F** 並還原

**真實滑鼠操作驗證(2026-08-14 補做)**:先前都是 store 注入,後來改用 Playwright **真的移動滑鼠、真的按左鍵**走 UI 流程:
- 工具列點「牆/結構」→「畫牆」,在既有牆端點上點兩下(第二下偏 5px,在 12px 吸附半徑內)
  → 真的產生 `startX === endX && startY === endY` 的零長度牆,**吸附路徑確實會造成報告描述的觸發條件**,且不崩潰
- 「網路布線」→「繪製線槽」兩下近距離點擊 + Enter → tray 兩點完全相同,退化線段,不崩潰
- 兩者切 3D 後同時存在仍正常
- 畫完牆後**復原按鈕真的從 disabled 變成可按**

**既有 undo 路徑全面回歸(2026-08-14 補做,皆記錄中間狀態避免 0→0 假通過)**:
tray 2→3→2 ✅ / riser 0→1→0 ✅ / switch 全棟 map 完整還原 ✅ / tripwire 0→1→0 ✅ /
zone 0→1→0 ✅ / unplacedCameras 2→3→2 ✅ / placeCamera(池 2→1→2、樓層 4→5→4)✅ /
dropFloor 堆疊 1→0 清乾淨且刪完後 undo 仍可用 ✅

**效能實測(2026-08-14 補做,300 AP + 45 牆)**:
新增的 `useFloorStore` 訂閱本身成本 = **0.71 微秒/次**(20000 次迭代實測),可忽略。
align 拖曳每次 239ms 是**既有問題不是 G5 造成**,證據:① 改樓層名字(我的訂閱早退、不做快照)同樣要 248ms
② 拿掉熱圖後成本不變 ③ **AP 數從 300 降到 5,成本從 239ms → 4.85ms(scale 隨 AP 數)**
→ 瓶頸是 AP 圖層重繪,屬 G9 範疇。A(走快照)− B(早退)僅差 **1.6ms**。

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
| ~~G2~~ ✅ | ~~parity 工具 + 熱圖快取~~ **已完成 2026-08-13** | ~~6-8 h~~ | — |
| ~~G3~~ ✅ | ~~GL 引擎正確性~~ **已完成 2026-08-14** | ~~8-10 h~~ | ~~G2~~ ✅ |
| ~~G4~~ ✅ | ~~GL 例外與資源回滾~~ **主體完成 2026-08-14**(R1 未修) | ~~6-8 h~~(R1 剩 2-3 h) | ~~G2~~ ✅ |
| ~~G5~~ ✅ | ~~undo/redo 完整性~~ **已完成 2026-08-13** | ~~8-10 h~~ | — |
| G6 | 切樓層/模式狀態殘留 | 6-8 h | — |
| G7 | 命名唯一性與跨樓層參照 | 5-6 h | — |
| G8 | 單位/比例尺/魔術數字 | 6-8 h | — |
| G9 | 效能與資源洩漏 | 5-7 h | — |
| G10 | UI/UX 與匯出 | 7-9 h | — |
| | **合計** | **61-78 h**(剩 **29-40 h** + R1 的 2-3 h) | |

## 分批建議

~~若想更早看到成效,前三組(G1 + G2 + G5,約 19-24 小時)覆蓋了「會白屏」「讓驗證失效」「改錯無法回退」三類最傷的問題。~~
**G1 + G2 + G5 已於 2026-08-13 全部完成** —— 三類最傷的問題(會白屏 / 讓驗證失效 / 改錯無法回退)都已解除。
**G3 已於 2026-08-14 完成**(三條 JS/GL 分歧全平,每條都用 stash 反證)。
**G4 主體已於 2026-08-14 完成**(C4/E3/P3-22/23y + contextlost 監聽器,驗證時抓到自己修法不完整並補齊)。
**剩下**:R1(反射分歧,已有完整診斷)、23d 的專門驗證、以及 G6~G10。

G3/G4(GL 引擎)可以延後,因為它們的症狀是「熱圖數字不對」而非「操作壞掉」,且需要較專注的數值驗證時段。
