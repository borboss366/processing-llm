#!/usr/bin/env python
"""Pose extraction worker (brief 16 Task 1, stage 1 of extract.mjs).

Reads a video, runs the MediaPipe pose landmarker per frame (VIDEO mode, CPU —
deterministic), writes one JSON line per frame to stdout:

  {"i": N, "t": seconds, "w": px, "h": px,
   "img": [[x,y,visibility] * 33],        # image-normalized (0..1 of frame)
   "world": [[x,y,z] * 33]}               # meters, hip-origin

Frames where no pose is detected emit {"i": N, "t": s, "miss": true}.
All math (filtering, de-yaw, retargeting) happens node-side in extract.mjs —
this worker only does inference, so the pinned-model boundary stays thin.

  .venv/bin/python pose_worker.py <video> [start_sec] [end_sec]
"""
import json
import sys
import os

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

MODEL = os.path.join(os.path.dirname(__file__), "models", "pose_landmarker_heavy.task")


def main() -> int:
    video_path = sys.argv[1]
    start_sec = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
    end_sec = float(sys.argv[3]) if len(sys.argv) > 3 else float("inf")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(json.dumps({"error": f"cannot open {video_path}"}))
        return 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(json.dumps({"meta": True, "fps": fps, "w": width, "h": height}))

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=MODEL),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
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
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = landmarker.detect_for_video(image, int(t * 1000))
            if not result.pose_landmarks:
                print(json.dumps({"i": i, "t": round(t, 5), "miss": True}))
                continue
            img_lm = [[round(p.x, 5), round(p.y, 5), round(p.visibility, 3)]
                      for p in result.pose_landmarks[0]]
            world_lm = [[round(p.x, 5), round(p.y, 5), round(p.z, 5)]
                        for p in result.pose_world_landmarks[0]]
            print(json.dumps({"i": i, "t": round(t, 5), "w": width, "h": height,
                              "img": img_lm, "world": world_lm}))
    cap.release()
    return 0


if __name__ == "__main__":
    sys.exit(main())
