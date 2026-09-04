# Brief 16 Task 1 — mocap extraction pipeline (tools/mocap/)

Offline capture→table pipeline built end to end and validated on the
user's first corpus clip (T-step tutorial, `corpus/shuffle-h264.mp4`,
logged in MOTION_SOURCES.md: loopL 0:03–0:04, loopR 0:06–0:07,
turnaround 0:05, mirror no).

## Architecture

`extract.mjs` (node, all math) orchestrates two thin Python stages
(pinned venv: mediapipe 0.10.21, opencv 4.10.0.84, numpy 1.26.4; model
pose_landmarker_heavy.task, CPU = deterministic):

1. `pose_worker.py` — inference only; 33 landmarks/frame (image + world),
   JSONL out.
2. One Euro on LANDMARK POSITIONS per axis (default minCutoff 1.2,
   beta 0.35), never on angles.
3. De-yaw: shoulder+hip left→right vector yaw per frame, rotate 3D world
   landmarks to frontal, orthographic project; yaw kept as a channel in
   poses.json (future yaw-fake data).
4. Retarget by matching WORLD BONE ORIENTATIONS: theta = observed segment
   angle − rig rest-bone angle − parent chain accRot, same atan2/rotation
   convention as the creature's FK — signs correct by construction.
   Mapping: MP 33 landmarks → the 15-joint rig (heel/toe from foot
   landmarks; hands are leaves). Positions derived by FK, never copied.
5. Timing: motion-derived phase default (autocorr base period = smallest
   strong ac peak of summed |angular speed|; loop×2 decided on SIGNED
   theta channels — |speed| erases L/R asymmetry); --audio-bpm / --grid
   lock the loop to the music; --loop-window always bounds; --mirror flag.
6. Cycle-average at 64 bins with outlier drop (RMS distance to per-bin
   median cycle, 2.5× rule) → distill: keys at extrema+inflections thinned
   greedily to ≤16, contacts from foot-height minima + low horizontal
   speed, `travel` from pelvis drift (--keep-drift for single-side
   travelling captures), ease snap on top-quartile speed keys.
7. `qa_render.py` — side-by-side source landmarks vs retargeted rig
   stickman, phase bar + beat ticks, dropped cycles tinted red.

## Verified

Self-test (`node tools/mocap/extract.mjs --self-test` → VERIFY:PASS
mocap-self-test), 5 checks:

| check | number |
|---|---|
| One Euro hold err / ramp lag | 0.0031 · 43 ms |
| period, symmetric move | base 0.3989 s vs 0.40 truth, ×1 (no false double) |
| period, L/R-alternating | full loop 1.5958 s vs 1.60 truth, ×2 |
| retarget↔FK round-trip | worst chain-accRot err 4.4e-16 rad (machine ε) |
| outlier cycles | dropped exactly the 2 planted of 8 |
| distill reconstruction | 12 keys, worst linear-interp err 0.044 rad |

Real clip (loopL window 3.0–4.9 s): 58/58 frames posed, y-sign
auto-detected, yaw median −175° (facing camera), base period 0.314 s ×2 →
0.63 s step loop (ac 0.24 — short window), 2 cycles kept 0 dropped,
16 keys / 9 joints, net drift −0.1553 u/loop kept as travel
(--keep-drift: a lone T-step half really travels). QA video reviewed:
landmarks track the instructor; rig stickman follows with correct sides;
visible artifacts are the documented no-hip DOF projection.

**Determinism: two identical runs → byte-identical move.json** (diff
clean; clip sha b43a6915 recorded in provenance).

## Deviations / notes

- Brief says "keys at extrema + inflection points" — implemented as
  candidate extrema+inflections thinned by least-reconstruction-error to
  ≤16 keys, which also caps table size to what the rig consumes well.
- The logged loop windows are ~1 s (≈2 cycles) — enough to run but thin
  for averaging; the turnaround at 0:05 separates L-lead and R-lead
  segments, so the full bpl-4 table (sides swap at half, like the
  authored one) will be stitched from the two single-side extractions in
  Task 2.
- Wall time, move #1 so far (pipeline tax): ~half a day of build; the
  extraction itself runs ~40 s for a 2 s window (pose inference
  dominated).
