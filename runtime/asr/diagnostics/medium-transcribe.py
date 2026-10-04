"""Input-blind medium-model diagnostic; never reads an expected transcript."""
import hashlib
import json
import sys
from pathlib import Path
from faster_whisper import WhisperModel

REPOSITORY = 'Systran/faster-whisper-medium'
REVISION = '08e178d48790749d25932bbc082711ddcfdfbc4f'
FILES = {
    'config.json': '3622a2ddc41ec0e0fd4e68c13c6830f03b90c38d89aaad184de02c8c642cf807',
    'model.bin': '9b45e1009dcc4ab601eff815b61d80e60ce3fd8c74c1a14f4a282258286b51ae',
    'tokenizer.json': 'fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab',
    'vocabulary.txt': '34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913',
}


def main():
    if sys.argv[1:] != ['/work/job.json']:
        raise ValueError('ASR_JOB_INVALID')
    job = json.loads(Path('/work/job.json').read_text())
    if job != {'language': 'zh-CN'}:
        raise ValueError('ASR_JOB_INVALID')
    for name, expected in FILES.items():
        hasher = hashlib.sha256()
        with (Path('/diagnostics/model') / name).open('rb') as source:
            for part in iter(lambda: source.read(4 * 1024 * 1024), b''):
                hasher.update(part)
        if hasher.hexdigest() != expected:
            raise ValueError('ASR_MODEL_CHANGED')
    audio = Path('/input/voice.wav')
    if not audio.is_file() or audio.is_symlink() or audio.stat().st_size > 20 * 1024 * 1024:
        raise ValueError('ASR_INPUT_INVALID')
    model = WhisperModel('/diagnostics/model', device='cpu', compute_type='int8',
                         cpu_threads=4, local_files_only=True)
    segments, _ = model.transcribe(str(audio), language='zh', beam_size=5,
                                   word_timestamps=True, condition_on_previous_text=False,
                                   vad_filter=False)
    result = [{'text': segment.text, 'startMs': round(segment.start * 1000),
               'endMs': round(segment.end * 1000), 'words': [
                   {'text': word.word, 'startMs': round(word.start * 1000),
                    'endMs': round(word.end * 1000), 'probability': word.probability}
                   for word in segment.words or []]} for segment in segments]
    if not result or len(result) > 100:
        raise ValueError('ASR_OUTPUT_INVALID')
    print(json.dumps({'model': REPOSITORY, 'revision': REVISION,
                      'modelWeightsSha256': FILES['model.bin'], 'language': 'zh-CN',
                      'segments': result}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('MEDIUM_ASR_FAILED', file=sys.stderr)
        sys.exit(1)
