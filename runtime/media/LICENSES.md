# Trusted media image license inventory

The local `sha256:75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919` probe image contains the following license notices. Recheck this inventory for every rebuilt image and target CPU architecture; an image ID is specific to its build.

| Component verified in the probe image | Included notice |
|---|---|
| Node 22.23.1 | `/usr/local/LICENSE` |
| Chromium 154.0.8037.92 | `/usr/share/doc/chromium/copyright` |
| FFmpeg 5.1.9 | `/usr/share/doc/ffmpeg/copyright` |
| Noto CJK fonts | `/usr/share/doc/fonts-noto-cjk/copyright` |
| Playwright 1.63.0 | `/opt/videobuddy/node_modules/playwright/LICENSE` |
| PDF.js 6.3.289 | `/opt/videobuddy/node_modules/pdfjs-dist/LICENSE` |

The image also contains transitive Debian packages and npm dependencies with their own notices under `/usr/share/doc` and `/opt/videobuddy/node_modules`. Before distributing a runtime image, export the complete package/license inventory and review it. Presence checks pass for the six listed paths; full distribution review is still pending.
