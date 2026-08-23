# Creature locomotion + behaviour — captures (Brief 7)

Module: `web/app/loaded-modules/creature.js` v4. 30 s captures per shape
over Butterchurn, techno mix seeked to span the ~440 s breakdown
(`tools/capture-creature.mjs --seek 425`), with a once-per-second in-page
sample of the behaviour state and stance foot slide.

- `creature4-quadruped.png/.mp4/-diag.png`
- `creature4-jelly.png/.mp4/-diag.png`

## Acceptance report (factual)

- **States observed** (auto mode, real audio): quadruped
  `idle → walk → groove → idle → walk → groove`; jelly
  `walk → idle → groove → walk → groove → walk` (an earlier same-window run
  also hit `hop`). Transitions land on bar wraps; idle engages on the
  breakdown (2 low-energy bars or beatConfidence < 0.4) and walking resumes
  after it.
- **Foot slide during stance**: max 2.78 px across the 30 s quadruped
  capture (~0.6% of body height, imperceptible; residual = the PLL's own
  onset nudges to beatPhase). Jelly n/a (no feet).
- **fps / cost**: module 0.34 ms/frame at ~598 nodes; page ~19–20 fps under
  headless swiftshader (Butterchurn-bound, as always — real GPU runs at
  display rate).

## What it looks like

The quadruped walks across the stage with planted feet, turns with a 0.4 s
mirror squish at the 18% margins, bounces lowest at mid-stance, grooves in
place when the energy z-score rises, and on the breakdown settles into an
idle that still breathes, sways on Perlin weight-shift, and glances around
with occasional quick head reorients. The jelly drifts across the screen
with lazy eased turns (no mirror), pulsing and swimming upward on
contraction — one still catches it mid-drift at the margin with tentacles
trailing. The head is connected flesh now (neck capsule in the core
sampling), the torso has no threshold holes (body sprite-radius floor), and
the palette is two hue families + accent with audio driving brightness only.

## Three real bugs the slide measurement caught

The "zero slide by construction" claim survived contact with reality only
after three fixes, found because the harness measures instead of trusting:

1. Horizontal squash pivots at the root, so it translated planted feet
   (~4 px) → squash is Y-only during walk.
2. The stride cycle originally rode `barPhase`, which jumps when the
   confidence gate switches between PLL and free-run clocks (~11 px) → the
   cycle now rides the continuity-guaranteed `phase`.
3. **Body translation and foot drift ran on different clocks** — `world.x`
   integrated render `dt` (clamped 80 ms) while the stride rode the audio
   clock (clamped 250 ms), so any frame stall desynchronised them
   (12–19 px per stall). Fix: phase-locked odometry — the body advances by
   `Δphase × stride`, the same clock the feet use, so stalls cancel exactly.

## Deviations from the brief

- Squash timing uses `cos(4πφ)` (squash at mid-stance, stretch at
  plant/flight); the inherited `sin` formula puts squash between plants,
  contradicting the brief's own "lowest at mid-stance".
- `creature-state` events reach the session stream via the render window's
  WS relay (module → `window.__ws` → controller writes the event); the
  module can't reach `/session/append` because the session id is
  controller-owned.
- The neck is a core capsule prim (grid-sampled connected flesh) rather
  than ring chains — rings are for thin limbs.

STOP — awaiting judgment.
