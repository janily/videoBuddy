"""Trusted fixed-image controller. Generated code executes only in credential-free Chromium."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time


def read_status(root):
    state = root / 'state.json'
    if state.exists():
        return json.loads(state.read_text())
    return {'status': 'running', 'outputs': []}


def run_stage(root, effect):
    root.mkdir(parents=True, exist_ok=True)
    with (root / 'stage.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return read_status(root)
        prior = read_status(root)
        if prior['status'] in ('succeeded', 'failed', 'cancelled'):
            return prior
        if (root / 'process.json').exists():
            return {'status': 'failed', 'outputs': [], 'errorCode': 'STAGE_UNKNOWN'}
        (root / 'process.json').write_text(json.dumps({'pid': os.getpid(), 'startTimeNs': time.time_ns()}))
        try:
            outputs = effect()
            state = {'status': 'succeeded', 'outputs': outputs}
        except Exception:
            state = {'status': 'failed', 'outputs': [], 'errorCode': 'RENDER_FAILED'}
        temp = root / 'state.tmp'
        temp.write_text(json.dumps(state))
        os.replace(temp, root / 'state.json')
        return state


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run')
    parser.add_argument('--status')
    args = parser.parse_args()
    stage = args.run or args.status
    if not stage or not re.fullmatch('[a-f0-9]{64}', stage):
        raise ValueError('INVALID_STAGE')
    root = Path('/work') / stage
    if args.status:
        print(json.dumps(read_status(root)))
        return
    def effect():
        subprocess.run(['node', '/opt/videobuddy/render.mjs', str(root / 'job.json')],
                       cwd=root, env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/tmp'}, check=True)
        output = root / 'output' / 'picture.mp4'
        if output.is_symlink() or not output.is_file() or output.stat().st_nlink != 1:
            raise ValueError('OUTPUT_INVALID')
        return ['output/picture.mp4']
    print(json.dumps(run_stage(root, effect)))

if __name__ == '__main__':
    cli()
