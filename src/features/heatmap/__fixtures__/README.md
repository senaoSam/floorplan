# Heatmap Golden Fixtures

Frozen snapshots of the JS heatmap engine's output, used as the reference
when porting the engine to GLSL (HM-F5a~f). The diff harness (HM-T2) runs
the shader version against the same scenarios and reports per-cell dB error
against `field.json` here.

## Layout

```
__fixtures__/
  build-golden.mjs         # generator (run via `pnpm heatmap:golden`)
  diff-golden.mjs          # diff harness (run via `pnpm heatmap:diff`)
  README.md                # this file
  basic/
    scenario.js            # input — single source of truth, hand-written
    field.json             # output — rssi/sinr/snr/cci as base64 Float32Array
    meta.json              # commit hash, timestamp, engine fingerprint, opts
    diff-report.html       # written by `pnpm heatmap:diff --html` (gitignored)
```

Each fixture lives in its own directory. The generator picks up every
subdirectory containing a `scenario.js`.

## Why two output files

- `field.json` is the binary payload, kept compact (base64 Float32Array)
  and rewritten as a single blob — no noisy per-cell diffs in git.
- `meta.json` is human-readable, captures provenance (commit hash, dirty
  flag, engine source fingerprint) and per-channel stats so a quick glance
  can confirm a regeneration didn't drift unexpectedly.

## Regenerating

```bash
pnpm heatmap:golden            # all fixtures
pnpm heatmap:golden basic      # just one
```

The generator boots a one-off Vite dev server (middleware mode, no HTTP)
purely to resolve `@/` aliases inside the engine. No HTTP port is opened.

## When to regenerate

- After **intentional** algorithm changes to `propagation.js`,
  `sampleField.js`, `buildScenario.js`, or `frequency.js`.
- After material constants change (`materials.js` ITU coefficients).

If you regenerate during shader work, the diff harness (HM-T2) will lose
its baseline — keep regeneration on `main`/JS-only branches.

## When NOT to regenerate

- During GPU/shader development (HM-F5a~f). The whole point of the
  fixture is to stay frozen so the shader can be diffed against it.
- When inspecting unexplained diffs — investigate first.

## Diff harness (HM-T2)

```bash
pnpm heatmap:diff                        # diff every fixture vs current JS engine
pnpm heatmap:diff basic                  # one fixture
pnpm heatmap:diff basic --html           # also write diff-report.html
pnpm heatmap:diff basic --engine shader  # diff shader engine vs golden (HM-F5a+)
pnpm heatmap:diff --ci                   # exit non-zero if any threshold breached
```

For each channel (rssi/sinr/snr/cci) the harness reports:

- **max / mean / p95 abs error** in dB
- counts of cells over **0.5 / 1.0 / 3.0 dB**
- **NaN mismatches** (one side NaN, other finite — always treated as failure)
- worst N cells with `(i, j, x_m, y_m, golden, current, |Δ|)`

Default per-channel pass threshold is **±1 dB**. Override via env, e.g.
`HEATMAP_DIFF_THRESHOLD_RSSI=3 pnpm heatmap:diff --ci`.

`--html` writes `diff-report.html` alongside the fixture: a 3-panel grid per
channel (golden / current / |diff|, with green ≤ thr / yellow thr–3·thr /
red &gt; 3·thr / magenta = NaN mismatch).

## Acceptance gates per HM-F5 sub-stage (HM-T4)

The shader port lands incrementally: each F5 sub-stage adds physics that the
previous stage couldn't do, so the diff bar relaxes accordingly. The harness's
default threshold (`±1 dB`) corresponds to **full parity (F5d)**. While the
shader is at an intermediate stage you must override per-channel thresholds
to match what's actually implemented — otherwise CI mode will rightly fail.

### Why per-stage thresholds, not "fix it later"

Each stage is allowed to be wrong about a *specific* physics term. F5a
intentionally skips reflections, so it must match a "Friis + walls only"
reference, not the full JS engine. Holding F5a to ≤1 dB would force us to
implement reflections inside F5a's MVP and defeat the whole staging plan.
The lookup table below names which term each stage adds and how loose the
diff bar is allowed to be on its way there.

### Threshold table

| Stage | Adds | RSSI / SNR / CCI | SINR | Notes |
| ----- | ---- | ---------------- | ---- | ----- |
| **F5a** MVP | Friis + walls (with Z filter), slab, openings | ≤ **3.0 dB** | ≤ **3.0 dB** | No reflections, no diffraction, no multi-frequency coherence yet — large absolute drift expected near reflective walls and grazing slabs. |
| **F5b** BVH | (perf only — same physics as F5a) | ≤ **3.0 dB** | ≤ **3.0 dB** | Identical numerical envelope to F5a; this stage just makes it fast. Diff must not regress vs F5a. |
| **F5c** Reflections + Fresnel | image-source reflections, complex Fresnel per polarization, knife-edge diffraction | ≤ **1.5 dB** | ≤ **1.5 dB** | Reflections fold most of the F5a drift into spec. Diffraction lands here too — corner cells should now be inside ±1.5 dB. |
| **F5d** Multi-frequency coherent sum | per-channel N-sample frequency average | ≤ **1.0 dB** | ≤ **1.0 dB** | Full parity with the JS engine. From here onward the harness's default threshold applies; CI mode runs with no overrides. |
| **F5e/f** Optimisations | (perf only) | ≤ **1.0 dB** | ≤ **1.0 dB** | Must not regress F5d. |

NaN-mismatch count must be **0** at every stage — out-of-scope masking is
data-driven (scope polygon test) and does not depend on which physics terms
the shader implements. A nonzero `nanMis` always indicates a scope-mask wiring
bug, not a physics drift, regardless of the stage.

### Running the gate per stage

```bash
# F5a / F5b
HEATMAP_DIFF_THRESHOLD_RSSI=3 \
HEATMAP_DIFF_THRESHOLD_SINR=3 \
HEATMAP_DIFF_THRESHOLD_SNR=3  \
HEATMAP_DIFF_THRESHOLD_CCI=3  \
pnpm heatmap:diff --engine shader --ci

# F5c
HEATMAP_DIFF_THRESHOLD_RSSI=1.5 \
HEATMAP_DIFF_THRESHOLD_SINR=1.5 \
HEATMAP_DIFF_THRESHOLD_SNR=1.5  \
HEATMAP_DIFF_THRESHOLD_CCI=1.5  \
pnpm heatmap:diff --engine shader --ci

# F5d onward (default ±1 dB, no env override needed)
pnpm heatmap:diff --engine shader --ci
```

Any sub-stage is "done" when its corresponding command above exits 0 against
**every** committed fixture (currently just `basic/`; HM-T5 adds more before
F5b and F5d land).

## Adding a new fixture

1. Create `__fixtures__/<name>/scenario.js` exporting `floors`, `wallsByFloor`,
   `apsByFloor`, `scopesByFloor`, `floorHolesByFloor`, `engineOpts`, `meta`.
2. Run `pnpm heatmap:golden <name>`.
3. Commit `scenario.js`, `field.json`, `meta.json` together.

Edge-case fixtures (`dense-walls/`, `dense-aps/`, `cross-floor-tunneling/`)
are tracked under HM-T5 and only added when their respective shader
sub-stage (HM-F5b/d) gets close to implementation.
