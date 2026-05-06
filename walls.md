# Floorplan Vector Extraction Spec

## Goal

從 floorplan image 中自動抽取：

- wall vectors
- door vectors
- window vectors

輸出：

```ts
type VectorLine = {
  x1: number
  y1: number

  x2: number
  y2: number

  thickness: number

  orientation:
    | "horizontal"
    | "vertical"

  type:
    | "wall"
    | "door"
    | "window"
}
```

---

# Core Strategy

不要直接保存 pixel。

流程：

```txt
image
→ color segmentation
→ binary mask
→ horizontal / vertical scan
→ segment extraction
→ segment merge
→ center line extraction
→ vector output
```

---

# Why This Works Well

你的 floorplan 有這些特徵：

```txt
1. orthogonal layout
2. 明確顏色
3. 線條乾淨
4. 門窗顏色獨立
5. 大多數為水平/垂直
```

所以：

```txt
line scan
比 Hough transform 更穩
比 AI 更可控
比 contour tracing 更簡單
```

---

# Step 1 — Convert Image To ImageData

```ts
function getImageData(
  img: HTMLImageElement
): ImageData
```

```ts
const canvas = document.createElement("canvas")
const ctx = canvas.getContext("2d")

canvas.width = img.naturalWidth
canvas.height = img.naturalHeight

ctx.drawImage(img, 0, 0)

const imageData = ctx.getImageData(
  0,
  0,
  canvas.width,
  canvas.height
)
```

---

# Step 2 — Color Classification

## Wall

```txt
r < 50
g < 50
b < 50
```

---

## Door

```txt
r > 180
g > 150
b < 120
```

---

## Window

```txt
r < 130
g > 120
b > 150
```

---

# classifyPixel()

```ts
function classifyPixel(
  r: number,
  g: number,
  b: number
):
  | "wall"
  | "door"
  | "window"
  | null
```

Implementation:

```ts
if (r < 50 && g < 50 && b < 50) {
  return "wall"
}

if (r > 180 && g > 150 && b < 120) {
  return "door"
}

if (r < 130 && g > 120 && b > 150) {
  return "window"
}

return null
```

---

# Step 3 — Build Binary Masks

## Goal

Convert image into:

```txt
0 = background
1 = target
```

---

# Masks Structure

```ts
type Masks = {
  wall: Uint8Array
  door: Uint8Array
  window: Uint8Array
}
```

---

# buildMasks()

```ts
function buildMasks(
  imageData: ImageData
): Masks {

  const { width, height, data } = imageData

  const masks = {
    wall: new Uint8Array(width * height),
    door: new Uint8Array(width * height),
    window: new Uint8Array(width * height)
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {

      const i = (y * width + x) * 4

      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]

      const type = classifyPixel(r, g, b)

      if (type) {
        masks[type][y * width + x] = 1
      }
    }
  }

  return masks
}
```

---

# Step 4 — Extract Horizontal Segments

## Core Idea

Convert:

```txt
0011111111000
```

Into:

```ts
{
  x1: 2,
  y1: 10,

  x2: 9,
  y2: 10
}
```

---

# Segment Type

```ts
type Segment = {
  x1: number
  y1: number

  x2: number
  y2: number

  orientation:
    | "horizontal"
    | "vertical"
}
```

---

# extractHorizontalSegments()

```ts
function extractHorizontalSegments(
  mask: Uint8Array,
  width: number,
  height: number,
  minLength = 8
): Segment[] {

  const segments = []

  for (let y = 0; y < height; y++) {

    let start = null

    for (let x = 0; x < width; x++) {

      const value = mask[y * width + x]

      if (value && start === null) {
        start = x
      }

      if ((!value || x === width - 1) && start !== null) {

        const end =
          value && x === width - 1
            ? x
            : x - 1

        const length = end - start + 1

        if (length >= minLength) {

          segments.push({
            x1: start,
            y1: y,

            x2: end,
            y2: y,

            orientation: "horizontal"
          })
        }

        start = null
      }
    }
  }

  return segments
}
```

---

# Step 5 — Extract Vertical Segments

Same logic vertically.

---

# extractVerticalSegments()

