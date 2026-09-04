#!/usr/bin/env python
"""Side-by-side stickman QA video (brief 16 Task 1 step 6).

Left: source frame with MediaPipe landmark skeleton. Right: the retargeted
rig skeleton (FK positions computed node-side, passed in the spec). Bottom:
phase bar with beat ticks. Frames inside DROPPED cycles get a red border —
kept-vs-dropped is visible, and a wrong --mirror guess is obvious.

  .venv/bin/python qa_render.py <spec.json>
"""
import json
import sys

import cv2
import numpy as np

MP_BONES = [(11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (23, 24),
            (11, 23), (12, 24), (23, 25), (25, 27), (27, 29), (29, 31), (27, 31),
            (24, 26), (26, 28), (28, 30), (30, 32), (28, 32), (7, 8)]

PANEL_W = 420


def main() -> int:
    spec = json.load(open(sys.argv[1]))
    cap = cv2.VideoCapture(spec["video"])
    src_w, src_h, fps = spec["w"], spec["h"], spec["fps"]
    scale = 720 / src_h
    view_w, view_h = int(src_w * scale), 720
    out_w, out_h = view_w + PANEL_W, view_h + 40
    vw = cv2.VideoWriter(spec["out"], cv2.VideoWriter_fourcc(*"mp4v"), fps, (out_w, out_h))

    frames = {f["i"]: f for f in spec["frames"]}
    period, anchor, t0 = spec["period"], spec["anchorSec"], spec["t0"]
    dropped = set(spec["droppedCycles"])
    bones = spec["bones"]

    # rig panel mapping: shape units (0..1) → panel px, small margin
    def rp(pt):
        return (view_w + int(30 + pt[0] * (PANEL_W - 60)), int(20 + pt[1] * (view_h - 60)))

    idx = -1
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        idx += 1
        if idx not in frames:
            continue
        f = frames[idx]
        canvas = np.zeros((out_h, out_w, 3), np.uint8)
        view = cv2.resize(frame, (view_w, view_h))

        # left: source + landmarks
        pts = [(int(x * view_w), int(y * view_h)) for x, y in f["img"]]
        for a, b in MP_BONES:
            cv2.line(view, pts[a], pts[b], (80, 220, 80), 2)
        for p in pts:
            cv2.circle(view, p, 3, (60, 160, 255), -1)
        canvas[0:view_h, 0:view_w] = view

        # right: retargeted rig stickman
        rig = f["rig"]
        for child, parent in bones:
            cv2.line(canvas, rp(rig[parent]), rp(rig[child]), (200, 200, 255), 3)
        for nm, pt in rig.items():
            cv2.circle(canvas, rp(pt), 4, (100, 100, 255), -1)
        cv2.putText(canvas, "retargeted rig", (view_w + 20, 24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (160, 160, 160), 1)

        # bottom: phase bar + beat ticks
        elapsed = f["t"] - t0 - anchor
        phase = (elapsed / period) % 1.0 if elapsed >= 0 else 0.0
        cyc = int(elapsed / period) if elapsed >= 0 else -1
        bar_y = view_h + 8
        cv2.rectangle(canvas, (10, bar_y), (out_w - 10, bar_y + 22), (40, 40, 40), -1)
        n_ticks = spec["bpl"]
        for k in range(n_ticks):
            x = 10 + int((out_w - 20) * k / n_ticks)
            cv2.line(canvas, (x, bar_y), (x, bar_y + 22), (120, 120, 120), 2)
        px = 10 + int((out_w - 20) * phase)
        cv2.line(canvas, (px, bar_y), (px, bar_y + 22), (0, 220, 255), 3)
        cv2.putText(canvas, f"cycle {cyc}  phase {phase:.2f}", (out_w - 230, bar_y + 17),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1)

        if cyc in dropped:
            cv2.rectangle(canvas, (0, 0), (out_w - 1, out_h - 1), (0, 0, 220), 8)
            cv2.putText(canvas, "DROPPED CYCLE", (12, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 220), 2)

        vw.write(canvas)
    vw.release()
    cap.release()
    return 0


if __name__ == "__main__":
    sys.exit(main())
