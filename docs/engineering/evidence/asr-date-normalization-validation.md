# English calendar ordinal comparison validation (2026-10-04)

T10 incremental fix, based on the actual archived English WAV independently transcribed as October 8th while frozen expected text says October eighth. The input audio and expected script remain unchanged. The new comparison canonicalizes only English month names followed by day ordinals in 1–31, including valid numeric suffixes. It rejects changed dates/months or malformed suffixes; ordinal words outside calendar notation and Chinese homophones remain strict.

New tests initially failed with ASR_MISMATCH. Final targeted tests passed 16/16; complete suite passed 102 files / 536 tests. Lint, production build, post-build typecheck and diff checks passed. Separate Spec/Standards reviewers independently traversed all 31 calendar day forms and checked wrong-day and invalid suffix rejection; both axes clean.

Actual read-only command: npx tsx scripts/video/probe-asr-date-recheck.ts --asr-date-recheck. It uses mustExist=true, rechecks the SHA of every existing WAV, loads the original input-blind transcripts and compares the same frozen expectations. Missing bytes reject without starting a producer. Source report/control/budget are unchanged; 0 network/provider/media executions. Result: five pass, one ASR_MISMATCH, exit1/blocked, see [recheck evidence](asr-date-recheck-probe.json). The original four-pass/two-fail [voice report](voice-front-end-probe.json) remains archived unchanged.

Original Chinese seed narration remains 3/4: 種子醒來了 探出綠牙 differs from frozen 绿芽 and is rejected. Proper-name 青禾/清和 also remains rejected by regression tests. This change neither publishes a preview nor proves intelligibility, listening QA, all four lines or full-film acceptance. Next diagnose whether full unchanged audio context improves the independent ASR transcription; do not waive the mismatch or change the source to its recognition.

C0/C1/C2 incomplete. No push or production deployment.
