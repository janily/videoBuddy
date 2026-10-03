# T10/T11 narration archive validation — 2026-10-03

Implemented locally; not deployed. T10/T11 remain partial, and C0/C1/C2 are not met.

The archive copies actual verified 24 kHz float PCM WAV bytes into private revision-scoped, content-addressed objects. Immutable source records bind the text, voice configuration, WAV probe, ASR provenance and raw word timings to 48 kHz FilmTimeline sample ranges. `prepareNarrationPackageStage` reads existing frozen Voice/Timing stages, checks consent/version fences and persists the archive. Composite record schema version 2 and its content key bind the archive hash; older composite records fail closed rather than silently adopting new inputs.

`loadVerifiedFilmPackage` now checks the expected frozen narration plan, manifest sources, actual WAV bytes and word-timing references. JSON re-signing cannot substitute another spoken date or omit the required voice. Boundary fixtures explicitly use `voiceMode=none` where they have no voice evidence; this does not change production defaults.

| Check | Actual result |
| --- | --- |
| Archive and stage tests before implementation | Exit 1: missing modules |
| Re-signed FilmTimeline with changed date | Old implementation incorrectly resolved; test exited 1. Updated verifier rejects `FILM_NARRATION_CHANGED` |
| Word text changed while recognized transcript stays fixed | Old archive incorrectly resolved; test exited 1. Updated verifier rejects `ASR_MISMATCH` |
| Crash after the actual hardlink syscall | Real Python process exits 73, leaving two links; a fresh verification process validates SHA/bytes, removes only the explained same-inode temporary link and restores one-link storage |
| Negative paths | Changed WAV bytes, redirected refs, symlinks, unexplained hardlinks, changed ASR JSON, missing voice sources and stale consent rejected |
| Independent archive read | Actual offline TTS/ASR probe reads the immutable object after deleting the original `voice/` directory; later deliberate object tampering rejected |
| Final regression | `npm test`: 51 files, 205 tests passed; lint, build, post-build typecheck and both Git diff checks exit 0 |

The combined Voice→Timing→Visual→Picture→Composite→Excerpt filesystem integration test exceeded its previous 5 s budget while build and Docker probes ran concurrently (204 passed, one timeout). Its own timeout is now 15 s; assertions and the global timeout were not relaxed. Final full suite passed.

Real probe commands: `npm exec tsx scripts/video/probe-voice-stage.ts -- --narration-package --record` and `--preview-720 --record`, with the pinned voice/ASR/media images recorded in [narration-package-probe.json](narration-package-probe.json) and [narration-package-preview-probe.json](narration-package-preview-probe.json). Both exit 0. The final 720p full composite is 20 s / 480 frames, 173,167 bytes, SHA `e1e05a655724f46279bc6a8e54309df69126b554cfb0315ad3393aa2942ac870`, -14.18 LUFS / -1.5 dBTP and matching final AAC ASR. The private excerpt is 9 s / 216 frames, 142,284 bytes, SHA `e95679e3614e014136f051df70c247f572e622c7b99a3adf127016bb64de3018`, independently decoded and inaccessible before pointer publication. Probe containers were removed; `docker ps -a --filter name=vb-` returned no rows.

The implement/code-review skills' standards and spec reviews both identified the interrupted-publication defect. After OS-flock publication/recovery was added, both reviews reported no remaining slice-specific findings. Recovery accepts only hashed bytes and matching named temporary aliases; unexplained hardlinks remain errors.

Limits: unit WAVs and ASR are injected fixtures; separate technical probes use real offline TTS/ASR and synthetic brief/HTML. No paid model, composed music, user recording, full FilmSpec producer, semantic/style/listening QA, preview publication, approval or 43-style baseline was validated. Independent archived-object reading is supported; Voice/Timing stage replay still requires their original working files. The archive is not exposed through artifact download routes. No push or production deployment.
