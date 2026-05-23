# Session Handoff — 2026-05-23

> 這份 doc 是從 [task.md](task.md) / [workflow.md](workflow.md) / [color-legend.md](color-legend.md) /
> [mode-matrix.md](mode-matrix.md) / [playwright-mcp-notes.md](playwright-mcp-notes.md) 抽出來的
> session continuation pack。新 session 開始時讀完這份 + 上面那幾份就能接續，**不需要回頭撈舊對話**。

---

> ⚠ **過時通知（2026-05-24）**：本文件原為「Phase 19 自動 IDF 推薦」的接手指引，但該 Phase 已實作完成後又整批撤回（理由：IDF 真實選位仰賴房間 / 弱電間語意，本工具沒這層資料）。底下提到的 25-1 ~ 25-4 / auto-idf-spec.md 全部失效。**現在剩 4 個 Phase 待做：20 perf / 21 heatmap polish / 22 3D enhancements / 23 switch kind 差別化**。詳見 [task.md](task.md)。

---

## 1. 現況一句話

主功能（Phase 7-18 / Layer 11-24）全部完成。Phase 19 已撤回，**剩 4 個新 Phase 待做**（Phase 20-23 / Layer 26-29）。

撤回的：21-1 / 21-2 / 21-3 / 22-3b / 22-4 / 12-4 / **25-1~25-4**（Auto IDF：建議無法反映實務）。

---

## 2. 待做 task 清單（按優先順序）

| Phase | Layer | Task | 性質 | 工程量 |
|---|---|---|---|---|
| **19** | 25 自動 IDF 推薦 | 25-1 演算法 spec | 設計討論 | 0 (純文件) |
| 19 | 25 | 25-2 `autoIdfPlan.js` 純函式 | code | 大（演算法主體）|
| 19 | 25 | 25-3 UI（線纜總結 panel ⚡ 按鈕 + modal + Apply）| code | 中 |
| 19 | 25 | 25-4 ghost preview（apply 前畫面看到 N 個建議 IDF）| code | 中 |
| **20** | 26 效能優化 | 26-1 perf profile @ 50/150/300 AP | 量測 | 小 |
| 20 | 26 | 26-2 根據 profile 動手優化 | code | 視 profile |
| 20 | 26 | 26-3 `.claude/perf-baseline.md` before/after | 文件 | 小 |
| **21** | 27 熱圖 polish | 27-1 audit `.claude/heatmap-audit.md` | 量測 | 小 |
| 21 | 27 | 27-2 根據 audit 動手 | code | 中 |
| **22** | 28 3D 強化 | 28-1 3D AP label sprite | code | 小 |
| 22 | 28 | 28-2 3D 樓層切換 UI | code | 中 |
| 22 | 28 | 28-3 3D camera presets | code | 小 |
| 22 | 28 | 28-4 3D hover readout | code | 小 |

**重要約束**：使用者明確說**不做** AI 牆 / Demo loader 相關 task。

---

## 3. 開新 session 的順序

**第一個 session 必做 → 25-1 演算法 spec**

我（上一個 session）已經跟使用者討論到一半，使用者卡在 5 個演算法設計問題上需要更深的討論。

把 **§4 brief** 整段貼進新 session，請 AI 幫忙完成 spec。完成後寫進 `.claude/auto-idf-spec.md`，再開下一個 session 做 25-2。

---

## 4. Brief for Task 25-1（直接複製進新 session）

