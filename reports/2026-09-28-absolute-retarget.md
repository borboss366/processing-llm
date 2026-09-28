# Absolute retarget — habitual pose is signal (root cause fix, 2026-09-28)

**Root cause (reviewer's):** collapsed arms / paralytic legs on stage.
The measured-rest calibration (2026-09-21) subtracted the dancer's
HABITUAL pose as their "neutral" — a dancer who holds his arms pumped
forward the whole clip had exactly that subtracted, deviations ≈ 0,
and the rig rendered its own rest. The running man's diagnostic now
quantifies what was being erased: **elbows −1.42 / −1.27 rad, knees
+0.26 / +0.30, neck +0.37** from the rig rest — the entire arm
carriage and crouch of the move.

## The new contract

`theta = sideSign × wrap(observedAbs − rigRestAbs(view))` — angles
measured against GRAVITY on both sides.

- **Reference = the view shape's own rest geometry**: profile clips
  retarget against `biped-profile.json` (arms hang 93°, legs down
  87–92°, feet flat 11° toward +x) — the exact body the table plays
  on; front clips against the front sidecar as before 09-21. The
  applyView override constants are gone; `buildRig(viewSidecar)` IS
  the reference.
- **Facing canonicalization** (mirror, never rotation): profile clips
  facing left are x-flipped so the dancer faces +x like the shape.
  On a same-facing shape `sideSigns` resolves to identity by
  construction — the far-side-flip machinery self-neutralizes.
- **Measured rest survives as a DIAGNOSTIC** (explorer stage 4 now
  shows habitual-pose stickman vs rig-rest stickman, and the Δ column
  = what the old scheme silently deleted) and for bone LENGTHS
  (foreshortening rest lengths, unchanged). It is never subtracted.
- One geometry per view end-to-end: retarget reference, FK contacts,
  QA stickman, explorer — all `rigV`.

## Self-tests (all in `--self-test`, VERIFY:PASS)

- **Habitual pose survives (the anti-test):** a synthetic clip whose
  mean pose is arms-FORWARD renders the arm at 0.00° absolute
  (forward), mean shoulder theta −1.62 rad — NOT the rig's 93° rest.
  This is the exact case measured-rest failed.
- Profile knee-lift both sides: rendered absolute bone angle ==
  observed absolute angle to 0.00° (the absolute contract makes the
  round-trip an identity).
- Profile feet vs reference: forward feet read |ankle| 0.16 rad on
  the profile shape (front-shape control still shows the ~π foot).
- Measured rest as diagnostic: reports observed angles to 1e-9, no
  fallbacks.
- Matched-view identity + reinterpretation cases unchanged, pass.

## Evidence (running man, rtmpose)

- QA video gains an **OVERLAY panel** (source + rig superimposed,
  hip-shoulder normalized): the rig now holds arms forward-bent and
  crouches with the dancer, near bone-for-bone. `corpus/
  runningman.qa.mp4`.
- rotLimit clamps: **0 hits** across 82 frames even with habitual
  offsets included.
- Explorer stage 4 = habitual vs rig-rest stickmen + Δ table; stage 5
  columns = observed abs / reference abs / theta / round-trip.
- Cycles kept 3 (was 4) and net drift −0.0324 u/loop (was −0.0001) —
  period detection sees the same motion but the averaged loop
  regrouped; watch on stage.

## Deviations / watch items

- Front-view feet: observation is heel→toe but the front shape's foot
  rest is ankle→foot geometry (±164°/16° splay) — under absolute
  retarget this convention gap can park a constant on front-view
  ankles (T-step). T-step is PARKED (blocked on depth), so recorded
  here as the known caveat for the next front-view foot judgment; the
  foot gate still holds foreshortened frames.
- The reinterpreted front table now carries habitual bend into twist
  (elbow ~−1.3 → strong foreshortening in front view) — semantically
  right (a bent-forward elbow IS foreshortened from the front), worth
  an explicit look at the A7 front variant.
- Stage tables rebuilt from the new extraction; the old tables'
  amplitudes were deviations-only and are superseded.
