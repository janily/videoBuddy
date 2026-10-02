"""Trusted single-host JSON CAS. Each mutation is locked by the OS, then fsynced."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import uuid


def mutate(root: Path, request: dict):
    key = request.get('key', '')
    if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9/_-]+', key):
        return {'error': 'INVALID_KEY'}
    path = root / (key + '.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_fd = os.open(str(path) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            existing = path.read_bytes()
        except FileNotFoundError:
            existing = None
        if request['op'] == 'create' and existing is not None:
            return {'error': 'STORE_CONFLICT'}
        if request['op'] == 'cas':
            if existing is None:
                return {'error': 'STORE_NOT_FOUND'}
            if hashlib.sha256(existing).hexdigest() != request.get('etag'):
                return {'error': 'STORE_CONFLICT'}
        raw = request['value'].encode('utf-8')
        json.loads(raw)
        temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as output:
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temp, path)
            dir_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        finally:
            temp.unlink(missing_ok=True)
        return {'ok': True}


def main():
    root = Path(sys.argv[1])
    if not root.is_absolute():
        raise ValueError('DATA_DIR_NOT_ABSOLUTE')
    root.mkdir(parents=True, exist_ok=True)
    try:
        request = json.load(sys.stdin)
        print(json.dumps(mutate(root, request)))
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps({'error': 'STORE_IO_FAILED'}))
        raise


if __name__ == '__main__':
    main()
