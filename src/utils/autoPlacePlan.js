// Phase 49 — 自動規劃 AP 放置（auto place）。
// 給定樓層（牆/scope）+ 目標頻段與覆蓋門檻，算出建議的 AP 位置與頻道。
//
// 三種模式：
//   fresh — 重新規劃：從空白算「達標所需最少 AP 數」；套用時移除現有同頻段 AP
//   fixed — 固定數量：放滿 apCount 顆、覆蓋最大化；套用語意同 fresh
//   fill  — 補洞：現有 AP 全保留，其同頻段覆蓋算進初始狀態，只加新 AP 補缺
//
// 演算法（經典 set cover 貪婪近似 + relocate 局部搜尋）：
//   1. 候選點：in-scope 內鋪 candStepM 格點（v1 唯一放置約束是 in-scope；
//      可安裝區 polygon / 離牆距離 / 最小間距 留在 candidateOk() 擴充）
//   2. 覆蓋矩陣：每個候選點以設計功率（per-band 預設）算一階 RSSI 場——
//      唯一的射線追蹤重活，進度以「已算候選數 / 總候選數」回報（determinate）
//   3. 貪婪：反覆挑「新覆蓋格子最多」的候選（平手比未覆蓋區 RSSI 總和），
//      到達標 / 放滿 N / 無增益 / 撞 maxAPs 為止
//   4. relocate：逐顆試「拔掉重挑」，最多 relocatePasses 輪
//   5. 頻道：greedyChannelAssign（干擾感知 + 法規域；fill 模式現有頻道固定）
//
// 評分格與 scope clip 與 autoPowerPlan 同款（自己 clip，引擎不排除 scope 外）。

import { buildScenario } from '@/features/heatmap/buildScenario'
import { rssiFromAp } from '@/features/heatmap/propagation'
import { channelCenterMHz } from '@/features/heatmap/frequency'
import { getDefaultTxPower } from '@/constants/apModels'
import { DEFAULT_CHANNEL_WIDTH } from '@/constants/channelWidths'
import { allowedChannels } from '@/constants/regulatoryDomains'
import { greedyChannelAssign } from '@/utils/autoChannelPlan'
import { buildIndoorMask } from '@/utils/indoorMask'
import { generateId } from '@/utils/id'

const DEFAULTS = {
  mode: 'fresh',          // 'fresh' | 'fixed' | 'fill'
  band: 5,
  apCount: 4,             // fixed 模式的 N
  targetRssiDbm: -65,
  targetCoverage: 0.95,   // fresh / fill 的停止門檻（in-scope 格子比例）
  maxAPs: 60,             // fresh / fill 安全上限（避免 targetCoverage 物理上達不到時失控）
  // 評分格 1 m：2 m 對室內 Wi-Fi 太粗 —— AP 覆蓋半徑常只有 8~10 m，
  // 2 m 格一顆 AP 只取得到 4~5 個點，小房間 / 走廊末端 / 房間角落整個
  // 落在採樣線之間。演算法看不見的死角＝不會為它放 AP，卻照樣回報高覆蓋率
  // （實測 demo：2 m 格 53 格、回報 90.6%，但 0.5 m 精細重算有 63 格
  // 低於 -65 dBm，最差 -85.8 dBm）。
  gridStepM: 1.0,
  // 候選格 2 m：4 m 太疏，演算法「搆不到」死角 —— 想補某塊弱區，但附近
  // 4 m 網格上沒有候選位置可選，bestGain 只能是 0 → 提早 exhausted。
  // 實測 demo（評分 1 m）：4 m 候選 12 個 → 10 顆 AP / 93.3% / 未達標；
  // 2 m 候選 52 個 → 7 顆 AP / 97.2% / 達標。少 3 顆卻覆蓋更好，
  // 因為 AP 能放在對的位置而非被網格逼到次佳點。
  // 再密到 1 m（178 個候選）沒有更好（96.9%）但耗時 3 倍 —— 2 m 是甜蜜點。
  candStepM: 2.0,
  relocatePasses: 3,
  domainId: 'TW',
  indoorOnly: true,       // 只在建築內放置＋只把室內算進覆蓋率（見 indoorMask）
}

