# Session Handoff — 2026-05-25 (Phase 25 pivot to PixiJS)

> Session continuation pack。新 session 讀這份 + `task.md` + `layer-architecture-spec.md` 就能接續，**不需要回頭撈舊對話**。
>
> 上個 session：Phase 24 已 ship。**Phase 25 從「純 Konva」轉向「PixiJS hybrid」**（基於 1000+ AP / 5000+ walls 規格目標）。Phase 24 step 3-5 撤回。設計 spec + task 全部寫進 repo。

---

## 1. 現況一句話

**Phase 23 結束。Phase 24 Step 1+2 已 commit + MCP 驗證通過（解 SW+Tray+50AP 卡頓）。Phase 25 pivot 為 PixiJS hybrid，spec 完成，等待動工。**

下一步：**Phase 25 step 31-0** —— `git mv src oldSrc` + 新 `src/main.jsx` PixiJS 骨架。

---

## 2. 目標規格（驅動所有後續決策）

未來規格（user 確認的長期目標）：

| 元素 | 數量 |
|---|---|
| AP | 1000+ |
| Walls | 5000+ |
| Switch / IDF / MDF / Router | 100+ |
| Cable Tray | 50+ |
| Cable routes（衍生）| ~1000，segment ~30000 |
| Heatmap | real-time recompute |
| **FPS** | **30–60 fps** |

**這個規格 Konva 撞牆**（純 Konva 上限約 300-500 AP），所以 Phase 25 不再走純 Konva，改 PixiJS hybrid。

---

## 3. Phase 24 / 25 / 26 路線圖

完整設計看 `.claude/layer-architecture-spec.md`（已重寫成 PixiJS hybrid 最終版）。

| Phase | 狀態 | 目標 | 對應 task |
|---|---|---|---|
| **24** Konva Layer 拆分 | ✅ ship (commit `a30139f`) | 解 SW+Tray+50AP 操作卡頓（凍結 cable 妥協）| Layer 30 |
| **25** PixiJS hybrid renderer | ⬜ 未開始 | 達 1000+ AP / 5000+ walls / 30-60fps 目標規格 | Layer 31 |
| **26** Real-time cable follow + 增量 routing | ⬜ 條件式 | 解凍 cable + 視量測決定增量 routing | Layer 32 |

### Phase 24 進度

| # | 狀態 |
|---|---|
| 30-1 CableLayer 拆獨立 layer | ✅ commit `a30139f` |
| 30-2 Tray dragmove → dragOverlay | ✅ commit `a30139f` |
| 30-3 / 30-4 / 30-5 / 30-6 / 30-7 | ⏸️ **撤回**（架構決策融入 Phase 25 PixiJS Container 階層；react-konva 環境做會白工） |

### Phase 26 決策樹

```
Phase 25 完成 → 量測 computeRoutes @ 50 / 1000 AP
                ├─ < 5 ms/frame  → 32-D 解凍 cable（即時 follow）
                ├─ 5–16 ms       → 32-D + monitor
                └─ > 16 ms       → 32-C 增量 routing
```

Phase 26 原本的「WebGL cable」路線已併入 Phase 25 的 31-5（cable Mesh shader）。

---

## 4. Phase 25 PixiJS hybrid 設計重點

詳見 `layer-architecture-spec.md` §3。核心：

### 分工

- **PixiJS 管產品複雜度**：scene graph、viewport、Sprite、Container、Graphics、Interaction
- **Custom Mesh + shader 管 bulk simple geometry**：walls 5000、cables 30000 segments
- **GPU shader 管 RF heatmap**：既有 raw WebGL2 → PIXI.Sprite
- **Worker 管 CPU-side**：spatial index、routing、tile invalidation
- **React 不管 Pixi object lifecycle**

### 八層 Container 階層

```
1. Background + FloorImage
2. Heatmap (既有 raw WebGL2 → PIXI.Sprite)
3. Walls (PIXI.Mesh + 自寫 line shader)
4. Scopes / FloorHoles / RefWall / RefVector (PIXI.Graphics)
5. Cables (PIXI.Mesh + 自寫 dashed line shader, eventMode='none')
6. Trays (PIXI.Container + Graphics + vertex handles)
7. Devices: AP (Sprite atlas) / SW (Container) / Riser (Sprite)
8. Visual overlays + Marquee + Interactive handles + Text labels
```

### 只 3 條 layer 走自寫 shader

1. **Heatmap**（既有 WebGL2 不動，整合進 PIXI.Sprite）
2. **Walls Mesh + line shader**（粗線 quad、screen-space width + DPR、AA、per-material color、`hoverWallId` uniform、opening 預切 sub-segments、drag-freeze + dragend commit）
3. **Cables Mesh + dashed line shader**（同 walls + dash 用 screen-space distance + per-route color/dash + focus halo second pass）

### 拍板的設計決策

