# Color / Icon Legend — Phase 18 Task 24-5

> Single source of truth for the colours used by Phase 18 grouping
> (toolbar separators / mode badge / right-panel accent strip).
>
> 規則：**同一 group 的 colour 必須在 toolbar、mode badge、right panel 三個
> 表面上用同一個 hex**，不然使用者眼睛追不到 → Phase 18 整個設計目的就垮了。
>
> 凡是要新加 object type / 重排 toolbar group / 調色票，**先改這份表**，
> 再去動三個表面的程式碼。

---

## 1. Group accent colours

7 個 toolbar group 對應 5 種 group accent（操作 / 結構 共用 slate，因為兩者
都是「結構性 / 中性」動作）。

| Group | UI 中文 | Accent | Hex | Soft fill (15% α) | 物件 / 動作 |
|---|---|---|---|---|---|
| pointer  | 操作        | slate-400  | `#94a3b8` | `rgba(148, 163, 184, 0.15)` | Select / Marquee / Pan |
| structure | 結構        | slate-400  | `#94a3b8` | `rgba(148, 163, 184, 0.15)` | Wall / Door+Window / FloorHole |
| wireless | 無線        | cyan-400   | `#4fc3f7` | `rgba(79, 195, 247, 0.15)`  | AP / Scope |
| cable    | 網路布線    | violet-400 | `#a78bfa` | `rgba(167, 139, 250, 0.15)` | Switch / Cable Tray / Riser |
| measure  | 標註        | amber-400  | `#f1c40f` | `rgba(241, 196, 15, 0.15)`  | Scale（未來：Dimension / Note） |
| meta     | 樓層 / 輔助 | gray-400   | `#9ca3af` | `rgba(156, 163, 175, 0.15)` | FloorImage / Batch / Align / Crop |

**Cross-surface check**（這 5 個地方拿同一個 hex）：

| Surface | 程式碼位置 | 怎麼接 accent |
|---|---|---|
| Toolbar group separator | `src/components/Toolbar/Toolbar.sass`（24-2） | `__separator` 細直線，目前統一灰色（未來可上 group 色） |
| Mode badge 左邊條 | `src/features/editor/Editor2D.sass` `&__mode-hint--{accent}` | `border-left-color`（24-4） |
| Right panel 頂部彩條 | `src/components/PanelRight/_shared/shared.sass` `.pnl--{type}` | `--panel-accent` CSS var（24-3） |
| Selected object stroke | 各 Layer | 統一用 `#e74c3c` 紅，**不**走 group accent（selected ≠ grouped） |
| Form 元件 focus ring / accent | `_shared/shared.sass` | `var(--panel-accent)` 從 PanelShell 繼承 |

---

## 2. Sub-type 顏色（在 group accent 之外的物件 sub-type）

### AP 頻段
| 頻段 | Hex | 用在 |
|---|---|---|
| 2.4 GHz | `#f39c12` | AP marker 環色 + APPanel 頻段 chip + heatmap legend |
| 5 GHz   | `#4fc3f7` | 同上 |
| 6 GHz   | `#a855f7` | 同上 |

### Switch / IDF / MDF / Router
這四個 kind 各自的 accent — 在 `src/store/useCableStore.js` `getSwitchKindColor()`。

| Kind | Hex |
|---|---|
| switch | `#4fc3f7` cyan |
| idf    | `#a855f7` purple |
| mdf    | `#fb923c` orange |
| router | `#2ed573` green |

### Wall material
6 種材質的色 swatch — 在 `src/constants/materials.js`。色碼依 dB loss 升序：
glass / drywall / wood / brick / concrete / metal。

### Tray system / 用途
5 種 system 各自色 — 在 `src/store/useCableStore.js` `TRAY_SYSTEMS`：
data / power / fire / backbone / mixed。CableTrayPanel 識別 section 有完整 legend。

### Scope (in / out)
- In-Scope:  `#2ed573` green
- Out-of-Scope: `#ff4757` red

### Riser
固定紫: `#a78bfa`（跟 cable group accent 一致）

### Floor Hole
固定紫: `#7c3aed` violet-600（比 cable accent 深一階，避免跟 Riser 混淆）

