# Local media runtime operations

The application plans videos and publishes private artifacts. A separate render process consumes bounded media jobs through `VIDEO_RENDER_SOCKET`, renders with Playwright Chromium, encodes/probes with ffmpeg/ffprobe, and returns verified media. Production uses `scripts/video/render-worker.ts` under the dedicated systemd unit. Development may run the same implementation within the worker when no socket is configured.

Follow [the deployment guide](../../deploy/README.md) for account, directory, environment, and service setup. Python remains required by the existing storage layer; replacing it with SQLite is outside this runtime migration.

## Reproducibility

Use Node 22.13–22.x and the reviewed `package-lock.json`. Install Chromium using that release's Playwright package, not a system Chromium or a browser selected from PATH. Install ffmpeg and ffprobe ≥6 from a managed source. Both version strings are reported by doctor; the rendering runtime incorporates its ffmpeg version into its digest.

Fonts come from `runtime/fonts/`, with SHA-256, byte counts, licenses, and metadata pinned by `runtime/fonts/fonts.lock.json`. Keep those resources together. `doctor` verifies all three file types. The renderer's version calculation binds the Playwright/Chromium versions, ffmpeg version, font-lock hash, rendering source, encoder policy, platform/CPU, and sandbox status. Its current capture format is PNG. Doctor uses this same calculation and reports no replacement digest if the runtime is incomplete.

```sh
node --import tsx scripts/video/doctor.ts
# Production renderer identity and allowlisted environment are documented in deploy/README.md:
node --import tsx scripts/video/doctor.ts --production --render
```

A failed check produces exit code 1. `status: pass` means the local checks succeeded; `productionReady` remains false because the doctor process cannot attest the live systemd/network/filesystem boundary. `status: development_unsafe` is explicitly not production evidence. No doctor path invokes a model or produces a paid generation.

## Chromium sandbox troubleshooting

Never run the production renderer as root. Keep `chromiumSandbox:true`; never use `--no-sandbox` to work around a production failure. The service deliberately has no `RestrictNamespaces` or namespace-blocking syscall filter. Its no-new-privileges and unprivileged user namespace path must work on the target host.

On Ubuntu 24.04, inspect the actual denial before changing policy:

```sh
sudo journalctl -u videobuddy-render.service --since '10 minutes ago'
sudo journalctl -k --since '10 minutes ago' | grep -E 'apparmor|DENIED|userns'
sysctl kernel.apparmor_restrict_unprivileged_userns
sysctl kernel.unprivileged_userns_clone
```

Missing shared libraries are resolved by the release's Playwright `install --with-deps chromium` step. A missing browser cache is resolved by checking `PLAYWRIGHT_BROWSERS_PATH` and installing the locked browser before starting services; the renderer never downloads dependencies itself.

If AppArmor denies `userns_create`, have the host administrator add a reviewed profile granting `userns,` to the exact root-owned Playwright Chromium executable path shown by the denial, using the host's AppArmor ABI. Include both the browser and headless-shell executable if the installed Playwright launch paths require them. Load the profile with `apparmor_parser`, then rerun the sandboxed doctor as `videobuddy-render` and in the actual service. Do not disable AppArmor or unprivileged namespace restrictions globally; do not allow arbitrary executables in a service-writable directory. Browser upgrades may change the executable path and require profile review.

For an isolated developer machine only, `NODE_ENV=development VIDEO_UNSAFE_NO_SANDBOX=1` explicitly requests an unsafe local diagnostic/runtime mode. Doctor prints a warning, sets the unsafe status, and cannot certify production. Production rejects this setting. A custom `VIDEO_CHROMIUM_EXECUTABLE_PATH` is likewise restricted to explicit unsafe development mode.

## Boundary and shared files

The dedicated renderer has no model/session credentials. `env -i` in its service forwards a fixed allowlist from a separate runtime-only environment file. Its persistent write access is confined to media by both systemd and Unix permissions. Root/assets/music/release are not writable by the render user; project messages, budgets, and published private objects are not readable by it. Loopback is for the browser asset server, while the filesystem Unix socket carries application RPC without granting IP connectivity.

Preserve `videobuddy-media` on the socket and shared input/output files. The parent media directory is setgid; new files must still be group-readable (0640), and directories traversable (0750). Referenced assets need the same read permissions. Do not fix a permission failure by making all project state readable or by running the renderer under the application user.

Cancellation disconnects the active RPC and aborts its media operation; stopping the service terminates its process group. systemd's `KillMode=control-group` contains leftover browser/encoder children. After a crash, restart the same unit, inspect the journal and queue recovery, and let the content-addressed runtime rebuild unfinished work. Stale `.partial` files are not valid artifacts. Never promote one manually. Remove a stale socket only with the old render service stopped; the unit's scoped pre-start cleanup assumes it is the only socket owner.

## Evidence and remaining host gates

Release evidence must distinguish unit tests, local unsandboxed diagnostic execution, and actual production sandbox/confinement results. This guide does not claim any host gate has passed. Record doctor JSON, runtime digest, live `systemctl show` limits, group/socket permissions, denied external network/write probes, cancellation cleanup, media QA, and the before/after benchmark separately. P0 speed/SSIM/size and P4 Ubuntu service acceptance require their own measurements.

Primary references: [systemd execution environment](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), [systemd resource controls](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html), and the installed Ubuntu `apparmor.d(5)`/`apparmor_parser(8)` manuals. Follow the versions installed on the production host.