> 我在做一個 floorplan AP planner（React 17 + Konva + Zustand）。已完成手動放置 IDF + 自動 cable routing（Dijkstra 沿 cable tray + Manhattan fallback）。現在要做 **auto IDF placement** 演算法 — 給定 N 個 AP + capacity constraint，自動建議 IDF 位置 + 對應 AP 分群。請幫我設計 spec，**先別寫 code**。我傾向 capacity-constrained k-means，但要討論替代方案 + 拍板問題。
>
> ### 現有 model（演算法要對齊）
>
> - AP: `{id, x, y, frequency, channel, txPower, mountHeight}`
> - Switch: `{id, kind: 'switch'|'idf'|'mdf'|'router', x, y, portCount (default 24), poeBudget, uplinkTo, cableType}`
> - 樓層: `{scale (px/m), imageWidth, imageHeight, floorHeight}`
> - 線長計算：沿 tray (有的話) + Z drop (天花板到 AP 高度) + slack 1.20
> - Cable type auto resolve：≥ 90 m 自動 fiber，否則 copper
> - 一個 switch 預設 24 port
> - Routing 已存在於 `src/features/cable/computeRoutes.js`
>
> ### 目標
>
> 給定一層樓的 AP 分布 + 容量限制，**自動建議**：
> - 要放幾個 IDF（switch kind='idf'）
> - 每個 IDF 應該放在哪 (x, y)
> - 每個 AP 對應哪個 IDF
>
> ### 我傾向的演算法
>
> Capacity-constrained k-means clustering：
> 1. 從 k=1 開始
> 2. 跑標準 k-means → 每個 IDF 是 centroid，AP 是 sample point
> 3. 檢查每個 IDF：(a) port 是否超載 (b) 是否有 AP 距離超過 90 m
> 4. 不滿足 → k++ → 重跑
> 5. 滿足 → 收斂，回傳
>
> ### 5 個拍板問題
>
> **Q1 演算法選擇**：(a) capacity-constrained k-means / (b) grid-based / (c) Voronoi-based。哪個對 AP planning 最合理？
>
> **Q2 建議的 switch kind**：只建議 IDF？還是也建議 MDF？
>
> **Q3 建議後微調**：Modal 顯示建議後，使用者可不可以「拖 ghost IDF」再 apply？還是 take-it-or-leave-it？
>
> **Q4 多樓層處理**：per-floor 各自跑 vs 全棟一次跑？跨樓層 AP 是否能共用同一個 IDF（透過 riser）？
>
> **Q5 邊界 case**：單個 AP 比 90 m 還遠的「孤島 AP」怎麼辦？AP 全部緊密集中時 k=1 是否該強制 k>=2？
>
> ### 額外要思考的考量
>
> - **權重 trade-off**：cable length minimization vs IDF 數量 minimization
> - **熱啟動**：使用者已經放了 N 個 switch，演算法是否要尊重既有 switch（只補充建議）
> - **物理空間限制**：IDF 不能放在牆裡（演算法是否要避開牆 / 中庭？）
> - **線材 type fallback**：90 m 上限可放寬到 fiber — 演算法要允許「這個 IDF 出去都用 fiber，所以線長上限可放寬」嗎？
> - **PoE budget**：除了 port 數，每個 IDF 的 PoE 總瓦數也是 constraint（高功率 AP 要算 30W PoE+）
>
> ### 我提議的 input / output（可挑戰）
>
> ```js
> autoIdfPlan({
>   aps,                  // [{ id, x, y, model? }]
>   pxPerM,               // floor scale
>   constraints: {
>     portsPerIdf: 24,
>     maxCableM: 90,
>     minAPsPerIdf: 4,
>   },
> })
> // →
> {
>   idfs: [
>     { x, y, assignedAPs: ['ap-1', 'ap-3', ...] },
>     ...
>   ],
>   totalCableM: 423.5,
>   unassigned: [],
> }
> ```
>
> ### 期望輸出
>
> - 演算法名稱 + 高階 pseudocode（10-20 行）
> - Input / output shape（refine 我提的）
> - 邊界 case 處理規則表
> - Q1-Q5 拍板答案
> - 演算法 worst-case complexity（避免 300 AP 時 hang）
>
> 完成後請我把 spec 存進 `.claude/auto-idf-spec.md`。

---

## 5. 工作流 cheat sheet（每個 session 都記住）

從 [workflow.md](workflow.md) 抽：

- **`ok`** = 確認任務完成 → 更新 task.md ✅ + ProgressPanel + 給英文 commit message
- **`next`** = 進下一個任務
- **commit 規則**：等使用者明確說 `ok` 才 commit；不主動 push
- **語言**：commit message 英文；測試 / 回應 / 提問用中文；Claude 內部思考英文
- **驗證流程**：做完一個 task → 跟使用者說驗證項目 → 使用者驗 → 使用者 `ok` → commit
- **每個 task 都用 Playwright MCP 真實驗證**（不單純 store 注入）— 看 [playwright-mcp-notes.md](playwright-mcp-notes.md) 三大踩坑點

---

## 6. 技術背景（重要！）

從 [CLAUDE.md](../CLAUDE.md) + [file-structure.md](file-structure.md) 抽關鍵：

