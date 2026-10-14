# processing-llm — brief 17.6: weight (one leg holds, the other is free)

Owner's finding (live, goo+bones): the figure often reads as hanging in
the air and wiggling — nothing in the motion says which leg carries the
body. Both feet get "planted" or neither does; the root floats and the
feet are pulled to the floor under it. Decision: make WEIGHT a first-class
signal. At every moment the body is carried by one foot (or shared
between two), and that one fact drives three things: which foot is pinned
to the floor, where the pelvis sits, and how the body sinks and rises.
This is the animation "weight" principle and the inverted-pendulum gait
model (the body vaults over its stance leg) reduced to its two visible
consequences. Engine stays 2D.

Runs AFTER brief 17.5 has landed and been judged. Touches the extractor
channel emission (same place 17.5 added `depth`) and the root/stance code
(17.5 did not touch these) — a separate worktree is fine; rebase on 17.5.

GENERALITY GUARD: one rule, zero per-move parameters. `weight` exists
for every clip (pelvis and ankles are tracked on every frame) and for
every authored table (it defaults from contacts). Constants live on the
SHAPE (fractions of leg length, one dial), never on a table. Acceptance
runs on ALL captured and authored tables with the same constants.

## Task 1 — The signal: `weight` per frame

1. One channel, `weight ∈ [−1, +1]`: −1 = all on the LEFT foot, +1 = all
   on the RIGHT, 0 = shared. (Body frame; mirror flips its sign.)
2. Extractor rule, applied every frame, then SG-smoothed like any channel:
   - A foot that is OFF the floor (existing lift detection: height above
     the lower foot + velocity) cannot carry weight → weight = ±1 toward
     the other foot.
   - Both feet down → weight = where the pelvis is between the ankles,
     along the visible axis: `clamp((pelvis − midAnkle) / halfSpread, −1, 1)`
     with a dead band and hysteresis so a standing figure gives a steady
     value, not jitter. In front view this is lateral; in profile it is
     fore/aft (front foot vs back foot). Same formula, the axis is the
     view's.
   - Hysteresis on the sign; no value-holding through occlusion (the
     occluded far foot in profile was the stance-lock bug in brief 15 —
     if the far foot is not observed, weight is the near foot's by the
     lift rule, not by image height).
3. Distill keeps `weight` like any channel (extrema exact). Authored
   tables: `weight` per key; when absent, derived from `contacts`
   (only one planted → ±1; both → 0; neither → previous). Do not keep two
   sources of truth: the engine reads `weight`; `contacts` become derived
   from it (|weight| ≥ 0.6 → the free foot is unplanted) and the field is
   kept in tables only for authoring convenience. Self-test: round-trip
   contacts → weight → contacts on every authored table is identity.
4. Self-tests on synthetic frames: (a) one foot raised → weight = ±1 the
   other side; (b) both down, pelvis over left ankle → −1; mid → 0;
   (c) a mirrored clip gives the negated channel; (d) profile sole-to-
   camera foot (17.5 degenerate case) does not break the lift rule.

## Task 2 — The engine: weight layer (root + stance, derived, one dial)

Driven by `weight`, blended through zero with no pop, all amplitudes as
fractions of the shape's leg length `L` (hip→ankle in the sidecar):
1. **Grounding (the floating fix).** The root is SOLVED from the support
   foot, not the feet from the root: the foot with weight toward it is
   pinned at its locked floor point and the root is placed so that leg's
   FK lands exactly there. Free leg follows FK. In shared stance
   (|weight| < 0.3) both are pinned and the root is placed to the
   weighted average. Lift-yield unchanged (a foot leaves the pin when the
   table lifts it). Consequence: support-foot slide is zero by
   construction, not by a spring.
2. **Pelvis over the support foot.** Lateral (front) / fore-aft (profile)
   root shift `shift · L · weight` toward the support foot, default
   `shift = 0.06`. Pelvis tilt: support hip up, free hip down, default
   `tilt = 4° · weight`. Contrapposto, in two numbers.
3. **Spine counter.** Chest leans against the pelvis by `counter · tilt`,
   default `counter = −0.5`, so the head stays over the base. Adds to the
   existing swing/twist channels; does not replace them.
4. **Sink on transfer.** Each weight transfer (sign change, or |Δweight|
   peak above a threshold) adds a downward root impulse
   `sink · L` (default 0.03) that decays over ~0.3 beat, so the body drops
   INTO the landing foot and rises through stance. This retimes the
   existing beat bounce to the step where a table has weight content:
   bounce = max(beat bounce ducked by a factor, transfer sink); with no
   transfers (idle, arm moves) the beat bounce is unchanged.
5. One dial on the puppet: `exaggerateWeight` (0 = layer off = today's
   engine, 1 = defaults, up to 2). The sidecar carries `L` and may
   override the four fractions per shape. With `weight ≡ 0` a figure
   must render identically to today at any dial value.

## Task 3 — Verify + fidelity

- New contract row **weight-ground**: on every table, over a full cycle,
  support-foot slide = 0 px (within the fidelity tolerance) and the root
  never exceeds `L · (1 + ε)` above its support foot's pin (no hanging).
- Sign sanity, printed in the report, same constants everywhere:
  runningman — `weight` alternates ±1 once per step with the step period
  (parity test reuses the octave guard); basic_kick_1 — weight on the
  standing leg throughout the kick, kicking foot never carries weight;
  tstep — weight on the heel-pivot side; idle/groove — |weight| ≤ 0.3 and
  slowly varying (a sway, not a wiggle).
- Add `weight` to the table-vs-engine ladder; the engine-trace heatmap
  gets a weight row; the capture explorer gets a stage overlay drawing
  the weight as a bar between the ankles over the source frame (the
  owner checks it against the video by eye).
- Render stress row: sweep weight −1→+1 at slow/beat/snap; no pops at
  zero crossings, one component, no NaN; transfer sink bounded; stance
  lock never oscillates (count pin changes vs. weight sign changes —
  must be equal).
- Existing fidelity rows unchanged (angles), transition-check still PASS,
  spike count still 0.

## Task 4 — Judgment (owner)

Goo+bones at 3 m, `exaggerateWeight` 0 / 1 / 1.5:
- idle/groove: does it stand ON the floor and sway, instead of hanging
  and wiggling?
- runningman: does each step LAND — body drops into the foot, pelvis
  moves over it?
- basic_kick_1: does the standing leg hold the body while the kick flies?
- tstep: does the shuffle now read as weight rocking side to side?
Record in reports/ with stills at the dial values; USER_GATES item.
Explain-it gate: `docs/explained/weight.md`, owner's paragraph, before
the layer ships ON by default.

## Out of scope

Balance/ZMP simulation; arm counterbalance beyond the spine counter;
3D; per-move tuning (forbidden by the guard); airborne phases (both feet
off — jumps keep today's behaviour; separate finding if it matters);
sign resolution beyond the lift + pelvis rule (if sign errors are common,
that is a separate numbered finding).
