# Local runtime implementation task graph

Approved specification: `docs/engineering/RUNTIME_PLAN.md` v1.1, decisions D1–D3. Deliver P0–P4 on `feat/local-video-runtime`; optional SQLite P5 and Vercel P6 are excluded. No production deployment or paid model batch is part of this refactor.

## Tickets and dependency frontier

| Ticket | Depends on | Scope / owner |
|---|---|---|
| T0 baseline | — | Fixed benchmark, environment inventory, comparison harness and truthful evidence; scripts/evidence only |
| T1 backend removal | — | §7.1 backend staged/audio removal; quick-only queue/contracts/publication/export; migration of legacy pending approvals; relevant unit tests |
| T2 frontend removal | — | Remove staged/approval/audio UI, hooks, and obsolete E2E tests; preserve canvas quick journeys |
| T3a standalone runtime | — | New isolated MediaRuntime contract and local implementation, pinned dependencies/fonts, bounded PDF worker; no replacement of current callers |
| T3 local runtime integration | T1,T3a | Quick integration, image/PDF processing, private preview source; delete old rendering implementation only after callers move |
| T4 live preview | T1,T2,T3 | Sandboxed srcdoc preview, playback controls and attack tests; source owned/private and CSP confined |
| T5 operations | T3 | Render worker boundary, restricted systemd service, doctor, fonts, install instructions; adapt benchmark to actual runtime |
| T6 integration/review | T0–T5 | Remove remaining runtime/container references, full type/lint/unit/browser/build checks, independent standards/spec review, draft PR |

Implementers use isolated worktrees. Merge only completed frontier tickets, then unblock dependents. Deleted feature tests may be removed; preserve/rewrite tests for surviving guarantees rather than lowering assertions. Baseline main `8130e15` differs from previously verified `2fcdbbf` only by this approved spec and benchmark fixtures.

## Gates

- Never silently disable Chromium sandbox; explicit development-only override must be visibly warned. Root-only environment results cannot stand in for production sandbox evidence.
- Render process receives no model/session credentials; production filesystem/network/resource confinement is part of the implementation.
- Keep owner checks, CAS, cache integrity, cancellation fences and AI labeling. No partial artifact is published.
- P0 requires measured frame count, duration, SSIM, size and timing; report unavailable daemon/host checks honestly, never turn spec estimates into measurements.
- Fixed dependencies; avoid Python storage migration while replacing rendering.

## Delivery status

T1–T5 code is integrated; T0 retains measured comparisons and T6 completed two-axis review plus full type/lint/build/unit/browser checks. See `docs/engineering/RUNTIME_IMPLEMENTATION.md` for verification and the passing numeric benchmark results and remaining production-host acceptance gates. Work remains a draft until the documented production acceptance gates pass.
