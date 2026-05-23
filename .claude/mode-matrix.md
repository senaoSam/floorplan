# Mode × Interaction Matrix

> Phase 17 / Layer 23 Task 23-1 — audit + spec for what each editor mode should
> allow on each Layer's interaction surface. Goal: a single source of truth so
> Layers stop carrying ad-hoc `if (isXMode)` guards (23-2 will derive a
> `getModeCapability(mode)` helper from this doc; 23-3 refactors all Layers to
> consult it).

Source of `editorMode` enum: `src/store/useEditorStore.js` (`EDITOR_MODE`).
Source of current ad-hoc gating: each Layer in `src/features/editor/layers/`.

---

## 1. Modes (rows)

14 editor modes today. Grouped by intent for readability — the runtime enum is flat.
中文名稱對齊 `Editor2D.jsx` 的 mode hint label，後續 toolbar / panel 一致使用。

| Group | Modes |
|---|---|
| Pointer | `SELECT` 選取, `MARQUEE_SELECT` 框選, `PAN` 平移 |
| Structural draw | `DRAW_WALL` 畫牆, `DOOR_WINDOW` 門窗, `DRAW_SCOPE` 範圍, `DRAW_FLOOR_HOLE` 中庭 |
| Wireless place | `PLACE_AP` 放置 AP |
| Cable place / draw | `PLACE_SWITCH` 放置 Switch, `DRAW_CABLE_TRAY` 繪製線槽, `PLACE_RISER` 放置 Riser |
| Floor meta | `DRAW_SCALE` 比例尺, `CROP_IMAGE` 裁切, `ALIGN_FLOOR` 樓層對齊 |

---

## 2. Interaction surfaces (columns)

These are the surfaces a Layer can expose per object. Naming is what 23-2 will
use as capability flag names.

| Flag | What it controls | Today's owner |
|---|---|---|
| `allowSelectClick` | Left-click on an existing object selects it (and opens its panel). | Most Layers wire `onClick={onXClick}` unconditionally. |
| `allowSelectHover` | **STRONG** hover highlight (stroke thicken / glow, move cursor) — implies "left-click will select / drag". | Mostly unconditional; some Layers gate via `dimmed`. |
| `allowCommandHover` (23-3f) | **WEAK** hover highlight (faint outline only) — implies "right-click will open command menu". Visually quieter than `allowSelectHover` so non-SELECT modes don't pretend objects are selectable. | New; per-Layer 23-3f addition. |
| `allowDragExisting` | Existing object can be dragged to a new position. | `WallLayer` gates on `!isDoorWindowMode && !isTrayMode`; AP/Switch/Scope/FloorHole/Riser always draggable; tray gates on `!isDrawingMode && !dimmed`. |
| `showQuickDelete` | Red X badge on hover. | `WallLayer` hides under door-window mode; everyone else always shows. |
| `showHandles` | Per-vertex / endpoint handles (wall endpoints, tray vertices, scope/scope-hole vertex handles when selected). | `WallLayer` hides under door-window mode; tray hides under drawing mode. |
| `showMagnet` | Tray / riser magnet halo. | Tray: drawing mode OR selected OR hover. Riser: placing mode OR selected OR hover. |
| `cursor` | Stage-level cursor (`default` / `crosshair` / `grab` / `move` / ...). | Computed in `Editor2D.jsx` per mode, overridden by per-object `setHoverCursor`. |
| `allowContextMenu` | Right-click opens context menu. | Today only `DRAW_CABLE_TRAY` (tray rename/split/extend/merge) and structural draw modes (right-click = cancel draft); see §6. |
| `dimOthers` | Objects of other types render at reduced opacity to fade into background. | Most Layers accept `dimmed` from `isDoorWindowMode`. |

Surfaces deliberately **not** in the matrix:

- Mode-specific *draft preview* (ghost wall line, tray draft polyline, scope
  polygon-in-progress). These live inside the active-mode Layer code and are
  not cross-mode interactions.
- Stage-level pan via middle-button or `PAN` mode — that's a Stage prop, not a
  per-object capability.

---

## 3. Capability matrix

Read as: in mode *row*, on objects belonging to *column-category*, should the
surface be enabled?

Categories merge same-treatment Layers:

- **OBJ-struct**: Wall, FloorHole, Scope
- **OBJ-wireless**: AP
- **OBJ-cable**: Switch, Cable Tray, Riser
- **OBJ-meta**: Floor image (background plane)

Cells use:
- `✓` allowed
- `–` disabled
- `(self)` only for objects native to that mode (e.g. wall handles in
  `DRAW_WALL` are about the *draft*, not existing walls)

### 3.1 `allowSelectClick`

