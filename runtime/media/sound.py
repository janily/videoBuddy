"""Trusted deterministic data-only synthesis, stereo float32/48 kHz.
No generated code, subprocess, model credentials or network access.
"""
import argparse
import array
import fcntl
import hashlib
import json
import math
import os
import pathlib
import struct
import sys
import tempfile

def digest_file(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_nlink != 1:
        raise ValueError("AUDIO_OUTPUT_INVALID")
    h = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def number(value, low, high, integral=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high or integral and int(value) != value:
        raise ValueError("AUDIO_JOB_INVALID")
    return value

def validate(job):
    if set(job) != {"schemaVersion", "planSha256", "sampleRate", "channels", "samples", "events"} or job["schemaVersion"] != 1 or job["sampleRate"] != 48000 or job["channels"] != 2:
        raise ValueError("AUDIO_JOB_INVALID")
    if not isinstance(job["planSha256"], str) or len(job["planSha256"]) != 64 or any(c not in "0123456789abcdef" for c in job["planSha256"]):
        raise ValueError("AUDIO_JOB_INVALID")
    samples = number(job["samples"], 960000, 5760000, True)
    events = job["events"]
    if not isinstance(events, list) or len(events) > 1600:
        raise ValueError("AUDIO_JOB_INVALID")
    seen = set()
    for event in events:
        if set(event) != {"eventId", "bus", "startSample", "durationSamples", "gainDb", "pan", "frequencyHz", "instrument", "attackSamples", "releaseSamples", "seed"}:
            raise ValueError("AUDIO_JOB_INVALID")
        if not isinstance(event["eventId"], str) or not 1 <= len(event["eventId"]) <= 120 or event["eventId"] in seen or event["bus"] not in ("music", "foley") or event["instrument"] not in ("sine", "triangle", "pluck", "noise"):
            raise ValueError("AUDIO_JOB_INVALID")
        seen.add(event["eventId"])
        start = number(event["startSample"], 0, samples - 1, True)
        duration = number(event["durationSamples"], 1, samples, True)
        attack = number(event["attackSamples"], 0, 96000, True)
        release = number(event["releaseSamples"], 0, 240000, True)
        if start + duration > samples or attack + release > duration:
            raise ValueError("AUDIO_JOB_INVALID")
        number(event["gainDb"], -60, 12)
        number(event["pan"], -1, 1)
        number(event["frequencyHz"], 1, 20000)
        number(event["seed"], 0, 4294967295, True)
    if sum(event["durationSamples"] for event in events) > samples * 32:
        raise ValueError("AUDIO_SYNTHESIS_CAPACITY")
    return int(samples)

def write_atomic(path, data):
    fd, temporary = tempfile.mkstemp(prefix=".sound-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def synthesize(job, bus, samples):
    pcm = array.array("f", [0.0]) * (samples * 2)
    for event in job["events"]:
        if event["bus"] != bus:
            continue
        start, duration = int(event["startSample"]), int(event["durationSamples"])
        attack, release = int(event["attackSamples"]), int(event["releaseSamples"])
        gain = 10 ** (event["gainDb"] / 20)
        angle = (event["pan"] + 1) * math.pi / 4
        left, right = gain * math.cos(angle), gain * math.sin(angle)
        phase_step = event["frequencyHz"] / 48000
        noise_state = int(event["seed"]) or 1
        filtered_noise = 0.0
        alpha = 1 - math.exp(-2 * math.pi * event["frequencyHz"] / 48000)
        for i in range(duration):
            phase = (i * phase_step) % 1
            instrument = event["instrument"]
            if instrument == "sine":
                value = math.sin(2 * math.pi * phase)
            elif instrument == "triangle":
                value = 4 * abs(phase - 0.5) - 1
            elif instrument == "pluck":
                value = (math.sin(2 * math.pi * phase) + 0.25 * math.sin(4 * math.pi * phase) + 0.1 * math.sin(6 * math.pi * phase)) / 1.35
                value *= math.exp(-5 * i / duration)
            else:
                noise_state ^= (noise_state << 13) & 0xffffffff
                noise_state ^= noise_state >> 17
                noise_state ^= (noise_state << 5) & 0xffffffff
                filtered_noise += alpha * ((noise_state / 2147483647.5 - 1) - filtered_noise)
                value = filtered_noise
            envelope = min(1, i / attack) if attack else 1
            if release:
                envelope *= min(1, (duration - 1 - i) / release)
            value *= envelope
            position = (start + i) * 2
            pcm[position] += value * left
            pcm[position + 1] += value * right
    if any(not math.isfinite(value) or abs(value) > 16 for value in pcm):
        raise ValueError("AUDIO_HEADROOM_EXCEEDED")
    if sys.byteorder != "little":
        pcm.byteswap()
    data = pcm.tobytes()
    header = struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", len(data) + 36, b"WAVE", b"fmt ", 16, 3, 2, 48000, 384000, 8, 32, b"data", len(data))
    return header + data

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    raw = pathlib.Path(args.job).read_bytes()
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError("AUDIO_JOB_INVALID")
    job = json.loads(raw)
    samples = validate(job)
    output = pathlib.Path(args.output)
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    if output.is_symlink():
        raise ValueError("AUDIO_OUTPUT_INVALID")
    job_hash = hashlib.sha256(raw).hexdigest()
    lock_fd = os.open(output / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        state_path = output / "state.json"
        if state_path.exists() or state_path.is_symlink():
            digest_file(state_path)
            state = json.loads(state_path.read_bytes())
            if state.get("jobSha256") != job_hash or set(state.get("outputs", {})) != {"music", "foley"}:
                raise ValueError("AUDIO_STAGE_CHANGED")
            for bus in ("music", "foley"):
                if digest_file(output / (bus + ".wav")) != state["outputs"][bus]:
                    raise ValueError("AUDIO_OUTPUT_CHANGED")
            return
        # A crash before the marker is a local deterministic calculation.
        # Recompute, compare any existing completed stem; never overwrite its changed bytes.
        hashes = {}
        for bus in ("music", "foley"):
            data = synthesize(job, bus, samples)
            path = output / (bus + ".wav")
            expected = hashlib.sha256(data).hexdigest()
            if path.exists() or path.is_symlink():
                if digest_file(path) != expected:
                    raise ValueError("AUDIO_OUTPUT_CHANGED")
            else:
                write_atomic(path, data)
            hashes[bus] = expected
        write_atomic(state_path, json.dumps({"schemaVersion": 1, "jobSha256": job_hash, "outputs": hashes}, sort_keys=True, separators=(",", ":")).encode())
    finally:
        os.close(lock_fd)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else "AUDIO_SYNTHESIS_FAILED", file=sys.stderr)
        sys.exit(1)
