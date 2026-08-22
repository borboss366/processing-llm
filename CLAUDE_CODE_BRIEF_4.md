# processing-llm — brief 4

State: director cadence is fixed (1.14 picks/min, bar-aligned commits);
PLL validated on 4 genres; replay is deterministic. The director is good
enough to run a set. Remaining director work is second-order and is moved
AFTER the creature module, which has been "next" for three briefs and has
no frame to show yet.

Ground rules unchanged: frames before frameworks, no new surfaces, live
path stays boring, delete don't attic, STATUS.md rewritten as a snapshot
after each task, evidence committed under `reports/`.

## Task 1 — Memory A/B (Brief 2 Task D, unblocked)

On the post-cadence session (`2026-08-22T19-29-28-829Z`), replay
`--prompt-variant memory` and `--prompt-variant no-memory` with the same
`--seed`. Report per window: profile summary, pick A, pick B, hold A/B.
Summarise: distinct presets, revisits, holds, off-list. State which is
default afterwards and why, in facts from the table only. Commit to
`reports/`. Budget: this is a replay run plus a table — do not touch the
prompt or the detector in this task.

## Task 2 — Creature module (original Task 4; full spec)

`web/app/loaded-modules/creature.js`. A dancing creature with a generated
armature. No graph growth, no LLM, no GRA. This task answers one question:
does it read as a creature?

1. **Shape.** Union of 3–5 circles/capsules as a 2D SDF in a unit box,
   with labelled parts: `body`, `head`, `limb[i]`. Two hardcoded shapes
   selectable by param `shape`: `quadruped` (body capsule, head circle,
   four limb capsules) and `jelly` (dome + 4–6 hanging tentacle capsules).
2. **Tissue.** 300–600 points inside the SDF (jittered grid with SDF
   rejection is enough), edges by k-nearest (k=3–4). Typed arrays:
   `Float32Array` pos/prevPos, `Int32Array` edges, `Float32Array` rest
   lengths = initial distances. Also store each node's part label.
3. **Skeleton.** Per shape, a hardcoded joint list in shape coordinates
   with parent links: quadruped = hip, shoulder, neck, 4 limb tips;
   jelly = bell centre + tentacle roots/tips. Each joint pins its nearest
   3–5 tissue nodes (pinned = position set directly each frame).
4. **Gait.** Per joint: angle offset = `A·sin(2π(beatPhase + phaseOffset))`
   applied as a rotation about the joint's parent. Archetype tables:
   - `trot`: diagonal limbs in phase, other pair offset 0.5; head bob at
     2× beat, small.
   - `pulse`: all tentacles in phase; bell scale `1 + 0.15·sin(2π·beatPhase)`.
   `A` scales with `smoothedLevel` (clamped). Param `archetype` defaults to
   the shape's natural one but both work on both shapes.
   Phase source: `audio.state.beatPhase` when `beatConfidence ≥ 0.4`,
   otherwise a free-running phase at `lastConfidentBpm`. Never stop.
5. **Physics.** Per frame: set pinned nodes to joint targets; Verlet
   integrate the rest with spring constraint relaxation (2–3 iterations),
   damping ~0.9, a weak centering force toward the shape's rest position.
   Must hold 60 fps at 600 nodes in p5. Draw edges with one
   `beginShape(LINES)`/`vertex` batch, not per-edge `line()`.
6. **Render.** Triangles (from any 3 mutually-connected nodes, computed
   once at setup) filled at low alpha; edges on top; node radius by
   distance to nearest joint (bigger near joints); colour: hue from part
   label, brightness from `bands.kick`/`bands.mid`.
7. Implements `triggerable` + `fadeable`; `movable` optional. Params
   exposed via `osc()`: `shape`, `archetype`, `amplitude`, `stiffness`,
   `nodeCount`. Add to `MODULE_ABI.md` as the reference `beatPhase` user.
8. **Capture.** Using the file-audio path with the techno mix, produce a
   screenshot and a 20 s capture (gif or mp4 via the headless harness),
   one per shape. Commit under `reports/2026-xx-xx-creature.md` with a
   one-paragraph description of what it looks like and the measured fps.

Then STOP and ask the user whether it reads as a creature. Do not start
growth, LLM shapes, or GRA. If the answer is no, the first things to try
are the shape (clearer limbs, less body mass) and the armature (more pins,
stiffer springs) — not the tissue.

## Task 3 — Change-detector calibration and hold (deferred director polish)

Only after Task 2 is judged.

The cadence report shows picks land ~52 s apart = min-hold + LLM latency:
the 0.16 threshold is below the mix's natural drift, so the clock, not the
detector, is deciding. And the prompt's opening line ("the audio character
just changed") is a leading question — the model will never hold.

1. Replace the fixed threshold with a z-score of profile distance against
   its running mean/std over the session (warm-up: first 60 s uses the
   fixed 0.16). Three bands: below `zLow` → nothing; between `zLow` and
   `zHigh` → controller-side hold, logged, no LLM call; above `zHigh` →
   LLM call. Defaults zLow=1.0, zHigh=2.0, both UI-exposed.
2. In the prompt, replace "just changed" with the magnitude: "profile
   distance z=X (typical for this set: 1.0)". Keep the hold option.
3. Re-record the same mix, same seek; report picks/min, holds (controller
   and LLM), and distribution of z at each call. Commit to `reports/`.

## Task 4 — Measured preset tags (Brief 2 Task E)

Unchanged spec. Deferred until Tasks 1–3 are done.

## Task 5 — Low-tempo PLL regression (Brief 3 Task 2)

Unchanged spec. Runs whenever the two tracks appear in `music/`; can be
interleaved with any task above at that point.

## Out of scope

Downbeat detection, alternative director models, two-stage director,
code-splitting, auth, GRA/Lenia/evolution, LLM-generated shapes, growth
animation.
