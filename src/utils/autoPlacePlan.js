// Phase 49 — 自動規劃 AP 放置（auto place）。
// 給定樓層（牆/scope）+ 目標頻段與覆蓋門檻，算出建議的 AP 位置與頻道。
//
// 三種模式：
//   fresh — 重新規劃：從空白算「達標所需最少 AP 數」；套用時移除現有同頻段 AP
//   fixed — 固定數量：放滿 apCount 顆、覆蓋最大化；套用語意同 fresh
//   fill  — 補洞：現有 AP 全保留，其同頻段覆蓋算進初始狀態，只加新 AP 補缺
//           （58-14：此頻段已關閉的現有裝置先重新開啟再補新 AP）
//
// 演算法（經典 set cover 貪婪近似 + relocate 局部搜尋）：
//   1. 候選點：in-scope 內鋪 candStepM 格點（v1 唯一放置約束是 in-scope；
//      可安裝區 polygon / 離牆距離 / 最小間距 留在 candidateOk() 擴充）
//   2. 覆蓋矩陣：每個候選點以設計功率（per-band 預設）算一階 RSSI 場——
//      唯一的射線追蹤重活，進度以「已算候選數 / 總候選數」回報（determinate）
//   3. 貪婪：反覆挑「新覆蓋格子最多」的候選（平手比未覆蓋區 RSSI 總和），
//      到達標 / 放滿 N / 無增益 / 撞 maxAPs 為止
//   4. relocate：逐顆試「拔掉重挑」，最多 relocatePasses 輪
//   5. 頻道：greedyChannelAssign（干擾感知 + 法規域；fill 模式現有頻道固定；
//      其他樓層的射頻為固定鄰居，58-16）
//
// 評分格與 scope clip 與 autoPowerPlan 同款（自己 clip，引擎不排除 scope 外）。

import { buildScenario } from '@/features/heatmap/buildScenario'
import { buildFloorScenario } from '@/features/heatmap/buildCrossFloor'
import { resolveApRadiation } from '@/features/heatmap/apRadiation'
import { makeApHearingFn } from '@/features/heatmap/apHearing'
import { rssiFromAp } from '@/features/heatmap/propagation'
import { channelBlockCenterMHz } from '@/features/heatmap/frequency'
import { getDefaultTxPower, getAPModelById, AP_MODEL_LIST, DEFAULT_AP_MODEL_ID } from '@/constants/apModels'
import { DEFAULT_CHANNEL_WIDTH } from '@/constants/channelWidths'
import { radiosForModel, hasEnabledBand, withOnlyBand, expandRadios, applyRadioResults, radioKey, apRadios, apRadio, patchRadio } from '@/utils/apRadios'
import { allowedChannels } from '@/constants/regulatoryDomains'
import { greedyChannelAssign } from '@/utils/autoChannelPlan'
import { buildIndoorMask } from '@/utils/indoorMask'
import { generateId } from '@/utils/id'

