# Fixed runtime comparison evidence

These are **unsafe development measurements, not production certification**. The latest concurrent lossless CDP run passed all numerical P0 comparison thresholds on this 8-vCPU host: median **37.139 s baseline → 10.263 s runtime (27.63%)**, SSIM **0.995946**, size **1.10535×**. Production sandboxing and 2-vCPU performance remain unverified. Earlier unsuccessful candidates are retained below. No paid models or application generation commands were used.

## Results, 2026-10-10

Every output below passed full decode, 288 video frames, 12 seconds, 1920×1080, 24 fps, H.264/yuv420p/BT.709, stereo 48 kHz AAC, and AI metadata checks. All H.264 encodes on both sides used `faster`, CRF 20, two threads, and GOP 48. The fixed scene is the checked-in `scene.html`, with the same pinned Noto Sans SC font used in the browser and AI label.

| Candidate | Baseline seconds | Candidate seconds | Time ratio (gate ≤0.50) | SSIM (gate ≥0.99) | Size ratio (gate ≤1.30) |
|---|---:|---:|---:|---:|---:|
| Playwright JPEG 92 | 48.044 | 27.235 | 0.5669 **fail** | 0.992471 | 1.4896 **fail** |
| CDP PNG, optimizeForSpeed | 49.716 | 35.461 | 0.7133 **fail** | 0.995946 | 1.1054 |

These are one-round exploratory measurements, not statistically stable medians. Lossless PNG improved quality and size but missed the time target. No production encoder policy should be changed based solely on these prototype runs. `--repeats 3` alternates order and computes medians when a candidate warrants repeated measurement.

The PNG run's baseline shot work took 41.492 s (21.347 s frame capture), concat 4.214 s, and final label/audio transcode 4.010 s. Its candidate shot work took 35.208 s (20.018 s piped capture plus encode), and copy assembly 0.253 s. Shot setup includes loading the full font embedded in each page and the same six deterministic sample captures. This font-loading approach adds substantial setup overhead; the actual runtime uses local font resources and must be measured separately.

Reports, exact harness source snapshots matching each report's `harnessSha256`, full per-command exit/stderr logs, and per-frame SSIM are in:

- `runs/faster20-jpeg92-tmp/`
- `runs/faster20-pngfast-tmp/`

Binary intermediates remain outside git. Reports retain absolute original output paths and content hashes; those paths are transient and are not links to deployed artifacts.

## Actual local runtime, serial reference

The retained serial adapter snapshot exercises `createLocalRuntime`, including factory startup, all four sequential `renderShot` calls, deterministic checks, posters, full runtime QA, cache hashing/manifests, durable publication, `assemble`, and `close`. Every run uses a fresh project and output directory. Source implementation is commit `bd9964e` (dependency cherry-pick `0032975` in this worktree); runtime renderer and full digest are in the report.

| Candidate | Baseline seconds | Runtime seconds | Time ratio | SSIM | Size ratio |
|---|---:|---:|---:|---:|---:|---:|
| Actual runtime, PNG | 45.683 | 40.382 | 0.8840 **fail** | 0.995946 | 1.1054 |

Media checks passed: 288 frames, 12 seconds, 24 fps, full decode, codecs/color/audio/AI metadata as above. This is one exploratory round on the shared development host; it does not establish a stable performance distribution. **The actual runtime has not met P0's ≤50% time gate.** Quality and size met the numeric thresholds in this round; production isolation remains unverified.

Startup took 0.392 s; per-shot times were 10.536, 9.298, 9.082, and 10.024 s; assembly took 1.034 s. Shot processing dominates. The public runtime does not expose separate capture/encode/QA spans, so capture time is `null`; no internal phase split is estimated. Actual runtime QA, hashing, and publication remain inside these timings. Common harness probe/decode/SSIM takes another 4.550 s outside both pipeline measurements.

The follow-up harness delivers the same font bytes through a fixed intercepted font URL instead of embedding the full font in every HTML payload. The actual adapter uses the runtime's local font route and waits explicitly for that font before `READY`. Neither path makes a remote font request. Baseline and candidate final file hashes match the earlier PNG comparison, providing a byte-level check that this setup change preserved outputs. The adapter rejects different encoder policies or font bytes. The actual runtime uses ordinary PNG capture, not the prototype's CDP PNG optimization.

`runs/local-runtime-png-tmp/` retains the exact harness and adapter source snapshots, runtime version/digest, probe/hash data, per-command harness logs, and frame SSIM. Internal runtime subprocess logs are not exposed through its public API and are not fabricated in the harness command log.

To exercise the real implementation with the command above, use `--capture png --adapter docs/engineering/evidence/runtime-bench/local-runtime-adapter.ts`. The font must reside in its locked `fonts/notosanssc` directory with the parent `fonts.lock.json`. The core runtime's pinned encoder policy is authoritative; mismatched harness flags fail the adapter.

