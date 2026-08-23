# processing-llm — brief 8.2 (patch): debris, palette, hiccups

Three items closing out Brief 8 before the user's GPU gate judgment.

## Task 1 — Identify and kill the debris

`reports/creature4-biped-2.png` shows a wiry blue tangle left of the
torso that is not Butterchurn fluid. Find what draws it (candidates: diag
wire layer bleeding into the production path, the dropped orphan
component being rendered somewhere, stray sprite batch state). One-line
answer in the report plus the fix. Acceptance: a capture with the same
seed/seek shows clean background around the figure.

## Task 2 — Palette rule: two hues + accent

Enforce: a creature renders with exactly `primary` (body + limbs; ramp
darkens/saturates toward the edge), `secondary` (core brightening ONLY —
not a separate region hue), `accent` (head + rim tint). Part→hue comes
from the shape json palette; never round-robin per part. Update both
biped sidecars and the quadruped/jelly to comply. Diag capture renders
the three swatches in a corner. Acceptance: stills show a two-hue figure;
swatches match the json.

## Task 3 — Transition smoothness (the "hiccup")

Symptom: a visible pose snap at a regular interval.

1. Diagnose first, from the state log + a per-frame joint-target velocity
   trace over 30 s: (a) unblended pose jump at FSM transitions, (b) FSM
   re-entering the SAME state each bar and resetting phases/latches,
   (c) PLL phase snaps propagating into move time. Name the culprit(s) in
   the report with the trace.
2. Fix:
   - Pose blending layer: the module holds current joint targets; on any
     move/state change, blend previous pose → new move stream over
     `blendBeats` (default 0.75, smoothstep) while phase runs on.
   - Same-state re-entry is a strict no-op (assert: no oscillator phase
     reset, no parameter re-latch).
   - Moves consume a CONTINUOUS move-local phase that accumulates from
     beatPhase deltas, so PLL nudges spread over a beat instead of
     stepping (cap per-frame delta; catch up smoothly).
3. Metric, permanent in `capture-creature.mjs --verify`: per-frame joint-
   target speed; flag spikes > 3× the rolling median occurring OUTSIDE a
   declared transition window or hop takeoff. Acceptance: zero flags over
   30 s with the full FSM cycling, and the report includes the
   before/after spike counts.

Then STOP: fresh 30 s captures per shape for the Brief 8 gate (lit body,
two-hue palette, no debris, no hiccups) — user judges on a real GPU.

Out of scope: move tables (Brief 9), audience pipeline, everything else.
