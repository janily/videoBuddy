# Offline voice runtime

This image generates a fresh WAV from each trusted `job.json`. The model and two voices are downloaded only at build preparation time; they are not committed to Git. The running container has no network and receives no model API key.

Run `python3 runtime/voice/fetch_model.py`, then `docker build -t videobuddy-voice:local runtime/voice`. Record `docker image inspect videobuddy-voice:local --format '{{.Id}}'` and set `VIDEO_VOICE_IMAGE_REF` to that `sha256:...` ID and `VIDEO_VOICE_RUNTIME_DIGEST` to its 64 hex digits. Run `npm run probe:video:voice -- --record` with those variables. Rebuild and reprobe when the model, package or Dockerfile changes.

`fetch_model.py` pins the ONNX repository revision and checks every file's SHA-256. The image uses `@uzen/kokoro-js@1.2.4`, one Chinese voice (`zf_001`) and one English voice (`af_maple`). See [model card](https://huggingface.co/onnx-community/Kokoro-82M-v1.1-zh-ONNX) and [upstream model card](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) for the stated Apache-2.0 model license. The npm package is also Apache-2.0; preserve package license notices when distributing the image.

This runtime produces 24 kHz mono float WAV. The separate pinned media image places verified lines on a 48 kHz narration-only track. Word timings, ASR, music/foley, loudness mastering and listening QA remain necessary before publishing video.
