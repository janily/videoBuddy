# T11 frozen real preview publication

Implemented locally, not deployed. The page now submits an idempotent preview command; HTTP reserves durable work without calling a model. The Worker connects frozen Treatment, voice/ASR, timing, music/foley, generated Visual, isolated picture rendering, composition, excerpts and sampled Critic to publication. Production refuses known blocking Critic reports. Missing media/model/voice configuration is checked before the first paid request. Fresh whole model creation has not been exercised through this new Worker.

RED: the new probe initially failed because preview/publish was absent. The existing commit rejected its own successful publication replay with PREVIEW_STALE. Independent review reproduced mismatched operation revision/preview IDs and a late Understanding CAS race. Tests then rejected a self-signed quality-policy digest (old code incorrectly resolved). These behaviors now reject; same-operation lost-acknowledgement replay preserves IDs, expiry, bytes and controlVersion.

Publication independently reads all frozen FilmSpec inputs, bridges actual Composite stages to frozen sources, rechecks the actual stereo excerpt, freezes technical evidence, derives quality policy from the actual timeline and publishes only the matching operation. Subtitle SHA is measured from the pinned Docker font file; the immutable runtime receipt is cold-readable by web without Docker.

Actual probe: Node22 node --import tsx scripts/video/probe-preview-publication.ts --publish. The prior real 11-second/264-frame/1280×720/2-channel MP4 SHA is 693795d7d8919187ca8fb2ee6bb0d6c38dcb5481ca04d1fa02ead33fc4b0226e. Access is denied before publication, allowed after; cold read and repeated publication are identical. The probe copies durable project JSON into a separate control directory and verifies the original control bytes remain unchanged. Existing immutable private media is independently verified at its original root. Network is forbidden and additional model calls are zero.

Actual pinned Noto font file SHA: b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a. No font file is exported. A receipt proves worker runtime measurement, not a claim that Noto satisfies every style. Independent standards review tested web receipt cold-read with Docker/Python unavailable.

Worker terminal outcomes survive event append failures before/after fsync, without repeating production. Cold queues recover an authorized active preview after a lost enqueue; a damaged queue record does not starve healthy jobs. A bounded pending-outcome map is drained only against immutable archived outcomes. Latest failure pointers preserve owner-visible explanations across page closure and are filtered against the current brief/consent epoch. Worker heartbeats continue during long stages.

Additional RED→GREEN evidence: terminal ACK loss could reinterpret failures; stale brief HTTP returned 503; cold failures lost explanations; preview button sent no request; playback renewal replaced the video element and reset its position. Tests/reproductions now reject these behaviors or preserve the correct recovery state. Independent reviewers also reproduced a configuration-missing request charging one Treatment call against a local HTTP fixture; the same fixture now observes zero calls.

Actual Node22 commands:

- `npm test`: 67 files, 295 tests passed.
- `npm run test:video:e2e`: 18 browser tests passed, including an actual preview command with the current brief and unchanged chat draft.
- `npm run lint`, `npm run build`, post-build `npm run typecheck`: exit 0.
- `node --import tsx scripts/video/probe-preview-publication.ts --publish`: pass; cold published-Worker recovery emits terminal events without re-running a producer; replay identical; original control unchanged; additional model calls 0.
- `node --import tsx scripts/video/probe-preview-browser.ts --browser`: pass; real anonymous session, signed private HTTP access and actual MP4 bytes decoded by Chromium on desktop/mobile. Media error events are explicitly injected to test renewal; access endpoints/media bytes are real HTTP. Paused position restores to 6 seconds, playing position to about 6.25 seconds, same video DOM and playsInline=true. Provider requests 0; web excludes provider key.

Both independent review axes found no remaining substantive findings after fixes.

Limitations: this evidence is explicitly technical_only with deliveryEligible=false. Historical Critic style/readability failures and the 青禾/清和 ASR mismatch remain failures. Diagnostic playback does not prove style quality or fresh model creation. Formal creation stays disabled in the page until approved rendering, full visual/listening QA and delivery are connected. Export, modifications, cleanup and the 43-style/86-media acceptance matrix remain unfinished. C0/C1/C2 have not been reached. No push or deployment.
