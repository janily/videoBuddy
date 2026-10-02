# Trusted media image license inventory

The local `sha256:f416c1f30abf8552e0f8fbe8f5490fe48e8694d84dec13a3b1c560523f2fb8c4` probe image contains the following license notices. Recheck this inventory for every rebuilt image and target CPU architecture; an image ID is specific to its build.

| Component verified in the probe image | Included notice |
|---|---|
| Node 22.23.1 | `/usr/local/LICENSE` |
| Chromium 154.0.8037.92 | `/usr/share/doc/chromium/copyright` |
| FFmpeg 5.1.9 | `/usr/share/doc/ffmpeg/copyright` |
| Noto CJK fonts | `/usr/share/doc/fonts-noto-cjk/copyright` |
| Playwright 1.63.0 | `/opt/videobuddy/node_modules/playwright/LICENSE` |

The image also contains transitive Debian packages and Playwright dependencies with their own notices under `/usr/share/doc` and `/opt/videobuddy/node_modules`. Before distributing a runtime image, export the complete package/license inventory and review it. Presence checks pass for the five listed paths; full distribution review is still pending.
