"""Download the pinned public medium diagnostic model; no API credential."""
import hashlib
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPOSITORY = 'Systran/faster-whisper-medium'
REVISION = '08e178d48790749d25932bbc082711ddcfdfbc4f'
FILES = {
    'config.json': ('3622a2ddc41ec0e0fd4e68c13c6830f03b90c38d89aaad184de02c8c642cf807', 2257),
    'model.bin': ('9b45e1009dcc4ab601eff815b61d80e60ce3fd8c74c1a14f4a282258286b51ae', 1527906378),
    'tokenizer.json': ('fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab', 2203239),
    'vocabulary.txt': ('34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913', 459861),
}


def digest(path):
    hasher = hashlib.sha256()
    with path.open('rb') as source:
        for part in iter(lambda: source.read(4 * 1024 * 1024), b''):
            hasher.update(part)
    return hasher.hexdigest()


def check_regular(path):
    if path.is_symlink() or (path.exists() and
                            (not path.is_file() or path.stat().st_nlink != 1)):
        raise ValueError('MODEL_FILE_BOUNDARY_INVALID')


def main():
    os.umask(0o077)
    root = Path.cwd() / '.video-local/asr-medium'
    models = root / 'model'
    models.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.is_symlink() or models.is_symlink():
        raise ValueError('MODEL_DIRECTORY_BOUNDARY_INVALID')
    report = {'repository': REPOSITORY, 'revision': REVISION,
              'modelCard': 'https://huggingface.co/' + REPOSITORY, 'files': {},
              'startedAt': datetime.now(timezone.utc).isoformat(), 'status': 'downloading'}
    def record():
        destination = root / 'manifest.json'
        check_regular(destination)
        with tempfile.NamedTemporaryFile(mode='w', dir=root, prefix='manifest-',
                                         suffix='.tmp', delete=False) as temporary:
            temporary.write(json.dumps(report, indent=2) + '\n')
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary.name, destination)
    try:
        for name, (expected, size) in FILES.items():
            target = models / name
            check_regular(target)
            if not target.exists():
                url = f'https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{name}?download=true'
                print(json.dumps({'file': name, 'status': 'downloading'}), flush=True)
                with urllib.request.urlopen(url, timeout=120) as response, tempfile.NamedTemporaryFile(
                        dir=models, prefix=name + '-', suffix='.part', delete=False) as destination:
                    temporary = Path(destination.name)
                    count = 0
                    for part in iter(lambda: response.read(4 * 1024 * 1024), b''):
                        count += len(part)
                        if count > size:
                            raise ValueError('MODEL_DOWNLOAD_SIZE_INVALID')
                        destination.write(part)
                    destination.flush()
                    os.fsync(destination.fileno())
                if count != size or digest(temporary) != expected:
                    raise ValueError('MODEL_DOWNLOAD_HASH_MISMATCH')
                temporary.replace(target)
            if target.is_symlink() or target.stat().st_size != size or digest(target) != expected:
                raise ValueError('EXISTING_MODEL_CHANGED')
            report['files'][name] = {'sha256': expected, 'bytes': size}
            record()
            print(json.dumps({'file': name, 'status': 'verified', 'bytes': size}), flush=True)
        report['status'] = 'verified'
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        record()
    except Exception as error:
        report['status'] = 'failed'
        report['errorType'] = type(error).__name__
        if isinstance(error, urllib.error.HTTPError):
            report['httpStatus'] = error.code
        record()
        print(json.dumps({'status': 'failed', 'errorType': type(error).__name__}), flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
