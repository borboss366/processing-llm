# processing-llm — brief 18.1: pluggable estimators (MediaPipe vs RTMPose)

Finding (brief 18 explorer, stage 1): MediaPipe's 2D image landmarks
are trustworthy; its 3D world head is not (a full profile stride
collapses in the world skeleton). Two consequences: (a) depth must be
derived from 2D, never taken from a 3D head; (b) the 2D estimator itself
is a replaceable front end, and better ones exist. This brief makes the
estimator pluggable, adds RTMPose/DWPose whole-body via rtmlib, derives
twist/yaw from 2D foreshortening, and turns the explorer into the
comparison tool. Runs BEFORE brief 19 (the ladder needs a fixed R0).

## Task 1 — Landmark schema + pluggable worker

1. Define the pipeline's landmark schema once (`lib/landmarks.mjs`):
   named joints the rig needs (head, neck, shoulders, elbows, wrists,
   hips, knees, ankles, heel, big toe, small toe per foot), each with
   (x, y, score). No estimator-specific names leak downstream; retarget,
   measured rest, cycles, distill consume ONLY this schema.
2. `pose_worker.py --estimator mediapipe|rtmpose` emitting the schema:
   - mediapipe: current path (heel + foot_index → heel/bigtoe; smalltoe
     = null), visibility → score. World landmarks NO LONGER emitted as
     an input to anything (kept in poses.json under `debug.world` for
     the explorer only).
   - rtmpose: rtmlib `Wholebody` (mode selectable: lightweight /
     balanced / performance; onnxruntime, CoreML on Apple Silicon),
     COCO-WholeBody 133 → schema mapping incl. 3 foot keypoints;
     keypoint scores → score. Reuse the worker's fixed-crop + flip-TTA
     path (verify flip-TTA helps here too; measure jitter as before).
   - `--estimator-model` for the concrete model preset; pinned versions;
     model download cached under corpus/.models (gitignored); setup.sh
     installs rtmlib + onnxruntime.
3. `tools/mocap/setup.sh --check` prints which estimators are runnable.

## Task 2 — Depth from 2D (replaces the 3D-derived channels)

1. `twist` per bone = acos(clamp(projectedLength / restLength)) using
   the MEASURED rest lengths from stage 4; `pelvisYaw`/`chestYaw` from
   hip-width and shoulder-width ratios vs rest.
2. Sign: temporal continuity first (no sign flips between adjacent
   frames), keypoint score asymmetry second (the side going away
   scores lower), hold last sign when ambiguous. Log every sign
   decision.
3. Explorer stage 3 shows BOTH twist estimates (foreshortening vs the
   old world-derived) as overlaid traces per bone; on the profile
   running man the foreshortening twist on the legs should sit near 0
   while the world twist does not — that plot is the acceptance.
4. yaw/view auto-select (17 A5) reads the foreshortening yaw.

## Task 3 — Explorer as the comparison tool

1. `extract.mjs --estimator A,B` runs both and writes ONE explorer with
   a per-stage estimator toggle (A / B / overlay). Stage 1 shows both
   skeletons on the frame with score colors; stage 2 shows jitter per
   estimator; stage 5 shows round-trip per estimator; stage 8 shows
   both distilled tables.
2. A summary card at the top: per estimator — mean keypoint score per
   limb (far leg called out), jitter before/after smoothing, round-trip
   worst-bone, feet keypoints available, wall time per frame.
3. The judgment view's variant dropdown gains the estimator dimension
   for captured moves (tables carry `estimator` in metadata).

## Task 4 — Acceptance (on the three current clips)

- Both estimators run end-to-end through the unchanged downstream
  stages; self-test extended with a schema round-trip per estimator.
- Comparison cards committed to reports/ for running man (far-leg
  score: MediaPipe 25–50% baseline vs RTMPose), T-step (feet), body
  roll. The user picks the default from the cards + explorer; the
  choice is recorded in MOTION_SOURCES/PIPELINE.md, and `--estimator`
  defaults to it.
- Foreshortening-twist acceptance plot (Task 2.3) in the report.
- USER_GATES: "estimator default chosen; far leg now usable?"

## Out of scope

3D lifters (RTMW3D, WHAM, GVHMR) — same monocular-guess class or too
heavy; the ladder (brief 19) — starts after the default is chosen;
any downstream stage change beyond consuming the schema.
