// HM-F9 — autoPowerPlan in a Web Worker.
//
// Runs the greedy multi-start search off the main thread so the UI stays
// responsive (modal progress, scrolling, cancel) during 30 s ~ 2 min plans.
//
// Message protocol (main → worker):
//   { type: 'run', payload: { floor, walls, aps, scopes, apIdsToPlan, userOpts } }
//   { type: 'cancel' }
//
// Message protocol (worker → main):
//   { type: 'progress', state: { ...iter info, elapsedMs, etaMs } }
//   { type: 'done',     result: { aborted, error?, txMapEntries?, score?, opts? } }
//   { type: 'error',    message }
//
// scopeMaskFn (a closure inside the scenario) cannot cross postMessage, so we
// re-import buildScenario inside the worker and rebuild the scenario from raw
// floor/walls/aps/scopes here. txMap is serialized as entries array.

import { runAutoPowerPlan } from '@/utils/autoPowerPlan'

let aborted = false

self.addEventListener('message', async (e) => {
  const msg = e.data
  if (!msg || !msg.type) return

  if (msg.type === 'cancel') {
    aborted = true
    return
  }

  if (msg.type === 'run') {
    aborted = false
    try {
      const { floor, walls, aps, scopes, apIdsToPlan, userOpts } = msg.payload
      const r = await runAutoPowerPlan({
        floor,
        walls,
        aps,
        scopes,
        apIdsToPlan,
        userOpts,
        // Inside the worker thread, onProgress doesn't have to await a
        // round-trip — we just post the state and check the in-process
        // `aborted` flag (set by 'cancel' messages).
        onProgress: (st) => {
          self.postMessage({ type: 'progress', state: st })
          return !aborted
        },
      })
      // Map cannot be cloned via structured clone for our use here (works for
      // simple Maps but we also need to be defensive) — convert to entries.
      const out = {
        aborted: r.aborted,
        error: r.error ?? null,
        txMapEntries: r.txMap ? Array.from(r.txMap.entries()) : null,
        score: r.score ?? null,
        opts: r.opts ?? null,
      }
      self.postMessage({ type: 'done', result: out })
    } catch (err) {
      self.postMessage({ type: 'error', message: err?.message ?? String(err) })
    }
  }
})