Validation: focused strict ES2022 TypeScript checks passed for the harness, adapter, and imported runtime files; ESLint passed for the harness. An explicit `NODE_ENV=production` invocation with `--unsafe-no-sandbox` rejected before rendering with exit 1. Native full comparison checks are recorded in the reports. No full application suite was run as part of this isolated T0 task.

## Concurrent local runtime

The adapter now dispatches independent shots with `Promise.all`; its returned clips remain in input order. It leaves the factory concurrency at its existing default `max(1,min(4,floor(availableParallelism()/2)))`. This host reported `availableParallelism() = 8`, so four slots were available. The per-shot FFmpeg encoder policy remains two threads, faster, CRF 20, GOP 48, and lossless PNG input. All QA, poster creation, hashes, manifests, publication and assembly remain enabled and timed. `shotsMs` measures elapsed wall time, not the sum of overlapping shot durations.

The first concurrent comparison measured **40.014 s baseline → 22.022 s runtime (55.04%)**, with **SSIM 0.995946** and **size ratio 1.10535**. Media validation passed, and the final MP4 hash is identical to the serial runtime output, providing direct evidence that concurrent completion did not reorder or change frames. The time gate still failed in this first round. Evidence is retained at `runs/local-runtime-png-parallel-tmp/`; the original serial report is unchanged.

Three additional alternating-order repetitions retained every result:

| Round | Order | Baseline seconds | Runtime seconds | Time ratio |
|---|---|---:|---:|---:|
| 1 | baseline-first | 38.295 | 21.759 | 0.5682 |
| 2 | candidate-first | 39.332 | 21.735 | 0.5526 |
| 3 | baseline-first | 38.007 | 21.665 | 0.5700 |

Median times were **38.295 s baseline and 21.735 s runtime**, a **0.5676 ratio**. Every individual timing ratio exceeded 0.50. All three rounds passed media validation with **SSIM 0.995946** and **size ratio 1.10535**. Their final MP4 hashes all exactly match the retained serial runtime output. Thus the concurrent change improves throughput while preserving this fixture's pixels and frame order, but **P0's time gate remains unmet on this host**. No pool failure occurred. Other agents' native render tests were paused during these three rounds; the development host is still not a dedicated production benchmark machine.

`runs/local-runtime-png-parallel-repeat3-tmp/` contains the complete three-round report, exact harness/adapter snapshots, per-command harness logs, and each round's per-frame SSIM. The default four-slot pool and two encoder threads per shot are recorded in every round, rather than inferred from a video duration or estimated progress. The adapter's per-shot times include any time waiting for a slot; the overlapping times are not added together to claim wall-time savings.

Resource limits matter: both paths ran on the same host with an **8-vCPU cgroup quota** and 8 GiB memory. The baseline renders one shot at a time; the candidate can run four encoders (up to eight encoder threads) plus browser work concurrently. This is the benefit being measured, not equal instantaneous CPU usage. **These results do not establish performance on the proposed production `CPUQuota=200%` (2-vCPU) worker.** That constrained deployment, its actual pool size, and its Chromium sandbox require separate verification. Root/unsafe host results cannot certify production isolation even if a numerical timing gate passes.

## Concurrent lossless CDP capture

The follow-up uses integration base `dfe5177` plus capture change `1153af8` (dependency cherry-pick `7038581` in the benchmark worktree). The implementation change passed 23 core/native checks before this benchmark began. It uses `Page.captureScreenshot` with **`format: 'png'`, `optimizeForSpeed: true`, `captureBeyondViewport: false`, `fromSurface: true`** for eligible frames. Frames with animation, editable controls or shadow roots preserve the existing Playwright screenshot behavior with animations disabled. JPEG behavior and H.264 encoder policy are unchanged. The fixed Canvas fixture qualifies for the lossless PNG fast path; no runtime invocation counter is claimed.

The same four-slot factory pool, four fixed shots, pinned font, faster/CRF20/two-thread/GOP48 encoder, AI label, metadata, validation, hashes, and durable publication remain in use. No QA was removed, and no baseline stage was added or slowed. The harness's unrelated daemon inventory probe was removed on the integration base; it was always outside measured pipeline time. Font packaging metadata changed on that base, but the actual font bytes and all final video bytes match the retained earlier comparisons.

| Round | Order | Baseline seconds | Runtime seconds | Time ratio |
|---|---|---:|---:|---:|
| 1 | baseline-first | 37.882 | 10.263 | 0.2709 |
| 2 | candidate-first | 37.139 | 10.344 | 0.2785 |
| 3 | baseline-first | 37.023 | 9.894 | 0.2672 |

The **median time ratio is 0.2763**, with **minimum SSIM 0.995946** and **maximum size ratio 1.10535**. All three rounds individually passed every numerical/media gate, including 288 frames, 12 seconds, 24 fps, full decode, expected video/audio formats and AI metadata. Every candidate final MP4 hash exactly matches the previous serial and concurrent runtime reference, and every baseline final hash also matches its reference. This confirms the measured speed improvement preserves the fixture's exact encoded output and frame order.

