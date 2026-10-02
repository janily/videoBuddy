"""Trusted cross-process append and replay of operation events."""
import fcntl
import json
import os
from pathlib import Path
import re
import sys


def execute(root: Path, request: dict):
    project, operation = request['projectId'], request['operationId']
    if not all(isinstance(value, str) and re.fullmatch(r'[a-f0-9-]{36}', value) for value in (project, operation)):
        return {'error': 'INVALID_KEY'}
    path = root / 'streams' / project / (operation + '.jsonl')
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_fd = os.open(str(path) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX if request['op'] == 'append' else fcntl.LOCK_SH)
        if request['op'] == 'append':
            raw = request['event'].encode('utf-8')
            if len(raw) > 16384 or b'\n' in raw or b'\r' in raw:
                return {'error': 'STREAM_RECORD_TOO_LARGE'}
            json.loads(raw)
            try:
                existing = path.read_bytes()
            except FileNotFoundError:
                existing = b''
            index = existing.count(b'\n')
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
            try:
                data = raw + b'\n'
                while data:
                    written = os.write(fd, data)
                    data = data[written:]
                os.fsync(fd)
            finally:
                os.close(fd)
            dir_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
            return {'ok': True, 'index': index}
        start = request['startIndex']
        if not isinstance(start, int) or start < 0:
            return {'error': 'CURSOR_INVALID'}
        try:
            lines = path.read_text(encoding='utf-8').splitlines()
        except FileNotFoundError:
            lines = []
        return {'ok': True, 'tailIndex': len(lines) - 1,
                'events': [{'index': index, 'event': json.loads(line)}
                           for index, line in enumerate(lines) if index >= start]}


if __name__ == '__main__':
    try:
        print(json.dumps(execute(Path(sys.argv[1]), json.load(sys.stdin)), ensure_ascii=False))
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps({'error': 'STORE_IO_FAILED'}))
        raise
