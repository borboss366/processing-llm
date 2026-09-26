#!/usr/bin/env python
"""Frame-by-frame FOOT report (brief 18.1 — 'the feet just jump in all
directions'): for every frame of a window, per foot: the keypoints drawn on
a zoomed foot crop, their scores, the heel→toe angle (raw and SavGol-
smoothed), the projected-length ratio (what the foot gate sees), and a JUMP
flag when the smoothed angle steps > JUMP_DEG between frames.

Outputs:
  reports/foot-report-<name>.png   filmstrip, one tile per frame
  reports/foot-report-<name>.md    the numbers, one row per frame

  .venv/bin/python foot_report.py <video> <start> <end> <estimator> <name>
"""
import json
import subprocess
import sys
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
S = dict(nose=0, hipL=9, hipR=10, ankleL=13, ankleR=14,
         heelL=15, heelR=16, bigtoeL=17, bigtoeR=18, smalltoeL=19, smalltoeR=20)
JUMP_DEG = 25.0


def savgol(vals, window=9, order=3):
    h = window // 2
    A = np.array([[i ** p for p in range(order + 1)] for i in range(-h, h + 1)])
    k = (np.linalg.pinv(A.T @ A) @ A.T)[0]
    pad = np.concatenate([vals[h:0:-1], vals, vals[-2:-h - 2:-1]])
    return np.convolve(pad, k[::-1], mode="valid")


