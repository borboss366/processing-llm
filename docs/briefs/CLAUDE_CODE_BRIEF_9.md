# processing-llm — brief 9: move tables (with two prerequisite fixes)

Brief 8.2 verdict: hiccup forensics accepted; residuals identified as (a)
PLL acquisition snaps, (b) metaball welding when an arm crosses the body.
Both are fixed HERE because the move tables (arm waves, T-steps) put arms
across the torso every bar and will amplify (b) badly.

## Task 0a — Union-by-max density groups (welding fix)

Accumulate density in separate channels by body group: R = torso+head+legs,
G = armL, B = armR (bone splats route to their group's channel). Shade on
`d = max(R, G, B)`; additive accumulation remains WITHIN a channel (smooth
shoulder self-union), max ACROSS channels (a crossing arm slides over the
body as a surface — no density stacking, no core/spec blowout, no normal
smear). Colour buffer: accumulate premultiplied as today, normalise by
summed density; if hue smearing at crossings is visible, weight colour by
the winning channel (report which was needed).

Acceptance: a scripted pose sweep (arm dragged across the torso over 4 s)
captured before/after; after shows no brightness inflation or weld-flash
at the crossing — measured max shaded luminance in the overlap window
within 5% of the no-overlap baseline. Stills in the report.

## Task 0b — Acquisition snap smoothing + entry gating

1. Route PLL ACQUISITION phase jumps through the same capped
   debt/catch-up mechanism as nudges (no bypass path to raw phase).
   The move-local clock must never see a per-frame delta above its cap,
   including the free-run↔locked switch.
2. The creature's `entering` state waits for `beatConfidence ≥ 0.5`
   sustained 1 s (param); until then it holds the fade.
Acceptance: file-writing captures show 0 spike flags INCLUDING the first
seconds; the dPhase-0.46 acquisition case reproduced in the harness and
shown spread over ≥ 1 beat.

## Task 1 — Move table format + playback

1. Format (document in MODULE_ABI.md as the authoring/extractor target):
   `moves/<name>.json`:
   { name, beatsPerLoop, keys: [ { phase, joints: {jointName: {dx, dy,
   rot}}, contacts: [jointName...], ease } ] }
   Offsets are in shape space relative to the neutral pose; `contacts`
   lists feet planted during the segment starting at this key; `ease`
   in {smooth, snap, linear} per key.
2. Playback: piecewise interpolation over move-local phase; layered UNDER
   the existing bounce/lean/Perlin/simmer (they stay on, scaled by a
   per-move `overlay` factor); stance lock honours `contacts`.
3. The FSM states map to moves (`groove` becomes a table, not code);
   `move` param forces one; switching uses the existing blend layer.

## Task 2 — Three moves

Port groove bounce to a table, then author from the user's quarter-speed
notes: `tstep` (Melbourne shuffle T-step: weight on heel pivots,
alternating side kicks) and `armwave` (wave travelling shoulder→wrist,
one bar per direction). USER INPUT REQUIRED: the notes. If not yet
provided, implement placeholders from tutorial-standard timing, name them
`*-placeholder`, and flag in the report that authored timing is pending.

## Task 3 — Capture gate

30 s per biped: FSM cycling through the three moves across a breakdown,
palette rule on, verify green (components, spikes, bone lengths, welding
sweep). STOP for GPU judgment.

Out of scope: mocap extractor, audience pipeline, scene schema, spider.
