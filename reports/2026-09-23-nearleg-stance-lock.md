# A7 stage bug: near-leg lift lost — stance lock obeying wrong contacts

User observation (wire mode): only one leg moves in the profile running
man; the other leg's lift is lost. Diagnosed per the user's decision
tree; verdict is (b), with a capture-asymmetry finding on top.

## Diagnosis

Table contacts dump: **footL flagged planted in all 16 keys** —
including its entire swing half — while footR was correctly released
for its swing. Engine scrub comparison (panel 1 = table expectation,
panel 2 = engine joints): the RELEASED leg tracks the table exactly
(hipR −0.44/−0.70, kneeR 1.22, foot lifts); the LOCKED leg's hip theta
is applied but knee/ankle are zeroed and the foot never leaves the
ground — the stance lock, correctly obeying wrong contacts. Verdict (b).

Root cause of the wrong contacts: distill derived them from IMAGE-space
foot height; rig footL is fed (via --mirror) by the person's occluded
far foot at −98° yaw, whose image-height range never left the planted
band.

Why moves-x-shapes didn't flag it (user question, honest answer): the
matrix asserts spikes 0 / components 1 / NaN-free / view correct — a
limb held perfectly still is STABLE by all of those measures. Motion-
amplitude assertions exist only in fk-check for authored front moves.
Gap noted for the reviewer: a per-limb "does it move like the table
says" row would have caught this.

## Fixes

1. **Contact derivation** (extract/distill): contacts now come from the
   RIG'S OWN FK of the averaged loop (the thetas demonstrably carry the
   lift — QA stickman), not the image channel. Planted = within a band
   of the cycle's lowest point AND slow horizontally; band is
   range-relative (25% of the foot's own swing range) with a pivot-foot
   case (range < 0.04 u → all planted, preserving t-step semantics).
   Per-side band/range logged per run.
2. **Stance-lock yield** (engine): when the table pose's pre-lock FK
   lifts a contact-flagged foot > 0.025 u above its rest, the lock
   target drops to 0 — a contacts flag can be wrong or a key can plant
   one frame and lift the next; the pose is authoritative.

Result (scrub verification): contacts alternate per side; the engine
tracks the table faithfully on BOTH legs at every scrubbed phase.
view-switch-check re-run: PASS (switches ≈2 s, 0 spikes).

## Remaining finding — capture asymmetry (data, not engine)

The fixed table itself holds kneeL peak 0.35 rad vs kneeR 1.49, hipL
−0.30 vs hipR −0.70: the occluded leg's captured swing is ~25–50% of
the near leg's. On stage the far-leg lift now happens but reads WEAK —
that is the source data, not suppression. Options for the user's call
at the gate: (a) accept (real capture honesty), (b) symmetrize the
loop from the better-tracked half (stitch --mirror machinery exists —
one command to try), (c) source a cleaner profile clip. Not decided
unilaterally — this is an aesthetics/authenticity trade.

Stage re-armed in wire mode with the fixed table.

## Resolution (user decision: option b)

`stitch --symmetrize L|R|auto` added (single-table mode, profile tables
only — a front table would need the negating mirror and the tool
refuses rather than guess). Auto picked the R half (knee+hip amp R 2.16
vs L 0.63), phase-windowed at the R-step, rebuilt the loop as
strongHalf + side-swapped strongHalf WITHOUT negation (profile
semantics: both legs swing with the same screen sign — the per-side
sign is already baked in at retarget).

Result: kneeL peak 0.35 → 1.488 == kneeR; scrub verification shows
exact mirror symmetry on the rig (hip −0.70 / knee ~1.28 per side at
its phase, both feet lifting); contacts alternate; view-switch-check
re-run PASS. runningman-captured + -x rebuilt symmetrized; the FRONT
table stays capture-honest (unsymmetrized) — revisit only if the user
picks front as the rotation default at the gate.
