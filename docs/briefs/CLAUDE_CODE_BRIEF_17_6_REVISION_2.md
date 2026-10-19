# processing-llm — brief 17.6 revision 2: contacts ≠ weight (reviewer's own error)

The T2 revision measured the consequences of the 2026-10-19 directives
and they expose an error in the ORIGINAL brief, not in the implementation:
"contacts derived from weight" conflated two different facts. Fix the
model; then Task 3.

## The correction

- **contact** = the foot TOUCHES the floor (extractor: lift detection,
  already measured per frame).
- **weight** = the foot CARRIES load (extractor: pelvis between ankles,
  already measured).
A foot can touch with no load (T-step free foot; the running man's
sliding trailing foot). Both channels are kept in the table; neither is
derived from the other. Authored tables: `contacts` as today; `weight`
defaults from contacts only when absent (one planted → ±1, both → 0).

## Grounding (replaces T2 step 5; one rule, no clamp, no knee invented)

With DRAWN bone lengths (physically faithful: a leg drawn shorter is a
leg leaning out of the plane, and the body is lower):
1. The support foot (by weight share, shared stance = weighted average,
   smoothstep as now) is placed on the floor.
2. If any TOUCHING foot would be below the floor, the body is raised
   until the lowest touching foot is on it. Touching feet never
   penetrate, by construction.
3. The resulting hang of the other touching foot is PRINTED per table in
   weight-probe as `leg-depth inconsistency (L)` — it measures how much
   the two legs' depth cues disagree. It is not corrected here.
4. A LIFTED foot (not in contacts) goes where the table says. If it ends
   below the floor, that is a capture error: printed, not clamped.
The knee re-solve for the pelvis SHIFT stays (inherent in moving the
pelvis over a pinned foot). Rest-length grounding from revision 1 is
reverted.

## Identity at weight ≡ 0 (measured row, no per-table gate)

Weight-free tables (procedural `none`, authored `groove`) at dial 1 and
2: with both feet touching and no load, grounding cancels the beat
bounce and the bounce-add-back restores it — layer displacement must be
≤ probe noise. If it is not, the report states the mechanism; do not
re-add `wSupport`/`wTransfer`.

## Then Task 3 as specified in STATUS

weight-ground row (touching-foot penetration = 0 on every table, support
hang ≤ tolerance, lifted-foot-under-floor printed), transfer/sign-sanity
rows, stress row, and engine-fidelity AT DIAL 1 with the layer's root
transform factored out — angles match the table except the support knee,
reported as a number.

## Numbered finding (not in this brief)

Leg depth disagrees between legs on in-plane moves (front running man:
right leg up to 0.2, left ≈ 0; kick ankleL 0.3–0.4 constant; elbowL sign
held on 118/118 frames). Magnitude is honest, SIGN resolution is not,
and through grounding a noise-level leg depth now has mechanical
consequences. Owner's check: stage-6 foreshortening overlay on the
running man — does the right shin's projection really shrink in the
loop? Fix is sign resolution at the source, when its turn comes.

## Operational

Roster `exclude` needs a server restart to take effect — say so in
STATUS's run paragraph.