```ts
function extractVerticalSegments(
  mask: Uint8Array,
  width: number,
  height: number,
  minLength = 8
): Segment[] {

  const segments = []

  for (let x = 0; x < width; x++) {

    let start = null

    for (let y = 0; y < height; y++) {

      const value = mask[y * width + x]

      if (value && start === null) {
        start = y
      }

      if ((!value || y === height - 1) && start !== null) {

        const end =
          value && y === height - 1
            ? y
            : y - 1

        const length = end - start + 1

        if (length >= minLength) {

          segments.push({
            x1: x,
            y1: start,

            x2: x,
            y2: end,

            orientation: "vertical"
          })
        }

        start = null
      }
    }
  }

  return segments
}
```

---

# Step 6 — Merge Duplicate Segments

## Problem

Wall thickness creates multiple parallel rows.

Example:

```txt
████████
████████
████████
```

Becomes:

```txt
3 duplicated horizontal lines
```

Need:

```txt
1 center vector
```

---

# Merge Rule

Horizontal segments belong to same wall if:

```txt
abs(y1 - y2) <= tolerance
```

AND:

```txt
x ranges overlap
```

---

# mergeHorizontalSegments()

```ts
function mergeHorizontalSegments(
  segments: Segment[],
  tolerance = 4
) {

  const groups = []

  for (const seg of segments) {

    let matched = null

    for (const group of groups) {

      const sameY =
        Math.abs(group.cy - seg.y1)
        <= tolerance

      const overlap =
        !(
          seg.x2 < group.x1 - tolerance ||
          seg.x1 > group.x2 + tolerance
        )

      if (sameY && overlap) {
        matched = group
        break
      }
    }

    if (matched) {

      matched.items.push(seg)

      matched.x1 =
        Math.min(matched.x1, seg.x1)

      matched.x2 =
        Math.max(matched.x2, seg.x2)

      matched.cy = Math.round(

        matched.items.reduce(
          (sum, s) => sum + s.y1,
          0
        ) / matched.items.length
      )

    } else {

      groups.push({

        items: [seg],

        x1: seg.x1,
        x2: seg.x2,

        cy: seg.y1
      })
    }
  }

  return groups.map(group => ({

    x1: group.x1,
    y1: group.cy,

    x2: group.x2,
    y2: group.cy,

    thickness: group.items.length,

    orientation: "horizontal"
  }))
}
```

---

# Step 7 — Merge Vertical Segments

Same logic vertically.

---

# Final Output

```ts
[
  {
    x1: 120,
    y1: 300,

    x2: 520,
    y2: 300,

    thickness: 8,

    orientation: "horizontal",

    type: "wall"
  }
]
```

---

# Main Extraction Pipeline

```ts
function extractVectors(
  imageData: ImageData
) {

  const { width, height } = imageData

  const masks =
    buildMasks(imageData)

  const result = {}

  for (const type of [
    "wall",
    "door",
    "window"
  ]) {

    const mask = masks[type]

    const horizontal =
      extractHorizontalSegments(
        mask,
        width,
        height,
        8
      )

    const vertical =
      extractVerticalSegments(
        mask,
        width,
        height,
        8
      )

    const mergedHorizontal =
      mergeHorizontalSegments(
        horizontal,
        5
      )

    const mergedVertical =
      mergeVerticalSegments(
        vertical,
        5
      )

    result[type] = [

      ...mergedHorizontal.map(v => ({
        ...v,
        type
      })),

      ...mergedVertical.map(v => ({
        ...v,
        type
      }))
    ]
  }

  return result
}
```

---

# Important Tunable Parameters

```ts
const CONFIG = {

  blackThreshold: 50,

  yellowThreshold: {
    r: 180,
    g: 150,
    b: 120
  },

  blueThreshold: {
    r: 130,
    g: 120,
    b: 150
  },

  minSegmentLength: 8,

  mergeTolerance: 5
}
```

---

# Why Not Hough Transform

Hough is good for:

- noisy scans
- rotated plans
- photographed documents

But your case:

```txt
clean orthogonal floorplans
```

So:

```txt
row/column scan
is simpler
faster
more deterministic
more editable
```

---

# Future Improvements

## Phase 2

Add OpenCV.js:

```txt
morphologyEx
dilate
erode
```

to clean masks.

---

## Phase 3

Add skeletonization:

```txt
wall blob
→ centerline
```

for irregular walls.

---

# Recommended Architecture

```txt
image
→ imageData
→ masks
→ vectors
→ editable objects
→ save JSON
```

Do NOT edit pixels directly.

Always convert to vectors first.









# Floorplan Vector Cleanup Spec

## Goal

將 raw skeleton vectors 清理成：

- clean wall graph
- clean door vectors
- clean window vectors

消除：

