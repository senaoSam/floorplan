# CLAUDE.md — Floorplan System

## Project Overview

A standalone, closed-loop network floor plan planning tool (inspired by Hamina Network Planner).
Built as a pure-frontend app using mock data. Intended for eventual embedding into a Flux-based main product.

---

## Tech Stack Constraints

| Concern | Choice | Reason |
|---|---|---|
| React | **17.0.2** — `ReactDOM.render()`, NOT `createRoot` | Must integrate with main product (React 17) |
| react-konva | **17.0.2-6** (exact) | Only npm version supporting React 17 |
| konva | **^8.0.1** | Peer dep constraint of react-konva 17.x |
| @react-three/fiber | **7.0.29** | Last version with `react >=17.0`; v8+ requires React 18 |
| State | **Zustand v4** | Isolated from main product's Flux store |
| Styles | **.sass** (indented syntax, NOT .scss) | Matches main product convention |
| Language | **Plain JavaScript** (no TypeScript) | Main product has no TypeScript |
| Node.js | **20.x** | See `.node-version`; managed by fnm |
| Build | **Vite + pnpm** | |
| Path alias | `@` → `./src` | Configured in vite.config.js |

### Shell Environment
Shell 預設的 Node 版本不正確，執行 build / dev 等指令前必須先載入 fnm：
```bash
eval "$(fnm env)" && fnm use
```

### Build 驗證
**不要使用 `pnpm build` 來確認程式碼是否正常。** 由使用者自行在本地驗證。

---

## Architecture

### Integration Boundary
This system is closed-loop internally. The future integration point is:
```jsx
<FloorplanSystem buildingData={...} onSave={...} />
```
All internal state uses Zustand. External systems communicate only through props/callbacks.

### Store Structure
| Store | Key State |
|---|---|
| `useEditorStore` | `editorMode`, `viewMode`, `selectedId`, `selectedType` |
| `useFloorStore` | `floors[]`, `activeFloorId`, `setScale()` |
| `useWallStore` | `wallsByFloor{}` |
| `useAPStore` | `apsByFloor{}` |
| `useScopeStore` | `scopesByFloor{}` |

### Zustand Subscription Pattern
**Always subscribe to data directly — never subscribe to getter functions:**
```js
// ✅ Correct — reactive
const walls = useWallStore((s) => s.wallsByFloor[floorId] ?? [])

// ❌ Wrong — subscribes to function ref, won't re-render on data change
const getWalls = useWallStore((s) => s.getWalls)
```

### Coordinate System
All canvas objects are stored in **canvas coordinates** (image pixels).
Viewport state `{ x, y, scale }` is managed in `Editor2D`. Convert screen → canvas with:
```js
const toCanvasPos = (screenPos) => ({
  x: (screenPos.x - viewport.x) / viewport.scale,
  y: (screenPos.y - viewport.y) / viewport.scale,
})
```

---

## Key Patterns

### Layer Order (inside Konva Stage)
Bottom to top:
1. Background Rect (dark fill)
2. FloorImageLayer
3. ScopeLayer
4. WallLayer
5. APLayer
6. ScaleLayer (only in DRAW_SCALE mode)

### Ghost Line Visibility
Double-line technique for visibility on both light and dark backgrounds:
- Black outline (strokeWidth 4, opacity 0.5) + colored inner line (cyan `#00e5ff` for walls, yellow `#f1c40f` for scale/scope)

### Keyboard Handler Guard
Always skip Delete/Backspace when focus is inside an input:
```js
if (e.key === 'Delete' || e.key === 'Backspace') {
  const tag = e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  // ...delete selected object
}
```

### Materials (`src/constants/materials.js`)
6 materials sorted by dB loss ascending: Glass(2) → Drywall(3) → Wood(4) → Brick(8) → Concrete(12) → Metal(20).
Default wall material: `MATERIALS.CONCRETE`.

### AP Frequency Colors
- 2.4 GHz: `#f39c12`
- 5 GHz: `#4fc3f7`
- 6 GHz: `#a855f7`

---

## Strict Rules

> These rules must be followed at all times without exception.

1. **Do not make any changes unrelated to the current prompt.** Only modify what was explicitly asked.
2. **When in doubt, ask — never guess.** If anything is unclear or uncertain, discuss with the user before proceeding.

---

## Session Start

**At the beginning of every new conversation:**
1. 讀 `.claude/workflow.md` 了解協作流程
2. 讀 `.claude/task.md` 了解目前任務進度
3. 讀 `.claude/file-structure.md` 了解檔案結構

---

## Conventions

- No TypeScript, no JSDoc, no prop-types
- No `.scss` files — only `.sass` (indented syntax)
- SASS files use `@use '@/styles/variables' as *`
- IDs generated with `generateId(prefix)` from `@/utils/id`

---

## .claude/ 資料夾

| 檔案 | 用途 |
|------|------|
| `.claude/workflow.md` | 協作流程規範（commit、測試、回應語言） |
| `.claude/file-structure.md` | 完整檔案結構與各檔說明（隨時更新） |
| `.claude/task.md` | 任務進度追蹤 |
| `.claude/spec.md` | 產品規格書 |
| `.claude/youtube.md` | Hamina Network Planner 影片筆記 |