// 一階傳播（同 autoPowerPlan / planQuality 的取捨）。
const FIELD_OPTS = { maxReflOrder: 0, enableDiffraction: false }

// 放置約束：in-scope ∩ 室內（maskFn 已把兩者合起來）。未來擴充點：
//   · 可安裝區 polygon（installZones）—— 手繪覆寫；目前用 out-scope 即可達成
//   · 離牆最小距離（wall clearance）
//   · 與既有 AP 的最小間距
function candidateOk(x, y, maskFn) {
  return maskFn(x, y)
}

// 候選/現有 AP 的 scenario 端 entry（meter 空間，鏡照 buildScenario.buildApEntry）。
function designApEntry(band, pos, opts) {
  const ch = allowedChannels(opts.domainId, band)[0] ?? (band === 5 ? 36 : 1)
  return {
    id: 'cand',
    pos,
    zM: 2.4,
    txDbm: getDefaultTxPower(band),
    antGainDbi: undefined,
    frequency: band,
    channel: ch,
    channelWidth: DEFAULT_CHANNEL_WIDTH[band] ?? 20,
    centerMHz: channelCenterMHz(band, ch),
    antennaMode: 'omni',
    azimuthDeg: 0,
    tiltDeg: 0,
    beamwidthDeg: 60,
    patternId: null,
  }
}

