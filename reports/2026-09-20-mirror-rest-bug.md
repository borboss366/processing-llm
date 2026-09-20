# Screenshot analysis follow-up: root-frame hypothesis tested, real bug
# found — mirror mode mismatched rig rest sides

User observation: retargeted rig shows large coherent wrong angles on
all chains (legs splayed, arm raised) while landmarks track correctly.
Hypothesis: pelvis/chest roots derived from lateral vectors collapse in
profile and children inherit noise.

## (1) The measurement (tools/mocap/root-diag.mjs)

Per-frame lateral lengths + root angles, running man (profile,
as-filmed) vs T-step (frontal):

| metric | running man (profile) | T-step (frontal) |
|---|---|---|
| lateral hip len / spine | median 0.08 (p10 0.02) — collapsed | 0.41 — healthy |
| lateral shoulder len / spine | 0.07 (p10 0.03) | 0.63 |
| chest angle, LATERAL-derived (hypothetical) | sd 150° — pure noise | sd 3.2° |
| chest angle, SPINE-derived (actual code path) | **sd 1.7° — stable** | sd 4.3° |

Verdict on the hypothesis: half right. The lateral vectors DO collapse
in profile exactly as predicted — but the retargeter never uses them
for orientation. Chest/neck are already spine-referenced
(hipMid→shoulderMid); hips are root-level (no parent frame); lateral
vectors feed only yaw estimation (unused in as-filmed) and midpoints.
So (2) "reference roots on the spine axis" was already the
implementation, and no root noise-inheritance path existed.

## The real bug — caught by root-diag's round-trip check

Rendered stickman bone angles vs observed segment angles on real
frames: worst error **132° (arm bone)** with --mirror. Cause: in the
defs template the REST angles were hardcoded to one side
(`rest('shoulderL','elbowL')`) while the assigned joint name uses the
template side. With --mirror the names flip but the rests didn't:
theta = obs(personL) − rest(rigL), rendered against rig-R's rest —
every mirrored chain coherently off by rest(L)−rest(R), which reads as
splayed legs / raised arm while landmarks stay perfect. Frontal
mirrored clips suffered it too, milder (near-symmetric rests);
mirror-off runs were never affected — the user's experiment (3) was
pointed at exactly the discriminating variable.

Fix: rests now reference the assigned joint's own chain
(`rest(shoulder${pl}, elbow${pl})` etc). Self-test gains a MIRROR
round-trip (rendered rig-R bones must equal observed person-L angles):
4.4e-16 rad after the fix. Real-data round-trip: 132° → 10.6°, and the
residual sits on pelvis→chest — the documented single-bend chest DOF
projection, not an error.

## (2)+(3) QA re-renders (pipeline experiment, nothing staged)

- Fixed + mirror ON (corpus/runningman-asfilmed.qa.mp4): stickman now
  matches the dancer — narrow profile stance, natural leg scissor,
  running-man arm pump at the sides. The splay/raised-arm artifact is
  gone.
- Fixed + mirror OFF (corpus/runningman-asfilmed-nomirror.qa.mp4):
  same silhouette with near/far sides relabeled; for a profile clip the
  sides overlap on screen, so the visual difference is which rig side
  leads each kick.

## Affected artifacts

`runningman-captured`/`-x` in web/app/moves were built PRE-fix with
--mirror — they carry the rest-mismatch. USER_GATES item 3 judgment
should wait for a rebuild (1 command each); flagged there. All T-step
tables are clean (mirror: no). Anatomy stats (Task 3) must use
re-extracted poses.
