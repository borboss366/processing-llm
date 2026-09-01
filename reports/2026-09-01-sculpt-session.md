# 2026-09-01 — brief 15 Section D: the sculpting session (R1–R4)

Live session over Sandstorm (136 BPM, grid tier), the user directing,
agent translating to keys — including a NEW workflow: the user draws
pose sequences into `resources/` and the agent reads the frames into
table keys (armsup.png, armsup2.png; validated both directions — the
second sheet fixed what words couldn't convey).

## Move verdicts (all remain -placeholder by the user's R4 call)

- **tstep — ✓ "resembles a t-step"** after 3 iterations: v3 = crossing
  kicks + eighth-note motion + bar-rate side swaps at bpl 4 (tempo
  converged from both directions), heel-pops softened 0.55→0.22 after
  the "palsy" verdict, and MOVE-DRIVEN TRAVEL (new engine channel, see
  below) so it actually glides side to side. FINDING: the true t-step
  fan is a floor-plane rotation (toes to viewer, heel sweeping behind)
  — a depth axis the 2D rig lacks.
- **armwave — ✓ "more or less"**: shrug channel added (lift-only dy on
  the shoulders riding the wave phase — the missing scapular lift that
  made the neck read long), shoulder base zeroed per the user (the
  brief's "raise the base toward chest height" dragged the silhouette
  down; natural hang + ripple + shrug wins).
- **sidepunch — ✓ "more or less"** after 3 iterations: horizontal jab
  (shoulder 0.95 per the calibrated sign map — 1.55 aimed diagonally
  up), resting arm HANGS (the chambered fold read as anatomy it
  shouldn't).
- **armpump — PARKED** (out of rotation): the arm-raise cannot read
  without the projection of humeral AXIAL ROTATION — the elbow's
  apparent bend flips sides as the arm rises, and neither sign of a 2D
  bend fakes it (tried both; "even more chicken"). The user's call:
  next brief.
- **elbowcircles — ✓ "okayish"**.

## New engine capability: move-driven travel

Tables gain a per-key `travel` channel (shape-units/beat, signed,
interpolated, crossfade-blended): integrates into world.x outside walk,
clamped to stage bounds, inert in manual scrub. ABI documented. Built
mid-session on the user's verdict that a t-step must travel; unlocks
the library's running man / glide / slide.

## R gates

- **R1 ✓ performer** ("looks good") + feature request queued:
  music-structure triggers — a drop (Darude) should force an immediate
  move re-pick / energy burst instead of waiting out moveHoldBars.
  Pairs with A5's unimplemented fillKey.
- **R2 ✓ swingPct = 0.2** (was 0.08) — baked as the default.
- **R3 ✓** accent + phrase lift: present, not cartoonish.
- **R4 — the decision**: "postpone all other shapes until we do
  everything with the human properly." Spider and further shapes WAIT;
  the human workstream is next. No tables promoted (all stay
  -placeholder pending that work).

## Research topics for the reviewer (the user's framing)

1. **Axial-rotation / pseudo-depth channel** — one mechanism under
   three findings: foot fan (floor-plane heel sweep), arm-raise elbow
   flip (humeral rotation in projection), the original convex-elbow
   note. This is THE representational wall of the 2D rig.
2. **Anatomy priors** — rotLimits are static ranges, but anatomy is
   pose-DEPENDENT coupling (raise forces axial turn; elevation drags a
   shrug; the shrug had to be hand-added tonight). Rules vs data — and
   Route B's extracted motion carries the couplings for free, while
   every hand-sculpted anatomy error tonight had to be found by eye.
3. **Music-structure reactivity** (drops → immediate response).

## Verification

fk-check PASS on the final tables (kick travel 260 px, heel pivot
12.1 px / toe 0.0, sidepunch 0.1% of authored, orbit 98.8 px, spikes
0); asserts updated to the sculpted values as they changed — the
authored numbers are the spec, the user's eye is the judge.
