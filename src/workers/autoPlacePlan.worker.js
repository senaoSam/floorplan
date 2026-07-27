// Phase 49 — autoPlacePlan in a Web Worker.
//
// 與 autoPowerPlan.worker 同款：搜尋跑在 worker 讓 UI 保持流暢。
//
// Message protocol (main → worker):
//   { type: 'run', payload: { floor, walls, aps, scopes, userOpts } }
//
// Message protocol (worker → main):
//   { type: 'progress', state: { phase, pct?, placed?, coverage?, elapsedMs } }
//   { type: 'done',     result: { aborted, error?, proposedAps?, removeApIds?, stats? } }
//   { type: 'error',    message }
//
// 取消：主線程直接 worker.terminate()（同 autoPowerPlan——搜尋是同步
// microtask 鏈，in-band cancel 訊息會被餓死，不提供）。

import { runAutoPlacePlan } from '@/utils/autoPlacePlan'

self.addEventListener('message', async (e) => {
  const msg = e.data
  if (!msg || msg.type !== 'run') return

  try {
    const { floor, walls, aps, scopes, userOpts } = msg.payload
    const r = await runAutoPlacePlan({
      floor,
      walls,
      aps,
      scopes,
      userOpts,
      onProgress: (st) => {
        self.postMessage({ type: 'progress', state: st })
        return true
      },
    })
    self.postMessage({
      type: 'done',
      result: {
        aborted: r.aborted,
        error: r.error ?? null,
        proposedAps: r.proposedAps ?? null,
        removeApIds: r.removeApIds ?? null,
        keptApIds: r.keptApIds ?? null,
        stats: r.stats ?? null,
      },
    })
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err) })
  }
})
