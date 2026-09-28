#!/usr/bin/env python
"""Side-by-side stickman QA video (brief 16 Task 1 step 6; overlay 2026-09-28).

Left: source frame with landmark skeleton. Middle: OVERLAY — the retargeted
rig superimposed on the source, hip→shoulder normalized (rig pelvis→chest
scaled/translated onto the person's hipMid→shoulderMid), so amplitude and
timing mismatches are visible per frame. Right: the rig skeleton alone (FK
positions computed node-side, passed in the spec). Bottom: phase bar with
beat ticks. Frames inside DROPPED cycles get a red border.

  .venv/bin/python qa_render.py <spec.json>
"""
import json
import sys

import cv2
import numpy as np

# schema bones (18.1: worker emits the 21-point pipeline schema)
MP_BONES = [(3, 4), (3, 5), (5, 7), (4, 6), (6, 8), (9, 10),
            (3, 9), (4, 10), (9, 11), (11, 13), (13, 15), (15, 17), (13, 17),
            (10, 12), (12, 14), (14, 16), (16, 18), (14, 18), (1, 2)]

PANEL_W = 420


def main() -> int:
    spec = json.load(open(sys.argv[1]))
    cap = cv2.VideoCapture(spec["video"])
    src_w, src_h, fps = spec["w"], spec["h"], spec["fps"]
    scale = 720 / src_h
    view_w, view_h = int(src_w * scale), 720
    out_w, out_h = view_w * 2 + PANEL_W, view_h + 40
    vw = cv2.VideoWriter(spec["out"], cv2.VideoWriter_fourcc(*"mp4v"), fps, (out_w, out_h))

    frames = {f["i"]: f for f in spec["frames"]}
    period, anchor, t0 = spec["period"], spec["anchorSec"], spec["t0"]
    dropped = set(spec["droppedCycles"])
    bones = spec["bones"]

    # rig panel mapping: shape units (0..1) → panel px, small margin
    def rp(pt):
        return (view_w * 2 + int(30 + pt[0] * (PANEL_W - 60)), int(20 + pt[1] * (view_h - 60)))

    # rig joint names for the overlay anchor (pelvis→chest axis)
    S = dict(shoulderL=3, shoulderR=4, hipL=9, hipR=10)

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
        overlay_base = view.copy()
        pts = [(int(x * view_w), int(y * view_h)) for x, y in f["img"]]
        for a, b in MP_BONES:
            cv2.line(view, pts[a], pts[b], (80, 220, 80), 2)
        for p in pts:
            cv2.circle(view, p, 3, (60, 160, 255), -1)
        canvas[0:view_h, 0:view_w] = view

        # middle: OVERLAY — rig superimposed on the source, hip-shoulder
        # normalized: rig pelvis→chest mapped onto person hipMid→shoulderMid
        rig = f["rig"]
        img = f["img"]
        hip_mid = ((img[S["hipL"]][0] + img[S["hipR"]][0]) / 2 * view_w,
                   (img[S["hipL"]][1] + img[S["hipR"]][1]) / 2 * view_h)
        sho_mid = ((img[S["shoulderL"]][0] + img[S["shoulderR"]][0]) / 2 * view_w,
                   (img[S["shoulderL"]][1] + img[S["shoulderR"]][1]) / 2 * view_h)
        person_hs = max(1e-6, ((sho_mid[0] - hip_mid[0]) ** 2 + (sho_mid[1] - hip_mid[1]) ** 2) ** 0.5)
        rig_hs = max(1e-6, ((rig["chest"][0] - rig["pelvis"][0]) ** 2 + (rig["chest"][1] - rig["pelvis"][1]) ** 2) ** 0.5)
        k_ov = person_hs / rig_hs

        def ov(pt):
            return (int(hip_mid[0] + (pt[0] - rig["pelvis"][0]) * k_ov),
                    int(hip_mid[1] + (pt[1] - rig["pelvis"][1]) * k_ov))
        for a, b in MP_BONES:
            cv2.line(overlay_base, pts[a], pts[b], (70, 160, 70), 1)
        for child, parent in bones:
            cv2.line(overlay_base, ov(rig[parent]), ov(rig[child]), (80, 80, 255), 3)
        cv2.putText(overlay_base, "overlay (hip-shoulder normalized)", (10, 24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1)
        canvas[0:view_h, view_w:view_w * 2] = overlay_base

        # right: retargeted rig stickman
        for child, parent in bones:
            cv2.line(canvas, rp(rig[parent]), rp(rig[child]), (200, 200, 255), 3)
        for nm, pt in rig.items():
            cv2.circle(canvas, rp(pt), 4, (100, 100, 255), -1)
        cv2.putText(canvas, "retargeted rig", (view_w * 2 + 20, 24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (160, 160, 160), 1)

        # ground marker (16.2): extracted pelvis drift as a moving tick on a
        # fixed ground line — captured travel is visible at a glance
        gy = rp((0.5, spec["ground"]))[1] + 8
        cv2.line(canvas, (view_w * 2 + 15, gy), (out_w - 15, gy), (90, 90, 90), 1)
        k = f.get("k", 0)
        drift = spec["pelvisDrift"][k] if k < len(spec["pelvisDrift"]) else 0.0
        mx = rp((0.5 + drift, 0))[0]
        cv2.drawMarker(canvas, (mx, gy), (0, 200, 255), cv2.MARKER_TRIANGLE_UP, 12, 2)
        cv2.putText(canvas, f"drift {drift:+.3f}u", (view_w * 2 + 20, gy + 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 200, 255), 1)

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
