# Trusted handwritten fonts

`fonts.lock.json` pins unmodified Ma Shan Zheng and Patrick Hand from the official Google Fonts repository at commit `406197b91ff39a93061c2c2eeaee67ddf2ae1f0d`, including the font, OFL notice and metadata bytes. Downloading is a trusted build operation. Generated scenes and running video tasks never download fonts.

The actual supplementary media image built here is `sha256:46a3a937735e1f0472fecc8e32b78da99c7da187aa1faac7017c523b92911dfb`. The application default remains the original media image. This image adds resources; it does not establish crayon-book subtitle styling, full media compatibility or delivery QA.

## Prepare a clean context

Use absolute paths with existing parent directories. Without `--download`, the cache must already contain the six exact locked files. Both modes reject substituted bytes, missing notices and linked files/directories; the build context must be new.

```sh
npx tsx scripts/video/prepare-style-fonts.ts --download --cache-root /absolute/font-cache --build-root /absolute/font-build
```

The prepared context contains only fonts, notices, SHA checks and an allowlisted Dockerfile/context. Binaries stay outside Git and are not included in source ZIPs. The image preserves original OFL notices under `/usr/share/doc/videobuddy-fonts/<id>/OFL.txt`, and metadata alongside each notice. Font files live under `/usr/local/share/fonts/videobuddy/`; files become0444 and directories0755 for nonroot readers.

## Resolve the local base exactly

Modern BuildKit interpreted `FROM sha256:<local-image-id>` as a registry repository name and the first real build failed before any build layer. The corrected recipe uses a local reference named with the complete expected image ID. A tag alone is not an integrity check: inspect it before and after every build and require its actual image ID to equal the `baseImage` in `build-inputs.json`.

For this build the base ID is `sha256:75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919` and reference is `videobuddy-media:font-base-75ffd41e03d738cee7e10914aeaeb2605b9daf213409afec295ccb97bb06c919`. If the reference exists with a different ID, stop. If absent, tag the already inspected expected local image; do not overwrite a conflicting reference. These checks were performed before and after the recorded local build.

```sh
docker build --network none --pull=false --iidfile /absolute/font-build/image.id --tag videobuddy-media:handwriting-406197b9 /absolute/font-build
```

The result's image ID is the execution pin. `probe-style-fonts.ts` checks the resolved base reference, the result's base RootFS layer prefix and lock/base labels, then verifies actual font/license/metadata hashes through two bounded nonroot offline invocations. It checks every character in the recorded Chinese/English scripts, with no system fallback accepted as the requested face.

```sh
npx tsx scripts/video/probe-style-fonts.ts --verify-built-font-runtime
```

The current probe is deliberately tied to the recorded private local build directory and has an exclusive report admission. Do not rerun an admitted probe or unknown invocation; a new build requires a separately reviewed diagnostic/report. Production can call `readPinnedStyleFont` with its own pinned configuration and owned journal/fence.

## Sources

The fixed official [Ma Shan Zheng metadata](https://raw.githubusercontent.com/google/fonts/406197b91ff39a93061c2c2eeaee67ddf2ae1f0d/ofl/mashanzheng/METADATA.pb) and [Patrick Hand metadata](https://raw.githubusercontent.com/google/fonts/406197b91ff39a93061c2c2eeaee67ddf2ae1f0d/ofl/patrickhand/METADATA.pb) identify handwritten families. Each font's fixed OFL source URL and hash are in the lock. The native runtime report verifies the installed notice bytes; it does not replace the full runtime distribution inventory in LICENSES.md.