def main() -> int:
    video, start, end, estimator, name = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
    out = subprocess.run(
        [os.path.join(HERE, ".venv/bin/python"), os.path.join(HERE, "pose_worker.py"),
         video, start, end, "on", estimator], capture_output=True, text=True)
    frames = []
    for line in out.stdout.splitlines():
        try:
            j = json.loads(line)
        except ValueError:
            continue
        if not j.get("meta") and not j.get("meta2") and not j.get("miss") and "img" in j:
            frames.append(j)
    if not frames:
        print("no frames from worker", file=sys.stderr)
        return 1
    W, H = frames[0]["w"], frames[0]["h"]
    AR = W / H

    # per-foot series (isotropic coords for true angles)
    data = {}
    for side in ("L", "R"):
        heel = np.array([[f["img"][S[f"heel{side}"]][0] * AR, f["img"][S[f"heel{side}"]][1]] for f in frames])
        toe = np.array([[f["img"][S[f"bigtoe{side}"]][0] * AR, f["img"][S[f"bigtoe{side}"]][1]] for f in frames])
        sc = np.array([[f["img"][S[f"heel{side}"]][2], f["img"][S[f"bigtoe{side}"]][2],
                        f["img"][S[f"smalltoe{side}"]][2]] for f in frames])
        v = toe - heel
        ang_raw = np.degrees(np.arctan2(v[:, 1], v[:, 0]))
        hs = np.stack([savgol(heel[:, 0]), savgol(heel[:, 1])], 1)
        ts = np.stack([savgol(toe[:, 0]), savgol(toe[:, 1])], 1)
        vs = ts - hs
        ang_sm = np.degrees(np.arctan2(vs[:, 1], vs[:, 0]))
        ln = np.hypot(vs[:, 0], vs[:, 1])
        rest = np.percentile(ln, 95)
        d = np.abs(np.diff(ang_sm, prepend=ang_sm[0]))
        d = np.minimum(d, 360 - d)
        data[side] = dict(ang_raw=ang_raw, ang_sm=ang_sm, ratio=ln / rest, dAng=d, sc=sc)

    # markdown table
    md = [f"# Foot report — {name} ({estimator})",
          "",
          f"window {start}–{end}s · {len(frames)} frames · JUMP = smoothed heel→toe angle step > {JUMP_DEG}°",
          "",
          "| frame | t | L ang° | L Δ° | L ratio | L scores h/t/s | R ang° | R Δ° | R ratio | R scores h/t/s | flags |",
          "|---|---|---|---|---|---|---|---|---|---|---|"]
    jumps = {"L": 0, "R": 0}
    for i, f in enumerate(frames):
        flags = []
        for side in ("L", "R"):
            if data[side]["dAng"][i] > JUMP_DEG:
                flags.append(f"JUMP-{side}")
                jumps[side] += 1
            if data[side]["ratio"][i] < 0.35:
                flags.append(f"gate-{side}")
        L, R = data["L"], data["R"]
        md.append(f"| {i} | {f['t']:.2f} | {L['ang_sm'][i]:.0f} | {L['dAng'][i]:.0f} | {L['ratio'][i]:.2f} | "
                  f"{L['sc'][i][0]:.2f}/{L['sc'][i][1]:.2f}/{L['sc'][i][2]:.2f} | "
                  f"{R['ang_sm'][i]:.0f} | {R['dAng'][i]:.0f} | {R['ratio'][i]:.2f} | "
                  f"{R['sc'][i][0]:.2f}/{R['sc'][i][1]:.2f}/{R['sc'][i][2]:.2f} | {' '.join(flags)} |")
    md.append("")
    md.append(f"**Jumps: L {jumps['L']}, R {jumps['R']} of {len(frames)} frames.** "
              f"Median ratio L {np.median(data['L']['ratio']):.2f}, R {np.median(data['R']['ratio']):.2f}.")
    mdpath = os.path.join(ROOT, "reports", f"foot-report-{name}.md")
    open(mdpath, "w").write("\n".join(md) + "\n")

    # filmstrip: zoomed foot crops with points + smoothed bone
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    tiles = []
    fi = 0
    idx = -1
    TILE = 150
    while fi < len(frames):
        ok, frame = cap.read()
        if not ok:
            break
        idx += 1
        if idx != frames[fi]["i"]:
            continue
        f = frames[fi]
        pts = [(f["img"][S[k]][0] * W, f["img"][S[k]][1] * H)
               for k in ("heelL", "bigtoeL", "smalltoeL", "heelR", "bigtoeR", "smalltoeR", "ankleL", "ankleR")]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        half = max(max(xs) - min(xs), max(ys) - min(ys)) * 0.75 + 30
        x0, x1 = int(max(0, cx - half)), int(min(W, cx + half))
        y0, y1 = int(max(0, cy - half)), int(min(H, cy + half))
        crop = frame[y0:y1, x0:x1].copy()
        sc = TILE / max(crop.shape[0], crop.shape[1])
        crop = cv2.resize(crop, (int(crop.shape[1] * sc), int(crop.shape[0] * sc)))
        P = lambda k: (int((f["img"][S[k]][0] * W - x0) * sc), int((f["img"][S[k]][1] * H - y0) * sc))
        for side, col in (("L", (80, 220, 80)), ("R", (80, 160, 255))):
            cv2.line(crop, P(f"heel{side}"), P(f"bigtoe{side}"), col, 2)
            for k in (f"heel{side}", f"bigtoe{side}", f"smalltoe{side}"):
                s2 = f["img"][S[k]][2]
                cv2.circle(crop, P(k), 3, (0, int(200 * s2), int(255 * (1 - s2))), -1)
        pad = np.zeros((TILE + 16, TILE, 3), np.uint8)
        pad[8:8 + crop.shape[0], 0:crop.shape[1]] = crop[:TILE, :TILE]
        flag = data["L"]["dAng"][fi] > JUMP_DEG or data["R"]["dAng"][fi] > JUMP_DEG
        cv2.putText(pad, f"{fi}{'!' if flag else ''}", (4, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                    (0, 0, 255) if flag else (160, 160, 160), 1)
        if flag:
            cv2.rectangle(pad, (0, 0), (TILE - 1, TILE + 15), (0, 0, 255), 2)
        tiles.append(pad)
        fi += 1
    cap.release()
    cols = 10
    rows = (len(tiles) + cols - 1) // cols
    strip = np.zeros((rows * (TILE + 16), cols * TILE, 3), np.uint8)
    for k, tile in enumerate(tiles):
        r, c = divmod(k, cols)
        strip[r * (TILE + 16):(r + 1) * (TILE + 16), c * TILE:(c + 1) * TILE] = tile
    pngpath = os.path.join(ROOT, "reports", f"foot-report-{name}.png")
    cv2.imwrite(pngpath, strip)
    print(f"jumps L {jumps['L']} R {jumps['R']} of {len(frames)} · wrote {mdpath} + {pngpath}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
