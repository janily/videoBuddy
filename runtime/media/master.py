"""Trusted FFmpeg mixer. Accepts a fixed graph and numeric MixPlan; no arbitrary commands."""
import argparse
import fcntl
import hashlib
import json
import math
import os
import pathlib
import re
import subprocess
import sys
import tempfile
from sound import digest_file, number, write_atomic

def num(value):
    return str(int(value)) if int(value) == value else str(value)

def numeric_literal(graph, prefix, suffix, expected):
    # JS and Python serialize small decimals differently. Preserve only a
    # restricted numeric literal whose decoded value equals the frozen plan.
    match = re.search(re.escape(prefix) + r"([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)" + re.escape(suffix), graph)
    if not match or not math.isfinite(float(match[1])) or float(match[1]) != expected:
        raise ValueError("AUDIO_MIX_INVALID")
    return match[1]

def validate(job):
    expected = {"schemaVersion", "planSha256", "samples", "hasVoice", "mix", "filter", "inputSha256"}
    if job.get("schemaVersion") == 2:
        expected.add("musicGainDb")
    if set(job) != expected or type(job["schemaVersion"]) is not int or job["schemaVersion"] not in (1, 2) or not isinstance(job["hasVoice"], bool):
        raise ValueError("AUDIO_MIX_INVALID")
    number(job["samples"], 960000, 5760000, True)
    if not re.fullmatch("[a-f0-9]{64}", job["planSha256"]) or set(job["inputSha256"]) != {"voice", "music", "foley"} or any(not re.fullmatch("[a-f0-9]{64}", digest) for digest in job["inputSha256"].values()):
        raise ValueError("AUDIO_MIX_INVALID")
    mix = job["mix"]
    if set(mix) != {"targetLufs", "toleranceLu", "maxTruePeakDbtp", "voiceGainDb", "duck"} or mix["targetLufs"] != -14 or mix["toleranceLu"] != 1 or mix["maxTruePeakDbtp"] != -1.2:
        raise ValueError("AUDIO_MIX_INVALID")
    number(mix["voiceGainDb"], -24, 12)
    duck = mix["duck"]
    if set(duck) != {"thresholdDb", "ratio", "attackMs", "releaseMs"}:
        raise ValueError("AUDIO_MIX_INVALID")
    number(duck["thresholdDb"], -45, -1)
    number(duck["ratio"], 1, 12)
    number(duck["attackMs"], 1, 100)
    number(duck["releaseMs"], 20, 1000)
    voice_gain = numeric_literal(job["filter"], "volume=", "dB", mix["voiceGainDb"])
    voice = "[0:a]aresample=48000,aformat=sample_fmts=flt:channel_layouts=stereo,volume=" + voice_gain + "dB"
    music = "[1:a]aformat=sample_fmts=flt:channel_layouts=stereo"
    if job["schemaVersion"] == 2:
        number(job["musicGainDb"], -6, 0)
        music_gain = numeric_literal(job["filter"], music + ",volume=", "dB", job["musicGainDb"])
        music += ",volume=" + music_gain + "dB"
    foley = "[2:a]aformat=sample_fmts=flt:channel_layouts=stereo[foley]"
    if job["hasVoice"]:
        match = re.search(r"sidechaincompress=threshold=([0-9.eE+-]+):ratio=", job["filter"])
        if not match or not math.isclose(float(match[1]), 10 ** (duck["thresholdDb"] / 20), rel_tol=1e-14):
            raise ValueError("AUDIO_MIX_INVALID")
        duck_graph = job["filter"][match.start():]
        ratio = numeric_literal(duck_graph, ":ratio=", ":attack=", duck["ratio"])
        attack = numeric_literal(duck_graph, ":attack=", ":release=", duck["attackMs"])
        release = numeric_literal(duck_graph, ":release=", "[music]", duck["releaseMs"])
        compressor = "sidechaincompress=threshold=" + match[1] + ":ratio=" + ratio + ":attack=" + attack + ":release=" + release
        parts = [voice + ",acompressor=threshold=0.08:ratio=4:attack=2:release=100:detection=peak,asplit=2[voice][side]", music + "[bed]", "[bed][side]" + compressor + "[music]", foley]
    else:
        parts = [voice + "[voice]", music + "[music]", foley]
    parts.append("[voice][music][foley]amix=inputs=3:duration=first:normalize=0,atrim=end_sample=" + num(job["samples"]) + ",asetpts=PTS-STARTPTS[out]")
    if job["filter"] != ";".join(parts):
        raise ValueError("AUDIO_MIX_INVALID")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    raw = pathlib.Path(args.job).read_bytes()
    if len(raw) > 16384:
        raise ValueError("AUDIO_MIX_INVALID")
    job = json.loads(raw)
    validate(job)
    inputs = {bus: pathlib.Path(args.job).parent / (bus + ".wav") for bus in ("voice", "music", "foley")}
    for bus, path in inputs.items():
        if digest_file(path) != job["inputSha256"][bus]:
            raise ValueError("AUDIO_SOURCE_CHANGED")
    output = pathlib.Path(args.output)
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    if output.is_symlink():
        raise ValueError("AUDIO_OUTPUT_INVALID")
    lock_fd = os.open(output / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        state_path, master_path = output / "state.json", output / "master.wav"
        job_hash = hashlib.sha256(raw).hexdigest()
        if state_path.exists() or state_path.is_symlink():
            digest_file(state_path)
            state = json.loads(state_path.read_bytes())
            if state.get("jobSha256") != job_hash or state.get("outputSha256") != digest_file(master_path):
                raise ValueError("AUDIO_MASTER_CHANGED")
            return
        # Uncommitted media output is an unknown calculation, never adopted or overwritten.
        if master_path.exists() or master_path.is_symlink():
            raise ValueError("AUDIO_MASTER_UNKNOWN")
        fd, temporary = tempfile.mkstemp(prefix=".master-", suffix=".wav", dir=output)
        os.close(fd)
        try:
            command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror", "-nostdin", "-y", "-threads", "1", "-filter_complex_threads", "1"]
            for path in inputs.values():
                command += ["-i", str(path)]
            command += ["-filter_complex", job["filter"], "-map", "[out]", "-c:a", "pcm_f32le", "-ar", "48000", "-ac", "2", temporary]
            subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=150)
            for bus, path in inputs.items():
                if digest_file(path) != job["inputSha256"][bus]:
                    raise ValueError("AUDIO_SOURCE_CHANGED")
            with open(temporary, "rb") as master:
                os.fsync(master.fileno())
            sha = digest_file(pathlib.Path(temporary))
            os.replace(temporary, master_path)
            directory = os.open(output, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
            write_atomic(state_path, json.dumps({"schemaVersion": 1, "jobSha256": job_hash, "outputSha256": sha}, sort_keys=True, separators=(",", ":")).encode())
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    finally:
        os.close(lock_fd)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else "AUDIO_MASTER_FAILED", file=sys.stderr)
        sys.exit(1)
