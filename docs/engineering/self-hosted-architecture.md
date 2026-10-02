# VideoBuddy self-hosted architecture (2026-10-02)

The user's current instruction replaces the Vercel-specific deployment and SDK clauses of v5.1. The product requirements remain: durable private projects and messages, resumable SSE, one formal approval after a real preview, independent media execution, safe changes, QA, downloads and all 43 styles. There is no database or login.

## Decision

Run a Node 22 Next.js server and a separate durable task worker on one Linux host. Both use a persistent local volume. The worker runs generated scenes in short-lived, restricted Docker containers. The host process keeps model credentials; scene containers receive none. Back up the data volume with tested restore procedures before claiming durable operation. A single host avoids pretending that an ordinary NFS share offers reliable cross-host CAS. Scaling to multiple hosts needs a separate shared store and coordination design.

Alternatives considered: (1) Vercel Functions plus another object store and remote media worker would retain most cloud coordination and fails the requested complete departure from Vercel. (2) a self-hosted database plus queue would simplify transactions but conflicts with the retained no-database requirement. A local volume and one trusted worker preserve the existing `AtomicStore` and `MediaExecutor` seams while replacing platform services.

## Boundaries and invariants

- `VIDEO_DATA_DIR` is an absolute path to a persistent volume, outside the source tree. JSON state uses create-if-absent, fresh read and ETag CAS with locks held across processes, atomic rename and fsync. Immutable messages, assets and artifacts have content hashes and owner-scoped keys. A temporary file or orphan lock never silently becomes a published object.
- The web server validates anonymous owner scope, origin, quotas, command IDs and approval fences. Its response does not wait for video rendering. A durable operation and its input are committed before the worker may run it.
- The worker scans durable operations on startup and after notifications. One host runs one worker. It claims operations and persists stage intents/results. An unknown model or media side effect is never automatically repeated. A restart resumes only safe, verifiable work, otherwise marks attention/interrupted without inventing output. The worker owns stage execution; the web server never runs generated scene code.
- Each operation has a bounded append-only event log. The SSE route replays from `epoch:index`, then waits for new records, sending heartbeats. Disconnecting a reader does not cancel work. Final messages and artifacts are independently archived so a lost event log cannot erase completed output.
- The trusted worker creates containers using a fixed image ID and fixed argv. Containers have no network, no credentials, no extra capabilities, a read-only root, resource and PID limits. Each stage has a writable mount for status/frames/output, while its `job.json` and `scene.html` files are over-mounted read-only. Independent MIME/hash/decode/QA checks are still required before publication. Docker access belongs only to the trusted worker process. The renderer must pass actual Chinese font, audio, 2D and WebGL probes before a style is declared supported.
- Artifact URLs are short-lived application-signed paths. The download route rechecks project ownership, deletion, expiry, artifact QA and path before streaming from the volume. Do not expose the data volume through static hosting.
- Secrets and volumes are configured on the host, never committed. Local development may use the same adapters in disposable directories. Production startup fails closed when the volume, worker, model budget or runtime image is absent. The generation flag remains off until real end-to-end tests pass.

## Deployment

Use a single Linux host with a persistent disk, a reverse proxy providing HTTPS, and two supervised processes (`web` and `worker`). The worker may access the Docker daemon; the web process may not. A tested backup/restore job and resource limits are required. No Vercel project, Blob token, Sandbox token, Workflow SDK, or Vercel-specific callback is part of this architecture. The media image can be built and pinned locally without a registry, but its digest and bundled licenses must be recorded.

Dependency inventory nuance: the existing Mastra package brings `workflow` and `@workflow/world-vercel` transitively through its `chat` dependency (`npm ls` verified). VideoBuddy has no import, configuration or call to those modules; the application queue is local. The deployment requires no Vercel account or credential. If a future supply-chain policy requires zero Vercel-named transitive packages, the Mastra adapter must also be replaced and retested rather than hiding those packages in the lockfile.

## Proof needed

Real cold-process CAS races, crash during write and lock recovery, server/worker restart with no duplicate model charge or render, SSE reconnect and completed archive after process replacement, anonymous cross-owner access checks, container network denial and stop, 20/120-second Chinese and English video paths, full 43-by-2 style evidence, actual QA, backup/restore and five-user workflow observation. Existing unit tests are supporting evidence only.

Docker's documented `--network none`, read-only root and resource limits support the proposed isolation controls; their presence does not prove this app's media quality. Sources: https://docs.docker.com/engine/network/drivers/none/ and https://docs.docker.com/reference/cli/docker/container/run/ . Node's file watcher may miss events, so durable indices remain authoritative: https://nodejs.org/api/fs.html#fswatchfilename-options-listener .
