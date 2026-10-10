# Local runtime implementation and release gates

Implementation follows `RUNTIME_PLAN.md` v1.1 decisions D1–D3. P5 storage replacement and P6 hosted deployment are excluded. No production deployment or paid-model batch was performed.

## Delivered code

- Quick-only contracts, queue, canvas and private MP4/poster exports; retired approval, speech and source-archive paths removed. Dry-run-first legacy migration preserves CAS, live-producer and unresolved-stop guards.
- Local `MediaRuntime`: isolated contexts, trusted local assets/fonts, deterministic samples, bounded frame/encoder execution, verified immutable caches and final media QA. Independent shots use the bounded pool; assembly copies the encoded video stream and writes audio/AIGC metadata.
- Production rendering through a scoped Unix RPC and dedicated systemd identity. Cancellation and quiescence wait for owned work; a verified stop permits a fresh operation without replaying paid calls. Unproven stops remain blocked.
- Bounded PDF worker thread and local image preparation with durable proof and read-only recovery.
- Private scene endpoint, opaque `allow-scripts` iframe, parent-controlled playback, child CSP and parent HTTP `frame-src 'none'`. Explicit development-only unsafe rendering is visibly warned.
- Pinned fonts/dependencies, installation-time reconstruction of the exact bundled CJK font bytes, doctor, restricted systemd units and deployment instructions.

## Verification

The full regression suite passed on the integrated tree. The final lossless PNG optimization additionally passed 23 runtime tests, including real-browser pixel-equivalence checks; type/lint/build were rechecked after integration.

| Check | Result |
|---|---|
| TypeScript | Passed |
| ESLint | Passed |
| Production Next.js build | Passed |
| Full unit suite | 86 files; 453 passed; 12 native opt-in cases skipped |
| Explicit native runtime suite | 23 passed after PNG optimization; real Chromium/FFmpeg and pixel equivalence |
| Browser suite against production build | 68 passed |
| Retired execution references | No case-insensitive `docker` references in `src` or `scripts` |
| Two-axis review | Standards and specification findings corrected and re-reviewed |

Native/browser execution used the explicit development sandbox override because this environment runs as root. The installed browser download failed; tests used the existing `/tmp/chromium` executable. Unix sockets cannot be bound here, so RPC protocol/cancellation tests used an injected loopback transport; production Unix socket permissions still require target-host verification. None of these tests certify the production OS sandbox.

## Remaining release gates

See `evidence/runtime-bench/README.md` for every measured round and exact source snapshots. Earlier sequential and concurrent results are retained, including failed gates and malformed intermediate-file evidence. Reconstructed host baselines exclude container overhead; the current host has 8 vCPU, unlike the proposed 2-vCPU production limit.

The final three alternating measurements pass the numeric benchmark gates: median baseline 37.139 s versus runtime 10.263 s (27.634%); minimum SSIM 0.995946; maximum size ratio 1.10535; all runs contain 288 frames at 24 fps over 12 seconds. These are development-host results, not production sandbox or 2-vCPU acceptance.

P4 remains unverified: run doctor as the dedicated non-root identity on Ubuntu 24.04, check actual service permissions/network/resource limits, and record live cancellation/recovery. This branch is a draft implementation for review, not an assertion that P0–P4 production acceptance or deployment has completed.
