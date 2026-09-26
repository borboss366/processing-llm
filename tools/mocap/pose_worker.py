#!/usr/bin/env python
"""Pose extraction worker (brief 16; enhancement 16.2; pluggable 18.1).

Emits the PIPELINE SCHEMA (lib/landmarks.mjs — 21 named points, L/R pairs at
(2k+1, 2k+2)), one JSON line per frame:

  {"i": N, "t": s, "w": px, "h": px,
   "img": [[x, y, score] * 21],           # image-normalized, schema order
   "world": [[x,y,z] * 21]}               # mediapipe only — DEBUG channel;
                                          # nothing downstream consumes it
                                          # (18.1: depth is derived from 2D)

Estimators (--estimator, argv[5]):
  mediapipe (default) — pose_landmarker_heavy, VIDEO mode, CPU. Two-pass
      fixed union crop + flip-TTA (16.2). smalltoe not provided → copy of
      bigtoe at score 0.
  rtmpose — rtmlib Wholebody (COCO-WholeBody 133), onnxruntime CPU. Same
      fixed-crop + flip-TTA path; keypoint scores → score. Mode via
      --estimator-model (argv[6]): lightweight | balanced | performance.

  .venv/bin/python pose_worker.py <video> [start] [end] [on|off] [estimator] [model]
"""
import json
import sys
import os

import cv2
import numpy as np

MODEL = os.path.join(os.path.dirname(__file__), "models", "pose_landmarker_heavy.task")

# schema: L/R pairs are (2k+1, 2k+2)
N_SCHEMA = 21
FLIP_PAIRS = [(2 * k + 1, 2 * k + 2) for k in range(10)]
# mediapipe 33 → schema (smalltoe: None → bigtoe copy at score 0)
MP_MAP = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, None, None]
# COCO-WholeBody 133 → schema (body 0-16, feet 17-22)
COCO_MAP = [0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19, 22, 17, 20, 18, 21]

MIN_SIDE = 512
MARGIN = 0.25


def flip_back(lms):
    out = [[1.0 - x, y, s] for x, y, s in lms]
    for a, b in FLIP_PAIRS:
        out[a], out[b] = out[b], out[a]
    return out


def flip_back_world(lms):
    out = [[-x, y, z] for x, y, z in lms]
    for a, b in FLIP_PAIRS:
        out[a], out[b] = out[b], out[a]
    return out


def iter_window(video_path, start_sec, end_sec, fps):
    cap = cv2.VideoCapture(video_path)
    i = -1
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        i += 1
        t = i / fps
        if t < start_sec:
            continue
        if t > end_sec:
            break
        yield i, t, frame
    cap.release()


# ── estimator backends: detect(bgr, ts_ms) → (schemaImg, world|None) ──────
def make_mediapipe():
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    def make():
        return vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=MODEL),
            running_mode=vision.RunningMode.VIDEO, num_poses=1,
            min_pose_detection_confidence=0.5, min_tracking_confidence=0.5))

    def wrap(lm):
        def detect(bgr, ts_ms):
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts_ms)
            if not res.pose_landmarks:
                return None
            raw = res.pose_landmarks[0]
            rawW = res.pose_world_landmarks[0]
            img = []
            for si, mi in enumerate(MP_MAP):
                if mi is None:                      # smalltoe: bigtoe copy, score 0
                    p = raw[MP_MAP[si - 2]]
                    img.append([p.x, p.y, 0.0])
                else:
                    p = raw[mi]
                    img.append([p.x, p.y, p.visibility])
            world = []
            for si, mi in enumerate(MP_MAP):
                q = rawW[mi if mi is not None else MP_MAP[si - 2]]
                world.append([q.x, q.y, q.z])
            return img, world
        return detect
    return make, wrap


def make_rtmpose(model_mode):
    import contextlib
    from rtmlib import Wholebody
    mode = model_mode if model_mode in ("lightweight", "balanced", "performance") else "balanced"

    def make():
        # rtmlib prints model-load progress to stdout — our channel is JSONL
        with contextlib.redirect_stdout(sys.stderr):
            return Wholebody(mode=mode, backend="onnxruntime", device="cpu")

    def wrap(wb):
        def detect(bgr, ts_ms):
            kps, scores = wb(bgr)
            if kps is None or len(kps) == 0:
                return None
            k, sc = kps[0], scores[0]
            h, w = bgr.shape[:2]
            img = []
            for ci in COCO_MAP:
                img.append([float(k[ci][0]) / w, float(k[ci][1]) / h, float(sc[ci])])
            return img, None
        return detect
    return make, wrap


