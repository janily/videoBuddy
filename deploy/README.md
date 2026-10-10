# Single-host Linux deployment

This release uses Node 22, the lockfile's Playwright Chromium, system ffmpeg/ffprobe ≥6, and bundled pinned fonts. Python 3 remains required for the existing transactional storage helpers. No container engine or privileged container group is required.

These files are deployment templates, not evidence of a production deployment. Production acceptance requires running the checks below on the actual Ubuntu 24.04 host. Keep generation disabled until those checks and the product/runtime acceptance tests pass.

## Processes and permissions

| Process | Unix identity | Secrets | Persistent access |
|---|---|---|---|
| Web, Director worker, PDF source worker | `videobuddy:videobuddy`, supplementary `videobuddy-media` | `/etc/videobuddy/video.env` loaded by systemd | Application state and media |
| Render worker | `videobuddy-render:videobuddy-media` | None; a separate path-only `render.env` is filtered by `env -i` | Read assets/music/release; write only `media/` |

The application calls `/var/lib/videobuddy/media/render.sock` using the local RPC transport. The render worker creates a mode-0660 filesystem socket. Its private network namespace has only loopback for Chromium's local asset server; it cannot reach the host network. Filesystem Unix sockets remain usable across this boundary.

The render unit applies `MemoryMax=6G`, `MemorySwapMax=0`, `CPUQuota=200%`, `TasksMax=256`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, and `NoNewPrivileges=yes`. Its only persistent writable path is `/var/lib/videobuddy/media`. Do not add `RestrictNamespaces`, namespace-blocking syscall filters, or a production no-sandbox flag: Chromium requires user namespaces. Limit changes require another real-host sandbox and render test.

## Provision a reviewed release

Install a supported Node 22 release using your host's managed package process, and verify `/usr/bin/node --version` is ≥22.13 and <23. Install `python3`, `ffmpeg`, and required Chromium libraries. Preserve the repository's package lock and bundled font/license files.

```sh
sudo apt-get update
sudo apt-get install -y python3 ffmpeg
# In the reviewed release directory, as the deployment user:
npm ci
npm run typecheck
npm run lint
npm test
npm run build
# Install the lockfile's Chromium and system dependencies at deploy time:
sudo env PLAYWRIGHT_BROWSERS_PATH=/opt/videobuddy/browsers /usr/bin/node node_modules/playwright/cli.js install --with-deps chromium
```

Publish the release under `/opt/videobuddy/releases/<revision>` and point `/opt/videobuddy/current` at it. The release, node_modules, and browser installation must be root-owned and not writable by either service user. Do not leave real `.env` files or credentials in the release. The bundled `runtime/fonts/fonts.lock.json` and font/license/metadata checksums must match; no downloads happen while rendering.

For a fresh host, create dedicated accounts and directories:

```sh
sudo groupadd --system videobuddy
sudo groupadd --system videobuddy-media
sudo useradd --system --gid videobuddy --home-dir /nonexistent --shell /usr/sbin/nologin videobuddy
sudo usermod -a -G videobuddy-media videobuddy
sudo useradd --system --gid videobuddy-media --home-dir /nonexistent --shell /usr/sbin/nologin videobuddy-render
sudo install -d -o videobuddy -g videobuddy -m 0711 /var/lib/videobuddy
sudo install -d -o videobuddy -g videobuddy -m 0700 /var/lib/videobuddy/projects
sudo install -d -o videobuddy -g videobuddy-media -m 2750 /var/lib/videobuddy/assets
sudo install -d -o videobuddy -g videobuddy-media -m 2770 /var/lib/videobuddy/media
sudo install -d -o root -g videobuddy-media -m 0750 /var/lib/videobuddy/music
sudo install -d -o root -g root -m 0700 /etc/videobuddy
```

All private state, including projects, operation records, budgets, messages, and published private objects, remains application-owned and mode 0700/0600. Only referenced assets use group-readable directories/files (0750/0640), with group `videobuddy-media`. Media directories/files must also retain this group and permit the application to read renderer output. Setgid parent directories provide group inheritance; a default ACL does not override an explicit mode-0600 file. Verify the actual writer behavior with an uploaded image before enabling generation. Never grant the render user the application group or recursively make the entire state tree group-readable.

The bundled large CJK font is stored in two binary parts. `npm ci` runs `scripts/runtime/prepare-fonts.mjs` to reconstruct and verify the exact pinned upstream TTF before the release becomes read-only. If lifecycle scripts are disabled, run `npm run fonts:prepare` explicitly. No font is downloaded at runtime.

## Configuration and services