- spikes
- tiny segments
- duplicated lines
- fragmented walls
- broken junctions

---

# Cleanup Pipeline

```txt
raw vectors
→ remove short segments
→ merge collinear segments
→ snap nearby endpoints
→ detect junction nodes
→ split intersections
→ normalize wall graph
→ attach doors/windows
→ final vectors
```

---

# Raw Vector Problems

Raw extraction 會產生：

```txt
1. tiny spikes
2. duplicated wall lines
3. fragmented walls
4. broken T junctions
5. unconnected corners
6. noisy short segments
```

Example:

```txt
────── ──── ─────
```

Should become:

```txt
────────────────
```

---

# Step 1 — Remove Tiny Segments

## Goal

Remove noise lines.

---

# Rules

Remove if:

```txt
segment length < threshold
```

---

# Recommended Thresholds

```ts
const MIN_LENGTH = {

  wall: 12,

  door: 6,

  window: 6
}
```

---

# Segment Length

## Horizontal

```txt
abs(x2 - x1)
```

---

## Vertical

```txt
abs(y2 - y1)
```

---

# removeShortSegments()

```ts
function removeShortSegments(
  segments,
  minLength
) {

  return segments.filter(seg => {

    const length =
      seg.orientation === "horizontal"

        ? Math.abs(seg.x2 - seg.x1)

        : Math.abs(seg.y2 - seg.y1)

    return length >= minLength
  })
}
```

---

# Step 2 — Merge Collinear Segments

## Goal

Convert fragmented wall lines into continuous vectors.

---

# Before

```txt
──── ──── ─────
```

---

# After

```txt
───────────────
```

---

# Merge Conditions

Two segments can merge if:

---

## Same Orientation

```txt
horizontal + horizontal
vertical + vertical
```

---

## Same Axis

Horizontal:

```txt
abs(y1 - y2) <= tolerance
```

Vertical:

```txt
abs(x1 - x2) <= tolerance
```

---

## Small Gap

Horizontal:

```txt
gap between x ranges <= gapTolerance
```

Vertical:

```txt
gap between y ranges <= gapTolerance
```

---

# Recommended Parameters

```ts
const MERGE_CONFIG = {

  axisTolerance: 4,

  gapTolerance: 10
}
```

---

# mergeCollinearSegments()

```ts
function mergeCollinearSegments(
  segments,
  axisTolerance = 4,
  gapTolerance = 10
) {

  let changed = true

  while (changed) {

    changed = false

    outer:
    for (let i = 0; i < segments.length; i++) {

      for (let j = i + 1; j < segments.length; j++) {

        const a = segments[i]
        const b = segments[j]

        if (
          a.orientation !== b.orientation
        ) {
          continue
        }

        if (
          a.orientation === "horizontal"
        ) {

          const sameAxis =
            Math.abs(a.y1 - b.y1)
            <= axisTolerance

          const gap =
            Math.max(a.x1, b.x1)
            -
            Math.min(a.x2, b.x2)

          if (
            sameAxis &&
            gap <= gapTolerance
          ) {

            segments[i] = {

              ...a,

              x1: Math.min(a.x1, b.x1),

              x2: Math.max(a.x2, b.x2),

              y1: Math.round(
                (a.y1 + b.y1) / 2
              ),

              y2: Math.round(
                (a.y2 + b.y2) / 2
              )
            }

            segments.splice(j, 1)

            changed = true

            break outer
          }
        }

        else {

          const sameAxis =
            Math.abs(a.x1 - b.x1)
            <= axisTolerance

          const gap =
            Math.max(a.y1, b.y1)
            -
            Math.min(a.y2, b.y2)

          if (
            sameAxis &&
            gap <= gapTolerance
          ) {

            segments[i] = {

              ...a,

              y1: Math.min(a.y1, b.y1),

              y2: Math.max(a.y2, b.y2),

              x1: Math.round(
                (a.x1 + b.x1) / 2
              ),

              x2: Math.round(
                (a.x2 + b.x2) / 2
              )
            }

            segments.splice(j, 1)

            changed = true

            break outer
          }
        }
      }
    }
  }

  return segments
}
```

---

# Step 3 — Snap Nearby Endpoints

## Goal

Fix broken corners and tiny gaps.

---

# Before

```txt
─────   │
```

---

# After

```txt
─────┐
```

---

# Snap Rules

If endpoint distance:

```txt
<= snapDistance
```

then move to same coordinate.

---

# Recommended Snap Distance

