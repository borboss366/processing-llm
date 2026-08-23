# Drawn silhouettes — Brief 8, Task 2

The creature's shape source is now a drawn PNG silhouette + JSON sidecar in
`web/app/shapes/` (format documented in `MODULE_ABI.md` — this pair is the
authoring interface a future LLM shape designer will emit). The capsule-SDF
shape code is deleted.

- **Sampler**: tissue rejection-samples against the bitmap (white = inside).
  Parts labelled `limb*` in the sidecar are fitted with ring chains along
  the region's principal axis (PCA over silhouette pixels; ring half-width
  measured by scanning the bitmap perpendicular to the axis), so limbs stay
  continuous ropes. Body/head grid-sample the rest. Surface nodes for the
  wire diagnostic come from 8-probe bitmap-edge tests.
- **Skeleton from the sidecar**: joints with parents by name, `paw` (9-node
  rigid pin cluster), `ground` (walking foot), `phase` (gait offset), plus
  per-shape palette, archetype, ground line, and eye positions (consumed in
  Task 3).
- **Async load**: `setup()` kicks off fetch+decode; `draw()` waits until the
  build lands (token-guarded against shape-param races).

## Deviation from the brief (explicit, per CLAUDE.md)

The brief specified "a quadruped with real proportions … and a jelly." The
user drew and shipped **two front-facing bipeds** (`biped-1`, `biped-2`) —
user art wins. Consequences:

- A new `biped` gait archetype: the two feet walk the stance/swing cycle in
  anti-phase; arms are non-ground limb tips that counter-swing from the
  shoulders (`phase` field drives both alternations); head bobs at 2×.
- No jelly shape file exists any more; the `pulse` archetype and the
  no-feet drift locomotion remain in code for the next jelly-like drawing.
- The old `quadruped`/`jelly` shape names are gone from the module,
  capture harness, and verify registry.

## Verified (over Butterchurn, techno mix @425 s)

`creature4-biped-1.png`: the walking figure follows the drawing —
pink-shaded round head, lit teal-green torso, arms ending in hand blobs,
two legs with feet planted on the ground line. States cycled
idle → groove → walk in the probe window.

Numbers (`tools/capture-creature.mjs --verify`): module 0.88 ms/frame at
585 nodes / 1076 edges; shade pass 0.73 ms wall; max stance slide 0.02 px.

## npm run verify

```
pll-synthetic             PASS    scenarios=4 (0.3s)
module-load               PASS    modules=8 (0.1s)
director-prompt-stable    PASS    bytes=57585 (0.1s)
creature-capture          PASS    shapes=1 seconds=5 (44.8s)   # biped-1
```
(full tier last green 2026-08-23)
