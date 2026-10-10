"""Bounded private immutable export publisher; locks and no-follow traversal."""
import fcntl
import hashlib
import json
import os
import re
import stat
import sys
import uuid

def execute(root, key, digest, expected):
    if not os.path.isabs(root) or not re.fullmatch(r'projects/[a-f0-9-]{36}/artifacts/[a-f0-9-]{36}/files/(poster\.png|final\.mp4)', key) or not re.fullmatch(r'[a-f0-9]{64}', digest):
        raise ValueError()
    name = key.split('/')[-1]
    limit = 150 * 1024 * 1024 if name == 'final.mp4' else 8 * 1024 * 1024
    minimum = 1024 if name == 'final.mp4' else 33
    if not minimum <= expected <= limit:
        raise ValueError()
    raw = sys.stdin.buffer.read(limit + 1)
    if len(raw) != expected or hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError()
    folder = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in ['objects'] + key.split('/')[:-1]:
            try:
                os.mkdir(part, mode=0o700, dir_fd=folder)
                os.fsync(folder)
            except FileExistsError:
                pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=folder)
            os.close(folder)
            folder = child
        lock = os.open(name + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600, dir_fd=folder)
        try:
            if not stat.S_ISREG(os.fstat(lock).st_mode) or os.fstat(lock).st_nlink != 1:
                raise ValueError()
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                os.stat(name, dir_fd=folder, follow_symlinks=False)
            except FileNotFoundError:
                temp = '.artifact-' + digest + '-' + uuid.uuid4().hex + '.tmp'
                try:
                    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=folder)
                    with os.fdopen(fd, 'wb') as output:
                        output.write(raw)
                        output.flush()
                        os.fsync(output.fileno())
                    os.link(temp, name, src_dir_fd=folder, dst_dir_fd=folder, follow_symlinks=False)
                finally:
                    os.unlink(temp, dir_fd=folder)
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=folder)
            with os.fdopen(fd, 'rb') as source:
                info = os.fstat(source.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size != expected or hashlib.sha256(source.read(expected + 1)).hexdigest() != digest:
                    raise ValueError()
                # Repair only explained, same-inode aliases after a lost fsync acknowledgement.
                aliases = []
                for alias_name in os.listdir(folder):
                    if re.fullmatch(r'\.artifact-' + digest + r'-[a-f0-9]{32}\.tmp', alias_name):
                        alias = os.stat(alias_name, dir_fd=folder, follow_symlinks=False)
                        if stat.S_ISREG(alias.st_mode) and (alias.st_dev, alias.st_ino) == (info.st_dev, info.st_ino):
                            aliases.append(alias_name)
                if info.st_nlink != 1 + len(aliases):
                    raise ValueError()
                for name in aliases:
                    os.unlink(name, dir_fd=folder)
                os.fsync(source.fileno())
                os.fsync(folder)
                if os.fstat(source.fileno()).st_nlink != 1:
                    raise ValueError()
        finally:
            os.close(lock)
    finally:
        os.close(folder)

try:
    execute(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]))
    print(json.dumps({'ok': True}))
except (OSError, ValueError, IndexError):
    print(json.dumps({'error': 'ARTIFACT_INVALID'}))
    sys.exit(1)