| 主題 | 約束 |
|---|---|
| React | **17.0.2** — `ReactDOM.render()` NOT `createRoot` |
| react-konva | **17.0.2-6** exact |
| @react-three/fiber | **7.0.29** |
| State | Zustand v4 |
| Styles | **.sass**（indented syntax）NOT .scss |
| Language | Plain JS（no TypeScript, no JSDoc, no prop-types）|
| Node | 20.x（`eval "$(fnm env)" && fnm use`）|
| Build | Vite + pnpm |
| Path alias | `@` → `./src` |
| Base path | `/floorplan/`（漏掉會 404）|

**Zustand subscription pattern**：subscribe data not getter（已踩過坑）

```js
// ✅
const walls = useWallStore((s) => s.wallsByFloor[floorId] ?? [])
// ❌
const getWalls = useWallStore((s) => s.getWalls)
```

**Konva stage**：MCP 不吃原生 DOM MouseEvent，要用 `Konva.stages[0]._fire('click', ...)` 配 `evt.button`

---

## 7. 設計原則（每個 task 都要遵守）

從 [task.md](task.md) "Design Principles"：

| 主題 | 原則 |
|---|---|
| **3D = read-only** | Z 軸屬性一律在 2D panel 編輯；3D 不開放編輯 |
| **Capacity rule** | tray fill 用 capacityProfile（25/40/custom），**不寫死「NEC 40%」**|
| **Color legend** | 用 owner/company/discipline standard，**不綁地區法規** |
| **垂直走線只用 Riser** | 不另做 vertical tray / conduit |
| **BOM = Planning BOM** | 不是施工 final BOM；warning ≠ code violation |
| **左右鍵分離** | 左 = select/drag/落點；右 = open context menu（不動 selection）|
| **Phase 18 group accent** | 5 種顏色映射到 toolbar / mode badge / right panel 三表面（見 [color-legend.md](color-legend.md)）|
| **Mode capability** | 每個 mode × 物件互動由 `getModeCapability(mode)` 單一決定（見 [mode-matrix.md](mode-matrix.md)）|

---

## 8. 已撤回 task（不要重啟）

| ID | 原因 |
|---|---|
| 21-1 Vertical tray | Hamina 無、Riser 已涵蓋、AP/SW 不 snap、dz 不進 BOM |
| 21-2 / 21-3 Zone box | 是工位 cabling 概念、IDF/MDF 已涵蓋、Hamina 無 |
| 22-3b SVG export | Konva 無 SVG renderer、PNG+PDF 涵蓋 95%、需求極窄 |
| 22-4 DXF export | AutoCAD 交付場景不在 AP planner 工作流、Hamina 無 |
| 12-4 Hybrid routing | 17-3 switch hub 落地後痛點消失 |

**判斷新 task 是否該撤回的 3 個問題**（如果新 session 提出新方向時用得到）：

1. Hamina Network Planner 有沒有做？沒做的話為什麼？
2. 真實 AP planner 工作流會用到嗎？或只是工程師覺得 cool？
3. 既有機制是否已涵蓋（例：21-2 zone box vs IDF/MDF）

3 題答案都是 No → 撤回，**不要勉強做**。

---

## 9. 怎麼 commit / push

從 workflow.md：
- 主動詢問使用者「要不要 commit」**錯誤** — 等使用者 `ok` 才 commit
- **永遠不要 `git push`** — 使用者明確說過

---

## 10. 此 session 結束時的 git 狀態

最後 5 個 commits：

```
f5b4df6  Withdraw 22-3b / 22-4 / 12-4; schedule Phase 19–22
37a3eb3  PDF planning report (Task 22-2)
25ba222  PNG plan view export (Task 22-3a)
127724e  CSV Planning BOM export (Task 22-1)
f8750e0  Withdraw Phase 15 zone box tasks (21-2 / 21-3)
```

Branch: `main`. 沒 push 過 — 使用者明確說不要 push。

---

## 11. 給新 session 的開場白模板

> 我接手了 floorplan-planner 這個 React + Konva 專案。讀完 `.claude/handoff.md` 跟它連結的所有 doc 我就能接續工作。下一個任務是 **Phase 19 / Task 25-1 自動 IDF 推薦演算法 spec**。我們先別寫 code，先把 spec 敲定 — 把使用者該拍板的問題列給我，我們一題一題討論。
