// Phase 49 — 室內偵測（indoor mask）。
//
// 問題：auto place 的候選點與評分格原本只受 scope 約束，而 scope 是粗略框選、
// 不知道牆在哪。結果貪婪 set cover 會偏好把 AP 放到牆外空地 —— 那裡沒有牆遮擋，
// 一顆 AP 能無衰減地灑滿一大片評分格，「新覆蓋格數」分數最高。數學上最優，
// 實務上是把 AP 裝在室外花園。
//
// 解法：flood fill，不做輪廓萃取。
//   1. 鋪一張 cellM 布林格，把牆線段光柵化上去（含 toleranceM 加粗）
//   2. 從圖面四邊界 flood fill（4-連通）—— 流得到的是室外
//   3. 流不到的 = 室內
//
// 為什麼不追牆的連通性找最外圈環路：那要處理分岔、T 字接頭、環路方向、
// 巢狀環，很難寫對。Flood fill 全部繞開，且天然正確處理內庭（甜甜圈形建築的
// 中庭從外面流得進去 → 正確判為室外）與封閉內房間（流不進去 → 室內）。
//
// 門窗不是破洞：buildScenario.expandWall() 把開口展開成牆上的「分段」而非缺口，
// 三段（牆-門-牆）全都是幾何線段，只是 lossDb 不同。所以幾何上牆線連續。
// 真正的破洞只來自使用者畫牆時端點沒對齊的縫 —— 那是繪圖精度問題，
// 用 toleranceM 加粗封起來（正是「小破洞明顯連接也算室內」）。
//
// 座標空間：meter（與 buildScenario 輸出的 scenario.walls 一致）。

const DEFAULT_CELL_M = 0.5

// 封縫容差：小於此的牆縫會被補起來（使用者畫牆端點沒對齊的縫）。
//
// 關鍵：封縫只在「端點」補圓點，不沿整條牆加粗。早期版本用方形 kernel
// 把整條牆加粗到容差寬度，結果在隔間密的圖上把室內走廊整個塞滿 ——
// 容差愈大封縫愈好，但室內被牆體吃掉愈多，兩者直接打架。分開處理後
// 牆恆為 1 格細線（不吃室內空間），容差只影響端點補洞半徑。
const DEFAULT_SEAL_M = 0.6

// 健康判據。用「室內佔牆 bbox 的比例」而非佔整張圖面 ——
// 圖面留白多寡（建築沒貼齊圖框）跟牆有沒有接好無關，
// 拿圖面當分母會在完全正常的圖上誤觸發退場。
//
// 只用這一個判據。曾經加過「最大連通塊佔比」，但那是錯的：室內被隔成
// 多塊正是牆該做的事（門在幾何上是牆的分段、不是缺口，所以房間之間本來
// 就不連通）。demo 圖 32 個房間、每塊 bbox 都是合理的辦公室尺寸，
// 卻被連通塊判據當成漏光。真正漏光的特徵是室內「幾乎為零」，ratio 就抓得到。
const MIN_INDOOR_BBOX_RATIO = 0.25

// 把線段光柵化成 1 格細線（不加粗 —— 加粗會吃掉室內空間，見 DEFAULT_SEAL_M）。
// 每半格取樣一次，確保對角線最壞情況也不漏格。
function stampSegment(grid, gw, gh, cellM, ax, ay, bx, by) {
  const x0 = ax / cellM
  const y0 = ay / cellM
  const x1 = bx / cellM
  const y1 = by / cellM
  const dx = x1 - x0
  const dy = y1 - y0
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2))
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const gx = Math.round(x0 + dx * t)
    const gy = Math.round(y0 + dy * t)
    if (gx < 0 || gx >= gw || gy < 0 || gy >= gh) continue
    grid[gy * gw + gx] = 1
  }
}

// 在端點補一個半徑 radCells 的圓點，把「兩條牆端點沒對齊」的縫封起來。
// 只在端點做 —— 縫必然發生在端點，牆身中段不會有縫。
function stampCap(grid, gw, gh, cellM, px, py, radCells) {
  if (radCells <= 0) return
  const cx = Math.round(px / cellM)
  const cy = Math.round(py / cellM)
  const r2 = radCells * radCells
  for (let oy = -radCells; oy <= radCells; oy++) {
    const gy = cy + oy
    if (gy < 0 || gy >= gh) continue
    for (let ox = -radCells; ox <= radCells; ox++) {
      if (ox * ox + oy * oy > r2) continue
      const gx = cx + ox
      if (gx < 0 || gx >= gw) continue
      grid[gy * gw + gx] = 1
    }
  }
}

