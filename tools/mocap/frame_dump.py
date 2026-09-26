#!/usr/bin/env python
"""Explorer helper (brief 18): dump N frames of the loop window AS THE
ESTIMATOR SAW THEM (same crop + upscale as pose_worker's enhanced path),
JPEG/base64, resized for the page.

  .venv/bin/python frame_dump.py <video> <start> <end> <x0,y0,x1,y1|full> <count>
Prints one JSON object: {"frames": [{"t": s, "jpg": b64}], "crop": [...]}.
"""
import base64
import json
import sys

import cv2

def main() -> int:
    video, start, end = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    crop = sys.argv[4]
    count = int(sys.argv[5])
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    box = [0, 0, W, H] if crop == "full" else [int(v) for v in crop.split(",")]
    times = [start + (end - start) * k / max(1, count - 1) for k in range(count)]
    out = []
    ti = 0
    i = -1
    while ti < len(times):
        ok, frame = cap.read()
        if not ok:
            break
        i += 1
        t = i / fps
        if t < times[ti]:
            continue
        sub = frame[box[1]:box[3], box[0]:box[2]]
        h, w = sub.shape[:2]
        s = 360 / max(w, h)
        if s < 1:
            sub = cv2.resize(sub, (int(w * s), int(h * s)))
        ok2, buf = cv2.imencode(".jpg", sub, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if ok2:
            out.append({"t": round(t, 3), "jpg": base64.b64encode(buf).decode()})
        ti += 1
    cap.release()
    print(json.dumps({"frames": out, "crop": box, "w": W, "h": H}))
    return 0

if __name__ == "__main__":
    sys.exit(main())