```ts
const SNAP_DISTANCE = 6
```

---

# Endpoint Definition

```ts
type Endpoint = {
  x: number
  y: number
}
```

---

# getEndpoints()

```ts
function getEndpoints(segment) {

  return [

    {
      x: segment.x1,
      y: segment.y1
    },

    {
      x: segment.x2,
      y: segment.y2
    }
  ]
}
```

---

# snapEndpoints()

```ts
function snapEndpoints(
  segments,
  snapDistance = 6
) {

  const points = []

  for (const seg of segments) {

    points.push({
      segment: seg,
      key: "start",
      x: seg.x1,
      y: seg.y1
    })

    points.push({
      segment: seg,
      key: "end",
      x: seg.x2,
      y: seg.y2
    })
  }

  for (let i = 0; i < points.length; i++) {

    for (let j = i + 1; j < points.length; j++) {

      const a = points[i]
      const b = points[j]

      const dx = a.x - b.x
      const dy = a.y - b.y

      const distance =
        Math.sqrt(dx * dx + dy * dy)

      if (distance <= snapDistance) {

        const mx =
          Math.round((a.x + b.x) / 2)

        const my =
          Math.round((a.y + b.y) / 2)

        if (a.key === "start") {
          a.segment.x1 = mx
          a.segment.y1 = my
        } else {
          a.segment.x2 = mx
          a.segment.y2 = my
        }

        if (b.key === "start") {
          b.segment.x1 = mx
          b.segment.y1 = my
        } else {
          b.segment.x2 = mx
          b.segment.y2 = my
        }
      }
    }
  }

  return segments
}
```

---

# Step 4 — Detect Junctions

## Goal

Build wall graph topology.

---

# Junction Types

```txt
L junction
T junction
Cross junction
Dead end
```

---

# Node Definition

```ts
type Node = {

  id: string

  x: number
  y: number

  connectedSegments: string[]
}
```

---

# Detect Junction Rule

If multiple endpoints share same coordinate:

```txt
(x, y)
```

create node.

---

# Example

```txt
────┐
    │
```

Node:

```ts
{
  x: 200,
  y: 300
}
```

---

# Step 5 — Split Crossing Segments

## Problem

Long wall crossing another wall:

```txt
────────
    │
    │
```

Needs:

```txt
────┬───
```

---

# Rule

If:

```txt
horizontal intersects vertical
```

then split both segments at intersection.

---

# Intersection Detection

Horizontal:

```txt
x range contains vertical x
```

Vertical:

```txt
y range contains horizontal y
```

---

# Step 6 — Normalize Walls

## Goal

Create clean architectural graph.

---

# Normalize Rules

## Horizontal

```txt
y1 === y2
```

---

## Vertical

```txt
x1 === x2
```

---

# Snap To Integer

```ts
x = Math.round(x)
y = Math.round(y)
```

---

# Remove Duplicates

Two segments are duplicate if:

```txt
same orientation
same endpoints
```

---

# Step 7 — Attach Doors/Windows

## Goal

Connect door/window to nearest wall.

---

# Rule

Door/window center point:

```txt
must lie near wall centerline
```

---

# Recommended Distance

```ts
const ATTACH_DISTANCE = 12
```

---

# Attach Output

```ts
{
  id: "door_1",

  parentWallId: "wall_12"
}
```

---

# Final Graph Structure

```ts
type FloorplanGraph = {

  walls: VectorLine[]

  doors: VectorLine[]

  windows: VectorLine[]

  nodes: Node[]
}
```

---

# Final Pipeline

```txt
image
→ masks
→ raw vectors
→ remove tiny segments
→ merge collinear vectors
→ snap endpoints
→ detect junctions
→ split intersections
→ normalize graph
→ attach openings
→ final floorplan graph
```

---

# Recommended Debug Views

## View 1

Raw vectors:

```txt
before cleanup
```

---

## View 2

Merged vectors:

```txt
after collinear merge
```

---

## View 3

Topology graph:

```txt
nodes + edges
```

---

# Recommended Future Improvements

## Phase 2

OpenCV.js cleanup:

```txt
morphologyEx
erode
dilate
```

---

## Phase 3

True centerline extraction:

```txt
wall blob
→ medial axis
→ vector graph
```

---

# Important Insight

你現在做的其實不是：

```txt
image parsing
```

而是：

```txt
architectural vector reconstruction
```

核心不是 pixel。

核心是：

```txt
topology graph reconstruction
```