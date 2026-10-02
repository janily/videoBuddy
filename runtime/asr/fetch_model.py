"""Fetch the exact offline, MIT-licensed CTranslate2 Whisper small assets."""
from hashlib import sha256
from pathlib import Path
import os
import urllib.request

REVISION = '2ec96c5472da50d38d40c0cfe0602af2e94b4c8a'
REPOSITORY = 'Systran/faster-whisper-small'
FILES = {
    'config.json': 'b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828',
    'model.bin': '3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671',
    'tokenizer.json': 'fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab',
    'vocabulary.txt': '34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913',
}
ROOT = Path(__file__).resolve().parent / 'model'


def digest(path: Path) -> str:
    hasher = sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


for name, expected in FILES.items():
    ROOT.mkdir(parents=True, exist_ok=True)
    target = ROOT / name
    if target.is_file() and digest(target) == expected:
        print(f'verified {name}', flush=True)
        continue
    temporary = ROOT / (name + '.part')
    url = f'https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{name}'
    with urllib.request.urlopen(url, timeout=90) as response, temporary.open('wb') as destination:
        for chunk in iter(lambda: response.read(1024 * 1024), b''):
            destination.write(chunk)
        destination.flush()
        os.fsync(destination.fileno())
    if digest(temporary) != expected:
        temporary.unlink(missing_ok=True)
        raise SystemExit(f'hash mismatch: {name}')
    temporary.replace(target)
    print(f'verified {name}', flush=True)
