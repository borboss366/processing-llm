# Face, shadow, grounding — Brief 8, Task 3

## Eyes

Drawn from the shape sidecar's `eyes` array (head-relative circles; both
bipeds define two), on the p5 canvas above the shade layer. Anchored to the
per-frame centroid of head-labelled tissue — they ride the flesh through
bob, squash, and head-look, rotated by 0.6× the neck joint's angle. A
single default eye is used if a shape file omits the field.

- **Blink**: every 4–7 s (randomised), ~130 ms vertical collapse to 12%
  height.
- **Saccade**: when the Perlin head-look reorients quickly (|Δ| > 0.12 rad
  in a frame), the eyes jump ~0.014 units in the look direction and decay
  back over ~110 ms.
- **Walk offset**: eyes shift 0.014 toward the walking direction (mapped
  through the mirror transform, so it always leads the motion).

## Contact shadow

A soft radial-gradient ellipse on a dedicated 2D canvas inserted UNDER the
shade layer (per the brief: under the body, not through the density field).
Width tracks the ground-feet spread (+14% body width); centre tracks the
feet centroid; squash widens and darkens it (`×(1+3·squash)`); opacity
drops 70% at hop apex; body-width fallback for no-feet shapes. Cleared on
lifecycle-invisible and removed in `teardown()` with the other layers.

## Verified (`tools/capture-creature.mjs`, techno mix @425 s)

`creature4-biped-1.png`: the walking biped now has a face — two dark eyes
on the pink head, reading as a character rather than a shape. States
groove → walk in the probe window; module 1.13 ms/frame at 579 nodes
(+0.25 ms for shadow + eyes vs Task 2); shade pass 0.74 ms wall; stance
slide 0.02 px. The shadow is present but subtle against bright Butterchurn
regions — judged properly at the Task 4 gate on a real display.

## npm run verify

```
module-load               PASS    modules=8
creature-capture          PASS    shapes=1 seconds=6   # biped-1, ≤6 ms, slide ≤5 px
```
(fast tier otherwise unchanged; full tier last green 2026-08-23)
