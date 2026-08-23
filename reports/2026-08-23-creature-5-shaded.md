# Shaded metaball render — Brief 8, Task 1

The CSS/SVG gooey filter is replaced by a shaded density pipeline on the
creature layer: node sprites accumulate density (alpha) + premultiplied
part colour (rgb) into a half-resolution 2D canvas, uploaded per frame as a
texture to a WebGL2 canvas that runs the shading pass — threshold at `d0`,
pseudo-normal from the density gradient, Lambert key light (upper-left
default, intensity breathing with `smoothedLevel`), colour ramp on density
(dark saturated edge → base hue → whitened core riding the kick band), rim
band at the `d0` crossing tinted toward the accent, one soft specular above
`d1`. Sprite radii simmer ±6% on a slow noise field (`simmer` param). The
SVG filter path is deleted; `renderMode:'wire'` remains the diagnostic.

Params: `gooThreshold` (d0), `shadeD1`, `shadeNz`, `lightX/lightY`,
`simmer`, plus the existing palette hues.

## What it looks like (dev capture, judgment is Task 4's gate)

`creature4-quadruped.png`: a lit, dimensional soft body — teal torso with
wool-like surface relief shaded from the upper-left, glossy pink head with
a specular sheen, ribbed mint legs (the ring-chain lattice reads as
knitted texture through the gradient normals), soft neon rim. Distinctly
not a flat sticker.

## Two implementation findings

- **Density must not saturate.** The first pass used sprite alpha ~0.7;
  overlaps clamped density to 1.0 across the whole interior, the colour
  ramp had no gradient left, and the body rendered flat white. Sprite
  alpha is now ~0.30 (+0.10 on the band) so the ramp and normals have
  signal. `gooThreshold` default moved 0.42 → 0.18 accordingly.
- **Deviation from the brief**: the pseudo-normal uses four explicit
  ±1-texel taps instead of `dFdx/dFdy` — screen-space derivatives on a
  magnified half-res texture are noisier per pixel; the taps are stable
  and cost nothing measurable.

## Budget (tools/capture-creature.mjs --verify; headless swiftshader)

- Module JS: 1.0 ms/frame at ~599 nodes (accumulation + upload + physics).
- Shade pass wall clock: 0.8 ms.
- GPU timer (EXT_disjoint_timer_query_webgl2): ~27 ms — **software GL**;
  swiftshader emulates the GPU on CPU, so this is not the dev machine's
  GPU number. The pass is one half-res-sourced fullscreen triangle with 9
  texture taps — the ≤3 ms real-GPU budget will be confirmed at the Task 4
  gate on the real display.
- Stance slide: 0.01 px (unchanged mechanics).

## npm run verify

```
pll-synthetic             PASS    scenarios=4 (0.3s)
module-load               PASS    modules=8 (0.1s)
director-prompt-stable    PASS    bytes=57585 (0.1s)
creature-capture          PASS    shapes=1 seconds=5 (45.9s)
```
(full tier last green 2026-08-23: pll-real-tracks 4/4, replay-smoke 14
windows 0 errors)