const DEFAULTS = {
  mode: 'fresh',          // 'fresh' | 'fixed' | 'fill'
  band: 5,
  apCount: 4,             // fixed 模式的 N
  // 57-34: -65 on purpose -- 2 dB above the -67 coverage target the panels
  // use (constants/coverage), as design margin; it is also Hamina's default
  // "High" (pass) threshold. The modal lets the user change it.
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

// 58-15 (D4): coverage-matrix budget (candidates × cells, Float32). Both
// counts grow with the floor area, so the matrix grows with area²: a
// 200×150 m box at the default steps is 7326 × 29651 = 869 MB and ~1 min.
// Over budget, both steps widen by the same factor (like sampleField's
// fitGridStep) until it fits. 16 M entries = 64 MB; a 100×75 m floor
// (1813 × 7326 = 13.3 M) still plans at the default steps.
const MAX_MATRIX_ENTRIES = 16_000_000

// 58-15 (F): fill -- an existing same-band device whose TX is at least this
// far below the design TX a new device would get (the band's default TX,
// model max / EIRP capped -- designApEntry) and which, raised to it, would
// cover cells the current devices leave uncovered, is reported: raising it
// may beat adding a device. The reference is the design TX, not the model's
// maximum: the defaults sit ~8 dB below the maximum (5 GHz 15 vs 23 dBm), so
// that would flag every device left at its default.
const WEAK_TX_MARGIN_DB = 6

// 放置約束：in-scope ∩ 室內（maskFn 已把兩者合起來）。未來擴充點：
//   · 可安裝區 polygon（installZones）—— 手繪覆寫；目前用 out-scope 即可達成
//   · 離牆最小距離（wall clearance）
//   · 與既有 AP 的最小間距
function candidateOk(x, y, maskFn) {
  return maskFn(x, y)
}

// 58: the model a planned device gets -- the default (dual-band) one when it
// has the target band, else the first catalog model that does (6 GHz).
function modelForBand(band) {
  if (getAPModelById(DEFAULT_AP_MODEL_ID).supportedBands.includes(band)) return DEFAULT_AP_MODEL_ID
  return AP_MODEL_LIST.find((m) => m.supportedBands.includes(band))?.id ?? DEFAULT_AP_MODEL_ID
}

// Most common model among `aps` that supports `band`; null when none.
function commonModelForBand(aps, band) {
  const counts = new Map()
  for (const a of aps) {
    const id = a.modelId ?? DEFAULT_AP_MODEL_ID
    if (!getAPModelById(id).supportedBands.includes(band)) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  let best = null
  for (const [id, n] of counts) if (best == null || n > counts.get(best)) best = id
  return best
}

// 候選/現有 AP 的 scenario 端 entry（meter 空間，鏡照 buildScenario.buildApEntry）。
// 57-34: TX / gain resolved exactly like the AP this candidate becomes (its
// model's gain, EIRP cap), and mounted at the floor's absolute elevation + 2.4 m.
function designApEntry(band, pos, opts, floorElevationM = 0, modelId = modelForBand(band)) {
  const ch = allowedChannels(opts.domainId, band)[0] ?? (band === 5 ? 36 : 1)
  const rad = resolveApRadiation({
    frequency: band, channel: ch, channelWidth: DEFAULT_CHANNEL_WIDTH[band] ?? 20,
    txPower: getDefaultTxPower(band), antennaMode: 'omni', modelId,
  }, opts.domainId)
  return {
    id: 'cand',
    pos,
    zM: floorElevationM + 2.4,
    txDbm: rad.txDbm,
    antGainDbi: rad.peakGainDbi,
    frequency: band,
    channel: ch,
    channelWidth: DEFAULT_CHANNEL_WIDTH[band] ?? 20,
    centerMHz: channelBlockCenterMHz(band, ch, DEFAULT_CHANNEL_WIDTH[band] ?? 20),   // 57-16
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
// removeApIds：fresh / fixed 模式套用時應移除的現有同頻段 AP id（58: 整台裝置，
// 含其他頻段的射頻）。
// onProgress(state)：回傳 false 可中止（worker 情境用主線程 terminate，見 worker 註解）。
export async function runAutoPlacePlan({
  floor,
  walls,
  aps,
  scopes,
  userOpts = {},
  onProgress = null,
  // 57-34: building data -> the same cross-floor scenario as the heatmap /
  // plan-quality panel (receiver 1.0 m, other floors' APs / walls / slabs);
  // env -> regulatory domain + RF settings from the main thread.
  floors = null,
  apsByFloor = null,
  wallsByFloor = null,
  holesByFloor = null,
  env = null,
}) {
  const opts = { ...DEFAULTS, ...userOpts }
  const band = opts.band
  const t0 = performance.now()
  // 58-9: the domain has no channel on this band (CN 6 GHz) -- every planned
  // radio would start disabled, so there is nothing to plan.
  if (allowedChannels(opts.domainId, band).length === 0) {
    return { aborted: false, error: 'band-not-allowed' }
  }

  // 現有同頻段 AP：fill 的初始覆蓋來源；fresh / fixed 的移除清單。
  // 58: devices with an enabled radio on the band.
  const existingSameBand = (aps ?? []).filter((a) => hasEnabledBand(a, band))
  // 58-9: devices that have the band but switched it off (e.g. by auto power).
  // They radiate nothing on it (no initial coverage), yet they are devices of
  // the band at that position: fresh / fixed remove them like the enabled
  // ones, and in every mode a planned position on top of one reuses that
  // device -- its radio is switched back on -- instead of stacking a new one.
  const offSameBand = (aps ?? []).filter((a) => apRadio(a, band) && !hasEnabledBand(a, band))
  // 58: planned devices take the most common model among them (a re-plan of
  // tri-band units must not swap in dual-band ones and drop 6 GHz); the
  // band's default model only when there are none.
  const planModelId = commonModelForBand(existingSameBand, band) ?? modelForBand(band)
  // scenario 帶現有同頻段 AP 建：牆/corners/scope mask 共用，
  // scenario.aps 直接是 fill 模式初始覆蓋要用的 entries。
  const sameBand = (list) => (list ?? []).map((a) => withOnlyBand(a, band)).filter(Boolean)
  // `mapAps` null = every radio of every device (channel planning).
  const buildFor = (thisFloorAps, mapAps = sameBand) => floors
    ? buildFloorScenario({
        floors, floorId: floor.id,
        apsByFloor: { ...(apsByFloor ?? {}), [floor.id]: thisFloorAps },
        wallsByFloor: { ...(wallsByFloor ?? {}), [floor.id]: walls ?? [] },
        holesByFloor: holesByFloor ?? {},
        scopes, ...(mapAps ? { mapAps } : {}), env,
      })
    : buildScenario(floor, walls, mapAps ? mapAps(thisFloorAps) : thisFloorAps, scopes, null, env)
  const scenario = buildFor(existingSameBand)
  if (!scenario) {
    return { aborted: false, error: 'invalid-floor' }
  }
  // 57-34: receiver height / slabs / AP mount elevation of that scenario.
  const rxZ = scenario.rxElevationM ?? 0
  const fieldOpts = { ...FIELD_OPTS, floorBoundaries: scenario.floorBoundaries ?? null }
  // Initial coverage: other floors' same-band APs always stay; this floor's
  // existing ones only in fill mode (fresh / fixed replace them).
  const thisFloorIds = new Set(existingSameBand.map((a) => a.id))
  const initialSources = opts.mode === 'fill'
    ? scenario.aps
    : scenario.aps.filter((e) => !thisFloorIds.has(e.deviceId))
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
    // 57-34: this floor's walls only -- the cross-floor scenario also carries
    // other floors' walls, which would corrupt the flood fill.
    ? buildIndoorMask(floors ? buildScenario(floor, walls, [], scopes, null, env).walls : scenario.walls, scenario.size)
    : { ok: false, indoorFn: () => true, ratio: 1 }
  let indoorFallback = opts.indoorOnly && !indoor.ok
  let maskFn = (x, y) => scopeMaskFn(x, y) && indoor.indoorFn(x, y)

  // ---- 評分格（in-scope ∩ 室內，同 autoPowerPlan 的 clip 規則）----
  const buildCells = (step) => {
    const nx = Math.ceil(w / step) + 1
    const ny = Math.ceil(h / step) + 1
    const xs = []
    const ys = []
    for (let j = 0; j < ny; j++) {
      const y = j * step
      if (y > h) continue
      for (let i = 0; i < nx; i++) {
        const x = i * step
        if (x > w) continue
        if (!maskFn(x, y)) continue
        xs.push(x)
        ys.push(y)
      }
    }
    return [xs, ys]
  }

  // ---- 候選點（in-scope、candStepM 格）----
  // 格點從半步開始（cs/2 起跳）：避免候選落在圖面 0 / w / h 邊線上 ——
  // 純 set cover 會為了搆到角落格把 AP 貼在邊緣，物理上合理但不像真實
  // 安裝位置。半步內縮後邊角仍搆得到（差半格），觀感正常。
  const buildCands = (cs) => {
    const out = []
    for (let y = cs / 2; y <= h - cs / 2 + 1e-9; y += cs) {
      for (let x = cs / 2; x <= w - cs / 2 + 1e-9; x += cs) {
        if (!candidateOk(x, y, maskFn)) continue
        out.push({ x, y })
      }
    }
    return out
  }

  let [cellX, cellY] = buildCells(opts.gridStepM)
  let candPos = buildCands(opts.candStepM)
  // 58-15 (D3): a mask only the scale-aware judgement accepted (rooms so
  // small the bbox ratio fell back) that leaves no cell or candidate -- fall
  // back to the whole plan, as before that judgement.
  if (indoor.rescued && (cellX.length === 0 || candPos.length === 0)) {
    indoorFallback = true
    maskFn = scopeMaskFn
    ;[cellX, cellY] = buildCells(opts.gridStepM)
    candPos = buildCands(opts.candStepM)
  }
  // 58-15 (D4): over the matrix budget -> widen both steps by one factor
  // (0.1 m steps) until it fits. Floors within budget are untouched.
  let gridCoarsened = false
  if (candPos.length * cellX.length > MAX_MATRIX_ENTRIES) {
    const g0 = opts.gridStepM
    const c0 = opts.candStepM
    let k = Math.pow((candPos.length * cellX.length) / MAX_MATRIX_ENTRIES, 0.25)
    for (;;) {
      const g = Math.ceil(g0 * k * 10 - 1e-9) / 10
      opts.gridStepM = g
      opts.candStepM = Math.round(c0 * (g / g0) * 10) / 10
      ;[cellX, cellY] = buildCells(opts.gridStepM)
      candPos = buildCands(opts.candStepM)
      if (candPos.length * cellX.length <= MAX_MATRIX_ENTRIES) break
      k = (g + 0.1) / g0
    }
    gridCoarsened = true
  }
  const nCells = cellX.length
  if (nCells === 0) {
    return { aborted: false, error: indoorFallback ? 'no-scope-cells' : 'no-indoor-cells' }
  }
  const nCands = candPos.length
  if (nCands === 0) {
    return { aborted: false, error: 'no-candidates' }
  }
  const reuseAps = opts.mode === 'fill' ? offSameBand : []
  const nReuse = reuseAps.length

  // 58-15 (F): fill never puts a new device on the candidate cell (within
  // half a step on both axes, as the off-device matching below) of an
  // existing same-band device that is on -- a weak one there is reported
  // instead (weakAps). Such candidates are never picked, nor computed.
  const blocked = new Uint8Array(nCands)
  if (opts.mode === 'fill' && existingSameBand.length > 0) {
    const half = opts.candStepM / 2 + 1e-6
    for (const a of existingSameBand) {
      const ax = a.x * pxToM
      const ay = a.y * pxToM
      for (let c = 0; c < nCands; c++) {
        if (Math.abs(candPos[c].x - ax) <= half && Math.abs(candPos[c].y - ay) <= half) blocked[c] = 1
      }
    }
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

  // Cells that real scenario entries cover (>= target). Only the yes/no
  // matters, so a cell stops at the first entry that reaches the target.
  const coveredBy = (entries) => {
    const out = new Uint8Array(nCells)
    if (!entries || entries.length === 0) return out
    for (let k = 0; k < nCells; k++) {
      const rx = { x: cellX[k], y: cellY[k], zM: rxZ }
      for (const entry of entries) {
        if (rssiFromAp(entry, rx, scenario.walls, scenario.corners, fieldOpts).rssiDbm >= opts.targetRssiDbm) {
          out[k] = 1
          break
        }
      }
    }
    return out
  }
  const fraction = (arr) => {
    let n = 0
    for (let k = 0; k < nCells; k++) n += arr[k]
    return n / nCells
  }
  // Cells covered by a floor where this floor's devices are `thisFloorAps`
  // (other floors' same-band devices included), each with its real radio.
  const coveredByDevices = (thisFloorAps) => coveredBy(buildFor(thisFloorAps)?.aps)

  // ---- 初始覆蓋（fill：現有同頻段 AP 的實際場；fresh / fixed：全未覆蓋）----
  const covered = coveredBy(initialSources)
  // 58-15: the current coverage of the floor as it is -- this floor's
  // devices included in every mode (fresh / fixed plan without them, but the
  // "before" figure must not leave them out).
  const coverageBefore = initialSources.length === scenario.aps.length
    ? fraction(covered)
    : fraction(coveredBy(scenario.aps))

  // ---- 覆蓋矩陣：每個候選點的 RSSI 場（設計功率、一階）----
  // 記憶體：nCands × nCells × 4B（300 × 650 ≈ 780 KB）。
  const candRssi = new Float32Array(nCands * nCells)
  for (let c = 0; c < nCands; c++) {
    const entry = designApEntry(band, candPos[c], opts, scenario.floorElevationM ?? 0, planModelId)
    const off = c * nCells
    for (let k = 0; k < nCells && !blocked[c]; k++) {
      const rx = { x: cellX[k], y: cellY[k], zM: rxZ }
      candRssi[off + k] = rssiFromAp(entry, rx, scenario.walls, scenario.corners, fieldOpts).rssiDbm
    }
    if (c % 4 === 3 || c === nCands - 1) {
      const cont = await progress('fields', { pct: (c + 1) / (nCands + nReuse) })
      if (!cont) return { aborted: true }
    }
  }
  // 58-14: fill -- this floor's devices whose band radio is off are reuse
  // candidates at their own position, with their own radio (model, TX,
  // channel) switched back on, i.e. exactly what applying would radiate.
  // Switching a radio back on adds no device, so the greedy below takes them
  // before any new position (see the reuse pass).
  const reuseRssi = new Float32Array(nReuse * nCells)
  if (nReuse > 0) {
    reuseRssi.fill(-Infinity)
    const onAps = reuseAps.map((a) => ({ ...a, radios: patchRadio(a, band, { enabled: true }) }))
    const reuseScenario = buildFor(onAps)
    const reuseIndex = new Map(reuseAps.map((a, r) => [a.id, r]))
    const entries = (reuseScenario?.aps ?? []).filter((e) => reuseIndex.has(e.deviceId))
    for (let n = 0; n < entries.length; n++) {
      const off = reuseIndex.get(entries[n].deviceId) * nCells
      for (let k = 0; k < nCells; k++) {
        const rx = { x: cellX[k], y: cellY[k], zM: rxZ }
        const r = rssiFromAp(entries[n], rx, scenario.walls, scenario.corners, fieldOpts).rssiDbm
        if (r > reuseRssi[off + k]) reuseRssi[off + k] = r
      }
      if (n % 4 === 3 || n === entries.length - 1) {
        const cont = await progress('fields', { pct: (nCands + n + 1) / (nCands + entries.length) })
        if (!cont) return { aborted: true }
      }
    }
  }

  // ---- 貪婪 set cover ----
  const target = opts.targetRssiDbm
  const chosen = []            // candidate indices
  const inUse = new Uint8Array(blocked)   // 58-15 (F): blocked ones stay "in use"
  const coverageNow = () => {
    let n = 0
    for (let k = 0; k < nCells; k++) n += covered[k]
    return n / nCells
  }
  const reused = []            // reuse indices (58-14: off devices switched back on)
  const reuseInUse = new Uint8Array(nReuse)
  // 給定「其餘已選候選 + 初始覆蓋」重算 covered（relocate 用）。
  const rebuildCovered = (skipCand, skipReuse = -1) => {
    covered.fill(0)
    if (initialSources.length > 0) {
      // 初始覆蓋重算太貴 — 快取一份。
      covered.set(coveredInitial)
    }
    for (const r of reused) {
      if (r === skipReuse) continue
      const off = r * nCells
      for (let k = 0; k < nCells; k++) {
        if (reuseRssi[off + k] >= target) covered[k] = 1
      }
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
  // 58-14: also scans the reuse candidates (`rssi` / `count` / `used`).
  const pickBest = (rssi = candRssi, count = nCands, used = inUse) => {
    let bestC = -1
    let bestGain = 0
    let bestTie = -Infinity
    for (let c = 0; c < count; c++) {
      if (used[c]) continue
      const off = c * nCells
      let gain = 0
      let tie = 0
      for (let k = 0; k < nCells; k++) {
        if (covered[k]) continue
        const r = rssi[off + k]
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
  // 58-14: reuse pass (fill) -- switching an off radio back on adds no
  // device, so every off device that still adds coverage is taken first
  // (most new cells first), before a single new position. New devices then
  // only fill what the re-enabled ones cannot reach. An off device whose area
  // is already covered (the usual reason auto power switched it off) adds
  // nothing and stays off.
  while (nReuse > 0 && coverageNow() < opts.targetCoverage) {
    const { bestC, bestGain } = pickBest(reuseRssi, nReuse, reuseInUse)
    if (bestC < 0 || bestGain === 0) break
    reused.push(bestC)
    reuseInUse[bestC] = 1
    const off = bestC * nCells
    for (let k = 0; k < nCells; k++) {
      if (reuseRssi[off + k] >= target) covered[k] = 1
    }
  }
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

  // 58-14: a re-enabled device whose cells the new ones now cover anyway
  // adds nothing -- leave its radio off (latest pick first: smallest gain).
  if (reused.length > 0) {
    for (let i = reused.length - 1; i >= 0; i--) {
      rebuildCovered(-1, reused[i])
      const off = reused[i] * nCells
      let gain = 0
      for (let k = 0; k < nCells; k++) {
        if (!covered[k] && reuseRssi[off + k] >= target) gain++
      }
      if (gain === 0) reused.splice(i, 1)
    }
    rebuildCovered(-1)
  }

  // ---- 原地保留：把「位置沒變」的建議對應回既有 AP ----
  // 演算法是確定性的 —— 同樣的牆 / 候選格 / 目標，重跑必然選到相同的候選點。
  // 不處理的話 fresh 重跑會產出「移除 N 顆 + 在完全相同座標新增 N 顆」，
  // 套用結果等於「什麼都沒變，但 AP 全部換了 id 與名字」，還會洗掉使用者
  // 手動調過的功率 / 頻道 / 型號。預覽上也是一堆紅叉疊著藍圈，看不出新的。
  //
  // 對策：候選點與「將被移除的既有同頻段 AP」距離在容差內時，視為原地保留 ——
  // 該候選不產生新 AP，該既有 AP 也不列入移除清單。fill 模式沒有移除語意，
  // 只配對此頻段已關閉的 AP（58-9：保留並重新開啟該射頻）。
  const scale = floor.scale
  // 58-14: the reused off devices are kept (and switched back on) as they are.
  const keptApIds = new Set(reused.map((r) => reuseAps[r].id))
  const keepMatchedCand = new Set()
  const matchedApIds = new Set()   // 58-15: existing devices a chosen position maps to
  const keepPool = opts.mode === 'fill'
    ? offSameBand.filter((a) => !keptApIds.has(a.id))
    : [...existingSameBand, ...offSameBand]
  // 容差取候選格的 1/4：同格點必然 0 距離，這裡只是吸收浮點誤差與
  // 使用者微調過幾公分的情況，不會把「明顯移動過」的 AP 誤判成沒變。
  const tolPx = (opts.candStepM * scale) / 4
  const tol2 = tolPx * tolPx
  // 58-9: fill matches the off devices by candidate cell (within half a
  // step on both axes) instead -- hand-placed devices are rarely within the
  // tolerance of the grid, and a miss would stack a new device next to them.
  const halfCellPx = (opts.candStepM * scale) / 2 + 1e-6
  const byCell = opts.mode === 'fill'
  // 58-15: also run on the positions the top-up below adds.
  const matchKept = (candList) => {
    if (keepPool.length === 0) return
    for (const c of candList) {
      const cx = candPos[c].x * scale
      const cy = candPos[c].y * scale
      let bestAp = null
      let bestD2 = Infinity
      for (const ap of keepPool) {
        if (keptApIds.has(ap.id)) continue      // 一顆既有 AP 只配對一次
        const dx = ap.x - cx
        const dy = ap.y - cy
        if (byCell && (Math.abs(dx) > halfCellPx || Math.abs(dy) > halfCellPx)) continue
        const d2 = dx * dx + dy * dy
        if (d2 < bestD2) { bestD2 = d2; bestAp = ap }
      }
      if (bestAp && (byCell || bestD2 <= tol2)) {
        keptApIds.add(bestAp.id)
        matchedApIds.add(bestAp.id)
        keepMatchedCand.add(c)
      }
    }
  }
  matchKept(chosen)

  // 頻道：58 — every device that stays on this floor (fill: all; fresh /
  // fixed: all but the removed ones) joins with its radios' channels fixed,
  // so the new devices' radios -- on every band -- plan around them.
  // 保留的 AP 頻道不動 —— 使用者可能手動調過，重跑規劃不該洗掉。
  // 58-15: derived from keptApIds, so again after the top-up below.
  const deriveStaying = () => {
    const removedIds = new Set(opts.mode === 'fill'
      ? []
      : [...existingSameBand, ...offSameBand].filter((a) => !keptApIds.has(a.id)).map((a) => a.id))
    // 58-9: kept devices whose radio on the band is off get it switched back on
    // (on apply); the channel plan already sees it on.
    const enableApIds = offSameBand.filter((a) => keptApIds.has(a.id)).map((a) => a.id)
    const enableSet = new Set(enableApIds)
    const stayingDevices = (aps ?? []).filter((a) => !removedIds.has(a.id))
      .map((a) => (enableSet.has(a.id) ? { ...a, radios: patchRadio(a, band, { enabled: true }) } : a))
    return { removedIds, enableApIds, enableSet, stayingDevices }
  }

  // 58-15: devices kept in place stay as they are configured (TX, model,
  // antenna, width, exact position), not as the design candidate the
  // greedy scored at that spot. Re-count coverage with their real radios
  // plus the new design positions; when that is below the target (e.g. the
  // kept devices were turned down by auto power), keep adding new positions,
  // so a short plan is never reported as "nothing to change".
  // Channels stay on the design channel here, like every candidate: the
  // channels' own loss is judged once, on the final plan below -- else a
  // re-run of an applied plan would add devices the first run did not.
  // Repeats while the top-up maps positions onto more existing devices: those
  // are re-counted as configured too.
  let recount = matchedApIds.size > 0
  while (recount) {
    recount = false
    const designCh = allowedChannels(opts.domainId, band)[0]
    covered.set(coveredByDevices(deriveStaying().stayingDevices.map((a) => (matchedApIds.has(a.id)
      ? { ...a, radios: patchRadio(a, band, { channel: designCh }) }
      : a))))
    for (const c of chosen) {
      if (keepMatchedCand.has(c)) continue
      const off = c * nCells
      for (let k = 0; k < nCells; k++) {
        if (candRssi[off + k] >= target) covered[k] = 1
      }
    }
    if (opts.mode !== 'fixed' && coverageNow() < opts.targetCoverage) {
      stopReason = null
      const prevLen = chosen.length
      // fill: the kept off devices are on already -- not reuse candidates;
      // the ones the prune above left off are candidates again.
      reuseAps.forEach((a, r) => { reuseInUse[r] = keptApIds.has(a.id) ? 1 : 0 })
      while (chosen.length < opts.maxAPs) {
        if (coverageNow() >= opts.targetCoverage) {
          stopReason = 'target'
          break
        }
        // 58-14: an off device switched back on before any new position
        // (as in the reuse pass), e.g. one the prune above left off.
        if (nReuse > 0) {
          const re = pickBest(reuseRssi, nReuse, reuseInUse)
          if (re.bestC >= 0 && re.bestGain > 0) {
            reused.push(re.bestC)
            reuseInUse[re.bestC] = 1
            keptApIds.add(reuseAps[re.bestC].id)
            const off = re.bestC * nCells
            for (let k = 0; k < nCells; k++) {
              if (reuseRssi[off + k] >= target) covered[k] = 1
            }
            continue
          }
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
      if (stopReason === null) stopReason = 'max-aps'
      // Added positions on top of an existing device keep it in place (fresh:
      // not "remove + new at the same spot"; fill: its radio switched on),
      // and send the loop round to re-count it as configured.
      const matchedBefore = matchedApIds.size
      matchKept(chosen.slice(prevLen))
      recount = matchedApIds.size > matchedBefore
    }
  }
  const { removedIds, enableApIds, enableSet, stayingDevices } = deriveStaying()

  // ---- 組裝結果 AP 物件（畫布 px）+ 頻道指派 ----
  // 58: a whole device of `planModelId`, every radio on (except bands the
  // domain has no channel for); `planBand` only colours the preview ghost
  // (stripped on apply).
  let proposed = chosen.filter((c) => !keepMatchedCand.has(c)).map((c) => ({
    id: generateId('ap'),
    name: null,                      // 套用端以 globalAPCounter 連號命名
    x: candPos[c].x * scale,
    y: candPos[c].y * scale,
    z: 2.4,
    antennaMode: 'omni',
    azimuth: 0,
    beamwidth: 60,
    patternId: null,
    mountType: 'ceiling',
    modelId: planModelId,
    color: '#4fc3f7',
    radios: radiosForModel(planModelId, [], opts.domainId),
    planBand: band,
  }))

  const channelPool = [...stayingDevices, ...proposed]
  const fixedChannels = new Map()
  for (const a of stayingDevices) {
    for (const r of apRadios(a)) {
      // 58-15: a radio switched back on had no channel in use -- it is
      // planned like a new one, not held at the channel it kept while off.
      if (enableSet.has(a.id) && r.band === band) continue
      fixedChannels.set(radioKey(a.id, r.band), r.channel)
    }
  }
  // 57-34: neighbours = radios that hear each other (scenario with this floor =
  // the planned pool, every band).
  // 58-16 (C1): other floors' radios in that scenario are fixed neighbours
  // (same as storeChannelNeighbors) -- avoided, never reassigned.
  const poolScenario = buildFor(channelPool, null)
  // A re-enabled radio joins with no channel: the planner prefers a radio's
  // current channel, and this one's is only the one it kept while off.
  const planRadios = expandRadios(channelPool).map((r) => (
    enableSet.has(r.deviceId) && r.frequency === band ? { ...r, channel: null } : r))
  const assigned = greedyChannelAssign(planRadios, opts.domainId,
    poolScenario ? makeApHearingFn(poolScenario, { crossFloorFixed: true }) : 300, fixedChannels.size ? fixedChannels : null)
  proposed = applyRadioResults(proposed, assigned, (a) => ({ channel: a.channel }))
  // 58-15: the channel each re-enabled radio gets (apply / preview write it).
  const enableChannels = {}
  for (const id of enableApIds) {
    const a = assigned.get(radioKey(id, band))
    if (a) enableChannels[id] = a.channel
  }

  // 58-15: the reported coverage is the floor as applied -- kept devices as
  // configured, re-enabled radios and new devices on their assigned channels
  // (the greedy scored every candidate on the band's first channel).
  const enableChannelMap = new Map(Object.entries(enableChannels).map(([id, ch]) => [radioKey(id, band), ch]))
  const finalDevices = [
    ...applyRadioResults(stayingDevices, enableChannelMap, (ch) => ({ channel: ch })),
    ...proposed,
  ]
  const coverageAfter = fraction(coveredByDevices(finalDevices))
  const targetMet = opts.mode === 'fixed' ? null : coverageAfter >= opts.targetCoverage
  // Positions met the target, the assigned channels' extra loss did not.
  if (targetMet === false && stopReason === 'target') stopReason = 'channel'

  // 58-15 (decision 5): a re-plan removes whole devices (fresh / fixed) or
  // adds devices with every radio (fill), so the other bands change too --
  // each band this floor has before or after, on the headline's basis (same
  // cells, indoor when applied, >= targetRssiDbm), the floor as it is vs. as
  // applied (finalDevices: the channels assigned above).
  const otherBands = []
  if (proposed.length > 0 || removedIds.size > 0) {
    for (const ob of [2.4, 5, 6]) {
      if (ob === band) continue
      if (!(aps ?? []).some((a) => hasEnabledBand(a, ob)) && !finalDevices.some((a) => hasEnabledBand(a, ob))) continue
      const only = (list) => (list ?? []).map((a) => withOnlyBand(a, ob)).filter(Boolean)
      otherBands.push({
        band: ob,
        coverageBefore: fraction(coveredBy(buildFor(aps ?? [], only)?.aps)),
        coverageAfter: fraction(coveredBy(buildFor(finalDevices, only)?.aps)),
      })
    }
  }

  // 58-15 (F): fill that adds devices or misses the target -- this floor's
  // same-band devices that are on but well below the design TX
  // (WEAK_TX_MARGIN_DB) and that, raised to it, would cover cells the current
  // devices leave uncovered. Most such cells first.
  const weakAps = []
  if (opts.mode === 'fill' && (proposed.length > 0 || targetMet === false) && existingSameBand.length > 0) {
    const setTx = new Map(existingSameBand.map((a) => [a.id, apRadio(a, band).txPower ?? getDefaultTxPower(band)]))
    const cur = new Map((scenario.aps ?? []).filter((e) => setTx.has(e.deviceId)).map((e) => [e.deviceId, e.txDbm]))
    // Raised to the design TX, capped by its own model / antenna / EIRP.
    const raised = buildFor(existingSameBand.map((a) => ({
      ...a,
      radios: patchRadio(a, band, {
        txPower: Math.min(getDefaultTxPower(band), getAPModelById(a.modelId ?? DEFAULT_AP_MODEL_ID).maxTxPower[band] ?? 23),
      }),
    })))
    for (const e of raised?.aps ?? []) {
      if (!setTx.has(e.deviceId) || !cur.has(e.deviceId)) continue
      if (e.txDbm - cur.get(e.deviceId) < WEAK_TX_MARGIN_DB) continue
      let gain = 0
      for (let k = 0; k < nCells; k++) {
        if (coveredInitial[k]) continue
        if (rssiFromAp(e, { x: cellX[k], y: cellY[k], zM: rxZ }, scenario.walls, scenario.corners, fieldOpts).rssiDbm >= target) gain++
      }
      if (gain === 0) continue
      const a = existingSameBand.find((d) => d.id === e.deviceId)
      weakAps.push({ id: a.id, name: a.name ?? a.id, txDbm: setTx.get(a.id), gain })
    }
    weakAps.sort((p, q) => q.gain - p.gain)
  }
  return {
    aborted: false,
    proposedAps: proposed,
    // 原地保留的既有 AP 不列入移除。
    removeApIds: [...removedIds],
    keptApIds: [...keptApIds],
    // 58-9: kept devices whose `band` radio is switched back on when applied.
    enableApIds,
    // 58-15: { apId: channel } -- the planned channel of each re-enabled radio.
    enableChannels,
    stats: {
      placedCount: proposed.length,
      // 位置與既有 AP 相同、原地沿用的顆數（UI 用來說明「什麼都沒變」）。
      keptCount: keptApIds.size,
      // 其中此頻段原本關閉、套用時重新開啟的顆數（58-9）。
      enabledCount: enableApIds.length,
      // 移除清單中此頻段原本就關閉的顆數（58-9：fresh / fixed 一併移除）。
      removedOffCount: offSameBand.filter((a) => removedIds.has(a.id)).length,
      coverageBefore,
      coverageAfter,
      cellsTotal: nCells,
      candidates: nCands,
      // 室內偵測診斷：indoorFallback=true 代表使用者勾了「僅室內放置」
      // 但偵測不可信（沒牆 / 牆有縫漏光），已退回全範圍 —— UI 要明講。
      indoorApplied: opts.indoorOnly && !indoorFallback,
      indoorFallback,
      // 58-15 (D3): why -- 'no-walls' / 'leaky' (walls not closed) / null
      // (unclear: e.g. tiny rooms; the walls are not blamed).
      indoorFallbackReason: !indoorFallback ? null : indoor.noWalls ? 'no-walls' : indoor.leaky ? 'leaky' : null,
      indoorRatio: indoor.ratio,
      // 58-15 (D4): the steps used; gridCoarsened = widened for a large floor.
      gridStepM: opts.gridStepM,
      candStepM: opts.candStepM,
      gridCoarsened,
      // 58-15 (F): fill -- weak same-band devices (see above).
      weakAps: weakAps.map(({ gain, ...a }) => a),
      // 58-15 (decision 5): [{ band, coverageBefore, coverageAfter }] -- the
      // other bands' coverage on the headline's basis (see above).
      otherBands,
      // 停止原因 + 是否真的達標（套用後的實際配置為準，58-15）。
      // fixed 模式沒有覆蓋率目標，不判定達標。
      // 'channel' — 位置以設計頻道已達標，但實際頻道（頻率較高、損耗較大）使覆蓋略降
      stopReason,
      targetMet,
      elapsedMs: performance.now() - t0,
    },
    opts,
  }
}