`runs/local-runtime-png-cdp-repeat3-tmp/` retains every round, per-frame SSIM, harness command logs, exact harness/adapter snapshots, and `capture-policy.json` with the source-inspected CDP options and implementation identity. The runtime digest is `0cb8c433d29a87dc095276b8b3caa41a0d91eefd0b00706dce66de7ce15c8dcb`; its renderer source hash changes with the capture code, while its encoder settings remain unchanged. Internal capture time is still `null`, rather than an invented phase breakdown. Other native CPU-heavy work was paused throughout the three rounds.

This is a **same-host 8-vCPU comparison pass**, not proof of production readiness or a measurement under `CPUQuota=200%`. The baseline is reconstructed on the host, not daemon-backed. Root/unsafe Chromium remains explicitly labelled, and the reports retain `productionReady: false` and `productionCertification: false`. The prior failed measurements remain intact rather than being replaced by the passing run.

## Scope and environment

The baseline reconstructs the former **host-side** algorithm: browser per shot → PNG files → shot encode → concat transcode → final label/audio transcode. No Docker binary/daemon was available. Container startup, polling, container CPU limits, and repeated legacy QA are not represented. This baseline does not reproduce the earlier plan's inconsistent encode presets and must not be compared as though it did.

The built-in candidate is an optimization prototype: persistent browser with fresh context per shot → image pipe with label in the first encode → stream-copy assembly. It does not exercise T3 cache, asset authorization, publication, process isolation, or runtime QA. Common final probe/decode and SSIM time is reported separately, outside both pipeline times. Model calls, app scheduling, and storage are excluded.

Environment: root UID 0 with explicit `--unsafe-no-sandbox`; Chromium 153.0.8010.0; Playwright 1.63.0; Node 22.23.3; FFmpeg/ffprobe 6.1.1-3ubuntu5; Linux 6.18.44; AMD EPYC 9V74. Cgroup CPU limit is **8 vCPU** (`800000 100000`) and memory limit **8 GiB**, unlike the plan's prior 2-vCPU benchmark. These runs share a development host with other tasks. Browser/font hashes and FFmpeg build hash are recorded in each report. The Chromium executable was previously extracted to `/tmp/chromium`; this is not evidence that the production browser installation or sandbox works.

## Reproduce

From the repository root with locked dependencies installed:

```sh
node --import tsx scripts/video/bench-runtime.ts \
  --out /tmp/vb-runtime-bench-example \
  --font /absolute/path/runtime/fonts/notosanssc/NotoSansSC.ttf \
  --chromium /absolute/path/chromium \
  --ffmpeg /usr/bin/ffmpeg --ffprobe /usr/bin/ffprobe \
  --capture png-fast --preset faster --crf 20 --threads 2 --repeats 3
```

Only for root development measurements, append `--unsafe-no-sandbox`. The harness rejects that flag under `NODE_ENV=production` and warns visibly otherwise. Production must use a non-root, sandbox-capable environment. Add `--require-gates` for exit code 2 when a complete comparison misses any numerical gate; incomplete/error runs exit 1. Defaults are JPEG 92, faster/20, two threads, and one round. Output/font paths must be filter-safe (letters, digits, slash, dot, underscore, dash). A fresh output directory is required; no existing result is deleted.

In this development environment dependencies were reused via `NODE_PATH=/workspace/scratch/4caaebdaa680/videoBuddy/node_modules` and an absolute `--import .../node_modules/tsx/dist/loader.mjs`; the `tsx` CLI itself could not open its IPC socket. Reports retain the complete harness arguments. The executable's Node and package versions come from the report, not the illustrative command.

`--adapter /absolute/path/adapter.ts` calls the module's `runRuntimeBenchmark(input)` export instead of the prototype. `RuntimeBenchInput` supplies fixed clocks, scene, font, binaries, and encode policy; the adapter returns an actual output path and wall timings. Capture time may be `null` when not exposed. Optional `details` records runtime-specific evidence. The harness independently probes, fully decodes, hashes, and computes SSIM. An adapter must preserve encoding/label/font settings and include its actual QA/cache/publication work in its wall time; missing timings must not be invented. The adapter path/hash is included in the report. This hook is ready for the actual T3 factory.

## Retained anomaly

Two earlier output-in-worktree attempts failed when concat read a truncated MP4 without `moov`. `runs/faster20-jpeg92-v3/commands.jsonl` records FFmpeg exit 0, a completed 72-frame encode and faststart relocation, followed by concat failure. A failed sample plus byte/hash/probe evidence is retained under `anomalies/`. Root reported no broad process cleanup. Manual re-encode of identical PNG frames succeeded. All subsequent output-in-`/tmp` comparisons recorded here succeeded.

The cause is **unresolved**. Filesystem synchronization is a hypothesis, not an established diagnosis. Failed runs are excluded from timing and quality conclusions. The current harness records immediate output byte counts and hashes after process exit to support subsequent investigation. Use `/tmp` for active render output in this environment and copy completed reports/logs into evidence afterward.
