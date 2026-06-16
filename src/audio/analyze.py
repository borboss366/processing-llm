#!/usr/bin/env python3
"""
Analyse an MP3/audio file for BPM and musical key (major/minor).
Outputs JSON to stdout.
"""

import sys
import json
import argparse
import numpy as np
import librosa


# ── Krumhansl-Schmuckler key profiles ─────────────────────────────────────────
# 12 values per template, starting from C, mapped to the 12 chroma bins.

_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
                   2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
                   2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F",
               "F#", "G", "G#", "A", "A#", "B"]


def detect_key(y: np.ndarray, sr: int) -> tuple[str, str, float]:
    """
    Returns (root_note, scale, confidence_0_to_1).
    scale is 'major' or 'minor'.
    """
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    mean_chroma = chroma.mean(axis=1)          # shape (12,)
    mean_chroma = mean_chroma / (mean_chroma.sum() + 1e-8)

    best_score = -np.inf
    best_root = 0
    best_scale = "major"

    for root in range(12):
        rotated = np.roll(mean_chroma, -root)

        score_major = np.corrcoef(rotated, _MAJOR)[0, 1]
        score_minor = np.corrcoef(rotated, _MINOR)[0, 1]

        if score_major > best_score:
            best_score = score_major
            best_root = root
            best_scale = "major"
        if score_minor > best_score:
            best_score = score_minor
            best_root = root
            best_scale = "minor"

    # Normalise correlation to 0-1 confidence
    confidence = float(np.clip((best_score + 1) / 2, 0.0, 1.0))
    return _NOTE_NAMES[best_root], best_scale, round(confidence, 3)


def detect_bpm(y: np.ndarray, sr: int) -> float:
    """Returns estimated BPM, rounded to one decimal place."""
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])
    return round(bpm, 1)


# ── Frequency bands ────────────────────────────────────────────────────────────

_BANDS = {
    "sub_bass":  (20,   60),
    "bass":      (60,   250),
    "low_mid":   (250,  500),
    "mid":       (500,  2000),
    "high_mid":  (2000, 4000),
    "high":      (4000, 20000),
}


def detect_spectral_centroid(y: np.ndarray, sr: int) -> float:
    """Average spectral centroid in Hz — perceived brightness of the sound."""
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)
    return round(float(np.mean(centroid)), 1)


def detect_harmonic_ratio(y: np.ndarray) -> float:
    """
    Ratio of harmonic energy to total energy (0 = fully percussive, 1 = fully harmonic).
    Uses librosa's HPSS (Harmonic-Percussive Source Separation).
    """
    y_harmonic, y_percussive = librosa.effects.hpss(y)
    harmonic_energy   = float(np.mean(y_harmonic   ** 2))
    percussive_energy = float(np.mean(y_percussive ** 2))
    total = harmonic_energy + percussive_energy + 1e-10
    return round(harmonic_energy / total, 3)


def detect_band_energies(y: np.ndarray, sr: int) -> tuple[dict[str, float], str]:
    """
    Returns (band_energies, dominant_band).
    band_energies: relative energy (0–1) per named band, sums to 1.
    dominant_band: name of the band with the most energy.
    """
    S = np.abs(librosa.stft(y)) ** 2
    freqs = librosa.fft_frequencies(sr=sr)

    raw: dict[str, float] = {}
    for name, (lo, hi) in _BANDS.items():
        mask = (freqs >= lo) & (freqs < hi)
        raw[name] = float(np.mean(S[mask, :])) if mask.any() else 0.0

    total = sum(raw.values()) + 1e-10
    energies = {k: round(v / total, 4) for k, v in raw.items()}
    dominant = max(energies, key=energies.__getitem__)
    return energies, dominant


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", help="Path to audio file (MP3, WAV, FLAC, …)")
    parser.add_argument("--duration", type=float, default=None,
                        help="Only analyse the first N seconds (faster, default: full track)")
    args = parser.parse_args()

    try:
        y, sr = librosa.load(args.audio, mono=True, duration=args.duration)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    bpm                      = detect_bpm(y, sr)
    root, scale, confidence  = detect_key(y, sr)
    spectral_centroid        = detect_spectral_centroid(y, sr)
    harmonic_ratio           = detect_harmonic_ratio(y)
    band_energies, dominant  = detect_band_energies(y, sr)

    print(json.dumps({
        "bpm":             bpm,
        "key":             root,
        "scale":           scale,
        "keyLabel":        f"{root} {scale}",
        "keyConfidence":   confidence,
        "durationSeconds": round(float(len(y) / sr), 1),
        "spectralCentroid": spectral_centroid,
        "harmonicRatio":    harmonic_ratio,
        "dominantBand":     dominant,
        "bandEnergies":     band_energies,
    }))


if __name__ == "__main__":
    main()