// 主入口。回傳：
//   { aborted, error?, proposedAps?, removeApIds?, stats?, opts? }
// proposedAps：畫布 px 座標的完整 AP 物件（無 name — 套用端用計數器命名）。
// removeApIds：fresh / fixed 模式套用時應移除的現有同頻段 AP id。
// onProgress(state)：回傳 false 可中止（worker 情境用主線程 terminate，見 worker 註解）。
export async function runAutoPlacePlan({
  floor,
  walls,
  aps,
  scopes,
  userOpts = {},
  onProgress = null,
}) {
  const opts = { ...DEFAULTS, ...userOpts }
  const band = opts.band
  const t0 = performance.now()

  // 現有同頻段 AP：fill 的初始覆蓋來源；fresh / fixed 的移除清單。
  const existingSameBand = (aps ?? []).filter((a) => (a.frequency ?? 5) === band)
  // scenario 帶現有同頻段 AP 建：牆/corners/scope mask 共用，
  // scenario.aps 直接是 fill 模式初始覆蓋要用的 entries。
  const scenario = buildScenario(floor, walls, existingSameBand, scopes, null)
  if (!scenario) {
    return { aborted: false, error: 'invalid-floor' }
  }
  const scopeMaskFn = scenario.scopeMaskFn ?? (() => true)
  const { w, h } = scenario.size
  const pxToM = 1 / floor.scale

  // ---- 室內遮罩（flood fill；見 utils/indoorMask）----
  // 沒有它，貪婪 set cover 會偏好牆外空地（無牆遮擋 → 單顆覆蓋格數最多），
  // 把 AP 放到室外。遮罩同時套在候選點與評分格上：
  //   · 候選點 — AP 只能裝在建築內
  //   · 評分格 — 室外不算「需要覆蓋的區域」，否則 AP 被關在室內、
  //     卻還要為室外的覆蓋率硬加顆數
  // indoor.ok=false（沒牆 / 牆沒接好導致 flood fill 漏光）時 indoorFn 恆真，
  // 等同退回未過濾行為；indoorFallback 讓 UI 能提示這件事。
  const indoor = opts.indoorOnly
    ? buildIndoorMask(scenario.walls, scenario.size)
    : { ok: false, indoorFn: () => true, ratio: 1 }
  const indoorFallback = opts.indoorOnly && !indoor.ok
  const maskFn = (x, y) => scopeMaskFn(x, y) && indoor.indoorFn(x, y)

  // ---- 評分格（in-scope ∩ 室內，同 autoPowerPlan 的 clip 規則）----
  const step = opts.gridStepM
  const nx = Math.ceil(w / step) + 1
  const ny = Math.ceil(h / step) + 1
  const cellX = []
  const cellY = []
  for (let j = 0; j < ny; j++) {
    const y = j * step
    if (y > h) continue
    for (let i = 0; i < nx; i++) {
      const x = i * step
      if (x > w) continue
      if (!maskFn(x, y)) continue
      cellX.push(x)
      cellY.push(y)
    }
  }
  const nCells = cellX.length
  if (nCells === 0) {
    return { aborted: false, error: indoorFallback ? 'no-scope-cells' : 'no-indoor-cells' }
  }

  // ---- 候選點（in-scope、candStepM 格）----
  // 格點從半步開始（cs/2 起跳）：避免候選落在圖面 0 / w / h 邊線上 ——
  // 純 set cover 會為了搆到角落格把 AP 貼在邊緣，物理上合理但不像真實
  // 安裝位置。半步內縮後邊角仍搆得到（差半格），觀感正常。
  const candPos = []
  {
    const cs = opts.candStepM
    for (let y = cs / 2; y <= h - cs / 2 + 1e-9; y += cs) {
      for (let x = cs / 2; x <= w - cs / 2 + 1e-9; x += cs) {
        if (!candidateOk(x, y, maskFn)) continue
        candPos.push({ x, y })
      }
    }
  }
  const nCands = candPos.length
  if (nCands === 0) {
    return { aborted: false, error: 'no-candidates' }
  }

  const progress = async (phase, extra = {}) => {
    if (!onProgress) return true
    const cont = await onProgress({
      phase,
      elapsedMs: performance.now() - t0,
      ...extra,
    })
    return cont !== false
  }

  // ---- 初始覆蓋（fill：現有同頻段 AP 的實際場；fresh / fixed：全未覆蓋）----
  const covered = new Uint8Array(nCells)
  let coverageBefore = 0
  if (opts.mode === 'fill' && scenario.aps.length > 0) {
    for (let k = 0; k < nCells; k++) {
      const rx = { x: cellX[k], y: cellY[k], zM: 0 }
      let best = -Infinity
      for (const entry of scenario.aps) {
        const { rssiDbm } = rssiFromAp(entry, rx, scenario.walls, scenario.corners, FIELD_OPTS)
        if (rssiDbm > best) best = rssiDbm
      }
      if (best >= opts.targetRssiDbm) covered[k] = 1
    }
    for (let k = 0; k < nCells; k++) coverageBefore += covered[k]
    coverageBefore /= nCells
  }

  // ---- 覆蓋矩陣：每個候選點的 RSSI 場（設計功率、一階）----
  // 記憶體：nCands × nCells × 4B（300 × 650 ≈ 780 KB）。
  const candRssi = new Float32Array(nCands * nCells)
  for (let c = 0; c < nCands; c++) {
    const entry = designApEntry(band, candPos[c], opts)
    const off = c * nCells
    for (let k = 0; k < nCells; k++) {
      const rx = { x: cellX[k], y: cellY[k], zM: 0 }
      candRssi[off + k] = rssiFromAp(entry, rx, scenario.walls, scenario.corners, FIELD_OPTS).rssiDbm
    }
    if (c % 4 === 3 || c === nCands - 1) {
      const cont = await progress('fields', { pct: (c + 1) / nCands })
      if (!cont) return { aborted: true }
    }
  }

  // ---- 貪婪 set cover ----
  const target = opts.targetRssiDbm
  const chosen = []            // candidate indices
  const inUse = new Uint8Array(nCands)
  const coverageNow = () => {
    let n = 0
    for (let k = 0; k < nCells; k++) n += covered[k]
    return n / nCells
  }
  // 給定「其餘已選候選 + 初始覆蓋」重算 covered（relocate 用）。
  const rebuildCovered = (skipCand) => {
    covered.fill(0)
    if (opts.mode === 'fill' && scenario.aps.length > 0) {
      // 初始覆蓋重算太貴 — 快取一份。
      covered.set(coveredInitial)
    }
    for (const c of chosen) {
      if (c === skipCand) continue
      const off = c * nCells
      for (let k = 0; k < nCells; k++) {
        if (candRssi[off + k] >= target) covered[k] = 1
      }
    }
  }
  const coveredInitial = new Uint8Array(covered)  // fill 模式的既有覆蓋快照

  // 挑「新覆蓋最多」的候選；平手比未覆蓋區的 RSSI 總和（偏向把弱區拉起來）。
  const pickBest = () => {
    let bestC = -1
    let bestGain = 0
    let bestTie = -Infinity
    for (let c = 0; c < nCands; c++) {
      if (inUse[c]) continue
      const off = c * nCells
      let gain = 0
      let tie = 0
      for (let k = 0; k < nCells; k++) {
        if (covered[k]) continue
        const r = candRssi[off + k]
        if (r >= target) gain++
        tie += Math.max(0, r - (target - 20))  // 未覆蓋區的接近程度
      }
      if (gain > bestGain || (gain === bestGain && gain > 0 && tie > bestTie)) {
        bestC = c
        bestGain = gain
        bestTie = tie
      }
    }
    return { bestC, bestGain }
  }

  // 停止原因要如實回報 —— 「放不下去了」跟「已達標」在畫面上長得一樣
  // （都是給出一組 AP），但意義天差地別。不分辨的話使用者看到的是
  // 一個看起來成功、實則未達目標的結果。
  //   'target'     — 達到 targetCoverage（fresh / fill 的正常結束）
  //   'count'      — 放滿 apCount（fixed 的正常結束）
  //   'exhausted'  — 沒有候選能再新增覆蓋（候選格太疏 / 死角搆不到）
  //   'max-aps'    — 撞 maxAPs 安全上限
  let stopReason = null
  const wantCount = opts.mode === 'fixed' ? opts.apCount : opts.maxAPs
  while (chosen.length < wantCount) {
    if (opts.mode !== 'fixed' && coverageNow() >= opts.targetCoverage) {
      stopReason = 'target'
      break
    }
    const { bestC, bestGain } = pickBest()
    if (bestC < 0 || bestGain === 0) {
      stopReason = 'exhausted'
      break
    }
    chosen.push(bestC)
    inUse[bestC] = 1
    const off = bestC * nCells
    for (let k = 0; k < nCells; k++) {
      if (candRssi[off + k] >= target) covered[k] = 1
    }
    const cont = await progress('greedy', { placed: chosen.length, coverage: coverageNow() })
    if (!cont) return { aborted: true }
  }
  // 迴圈條件耗盡（沒走 break）：fixed 是放滿 N，fresh / fill 是撞安全上限。
  if (stopReason === null) {
    stopReason = opts.mode === 'fixed' ? 'count' : 'max-aps'
  }

  // ---- relocate 局部搜尋：逐顆「拔掉重挑」到無改善或 relocatePasses 輪 ----
  for (let pass = 0; pass < opts.relocatePasses; pass++) {
    let changed = false
    for (let i = 0; i < chosen.length; i++) {
      const cur = chosen[i]
      rebuildCovered(cur)
      inUse[cur] = 0
      const { bestC, bestGain } = pickBest()
      // 目前這顆在「其餘固定」下的增益
      let curGain = 0
      const off = cur * nCells
      for (let k = 0; k < nCells; k++) {
        if (!covered[k] && candRssi[off + k] >= target) curGain++
      }
      if (bestC >= 0 && bestC !== cur && bestGain > curGain) {
        chosen[i] = bestC
        inUse[bestC] = 1
        changed = true
      } else {
        inUse[cur] = 1
      }
    }
    rebuildCovered(-1)
    const cont = await progress('refine', { placed: chosen.length, coverage: coverageNow() })
    if (!cont) return { aborted: true }
    if (!changed) break
  }

  // ---- 原地保留：把「位置沒變」的建議對應回既有 AP ----
  // 演算法是確定性的 —— 同樣的牆 / 候選格 / 目標，重跑必然選到相同的候選點。
  // 不處理的話 fresh 重跑會產出「移除 N 顆 + 在完全相同座標新增 N 顆」，
  // 套用結果等於「什麼都沒變，但 AP 全部換了 id 與名字」，還會洗掉使用者
  // 手動調過的功率 / 頻道 / 型號。預覽上也是一堆紅叉疊著藍圈，看不出新的。
  //
  // 對策：候選點與「將被移除的既有同頻段 AP」距離在容差內時，視為原地保留 ——
  // 該候選不產生新 AP，該既有 AP 也不列入移除清單。fill 模式沒有移除語意，跳過。
  const scale = floor.scale
  const keptApIds = new Set()
  const keepMatchedCand = new Set()
  if (opts.mode !== 'fill' && existingSameBand.length > 0) {
    // 容差取候選格的 1/4：同格點必然 0 距離，這裡只是吸收浮點誤差與
    // 使用者微調過幾公分的情況，不會把「明顯移動過」的 AP 誤判成沒變。
    const tolPx = (opts.candStepM * scale) / 4
    const tol2 = tolPx * tolPx
    for (const c of chosen) {
      const cx = candPos[c].x * scale
      const cy = candPos[c].y * scale
      let bestAp = null
      let bestD2 = Infinity
      for (const ap of existingSameBand) {
        if (keptApIds.has(ap.id)) continue      // 一顆既有 AP 只配對一次
        const dx = ap.x - cx
        const dy = ap.y - cy
        const d2 = dx * dx + dy * dy
        if (d2 < bestD2) { bestD2 = d2; bestAp = ap }
      }
      if (bestAp && bestD2 <= tol2) {
        keptApIds.add(bestAp.id)
        keepMatchedCand.add(c)
      }
    }
  }

  // ---- 組裝結果 AP 物件（畫布 px）+ 頻道指派 ----
  const proposed = chosen.filter((c) => !keepMatchedCand.has(c)).map((c) => ({
    id: generateId('ap'),
    name: null,                      // 套用端以 globalAPCounter 連號命名
    x: candPos[c].x * scale,
    y: candPos[c].y * scale,
    z: 2.4,
    txPower: getDefaultTxPower(band),
    frequency: band,
    channel: null,                   // 下面 greedyChannelAssign 填
    channelWidth: DEFAULT_CHANNEL_WIDTH[band] ?? 20,
    antennaMode: 'omni',
    azimuth: 0,
    beamwidth: 60,
    patternId: null,
    mountType: 'ceiling',
    modelId: null,
    color: '#4fc3f7',
  }))

  // 頻道：留在場上的既有同頻段 AP（fill 模式的全部 + 原地保留的那些）
  // 一起餵進去但頻道固定（fixedChannels），新 AP 繞著它們排。
  // 保留的 AP 頻道不動 —— 使用者可能手動調過，重跑規劃不該洗掉。
  const stayingExisting = opts.mode === 'fill'
    ? existingSameBand
    : existingSameBand.filter((a) => keptApIds.has(a.id))
  const channelPool = stayingExisting.length > 0
    ? [...stayingExisting, ...proposed]
    : proposed
  const fixedChannels = stayingExisting.length > 0
    ? new Map(stayingExisting.map((a) => [a.id, a.channel]))
    : null
  const assigned = greedyChannelAssign(channelPool, opts.domainId, 300, fixedChannels)
  for (const ap of proposed) {
    ap.channel = assigned.get(ap.id)?.channel
      ?? (allowedChannels(opts.domainId, band)[0] ?? (band === 5 ? 36 : 1))
  }

  const coverageAfter = coverageNow()
  return {
    aborted: false,
    proposedAps: proposed,
    // 原地保留的既有 AP 不列入移除。
    removeApIds: opts.mode === 'fill'
      ? []
      : existingSameBand.filter((a) => !keptApIds.has(a.id)).map((a) => a.id),
    keptApIds: [...keptApIds],
    stats: {
      placedCount: proposed.length,
      // 位置與既有 AP 相同、原地沿用的顆數（UI 用來說明「什麼都沒變」）。
      keptCount: keptApIds.size,
      coverageBefore,
      coverageAfter,
      cellsTotal: nCells,
      candidates: nCands,
      // 室內偵測診斷：indoorFallback=true 代表使用者勾了「僅室內放置」
      // 但偵測不可信（沒牆 / 牆有縫漏光），已退回全範圍 —— UI 要明講。
      indoorApplied: opts.indoorOnly && indoor.ok,
      indoorFallback,
      indoorRatio: indoor.ratio,
      // 停止原因 + 是否真的達標（relocate 後的最終覆蓋率為準）。
      // fixed 模式沒有覆蓋率目標，不判定達標。
      stopReason,
      targetMet: opts.mode === 'fixed' ? null : coverageAfter >= opts.targetCoverage,
      elapsedMs: performance.now() - t0,
    },
    opts,
  }
}