Create `/etc/videobuddy/video.env` with application settings, model/session credentials, `VIDEO_DATA_DIR=/var/lib/videobuddy`, `VIDEO_RENDER_SOCKET=/var/lib/videobuddy/media/render.sock`, the public HTTPS `VIDEO_APP_ORIGIN`, and `VIDEO_GENERATION_ENABLED=false`. Make it root-owned mode 0600. systemd reads it before changing user. Serve HTTPS through a reverse proxy to the web unit's `127.0.0.1:3000`, preserving the expected Host and Origin.

Create a separate root-owned mode-0600 `/etc/videobuddy/render.env` containing exactly these runtime paths:

```dotenv
VIDEO_DATA_DIR=/var/lib/videobuddy
VIDEO_RENDER_SOCKET=/var/lib/videobuddy/media/render.sock
VIDEO_FFMPEG_PATH=/usr/bin/ffmpeg
VIDEO_FFPROBE_PATH=/usr/bin/ffprobe
VIDEO_MUSIC_DIR=/var/lib/videobuddy/music
PLAYWRIGHT_BROWSERS_PATH=/opt/videobuddy/browsers
```

Do not source `video.env` from the render service or place any model/session key in `render.env`. The unit's `env -i` command passes only the named runtime values. When customizing the data root, update the environment, socket cleanup command, and systemd path restrictions together. The render worker's socket cleanup is safe only while systemd is the exclusive lifecycle owner; do not start a second manual render worker on the same socket.

Install and inspect the four units before starting them:

```sh
sudo install -m 0644 deploy/systemd/videobuddy-*.service /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/videobuddy-*.service
sudo systemctl daemon-reload
sudo systemctl enable --now videobuddy-render.service
sudo systemctl enable --now videobuddy-worker.service videobuddy-source-worker.service videobuddy-web.service
```

The source worker performs bounded text-layer PDF extraction locally; it does not need the renderer's network privileges or a container engine. The main worker needs external model connectivity and obtains media through the Unix socket. The render service can restart independently; stale socket removal is scoped to its fixed media socket path, and partial render output must never be published.

## Acceptance on the actual host

Run the doctor with the exact render identity and allowlisted settings, after switching into `/opt/videobuddy/current`:

```sh
sudo -u videobuddy-render env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 NODE_ENV=production VIDEO_DATA_DIR=/var/lib/videobuddy VIDEO_RENDER_SOCKET=/var/lib/videobuddy/media/render.sock VIDEO_FFMPEG_PATH=/usr/bin/ffmpeg VIDEO_FFPROBE_PATH=/usr/bin/ffprobe VIDEO_MUSIC_DIR=/var/lib/videobuddy/music PLAYWRIGHT_BROWSERS_PATH=/opt/videobuddy/browsers /usr/bin/node --import tsx scripts/video/doctor.ts --production --render
sudo systemctl show videobuddy-render.service -p User -p Group -p MainPID -p MemoryMax -p MemorySwapMax -p CPUQuotaPerSecUSec -p TasksMax -p ProtectSystem -p ProtectHome -p PrivateNetwork -p IPAddressDeny -p IPAddressAllow -p ReadWritePaths -p NoNewPrivileges
id videobuddy
id videobuddy-render
sudo systemd-analyze security videobuddy-render.service
```

Doctor checks dependency versions, sandboxed browser launch and a local screenshot, pinned fonts, storage access, and the actual runtime digest. A root invocation or explicit development unsafe run cannot pass the production sandbox gate. Its JSON always marks host isolation as unverified: running it outside a service is not proof of the live unit's cgroup, network, or mount restrictions. A systemd security score alone is also insufficient.

On the running unit, verify the process UID, effective limits, socket mode/group, no membership in privileged groups such as `docker`, and the absence of model/session variables (inspect variable names only; never log values). Confirm outbound IP traffic is blocked, Chromium loopback works, writes outside media fail, private projects are unreadable, and a real referenced image is readable. Run one authorized end-to-end render, private range download, image preparation, PDF extraction, cancellation, renderer restart, and SSE reconnect. Confirm frame count, H.264/AAC/color/metadata, visible AI label, and no partial publication. Record outputs and runtime digest in the release evidence. The unit templates and this repository's root/container tests do not establish these host gates.

See [local runtime operations](../docs/engineering/local-runtime.md) for sandbox troubleshooting and recovery.

## Backup and rollback

For a consistent snapshot, stop web, Director, source, and render services; copy `/var/lib/videobuddy` to protected storage preserving owners, groups, modes, and timestamps; then restart renderer before application workers. Exclude the transient socket from backups. A copy made while state is changing is not a verified cross-file snapshot. Test restore on an isolated host, including ownership, private access, queue recovery, and result restore.

Keep the previous reviewed release and its browser/fonts available for rollback. Stop workers before switching the release symlink, then run doctor again. Runtime upgrades change the digest and invalidate incompatible media caches. Reverting to a version with a different storage contract requires its migration procedure; do not assume code rollback alone restores state compatibility.
