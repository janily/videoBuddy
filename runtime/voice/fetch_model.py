"""Fetch the exact offline Kokoro assets used by the pinned voice runtime."""
from hashlib import sha256
from pathlib import Path
import os
import urllib.request

REVISION = '6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3'
REPOSITORY = 'onnx-community/Kokoro-82M-v1.1-zh-ONNX'
FILES = {
    'model/config.json': 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f',
    'model/tokenizer.json': '5715a60b09d5e4b9074435d68c6ccd5675b9d48b220e109fdea3cda681e23d15',
    'model/tokenizer_config.json': 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20',
    'model/onnx/model.onnx': '94b973941b1852754f979be5d5e20be666d5c81d9bb886b88ae1dc85c9b895ca',
    'voices/af_maple.bin': 'bd5b230b916ea98c67a3a7a833a3ce43e535ce56a81503f4166ee9390b9ddeeb',
    'voices/zf_001.bin': '0a89ec12bb93fb9c74077924daf02568baad64e1f869389f5aaee01a386035f8',
}
ROOT = Path(__file__).resolve().parent

def digest(path: Path) -> str:
    hasher = sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            hasher.update(chunk)
    return hasher.hexdigest()

for relative, expected in FILES.items():
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and digest(target) == expected:
        print(f'verified {relative}', flush=True)
        continue
    url = f'https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{relative.removeprefix("model/")}'
    if relative.startswith('voices/'):
        url = f'https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{relative}'
    temporary = target.with_suffix(target.suffix + '.part')
    with urllib.request.urlopen(url, timeout=90) as response, temporary.open('wb') as destination:
        for chunk in iter(lambda: response.read(1024 * 1024), b''):
            destination.write(chunk)
        destination.flush()
        os.fsync(destination.fileno())
    if digest(temporary) != expected:
        temporary.unlink(missing_ok=True)
        raise SystemExit(f'hash mismatch: {relative}')
    temporary.replace(target)
    print(f'verified {relative}', flush=True)
