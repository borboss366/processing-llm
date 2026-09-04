# tools/mocap — capture → move tables (brief 16, Route B pilot)

Offline pipeline that turns a dance-tutorial clip into a standard move
table plus a side-by-side QA video. Why isolated: capture is the cheapest
anatomy model (one dancer's video carries the joint couplings the
hand-authored tables lack), but everything here is slow, Python-dependent
and failure-prone — exactly what the live path must never touch. Promoted
if the captured T-step beats the authored placeholder on the user's word
(USER_GATES) and per-move wall time makes style packs economic; killed if
captured tables read worse than sculpted ones.

Setup once: `tools/mocap/setup.sh` (pinned venv + pose model, both
gitignored). Run: `node tools/mocap/extract.mjs corpus/<clip>.mp4
--loop-window 3.0-4.9 --bpl 2 [--mirror] [--keep-drift]` — see the header
of `extract.mjs` for all options. Outputs land next to the clip:
`.poses.json` (per-frame rig rotations + yaw + confidence), `.move.json`
(distilled table, MODULE_ABI format), `.qa.mp4` (source landmarks vs
retargeted rig, beat ticks, dropped cycles tinted). Math self-checks:
`node tools/mocap/extract.mjs --self-test` (VERIFY line).

Known DOF projection: the rig has no hip joint (thigh is rigid
pelvis→knee), so whole-leg swings project onto knee/ankle — visible in the
QA video by design, not a bug. Clip logging conventions (loop window,
mirror, tempo notes) live in `docs/MOTION_SOURCES.md`.
