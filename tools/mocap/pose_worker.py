#!/usr/bin/env python
"""Pose extraction worker (brief 16 Task 1; input enhancement 16.2).

Reads a video, runs the MediaPipe pose landmarker per frame, writes one JSON
line per frame to stdout:

  {"i": N, "t": seconds, "w": px, "h": px,
   "img": [[x,y,visibility] * 33],        # image-normalized (0..1 of frame)
   "world": [[x,y,z] * 33]}               # meters, hip-origin

Modes (argv[4]):
  on  (default) — 16.2 enhancement, two-pass: a full-frame VIDEO scout pass
      finds the dancer's UNION bbox over the window; then two VIDEO-mode
      landmarkers run on that FIXED crop (upscaled), one on the mirror
      (test-time augmentation), averaged after flipping back. The crop is
      constant so each stream keeps MediaPipe's temporal tracking — a
      per-frame moving crop in IMAGE mode was measured NOISIER (4.52 vs
      3.75 px second-diff jitter) because it discards the temporal prior.
  off — legacy full-frame single-pass VIDEO mode (brief 16 Task 1 behavior).

Frames with no pose emit {"i": N, "t": s, "miss": true}. All math
(filtering, de-yaw, retargeting) stays node-side in extract.mjs.

  .venv/bin/python pose_worker.py <video> [start_sec] [end_sec] [on|off]
"""
import json
import sys
import os

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

MODEL = os.path.join(os.path.dirname(__file__), "models", "pose_landmarker_heavy.task")

# BlazePose 33-landmark left/right pairs (nose 0 is self-paired)
FLIP_PAIRS = [(1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14),
              (15, 16), (17, 18), (19, 20), (21, 22), (23, 24), (25, 26),
              (27, 28), (29, 30), (31, 32)]
MIN_SIDE = 512          # upscale crops so the short side reaches this
MARGIN = 0.25           # bbox expansion per side


def flip_back_img(lms):
    """Mirror-detected image landmarks → original frame orientation."""
    out = [[1.0 - x, y, v] for x, y, v in lms]
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


def make_landmarker():
    return vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=MODEL),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ))


def detect_video(landmarker, bgr, ts_ms):
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    res = landmarker.detect_for_video(
        mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts_ms)
    if not res.pose_landmarks:
        return None
    img = [[p.x, p.y, p.visibility] for p in res.pose_landmarks[0]]
    world = [[p.x, p.y, p.z] for p in res.pose_world_landmarks[0]]
    return img, world


def main() -> int:
    video_path = sys.argv[1]
    start_sec = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
    end_sec = float(sys.argv[3]) if len(sys.argv) > 3 else float("inf")
    enhance = (sys.argv[4] if len(sys.argv) > 4 else "on") != "off"

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(json.dumps({"error": f"cannot open {video_path}"}))
        return 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    print(json.dumps({"meta": True, "fps": fps, "w": width, "h": height}))

    if not enhance:
        with make_landmarker() as lm:
            for i, t, frame in iter_window(video_path, start_sec, end_sec, fps):
                r = detect_video(lm, frame, int(t * 1000))
                if not r:
                    print(json.dumps({"i": i, "t": round(t, 5), "miss": True}))
                    continue
                img_lm = [[round(x, 5), round(y, 5), round(v, 3)] for x, y, v in r[0]]
                world_lm = [[round(x, 5), round(y, 5), round(z, 5)] for x, y, z in r[1]]
                print(json.dumps({"i": i, "t": round(t, 5), "w": width, "h": height,
                                  "img": img_lm, "world": world_lm}))
        return 0

    # ── enhanced: pass 1 — full-frame scout for the UNION bbox ───────────
    lo_x, lo_y, hi_x, hi_y = 1.0, 1.0, 0.0, 0.0
    found = False
    with make_landmarker() as lm:
        for i, t, frame in iter_window(video_path, start_sec, end_sec, fps):
            r = detect_video(lm, frame, int(t * 1000))
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
    # explorer (brief 18): the crop the estimator actually saw
    print(json.dumps({"meta2": True, "crop": [x0p, y0p, x1p, y1p], "scale": round(scale, 3)}))

    # pass 2 — two tracked VIDEO streams on the FIXED crop (plain + mirror)
    with make_landmarker() as lm1, make_landmarker() as lm2:
        for i, t, frame in iter_window(video_path, start_sec, end_sec, fps):
            crop = frame[y0p:y1p, x0p:x1p]
            if scale > 1.0:
                crop = cv2.resize(crop, (int(cw * scale), int(chh * scale)),
                                  interpolation=cv2.INTER_CUBIC)
            ts = int(t * 1000)
            r1 = detect_video(lm1, crop, ts)
            r2 = detect_video(lm2, cv2.flip(crop, 1), ts)
            results = []
            if r1:
                results.append(r1)
            if r2:
                results.append((flip_back_img(r2[0]), flip_back_world(r2[1])))
            if not results:
                print(json.dumps({"i": i, "t": round(t, 5), "miss": True}))
                continue
            n = len(results)
            world_lm = [[round(sum(r[1][l][c] for r in results) / n, 5) for c in range(3)]
                        for l in range(33)]
            img_lm = []
            for l in range(33):
                x = sum(r[0][l][0] for r in results) / n
                y = sum(r[0][l][1] for r in results) / n
                v = sum(r[0][l][2] for r in results) / n
                img_lm.append([round((x0p + x * cw) / width, 5),
                               round((y0p + y * chh) / height, 5), round(v, 3)])
            print(json.dumps({"i": i, "t": round(t, 5), "w": width, "h": height,
                              "img": img_lm, "world": world_lm}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