| Mode | OBJ-struct | OBJ-wireless | OBJ-cable | OBJ-meta (floor img) |
|---|---|---|---|---|
| SELECT 選取 | ✓ | ✓ | ✓ | ✓ |
| MARQUEE_SELECT 框選 | – (drag selects rectangle; clicking objects shouldn't single-select) | – | – | – |
| PAN 平移 | – | – | – | – |
| DRAW_WALL 畫牆 | – | – | – | – |
| DOOR_WINDOW 門窗 | (target wall only — clicking wall = pick host for opening) | – | – | – |
| DRAW_SCOPE 範圍 | – | – | – | – |
| DRAW_FLOOR_HOLE 中庭 | – | – | – | – |
| PLACE_AP 放置 AP | – | – | – | – |
| PLACE_SWITCH 放置 Switch | – | – | – | – |
| DRAW_CABLE_TRAY 繪製線槽 | – | – | – | – |
| PLACE_RISER 放置 Riser | – | – | – | – |
| DRAW_SCALE 比例尺 | – | – | – | – |
| CROP_IMAGE 裁切 | – | – | – | – |
| ALIGN_FLOOR 樓層對齊 | – | – | – | – |

### 3.2 `allowSelectHover`

| Mode | OBJ-struct | OBJ-wireless | OBJ-cable | OBJ-meta |
|---|---|---|---|---|
| SELECT 選取 | ✓ | ✓ | ✓ | ✓ |
| MARQUEE_SELECT 框選 | – | – | – | – |
| PAN 平移 | – | – | – | – |
| DRAW_WALL 畫牆 | – | – | – | – |
| DOOR_WINDOW 門窗 | ✓ (wall only — must highlight target wall) | – | – | – |
| DRAW_SCOPE 範圍 | – | – | – | – |
| DRAW_FLOOR_HOLE 中庭 | – | – | – | – |
| PLACE_AP 放置 AP | – | – | – | – |
| PLACE_SWITCH 放置 Switch | – | – | – | – |
| DRAW_CABLE_TRAY 繪製線槽 | ✓ (tray endpoint snap visual — but no selection state change) | – | ✓ (only for snap halos, not selectable click) | – |
| PLACE_RISER 放置 Riser | – | – | ✓ (magnet halo on candidate trays for snap visual) | – |
| DRAW_SCALE 比例尺 | – | – | – | – |
| CROP_IMAGE 裁切 | – | – | – | – |
| ALIGN_FLOOR 樓層對齊 | – | – | – | – |

> Note: in non-SELECT modes, hover may still surface *snap-related* affordances
> (tray endpoint glow when drawing a new tray) but must not produce a "this
> object will be selected" cue (no thick stroke, no move-cursor, no badge).

### 3.3 `allowDragExisting`

| Mode | OBJ-struct | OBJ-wireless | OBJ-cable | OBJ-meta |
|---|---|---|---|---|
| SELECT 選取 | ✓ | ✓ | ✓ | ✓ (move floor image — currently via Crop / Align mode only; leaving SELECT path open) |
| MARQUEE_SELECT 框選 | – | – | – | – |
| PAN 平移 | – | – | – | – |
| DRAW_WALL 畫牆 | – | – | – | – |
| DOOR_WINDOW 門窗 | – | – | – | – |
| DRAW_SCOPE 範圍 | – | – | – | – |
| DRAW_FLOOR_HOLE 中庭 | – | – | – | – |
| PLACE_AP 放置 AP | – | – | – | – |
| PLACE_SWITCH 放置 Switch | – | – | – | – |
| DRAW_CABLE_TRAY 繪製線槽 | – | – | – | – |
| PLACE_RISER 放置 Riser | – | – | – | – |
| DRAW_SCALE 比例尺 | – | – | – | – |
| CROP_IMAGE 裁切 | – | – | – | – |
| ALIGN_FLOOR 樓層對齊 | – | – | – | – |

> Rule of thumb: drag-existing is **only** available in `SELECT`. Every other
> mode has an active drawing/placing intent and the canvas drag gesture is
> reserved for that (placing a new object, picking a draft anchor).

### 3.4 `showQuickDelete` (hover red-X badge)

| Mode | OBJ-struct | OBJ-wireless | OBJ-cable | OBJ-meta |
|---|---|---|---|---|
| SELECT 選取 | ✓ | ✓ | ✓ | – |
| MARQUEE_SELECT 框選 | – | – | – | – |
| PAN 平移 | – | – | – | – |
| All other modes 其他所有 mode | – | – | – | – |

> Quick-delete is a SELECT-only convenience. In a drawing mode the X invites
> mis-clicks (you're trying to land a vertex, not delete a wall).

### 3.5 `showHandles` (endpoint / vertex handles when selected)

| Mode | OBJ-struct (wall endpoints, scope/hole vertices) | OBJ-cable (tray vertices) | OBJ-wireless / meta |
|---|---|---|---|
| SELECT 選取 | ✓ | ✓ | n/a (no per-vertex handles) |
| All other modes 其他所有 mode | – | – | – |

### 3.6 `showMagnet` (tray / riser magnet halo)

| Mode | Tray | Riser |
|---|---|---|
| SELECT 選取 | only on selected / hovered | only on selected / hovered |
| DRAW_CABLE_TRAY 繪製線槽 | ✓ on all trays (drawing visibility) | ✓ on all risers (snap candidates) |
| PLACE_SWITCH 放置 Switch | ✓ on all trays (snap-to-tray for switch hub — 17-3) | – |
| PLACE_RISER 放置 Riser | – | ✓ on all risers (placing) + halos on tray magnets if relevant |
| All other modes 其他所有 mode | hidden | hidden |

### 3.7 `cursor`

Per-mode stage cursor today (`Editor2D.jsx` lines 1457–1467):

| Mode | Cursor |
|---|---|
| SELECT 選取 | `default` (per-object overrides to `grab`/`move`/`pointer`) |
| MARQUEE_SELECT 框選 | `crosshair` |
| PAN 平移 | `grab` |
| DRAW_SCALE 比例尺 | computed (`cursorScale`) |
| DRAW_WALL 畫牆 | computed (`cursorWall`) |
| PLACE_AP 放置 AP | computed (`cursorAP`) |
| PLACE_SWITCH 放置 Switch | `crosshair` |
| DRAW_CABLE_TRAY 繪製線槽 | computed (`cursorTray`) |
| PLACE_RISER 放置 Riser | `crosshair` |
| DOOR_WINDOW 門窗 | `crosshair` |
| CROP_IMAGE 裁切 | `crosshair` |
| DRAW_SCOPE / DRAW_FLOOR_HOLE 範圍 / 中庭 | `crosshair` |
| ALIGN_FLOOR 樓層對齊 | `default` |

Per-object hover cursor overrides should only fire when `allowDragExisting` or
`allowSelectClick` is true for that object. This is the gap reviewer flagged
(wall in tray mode currently goes to `move` cursor on hover — wrong).

### 3.8 `allowContextMenu`

**23-3f update**: right-click on an object opens the command menu **in every mode without an active draft**. The draft-cancel semantics still take precedence whenever a draft is in progress (Editor2D computes `draftActive` and dynamically strips `allowContextMenu` + `allowCommandHover` for that frame).

| Mode (no draft active) | Object right-click | Empty canvas right-click |
|---|---|---|
| SELECT 選取 | Open object menu (rename / 刪除; "選取" item hidden — left-click already does that) | No-op |
| MARQUEE_SELECT 框選 / PAN 平移 | Open object menu (incl. "選取" item to promote into selection without leaving mode) | No-op |
| DRAW_WALL 畫牆 / DOOR_WINDOW 門窗 / DRAW_SCOPE 範圍 / DRAW_FLOOR_HOLE 中庭 / PLACE_AP / PLACE_SWITCH / DRAW_CABLE_TRAY 繪製線槽 / PLACE_RISER / DRAW_SCALE 比例尺 | Open object menu (incl. "選取") | No-op |
| CROP_IMAGE 裁切 / ALIGN_FLOOR 樓層對齊 | No object menu (these modes' draft IS the crop box / floor transform itself, no atomic "no draft" state) | No-op |

Tray uses its own `TrayContextMenu` (rename / split / extend / merge / convert / delete — 20-4), wired through the same dispatcher.

| Mode | Object right-click WITH draft active | Empty canvas right-click |
|---|---|---|
| Any mode with `draftActive === true` (wall draft / scope polygon / floor-hole polygon / tray polyline / scale points / crop box / door-window first click) | Cancel / commit the in-progress draft (NOT open menu) | Same — cancel draft |

---

## 4. Identified gaps (current behaviour vs spec)

Below are the cases where today's code disagrees with the matrix above. These
are the deliveries 23-3 should fix.

| # | Gap | Today | Spec (this doc) |
|---|---|---|---|
| G1 | Wall hover under tray mode shows endpoint handles + X badge + `move` cursor (reviewer's example) | `WallLayer` only guards on `isDoorWindowMode` for handles / X; drag-gating uses `!isDoorWindowMode && !isTrayMode` | None of `allowSelectHover` / `showHandles` / `showQuickDelete` are true for OBJ-struct in DRAW_CABLE_TRAY 繪製線槽 → all suppressed |
| G2 | AP / Switch / Riser hover X badge + drag stay live in every mode | No mode gating in `APLayer`, `SwitchLayer`, `RiserLayer` | Only available in SELECT 選取 |
| G3 | Scope / FloorHole drag + hover X stay live in every mode | No mode gating in `ScopeLayer` / `FloorHoleLayer` | Only available in SELECT 選取 |
| G4 | Wall hover handles shown in PLACE_AP 放置 AP / PLACE_SWITCH 放置 Switch / PLACE_RISER 放置 Riser / DRAW_SCALE 比例尺 / DRAW_SCOPE 範圍 / DRAW_FLOOR_HOLE 中庭 / CROP_IMAGE 裁切 / ALIGN_FLOOR 樓層對齊 | `WallLayer` only gates door-window | Hidden everywhere except SELECT 選取 |
| G5 | Tray vertex handles when tray is selected in a non-SELECT mode | Guarded by `!isDrawingMode` only (so visible in PLACE_AP 放置 AP、DRAW_WALL 畫牆 等) | Only available in SELECT 選取 |
| G6 | `dimmed` is wired from `isDoorWindowMode` only; other modes don't fade off-target objects | Per-Layer `dimmed={isDoorWindowMode}` | Generic `dimOthers` flag — any draw/place mode should fade unrelated object types so the canvas reads as "you are in X mode" |
| G7 | Per-object hover cursor (`move` / `grab`) fires regardless of mode | `setHoverCursor` is called in `onMouseEnter` of every marker | Skip the override unless `allowDragExisting` or `allowSelectClick` is true |
| G8 | `FloorImageLayer` accepts `isSelectMode` prop but no other Layer follows the same convention | Inconsistent naming | All Layers should consume a single `capability` prop derived from current mode |

---

## 5. Object → Layer cross-reference

For 23-3 refactor planning — which Layer owns each object category.

| Category | Layers to touch |
|---|---|
| OBJ-struct | `WallLayer.jsx`, `ScopeLayer.jsx`, `FloorHoleLayer.jsx` |
| OBJ-wireless | `APLayer.jsx` |
| OBJ-cable | `SwitchLayer.jsx`, `CableTrayLayer.jsx`, `RiserLayer.jsx` |
| OBJ-meta | `FloorImageLayer.jsx` |
| Mode-native draft layers | `ScaleLayer.jsx`, `CropLayer.jsx` (only render in their mode; no audit needed) |
| Read-only overlay | `HeatmapLayer.jsx`, `CableLayer.jsx`, `RefWallLayer.jsx`, `RefVectorLayer.jsx` (no interaction; excluded) |

---

## 6. Right-click semantics (cross-cutting clarification)

Right-click is currently overloaded:

1. **Cancel / commit draft** when a drawing mode has unfinished state — wall
   draft start, scope polygon-in-progress, floor-hole polygon, crop start,
   door-window first point, tray draft polyline (commits ≥ 2 points).
2. **Open object context menu** (SELECT mode only, currently tray-only).

These do not conflict: rule 1 only applies when a draft is active, and a draft
only exists in a drawing mode (which already has `allowContextMenu = false`
for the object-menu path). 23-2 should encode this as:

```
shouldHandleRightClick(mode, draftActive, hitObject) =
  draftActive          → 'cancel-or-commit-draft'
  mode === SELECT      → openContextMenuFor(hitObject)
  else                 → 'no-op'
```

---

## 7. Open questions

Items to confirm with the user before 23-2 implementation:

- **Q1** — 在 `MARQUEE_SELECT` 框選 mode 中，「點」物件（無拖曳）應該 toggle
  該物件在框選結果中的成員資格，還是 no-op？目前：點擊 = 單選（行為等同
  SELECT 選取）。Spec 表標 `–`，傾向 no-op 比較乾淨，但可能違反肌肉記憶。
- **Q2** — `ALIGN_FLOOR` 樓層對齊 mode 完全不允許物件互動，確認對齊模式下
  不需要選取 wall / AP？今天因為「對齊是整層樓搬」，所以實作上也選不到。
- **Q3** — `CROP_IMAGE` 裁切 mode 同樣禁止物件互動，確認裁切時不需要同時
  搬牆等其他物件（大機率是）。
- **Q4** — 在 `DRAW_CABLE_TRAY` 繪製線槽 mode 中，switch 跟 riser 是合法的
  snap 目標（端點會變成 tray vertex）。hover 時要不要顯示 snap halo 但不
  進入選取狀態？目前兩者都沒有 — 大概可以維持，矩陣把 OBJ-cable 在 tray
  mode 的 `allowSelectHover` 標 `–`，但允許 snap-specific halo。
- **Q5** — `dimOthers` 政策（G6）：哪些 mode 要把哪些物件類型淡化？
  提議：每個 draw / place mode 把不屬於自己 target 類別的 OBJ-* 全部淡化
  到 opacity ~0.4，但對比度需要跟 reviewer 確認。
