"""Offline, input-blind ASR for independently checking synthesized narration."""
import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel


def main():
    if sys.argv[1:] != ['/work/job.json']:
        raise ValueError('ASR_JOB_INVALID')
    job = json.loads(Path('/work/job.json').read_text())
    if (not isinstance(job, dict) or set(job) != {'language'} or
            job['language'] not in ('zh-CN', 'en', 'auto')):
        raise ValueError('ASR_JOB_INVALID')
    source = Path('/input/voice.wav')
    if not source.is_file() or source.is_symlink() or source.stat().st_size > 20 * 1024 * 1024:
        raise ValueError('ASR_INPUT_INVALID')
    model = WhisperModel('/opt/videobuddy/asr/model', device='cpu',
                         compute_type='int8', cpu_threads=4, local_files_only=True)
    language = {'zh-CN': 'zh', 'en': 'en', 'auto': None}[job['language']]
    segments, info = model.transcribe(str(source), language=language,
                                      beam_size=5, word_timestamps=True,
                                      condition_on_previous_text=False, vad_filter=False)
    result = []
    for segment in segments:
        words = [{'text': word.word, 'startMs': round(word.start * 1000),
                  'endMs': round(word.end * 1000), 'probability': word.probability}
                 for word in segment.words or []]
        result.append({'text': segment.text, 'startMs': round(segment.start * 1000),
                       'endMs': round(segment.end * 1000), 'words': words})
    if len(result) > 100:
        raise ValueError('ASR_OUTPUT_INVALID')
    detected = job['language'] if language else {'zh': 'zh-CN', 'en': 'en'}.get(info.language)
    if detected is None or not result:
        raise ValueError('ASR_OUTPUT_INVALID')
    print(json.dumps({'language': detected, 'model': 'Systran/faster-whisper-small',
                      'segments': result}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('ASR_FAILED', file=sys.stderr)
        sys.exit(1)
