# Canvas × video assistant implementation plan

> Execute the approved product specification using isolated file ownership, test-first changes, and whole-branch verification.

**Goal:** Make the canvas a persistent, live video dossier with conversation as the source of user intent.
**Architecture:** Keep ProjectView authoritative; archive presentation metadata with messages. Draft scripts in an independent durable worker lane and reuse the identical treatment cache for paid generation. Store shot media as private artifacts. Derive UI stages rather than adding backend phase values.
**Tech stack:** Existing Next.js 16 / React / TypeScript / Zod / file-backed atomic store / local worker / Docker media runtime.
**Spec:** `docs/product/canvas-assistant-ux.md`.

## Constraints
- No dialog, overlays, window.confirm or alert; browser file picker remains native.
- Generation must be explicitly initiated; automatic drafts execute treatment only.
- Preserve `VIDEO_FLOW=staged`, ownership checks, idempotency, cancellation and version fencing.
- Default changes must be visible in conversation; no duplicate input form for script edits.
- Honor reduced motion and manual scroll; mobile 390px has no document overflow.
- Never represent placeholder media or fabricated progress as generated content.

## Tasks and verification
1. Assistant UI metadata and message provenance: tolerant optional field validation, archival, prompts and canvas origin. Tests: invalid metadata does not break valid guidance; stored metadata survives view reload; origin survives retry.
2. Script-first backend and private shot artifacts: separate script queue, 3s debounce, shared treatment key, stale detection, retry and real progress. Tests: no second treatment call, stale jobs cannot publish, artifacts remain owner-only, cancellation preserves cached work.
3. Persistent canvas and chat integration: card state derivation, inline style/spec options, script and result cards, links and quick replies, recent menu/page. Tests: gold journey, legacy staged flow, mobile navigation, no dialog.
4. Client data transport: immediate canvas submission without consuming draft/attachments, script event subscription/recovery, progress metadata, cancellation and direct preference calls. Tests: preserve pending draft, retries maintain command identity, script/shot events refresh authoritative view.
5. M3 support: authenticated bounded analytics and dashboard, real stage timing medians, sample generation CLI, centralized error copy, direct duration/aspect update. Tests: privacy/owner isolation, valid statistics, invalid edits and concurrent brief fencing. Actual sample generation requires configured models and Docker; do not run a paid batch as a test.
6. Integration: typecheck, lint, full unit suite, Playwright, production build, independent code review; repair material findings and create reviewable branch/PR.

## Review focus
- Out-of-order script completion after a newer brief or a restored result.
- Duplicate canvas clicks, uncertain HTTP outcomes, and typing while requests are pending.
- Modifying the next version during production without losing current media or allowing stale publication.
- Private poster/clip access, user content in telemetry, and cross-owner metrics.
- Legacy stored objects without optional UI/script fields and staged fixtures.

## Execution notes
- Using Node 22.23.3 (repository engines >=22.13.0 <23); dependencies installed from the existing lockfile.
- Paid model/Docker end-to-end performance thresholds and 43 production samples require the deployed runtime and are reported separately from fixture validation.
- All six implementation tasks completed. Verification: lint, typecheck and production build passed; 62 browser tests passed; full unit run 849/851 passed with two 15-second environment timeouts, and both affected files passed serially (7/7) without weakening assertions. Runtime acceptance remains as documented in `docs/product/canvas-assistant-implementation.md`.