// 主入口。
//
// Args:
//   walls:  scenario.walls —— [{ a:{x,y}, b:{x,y}, ... }]，meter 空間
//   size:   { w, h } 圖面尺寸（meter）
//   opts:   { cellM?, sealM? }
//
// Returns:
//   { ok, indoorFn, ratio, cellM }
//     ok       — false 表示偵測不可信（沒牆 / 漏光），呼叫端應忽略遮罩
//     indoorFn — (x, y) => boolean，meter 座標；ok=false 時恆真
//     ratio    — 室內格數 / 牆 bbox 格數（診斷與 UI 提示用）
export function buildIndoorMask(walls, size, opts = {}) {
  const cellM = opts.cellM ?? DEFAULT_CELL_M
  const sealM = opts.sealM ?? DEFAULT_SEAL_M
  const alwaysIndoor = { ok: false, indoorFn: () => true, ratio: 1, cellM }

  if (!walls || walls.length === 0) return alwaysIndoor
  if (!size || !(size.w > 0) || !(size.h > 0)) return alwaysIndoor

  const gw = Math.ceil(size.w / cellM) + 1
  const gh = Math.ceil(size.h / cellM) + 1
  const nGrid = gw * gh
  if (nGrid <= 0) return alwaysIndoor

  // 0 = 空、1 = 牆、2 = 已知室外（flood fill 造訪過）
  const grid = new Uint8Array(nGrid)
  const sealCells = Math.max(0, Math.round(sealM / cellM))
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity
  for (const seg of walls) {
    stampSegment(grid, gw, gh, cellM, seg.a.x, seg.a.y, seg.b.x, seg.b.y)
    stampCap(grid, gw, gh, cellM, seg.a.x, seg.a.y, sealCells)
    stampCap(grid, gw, gh, cellM, seg.b.x, seg.b.y, sealCells)
    for (const p of [seg.a, seg.b]) {
      if (p.x < bx0) bx0 = p.x
      if (p.x > bx1) bx1 = p.x
      if (p.y < by0) by0 = p.y
      if (p.y > by1) by1 = p.y
    }
  }

  // 從四邊界 flood fill（4-連通）。顯式 stack，避免遞迴爆棧。
  const stack = []
  const pushIfOpen = (gx, gy) => {
    if (gx < 0 || gx >= gw || gy < 0 || gy >= gh) return
    const idx = gy * gw + gx
    if (grid[idx] !== 0) return
    grid[idx] = 2
    stack.push(idx)
  }
  for (let gx = 0; gx < gw; gx++) {
    pushIfOpen(gx, 0)
    pushIfOpen(gx, gh - 1)
  }
  for (let gy = 0; gy < gh; gy++) {
    pushIfOpen(0, gy)
    pushIfOpen(gw - 1, gy)
  }
  while (stack.length > 0) {
    const idx = stack.pop()
    const gx = idx % gw
    const gy = (idx - gx) / gw
    pushIfOpen(gx + 1, gy)
    pushIfOpen(gx - 1, gy)
    pushIfOpen(gx, gy + 1)
    pushIfOpen(gx, gy - 1)
  }

  // 室內 = 值仍為 0（既非牆、也沒被外部 flood 到）。
  // 牆格（1）本身不算室內：AP 不該放在牆體內，評分格也不該落在牆裡。
  let indoorCells = 0
  for (let i = 0; i < nGrid; i++) {
    if (grid[i] === 0) indoorCells++
  }

  // 健康判據用牆 bbox 當分母，不用整張圖面 —— 建築沒貼齊圖框時
  // 圖面會有大片留白（demo 圖上方就有 6 m），那是正常的室外，
  // 拿它當分母會讓完全健康的圖看起來像漏光。
  const bboxCells = (bx1 > bx0 && by1 > by0)
    ? Math.max(1, ((bx1 - bx0) / cellM) * ((by1 - by0) / cellM))
    : nGrid
  const ratio = indoorCells / bboxCells

  // 退場：漏光時 flood fill 會從牆縫灌進建築，把室內吃到幾乎為零 ——
  // 這時遮罩會把幾乎所有候選點濾掉，一顆 AP 都放不了。
  // 回 ok:false 讓呼叫端退回原行為並在 UI 提示，不要靜默給空結果。
  if (ratio < MIN_INDOOR_BBOX_RATIO) {
    return { ok: false, indoorFn: () => true, ratio, cellM }
  }

  const indoorFn = (x, y) => {
    const gx = Math.round(x / cellM)
    const gy = Math.round(y / cellM)
    if (gx < 0 || gx >= gw || gy < 0 || gy >= gh) return false
    return grid[gy * gw + gx] === 0
  }

  return { ok: true, indoorFn, ratio, cellM }
}
