"""Hold a process-wide flock until the parent closes its stdin pipe."""
import fcntl
import os
from pathlib import Path
import sys
root = Path(sys.argv[1])
name = sys.argv[2] if len(sys.argv) > 2 else 'worker'
if name not in ('worker', 'source-worker'):
    raise SystemExit('WORKER_LOCK_INVALID')
root.mkdir(parents=True, exist_ok=True)
fd = os.open(root / (name + '.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
with os.fdopen(fd, 'r+') as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('WORKER_BUSY', flush=True)
        sys.exit(3)
    print('LOCKED', flush=True)
    sys.stdin.buffer.read()