### Heatmap
- RSSI / SINR / SNR / CCI 各自 colormap — 在 `src/features/heatmap/modes.js`
- 跟 group accent **無關**，是純 RF 視覺化

---

## 3. Selected / Hover / Focus 共用色

跨 group 統一，**不**用 group accent：

| 狀態 | Hex | 用在 |
|---|---|---|
| Selected stroke | `#e74c3c` | 所有物件被選取時的紅環 |
| Focus halo (related device, 17-2) | `#818cf8` indigo-400 | 點 AP 時相關 switch / cable 高亮 |
| Hover invert (23-3f / hover-invert pass) | 物件 fill / stroke 對調 — 不引入新色 |
| Weak hover ring | `rgba(255, 255, 255, 0.35)` | 非 SELECT mode 右鍵命中提示（被 hover invert 取代） |

---

## 4. Toolbar icon stroke

全部 SVG icon `currentColor`，由 button 狀態決定：

| 狀態 | CSS color |
|---|---|
| Idle  | `$text-secondary` (slate-400-ish) |
| Hover | `$text-primary` (white-ish) |
| Active | `$accent` (cyan, currently `#4fc3f7`) |
| Disabled | opacity 0.3 |

**Active 顏色目前不分 group** — toolbar 所有 active icon 都是 cyan。這是
24-5 留下的**已知 inconsistency** — 真要嚴格對齊應該讓 icon active color
跟著 group accent 走（畫牆 active 就 slate、放置 AP active 就 cyan、繪製
線槽 active 就 violet）。**未做** — 工程量不大但要全 7 群 icon 都驗，等
有實際視覺需求再補。

---

## 5. 新增 object type 時的 checklist

把新物件接進現有 group：

1. **挑 group**：物件本質屬於哪個 group？參考 §1。
2. **更新 `src/features/editor/modeCapabilities.js`** — 加新 mode 的 cap 物件，引用對的 `dimOthers` 鍵。
3. **更新 `src/components/Toolbar/Toolbar.jsx`** — 把新 icon 加到對的 group。
4. **更新 `src/components/Icon/Icon.jsx`** — 加新 SVG icon。
5. **更新 `src/features/editor/Editor2D.jsx` `modeHintMap`** — 加新 mode 的 `group` + `accent`。
6. **更新 `src/components/PanelRight/_shared/shared.sass` `.pnl--{type}`** — 加新物件類型對應的 accent var。
7. **更新本檔** §2 — 如果新物件有 sub-type 需要色票，加進來。

如果是新 group（很少見）：
- 上面 1–7 全部要做 +
- §1 加新 row
- `_shared/shared.sass` 加新 `.pnl--{group}` block 設 `--panel-accent`
- `Editor2D.sass` 加新 `&__mode-hint--{accent}` block 設 `border-left-color`
- `Toolbar.jsx` `GROUPS` 加新 group entry

---

## 6. Open colour debt（未來要清的）

- **Toolbar icon active color**：目前全 cyan，未跟 group 對齊（§4 已標註）
- **Toolbar group separator**：目前細灰直線，未上 group 色 — 加上 group 色可能讓 toolbar 更易讀，但目前看來沒到 reviewer 抱怨的程度，暫緩
- **Scope-out 紅 vs Selected 紅**：兩個都是紅色家族（`#ff4757` vs `#e74c3c`），同時出現時可能混淆。先觀察使用者有沒有提，再決定要不要分家
- **Riser `#a78bfa` vs FloorHole `#7c3aed`**：兩個紫，視覺上有時不夠分。FloorHole 用點線輪廓+紫 fill 已經足夠區分，目前不動

---

## 7. Quick reference card

```
                 Hex        Toolbar    Mode badge    Right panel
─────────────────────────────────────────────────────────────────
操作 / 結構      #94a3b8    (slate)    --pointer/    .pnl--wall/
                                       --structure   .pnl--scope/...

無線             #4fc3f7    (cyan)     --wireless    .pnl--ap

網路布線         #a78bfa    (violet)   --cable       .pnl--switch/
                                                     .pnl--cable_tray/
                                                     .pnl--cable_riser

標註             #f1c40f    (amber)    --measure     .pnl--measure

樓層 / 輔助      #9ca3af    (gray)     --meta        .pnl--meta/
                                                     .pnl--floor_image/
                                                     .pnl--batch
```
