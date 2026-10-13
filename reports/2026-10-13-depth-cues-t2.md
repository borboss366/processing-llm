# Brief 17.5 Task 2 — depth cues (render-only)

All four cues are driven by the table's `depth` channel; the constants
live on the SHAPE (`depthCues` in biped-1 / biped-2 / biped-profile /
biped-front, defaults in creature.js), never on a table. The dial is the
`exaggerateDepth` param (puppet auto-enumerates it): 0 off · 1 shape
defaults · up to 2.

1. **Size** — per bone: radius × max(0.8, 1 + gain·depth·dial). Gains:
   feet/hands 0.6, shins/forearms 0.35, thighs/upper arms 0.2,
   torso/head 0. Applied to bone splats and to every limb node (each
   node rides the nearest bone of its part at rest).
2. **Draw length** — FK child offset × (1 − |depth|·drawK·dial), floor
   0.25 (B's foreshortening, kept; both signs shorten). The bone-length
   health metric expects the same factor.
3. **Brightness** — per bone tint ∝ brightness·depth·dial (0.35):
   toward adds a white wash to the colour field, away a black one;
   density is untouched, so the shape doesn't change.
4. **Overlap** — arm state front/neutral/behind at |depth| > 0.3 with
   a 0.1 hysteresis band (flip counts kept in `state.ovlFlips` for the
   Task 3 stress row). Front: the arm's silhouette edge is drawn across
   the torso; behind: the arm is hidden wherever the torso is solid.

**Standing = unchanged (verified):** on a table with no depth (authored
tstep) the size deviation is exactly 0 and the tint stays below the draw
threshold at dials 0, 1 and 2, so nothing on screen differs.
**Kick, dials 0 / 1 / 1.5** (`2026-10-13-depth-cues-kick-dials.png`,
goo-bones, phase 0.156): size up to ×1.20 / ×1.30, left arm switches to
front (outline across the torso). The averaged kick only reaches depth
0.33 — the multi-kick window problem, not the cues.
**Health:** module 2.1 ms/frame; engine-fidelity, moves-x-shapes,
fk-check, transition-check all PASS.

## Deviations (stated)

- **Overlap is arms-only and front-view-only.** The density field has
  three channels: torso + head + legs share red, arms are green/blue. A
  leg can't be ordered against the torso without a fourth channel; in
  profile, green/blue each mix a leg and an arm, so ordering is off there.
- **Rim:** the core brightness and the dark edge band follow the tint
  (the edge colour is derived from the base colour), but the additive
  rim highlight stays uniform — per-part rim needs per-part data in the
  shader, which this doesn't add.
- **Depth no longer feeds the twist mechanics** (cos-bend of the child,
  dim, foot fan) that Task 1 temporarily kept. Those stay for authored
  `twist` only; depth drives exactly the brief's four cues.