| 項目 | 決定 |
|---|---|
| Wall stroke | `max(worldWidth × scale, 1) × DPR`，maxPx 預設不啟用 |
| Wall opening update | drag 中只更新拖中那條，dragend commit |
| Cable dash | screen-space distance + 沿用 CableLayer.jsx 各 route 類型 |
| AP data texture | K=4 row layout，整張重 upload |
| Spatial index | AP/SW/Riser uniform grid；Wall/Tray/Scope/Hole R-tree |
| Hover wall | `hoverWallId` uniform |
| Selection wall (大量) | mesh attribute；少量 Tray/AP overlay Graphics |
| Text | SDF/MSDF atlas（禁 PIXI.Text 大量用） |
| Animation | `app.ticker` + 手寫 ease util（非 tween library） |
| PixiJS version | v8，WebGPU preferred，WebGL2 fallback |
| Shader 雙寫 | 第一版 GLSL only，第二版補 WGSL，第三版升 compute |
| Worker | 不做 main RF compute |
| GPU memory budget | hard 200MB，warning 150MB |
| Bundle 增量 | < 500 KB gzip |

### 估時：3-4 週

---

## 5. Migration 策略：src → oldSrc

```bash
git mv src oldSrc
mkdir src
# 新 src/main.jsx 第一天起要存在（最小 PixiJS app 骨架）
```

**紀律**：
- 新 `/src` **嚴禁** import `/oldSrc`
- `oldSrc/` 加 `.eslintignore` + vitest 排除
- `vite.config.js` `@` alias 維持 `./src`
- **Migration 不可逆**：沒有「邊改邊跑舊版」的選項；第一週新 src 跑得很慘要有心理準備

---

## 6. 元層級的設計原則

`動一下就回 store + re-render` 是這類大 canvas 系統的根本性能陷阱。

> **Transient state（暫時狀態）不該進 store**。
> mousedown / keypress / hover / 繪製途中都活在 ref / local state / dragOverlay。
> 邊界（mouseup / blur / dragend）才 commit。

Phase 24 step 2 就是這個原則套用到 Tray drag。**Phase 25 PixiJS 改寫過程要堅持這個邊界**——store 不更新時 PixiJS 視覺照常更新（透過 dragOverlay）。

**Panel sliders 還有 3 個沒處理**（HeatmapControl gridStep/blur、AlignFloorPanel offset/scale/rotation、FloorImagePanel rotation/opacity），Phase 25 過程或之後可順手收尾。

---

## 7. 跨機器開發注意

User 在多台機器開發。**durable 計畫 / 決策一律進 `.claude/*.md`（隨 repo 走）**，不只 memory（local-only）。Memory 可作為 hint，repo doc 才是 canonical source。

對應 memory：`feedback_cross_machine_dev.md`

---

## 8. 立即可做的清單（按優先序）

1. **Phase 25 step 31-0**：`git mv src oldSrc` + 新 `src/main.jsx` PixiJS 最小骨架 + 配置調整
2. **31-1** PIXI.Application + 八層 Container 階層 + viewport
3. **31-2** Store wiring (Zustand subscribe imperative)
4. **31-3** Heatmap 整合（既有 WebGL2 canvas → PIXI.Sprite）
5. **31-4 / 31-5** 自寫 wall / cable shader（技術風險最高，早點做）
6. **31-6 → 31-13** 標準 PixiJS 路徑 + validation

詳見 `task.md` Layer 31 task 列表。

---

## 9. 跨檔對照 quick map

| 你要找的東西 | 看哪裡 |
|---|---|
| 各 phase 任務列表 + 狀態 | `.claude/task.md`（Phase 24 已 ship、Phase 25 PixiJS、Phase 26 條件式） |
| **Canvas 渲染架構 spec**（PixiJS hybrid 最終版）| **`.claude/layer-architecture-spec.md`** |
| 協作流程 / commit 規則 | `.claude/workflow.md` |
| 檔案結構 | `.claude/file-structure.md` |
| Cable 系統設計 | `.claude/cable-spec.md` |
| Playwright MCP 驗證踩坑 | `.claude/playwright-mcp-notes.md` |
| Perf 量測 baseline | `.claude/perf-baseline.md` |

---

## 10. 過去 session 已確立但未在 spec 的事

- Phase 25 不走純 Konva（曾經是計畫，已撤回，理由是 Konva 上限約 300-500 AP，達不到 1000 AP 規格）
- Raw WebGL 全套 path 評估後不選（DX 災難、bug surface 太大、PixiJS 已夠 1000 AP 規格）
- PixiJS v8 自帶 WebGPU 後端，custom shader 用 `PIXI.Shader({ glProgram, gpuProgram })` 雙寫（一次性多 30% shader 工程，換 WebGPU 自動升級路徑）
- Heatmap shader 在 1000 AP 規格下需要 tile-based culling + AP data texture + dirty tile update，shader 改造未進 Phase 25 但寫進 spec §3.4.1
