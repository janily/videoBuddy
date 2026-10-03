"""Publish/verify private narration bytes under an OS lock; repair only verified temp aliases."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import uuid

MAX_BYTES = 20 * 1024 * 1024
UUID = r'[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}'
KEY = re.compile(r'projects/' + UUID + r'/revisions/' + UUID + r'/audio-files/([a-f0-9]{64})\.wav')


def sync_directory(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def verify_and_repair(path, digest, expected_bytes):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size != expected_bytes:
            raise ValueError('NARRATION_AUDIO_CHANGED')
        raw = source.read(MAX_BYTES + 1)
        if len(raw) != expected_bytes or hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError('NARRATION_AUDIO_CHANGED')
        aliases = []
        pattern = re.compile(r'\.narration-' + digest + r'-[a-f0-9]{32}\.tmp')
        for entry in path.parent.iterdir():
            if not pattern.fullmatch(entry.name):
                continue
            alias = entry.lstat()
            if stat.S_ISREG(alias.st_mode) and (alias.st_dev, alias.st_ino) == (info.st_dev, info.st_ino):
                aliases.append(entry)
        # Reject unexplained links before removing anything; never relax the one-link invariant.
        if info.st_nlink != 1 + len(aliases):
            raise ValueError('NARRATION_AUDIO_CHANGED')
        for alias in aliases:
            alias.unlink()
        os.fsync(source.fileno())
        sync_directory(path.parent)
        if os.fstat(source.fileno()).st_nlink != 1:
            raise ValueError('NARRATION_AUDIO_CHANGED')


def execute(root, mode, key, expected_bytes):
    match = KEY.fullmatch(key)
    if not root.is_absolute() or mode not in ('publish', 'verify') or not match or not 44 <= expected_bytes <= MAX_BYTES:
        raise ValueError('NARRATION_AUDIO_CHANGED')
    digest = match.group(1)
    raw = sys.stdin.buffer.read(MAX_BYTES + 1) if mode == 'publish' else None
    if raw is not None and (len(raw) != expected_bytes or hashlib.sha256(raw).hexdigest() != digest):
        raise ValueError('NARRATION_AUDIO_CHANGED')
    base = root / 'objects'
    path = base / key
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not path.parent.resolve().is_relative_to(base.resolve()):
        raise ValueError('NARRATION_AUDIO_CHANGED')
    lock_fd = os.open(str(path) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'r+b') as lock:
        lock_info = os.fstat(lock.fileno())
        if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_nlink != 1:
            raise ValueError('NARRATION_AUDIO_CHANGED')
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            path.lstat()
        except FileNotFoundError:
            if mode != 'publish':
                raise ValueError('NARRATION_AUDIO_CHANGED')
            temp = path.with_name('.narration-' + digest + '-' + uuid.uuid4().hex + '.tmp')
            try:
                fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, 'wb') as output:
                    output.write(raw)
                    output.flush()
                    os.fsync(output.fileno())
                os.link(temp, path)
            finally:
                temp.unlink(missing_ok=True)
        verify_and_repair(path, digest, expected_bytes)
    return {'ok': True}


def main():
    try:
        print(json.dumps(execute(Path(sys.argv[1]), sys.argv[2], sys.argv[3], int(sys.argv[4]))))
    except (OSError, ValueError, IndexError, TypeError):
        print(json.dumps({'error': 'NARRATION_AUDIO_CHANGED'}))
        sys.exit(1)


if __name__ == '__main__':
    main()
