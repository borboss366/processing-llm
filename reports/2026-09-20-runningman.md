# Move #2: running man — capture run + the economics number (brief 16)

Clip: corpus/runningman.mp4 (logged in MOTION_SOURCES.md; the log's
path is authoritative — the request said `runningman-h264.mp4`, which
does not exist). Window 15.749–18.452 s, mirror yes, in place (net
drift removed — no --keep-drift).

## Economics number

**Per-move wall time: ~15 min** (911 s measured, from clip probe to
staged over Darude — extraction 2×~90 s incl. the enhanced worker's
3 inference passes, single-table stitch ×2, fk-check + moves-x-shapes
sequential runs, stack restart + staging). Move #1 paid the pipeline
tax across three sessions; move #2 is the marginal cost. One
implementation detour inside that time: stitch.mjs needed a
single-table mode (a full alternating loop needs no halving — 12 lines,
now permanent). A style-pack decision can price on ~15 min/move plus
one user judgment cycle.

## Pipeline numbers

| metric | value |
|---|---|
| frames posed | 82/82, jitter 8.47 px (fast move; T-step was 3.3) |
| cycles | 2 → kept 2, dropped 0 |
| lag vs raw | 0.9 ms, thirds −12.6/3.7/−0.2 → constant |
| foot gate (<0.35) | held ankleL 32, ankleR 58 of 82 frames |
| ankle stance offsets | +0.589 / −1.157 rad removed |
| table | bpl 2, 16 keys, 12 joints; travel removed (in place) |
| harnesses | fk-check PASS (0 spikes, all prior asserts hold); moves-x-shapes PASS 7 moves × 2 shapes |

Tables: runningman-captured + runningman-captured-x (per-part
captureExag). In the groove repertoire at weight 0.05. Staged over
Darude, forced, live clock.

## Finding to carry into brief 17 (measured, not judged)

The source is NEAR SIDE-VIEW (yaw median −98°) — running man tutorials
film in profile because the knee lift reads there. Our de-yaw rotates
the pose to frontal, which sends the sagittal knee-lift into z and the
orthographic projection DISCARDS it: captured hip spans are only
0.09/0.16 rad where the lift should dominate, and the foot gate held
39–70% of ankle frames (feet point at the camera all window in the
de-yawed frame). The neck also carries a +0.85 rad side-view artifact
(head reads tilted on stage).

Same depth wall as the T-step, but INVERTED: the T-step's information
was destroyed by the projection with no view that keeps it flat;
the running man's information EXISTS in the raw camera plane — de-yaw
itself throws it away. A plane-select (fit the plane of maximum motion
variance instead of always de-yawing to frontal) would capture this
move today and matches the profile-facing rig. Candidate for brief 17
alongside footYaw/twist consumption; both channels are already emitted
for this clip.
