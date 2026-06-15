#!/usr/bin/env python3
"""
Capture audio from a named input device (e.g. BlackHole) and write to a temp WAV file.
Prints the output file path to stdout.
"""

import sys
import argparse
import tempfile
import sounddevice as sd
import soundfile as sf
import numpy as np


def find_device(name_fragment: str) -> int:
    devices = sd.query_devices()
    for i, dev in enumerate(devices):
        if (name_fragment.lower() in dev["name"].lower()
                and dev["max_input_channels"] > 0):
            return i
    available = [f"{i}: {d['name']}" for i, d in enumerate(devices) if d["max_input_channels"] > 0]
    raise RuntimeError(
        f"No input device matching '{name_fragment}' found.\n"
        f"Available input devices:\n" + "\n".join(available)
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="blackhole",
                        help="Device name fragment to match (default: blackhole)")
    parser.add_argument("--duration", type=float, default=30.0,
                        help="Seconds to capture (default: 30)")
    parser.add_argument("--sample-rate", type=int, default=44100)
    parser.add_argument("--channels", type=int, default=2)
    parser.add_argument("--output", default=None,
                        help="Output WAV path (default: auto temp file)")
    args = parser.parse_args()

    device_idx = find_device(args.device)
    dev_info = sd.query_devices(device_idx)
    print(f"[capture] Recording {args.duration}s from '{dev_info['name']}' (device {device_idx})", file=sys.stderr)

    audio = sd.rec(
        int(args.duration * args.sample_rate),
        samplerate=args.sample_rate,
        channels=args.channels,
        device=device_idx,
        dtype="float32",
    )
    sd.wait()

    out_path = args.output or tempfile.mktemp(suffix=".wav", prefix="proc_capture_")
    sf.write(out_path, audio, args.sample_rate)

    print(out_path)  # Only stdout output — the caller reads this as the file path


if __name__ == "__main__":
    main()
