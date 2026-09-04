# processing-llm — brief 16: Route B pilot (capture → tables + anatomy)

Trigger: the brief-15 gate found the naturalness ceiling — the system
knows no anatomy, and hand-authored tables encode joint couplings only
where intuition supplied them. Capture is the cheapest anatomy model:
one dancer's video contains the correlations empirically. This pilot
builds the offline pipeline end to end for ONE move, plus the corpus
statistics that let captured data audit authored tables. Everything
offline in tools/; nothing in the live path. CLAUDE.md rules.

## Task 1 — Extraction pipeline (`tools/mocap/`)

`extract.mjs <video> [--audio-bpm N | --grid <sidecar>]`:
1. Pose per frame via MediaPipe (holistic/pose landmarker; node or
   python worker — implementer's choice, pinned versions).
2. **One Euro filter on landmark positions** (per landmark, per axis;
   minCutoff/beta as params with dance-tuned defaults). Filter
   landmarks, THEN derive rotations — never filter angles (wrap).
3. De-yaw: estimate pelvis/shoulder yaw per frame, rotate the pose to
   frontal, project orthographically. Keep the yaw trace as a channel
   in the output (future yaw-fake data; unused now).
4. Retarget to ROTATIONS: bone directions relative to parent →
   signed 2D angles for the 15-joint rig (mapping table for MediaPipe
   landmarks → our joints, incl. heel/toe from foot landmarks).
   Normalize bone lengths to the rig's; positions are derived, never
   copied.
5. Timing, three routes (tutorial audio is often useless — talking,
   half-tempo demos): (a) --grid / --audio-bpm when the clip's audio
   is musical; (b) MOTION-DERIVED phase (default for tutorials):
   autocorrelate the summed joint-velocity signal inside the logged
   loop window and phase-lock the loop to its own periodicity; (c)
   --loop-window from MOTION_SOURCES.md always bounds the analysis.
   Also: --mirror flag (instructors mirror for teaching; the QA video
   makes a wrong guess obvious).
6. Outputs per run: `<clip>.poses.json` (per-frame rig rotations +
   yaw + confidence), a distilled `<clip>.move.json` — cycle-averaged
   loop in the STANDARD move-table format (keys at extrema + inflection
   points, contacts from ankle-height minima + low velocity; before
   averaging, phase-normalize cycles and DROP OUTLIERS by median
   distance to the mean cycle — instructors demo slow-then-fast, and
   averaging those smears timing; log dropped cycles, show
   kept-vs-dropped in the QA video) — and a
   side-by-side STICKMAN QA video: source landmarks vs retargeted rig
   skeleton, beat ticks burned in.

## Task 2 — Pilot move: THE T-STEP, depth-first

Sourcing (user's side, batched once): the user picks ONE tutorial
instructor (single body = coherent style + coherent anatomy stats) and
logs 5–8 move Shorts into MOTION_SOURCES.md — URL, move name, clean
loop window ("0:12–0:22"), mirror yes/no, tempo note if any. Clips are
yt-dlp'd by the user into the gitignored corpus dir (the agent
receives FILES, never URLs). Shorts hazards checked at logging time:
vertical crop cutting feet (feet matter here), mid-window camera cuts.

Processing is DEPTH-FIRST: the T-step clip goes through the full
pipeline and is taken to DONE before any other move. Done-bar, fixed
now so "really work" cannot inflate: legible as a T-step from 3 m
(USER_GATES question), moves-x-shapes green, in the groove rotation
behind a weight, one workbench exaggeration pass (wire mode),
user-judged against the QA video — "recognizably the same move." NOT
the bar: indistinguishable from the tutorial. The captured table
replaces tstep-placeholder on the user's word.

Move #2 (only after the T-step closes) comes from an UNCOVERED family
— body roll suggested (probes torso articulation and the anatomy
correlations) — not a second footwork move. Report per-move wall time:
move #1 pays the pipeline tax; move #2's cost is the style-pack
economics number.

## Task 3 — Anatomy statistics + lint

From the pilot corpus (all extracted poses.json files):
1. Per-joint realized-range histograms (P1–P99), and pairwise joint-
   angle correlation stats for the coupled pairs that matter (shoulder↔
   spine lean, hipL↔hipR, shoulder↔elbow, pelvis↔chest counter-
   rotation).
2. `tools/anatomy-lint.mjs` + verify row: audits AUTHORED move tables
   against the corpus — flags keys whose joint combinations fall
   outside corpus support (report-only this brief; no auto-fail until
   the corpus has ≥3 clips). Report the lint's verdict on the current
   move library — the interesting output is which hand-authored keys
   the data calls unnatural.
3. Document corpus provenance in MOTION_SOURCES.md (private use;
   provenance notes if this ever feeds a talk).

## Task 4 — Acceptance

- Pipeline reruns deterministically (same clip → same tables).
- QA video committed for the pilot clip; retargeted skeleton visually
  tracks the source through the loop (the user judges).
- fk-check + moves-x-shapes green on the captured table; spike metric
  0 in rotation; anatomy-lint report committed.
- USER_GATES gains: "captured T-step: recognizably the instructor's
  move, legible at 3 m, MORE natural than the authored placeholder it
  replaces?" plus the economics note after move #2 (per-move wall time
  = the style-pack decision number).

## Out of scope

Style packs (decision after pilot economics), live capture, yaw-fake
rendering (queued behind this), depth buffer/occlusion, toward-camera
motion, spider (17), field scene (18).
