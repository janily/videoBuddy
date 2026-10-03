# Mandarin frontend repair validation (2026-10-04)

T10 incremental work; the project remains below C0/C1/C2. Real frozen source text is unchanged. No provider calls were made by the frontend tests.

The old pinned JS frontend read compound noun 地 as neutral de5 and incorrectly neutralized 的 in 目的地. The new pinned Misaki 0.9.4 frontend plus a lexical tone adapter preserves the original dictionary tones of compound words. Grammatical particles remain neutral. Single-character ambiguities and proper-name pronunciation remain unverified; this is not a complete pronunciation guarantee.

Actual initial noun/目的地 tests failed on the original frontend. A separate read-only review reproduced GPT-4 failing after reference numeric normalization changed the expected English fragment; the new test failed with VOICE_PHONEMIZATION_FAILED. Discovery now runs the actual reference frontend before the native English adapter. Review then caught the reference reading the model connector as a minus sign; Latin-letter-to-number connectors are normalized identically in both passes, while an independent minus remains negative. The final host test run passed 9/9 in 32.696 seconds, without loading the acoustic model. The intermediate container also passed 9/9 under --network=none, but used automatically downloaded source-build tools and is not the final runtime.

Application checks: npm test passed 102 files / 533 tests; lint, production build, subsequent typecheck and git diff --check exited 0. Two-axis reviews are separately clean. These checks do not establish final film or speech quality.

Two apt builds terminated with exit 100: Debian port-80 connectivity failed, then the host proxy became unreachable from Docker after partial downloads. The runtime now uses the same digest-pinned Python bookworm base as independent ASR, with Node/npm and locked npm dependencies copied from the original Node stage. Nine runtime dependencies plus three source-build tools have exact release hashes; --no-build-isolation prevents unpinned build-tool downloads and pip check validates installed dependencies.

Final build and acoustic evidence are in [machine-readable validation](voice-front-end-validation.json). The independent diagnostic scripts/video/probe-voice-front-end.ts preserves the four frozen seed narration lines and checks two separately marked historic date/English regressions through actual offline synthesis and input-blind ASR, using an isolated root. The final build exited 0, pip check found no broken requirements, and all nine offline frontend tests passed in 31.544 seconds. Fixed image SHA is b145374e774d91aa729569a65e06fe0038009398a55ae8d31e025b227642c8d6. Actual diagnostic exited 1: all six WAVs were synthesized, but only four ASR checks passed. See [actual voice and ASR evidence](voice-front-end-probe.json). A phoneme or unit test pass must not be counted as listening, final AAC/postmix or full-film QA.

No push or production deployment.

The frozen second line now transcribes as 适量浇水,润湿大地。 (pass), instead of the original 润湿大的 failure. Frozen lines 1 and 4 also pass. Frozen line 3 transcribes 種子醒來了 探出綠牙 instead of 绿芽 and remains ASR_MISMATCH. The independent Chinese date regression passes; English produces October 8th instead of October eighth and remains ASR_MISMATCH under the current comparison rule. Neither expected transcript was changed, and no failure was bypassed. Original project control/budget hashes stayed unchanged and networkCalls=0; no owned container remained after the terminal result.

Next: diagnose the Chinese homophone recognition and English ordinal notation separately, preserving the frozen source and failure evidence. Do not automatically promote the new runtime, publish the preview, or count all four narration lines as verified.
