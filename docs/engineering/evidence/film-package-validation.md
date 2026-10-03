# T06/T09/T10/T11 FilmSpec package validation — 2026-10-03

Implemented and tested locally; not deployed. T06/T09/T10/T11 remain partial. C0/C1/C2 are not met.

`prepareFilmPackageStage` assembles existing frozen Understanding, Treatment, TimingDraft, private narration capsules, Visual sources and AudioPlan into a full 1080p FilmSpec and seven immutable manifests. It does not invoke a model, render, approve or publish. The strict loader checks actual narration/uploaded bytes, frozen audio sections/cues, shot directions, captions, actor declarations, source HTML, runtime and revision seed. The complete graph is verified before the durable stage marker is created; replay reconstructs the expected graph and rechecks consent/input fences.

Visual model output now requires purpose, framing, camera, actor IDs and the revision seed. Picture record schema 2 binds the complete Visual source reference as well as its HTML hash; all shots use one revision seed. Existing incomplete Visual archives cannot form a FilmSpec. The base caption profiles are shared with the compositor; they do not constitute 43 style adapters.

The real Mastra Audio role has a strict plan and durable budget/effect stage. It binds STYLE rules, timing, beat/bar sections, synthesis or authorized user-track sources, sample-accurate events and fixed loudness/peak targets. Default composed music must contain synthesis events. This slice has not executed those events: package assembly rejects music, Foley or nonzero voice gain with `FILM_AUDIO_EXECUTION_NOT_READY`. Explicit no-music/no-Foley projects can currently assemble a narration package. A 14-rule delivery policy is frozen, with no fabricated QA passes; style-specific policies are still pending.

| Check | Actual result |
| --- | --- |
| Initial AudioPlan and FilmSpec producer tests | Exit 1: missing target modules |
| Policy downgrade regression | Before the fix, changing policy to `v1` incorrectly resolved; test exited 1. Unknown policies now fail `FILM_POLICY_UNSUPPORTED` before reading manifests |
| Completeness | AudioPlan/TimingDraft, Visual/TimingDraft and original asset refs are mandatory; re-signed missing provenance is rejected |
| Re-signed changes | BPM sections, camera direction, caption frames, omitted narration and stripped source proofs rejected |
| Execution/resource negatives | Unexecuted Foley/gain, incomplete Visual, changed runtime, missing font glyphs and actual uploaded-byte tampering rejected |
| Native model adapter | Local compatible HTTP fixture verifies actual Mastra structured-output protocol; no paid model or model quality claim |
| Regression | `npm test`: 53 files / 208 tests passed; lint, build and post-build typecheck exit 0 |

Lint initially rejected two variables named `module`; both were renamed and lint then exited 0. Boundary fixtures now contain complete frozen plan/source/timing proofs instead of using a weaker legacy validation branch. Silent fixtures explicitly request no voice, music or captions; production defaults were not changed.

Real local command: `npm exec tsx scripts/video/probe-voice-stage.ts -- --package --preview-720 --record`, with the pinned voice/ASR/media images recorded in [film-package-stage-probe.json](film-package-stage-probe.json). Final run exited 0: actual Chinese 4.1 s / 12-word TTS/ASR, 393,644-byte private WAV, FilmSpec SHA `375db49de9d5739eab06a274d8529f32bcae8729e8e31683dbc933c98f5a0e65`, identical replay and re-signed timeline tamper rejection. The independent package loader still succeeds after deleting both `voice/` and `audio/` work directories. Producer/Voice/Timing replay still requires its original workfiles.

The same technical project also produced a 20 s / 480-frame 1280×720 composite, 173,974 bytes, SHA `267fa1bf61f25bfaae8ad576672f2275298754f9570f6387c33bb91fb07a4a8f`, −14.18 LUFS / −1.5 dBTP and matching final AAC ASR. Its private 9 s / 216-frame excerpt is 142,794 bytes, SHA `78ca3a42b2b5df504456a44a0fb6030c6a633f2d20608e8a751210f4d6568364`; independent decode, replay and blocked public access before pointer publication passed. Probe containers were removed; the final `docker ps -a --filter name=vb-` returned no rows.

The [implement skill](/Users/janily/.codex/plugins/cache/openai-curated-remote/matt-skills-curated/1.1.0/skills/implement/SKILL.md) and [code-review skill](/Users/janily/.codex/plugins/cache/openai-curated-remote/matt-skills-curated/1.1.0/skills/code-review/SKILL.md) were applied. Review base: `9788bb33bcfca4591c489acd35ba10d270f9e2e7`. Standards axis: no substantive findings. Spec axis: identified the policy downgrade; after mandatory schemas, rejection tests and removal of legacy branches, no remaining slice findings. The spec reviewer independently reran three files / six tests successfully.

Limits: synthetic brief and injected complete Visual/Audio plans, explicitly without music or Foley. Offline voice/ASR and Docker media are real. The FilmSpec declares a 1080p target; this run does not prove 1080p rendering. Preproduction media stages still bind their own input hashes, and the approved FilmSpec→formal render worker is not wired. Real model decisions, material transport, music execution, user recording, independent semantic/style/listening QA, user preview/approval and all 43 styles / 86 baselines remain incomplete. Missing model configuration and paid-call authorization are recorded in [blockers](../blockers.md); independent development continues. No push or production deployment.