def main() -> int:
    video_path = sys.argv[1]
    start_sec = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
    end_sec = float(sys.argv[3]) if len(sys.argv) > 3 else float("inf")
    enhance = (sys.argv[4] if len(sys.argv) > 4 else "on") != "off"
    estimator = sys.argv[5] if len(sys.argv) > 5 else "mediapipe"
    model_mode = sys.argv[6] if len(sys.argv) > 6 else "balanced"

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(json.dumps({"error": f"cannot open {video_path}"}))
        return 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    print(json.dumps({"meta": True, "fps": fps, "w": width, "h": height,
                      "estimator": estimator, "schema": N_SCHEMA}))

    make, wrap = make_mediapipe() if estimator == "mediapipe" else make_rtmpose(model_mode)

    def emit(i, t, img, world):
        row = {"i": i, "t": round(t, 5), "w": width, "h": height,
               "img": [[round(x, 5), round(y, 5), round(s, 3)] for x, y, s in img]}
        if world is not None:
            row["world"] = [[round(a, 5) for a in p] for p in world]
        print(json.dumps(row))

    if not enhance:
        det = wrap(make())
        for i, t, frame in iter_window(video_path, start_sec, end_sec, fps):
            r = det(frame, int(t * 1000))
            if not r:
                print(json.dumps({"i": i, "t": round(t, 5), "miss": True}))
                continue
            emit(i, t, r[0], r[1])
        return 0

    # pass 1 — full-frame scout for the UNION bbox
    lo_x, lo_y, hi_x, hi_y = 1.0, 1.0, 0.0, 0.0
    found = False
    det0 = wrap(make())
    for i, t, frame in iter_window(video_path, start_sec, end_sec, fps):
        r = det0(frame, int(t * 1000))
        if not r:
            continue
        found = True
        for x, y, _ in r[0]:
            lo_x, lo_y = min(lo_x, x), min(lo_y, y)
            hi_x, hi_y = max(hi_x, x), max(hi_y, y)
    if found:
        bw, bh = hi_x - lo_x, hi_y - lo_y
        x0p = max(0, int((lo_x - MARGIN * bw) * width))
        y0p = max(0, int((lo_y - MARGIN * bh) * height))
        x1p = min(width, int((hi_x + MARGIN * bw) * width))
        y1p = min(height, int((hi_y + MARGIN * bh) * height))
        if x1p - x0p < 64 or y1p - y0p < 64:
            x0p, y0p, x1p, y1p = 0, 0, width, height
    else:
        x0p, y0p, x1p, y1p = 0, 0, width, height
    cw, chh = x1p - x0p, y1p - y0p
    scale = max(1.0, MIN_SIDE / min(cw, chh))
    print(json.dumps({"meta2": True, "crop": [x0p, y0p, x1p, y1p], "scale": round(scale, 3)}))

    # pass 2 — two tracked streams on the FIXED crop (plain + mirror)
    d1, d2 = wrap(make()), wrap(make())
    for i, t, frame in iter_window(video_path, start_sec, end_sec, fps):
        crop = frame[y0p:y1p, x0p:x1p]
        if scale > 1.0:
            crop = cv2.resize(crop, (int(cw * scale), int(chh * scale)),
                              interpolation=cv2.INTER_CUBIC)
        ts = int(t * 1000)
        r1 = d1(crop, ts)
        r2 = d2(cv2.flip(crop, 1), ts)
        results = []
        if r1:
            results.append(r1)
        if r2:
            results.append((flip_back(r2[0]),
                            flip_back_world(r2[1]) if r2[1] is not None else None))
        if not results:
            print(json.dumps({"i": i, "t": round(t, 5), "miss": True}))
            continue
        n = len(results)
        img = []
        for l in range(N_SCHEMA):
            x = sum(r[0][l][0] for r in results) / n
            y = sum(r[0][l][1] for r in results) / n
            s = sum(r[0][l][2] for r in results) / n
            img.append([(x0p + x * cw) / width, (y0p + y * chh) / height, s])
        world = None
        if all(r[1] is not None for r in results):
            world = [[sum(r[1][l][c] for r in results) / n for c in range(3)]
                     for l in range(N_SCHEMA)]
        emit(i, t, img, world)
    return 0


if __name__ == "__main__":
    sys.exit(main())
