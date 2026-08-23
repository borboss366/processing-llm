# processing-llm — brief 8: from flat blob to lit body

Verdict on Brief 7: locomotion gate PASSED (walk/turn/idle/groove all read
correctly). New target: the render is a flat fill with a hard edge — 70s
cel look. This brief replaces the threshold with a shaded density render,
and the capsule shapes with drawn silhouettes. CLAUDE.md rules apply;
`npm run verify` output at the end of every report.

## Task 1 — Shaded metaball render (supersedes the CSS goo filter)

The sprite pass already accumulates a density field; stop clamping it to
in/out. Render pipeline, all on the creature layer:

1. Accumulate node sprites into a half-resolution offscreen buffer
   (density in one channel, part-hue premultiplied color in the others),
   as today.
2. Fragment shader over that buffer (WebGL2; raw context or regl-free
   hand-rolled — no new framework):
   - `d = density`, discard below `d0` (body threshold, ~ current goo
     threshold).
   - Pseudo-normal from the density gradient:
     `n = normalize(vec3(-dFdx(d), -dFdy(d), nz))`, `nz` param ≈ 0.6.
   - Key light dir param (default upper-left). Lambert term shades the
     flanks.
   - Color ramp on d: edge band dark + saturated, mid band base hue,
     core band brightened toward white (translucent-jelly look). Ramp
     stops as params.
   - Rim light: bright 1–2 px band where `d` crosses `d0` (smoothstep on
     d, colored slightly toward the accent hue).
   - Specular: highlight where `dot(n, halfVec)` is high AND `d > d1`
     (a second, higher threshold) — one soft hotspot, not gloss
     everywhere.
   - Audio: key light intensity breathes with `smoothedLevel`; core
     brightness with the kick band. Hue stays palette-driven.
3. Composite the shaded buffer to the layer at full res (linear filter).
   Delete the SVG gooey filter path once parity is reached; keep
   `renderMode: 'wire'` diagnostic.
4. Surface life: modulate each sprite radius by ±6% with a slow 2D
   noise field (node index + time), so the surface simmers at rest.
   Param `simmer`.

Budget: ≤ 3 ms/frame GPU-side at half res on the dev machine; measure
with EXT_disjoint_timer_query if available, else report wall clock of the
pass. Verify line from `capture-creature.mjs --verify` must still pass.

## Task 2 — Drawn silhouettes (Brief 6 Task 5, now due)

1. Shape source: `web/app/shapes/<name>.png` (128×128 or 256×256,
   white = inside) + `web/app/shapes/<name>.json` sidecar: joints
   (name, x, y, parent), pin radius, part regions (labelled circles),
   ground contact points, natural archetype, palette.
2. Sampler: rejection-sample points against the bitmap alpha; per-part
   sprite radius floors as today; limbs detected from part regions keep
   the ring-chain topology (fit rings along the region's principal axis).
3. Ship two shapes DRAWN BY THE USER (placeholder art from the
   implementer is acceptable to unblock, clearly named `*-placeholder`):
   a quadruped with real proportions (tapered neck, thighs > shins,
   tail) and a jelly. Capsule shape code is deleted once both load.
4. The shape file pair is the creature's authoring interface from now on
   — document the format in `MODULE_ABI.md` (this is also what a future
   LLM shape designer will emit).

## Task 3 — Face, shadow, grounding

1. Eye: one dark dot on the head, offset toward walking direction;
   blink every 4–7 s (two-frame vertical collapse); quick saccade when
   the head-look reorients. Two eyes if the shape's json asks
   (`eyes: [{x,y,r}, ...]` in head coordinates).
2. Contact shadow: soft dark ellipse under the body on the layer's
   bottom, width tracking the feet spread, squashing with bounce,
   opacity dropping when airborne (hop). Drawn under the shaded body,
   not through the density field.

## Task 4 — Capture and gate

30 s per shape over Butterchurn, file audio spanning the breakdown, real
+ diag stills. Report: shader pass cost, verify table, factual
description. STOP for judgment on a real GPU. The question at the gate:
does it look like a lit, translucent soft body with anatomy — or still
like a flat sticker?

## Not in this brief

Director-driven behavior / scene schema (next after this gate), fluid
engine, three.js creature, mocap gait curves, GRA/growth. The
ARCHITECTURE_NOTE triggers remain unmet — no engine refactor.
