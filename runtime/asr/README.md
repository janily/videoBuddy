# Offline speech recognition runtime

Run `python3 runtime/asr/fetch_model.py`, then build `docker build -t videobuddy-asr:local runtime/asr`. The fetcher pins a specific [faster-whisper-small model revision](https://huggingface.co/Systran/faster-whisper-small/tree/2ec96c5472da50d38d40c0cfe0602af2e94b4c8a) and verifies four SHA-256 hashes. Model weights stay outside Git. The model card states MIT; the [faster-whisper project](https://github.com/SYSTRAN/faster-whisper) is also MIT. `requirements.lock` pins the Python runtime dependencies.

Record `docker image inspect videobuddy-asr:local --format '{{.Id}}'` in `VIDEO_ASR_IMAGE_REF`, with the 64 hex characters in `VIDEO_ASR_RUNTIME_DIGEST`. The container is called with no network and receives only the WAV and language, never the expected words. `npm run probe:video:asr -- --record` exercises fresh Chinese and English speech, text matching, word timestamps and same-stage replay. The probe also needs the pinned offline voice image.

The model can misrecognize a clean sentence. A mismatch blocks the line; the application must retain the original expected words and arrange a new synthesis or trusted review. Word timings are model estimates. Final mixed-audio ASR, listening QA and subtitle alignment remain separate release gates.
