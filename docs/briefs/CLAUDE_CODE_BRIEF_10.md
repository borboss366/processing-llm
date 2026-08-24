# processing-llm — brief 10: staging and post (killing the last 70s)

Context: the creature body is lit and mechanically solid (Brief 9 gate
tables all green). What still dates the picture is presentation: pasted-on
compositing, raw-canvas look, static framing. Three small layers fix most
of it. Move-timing notes from the user land separately and replace the
`*-placeholder` tables whenever provided — not a dependency of this brief.

All work is on the compositing path in the render window; the creature
module's internals stay untouched except where named. CLAUDE.md rules;
verify green; budgets measured and reported.

## Task 1 — Integration (creature ↔ background)

1. **Bloom bleed**: the creature layer's bright pixels contribute a wide,
   low-alpha additive halo onto the composite (separable blur of the
   creature buffer, ~1/8 res, radius param `bloomRadius`, strength
   `bloomStrength` default subtle). The glow must visibly tint the
   background around the figure, replacing the current hard cutout edge.
2. **Ambient pickup (fake radiosity)**: sample the background layer at
   low res; in the creature shader, tint the DARK edge band of the ramp
   toward the local background colour (strength param `ambientPickup`,
   default ~0.25). Two shader lines + one texture bind; the figure's
   shadow side should no longer be scene-independent.
3. The contact shadow composites with a hint of the background colour
   (multiply, not pure black).

## Task 2 — Post-processing on the final composite

One full-screen pass after all layers (WebGL, half-res acceptable for the
effects, full-res for the base):
- film grain (animated, luminance-weighted, `grain` default low)
- vignette (`vignette` default gentle)
- chromatic aberration, radial, edges only (`chroma` default very low)
- optional soft highlight rolloff (tonemap knee) so the 255-saturating
  specular/core stops clipping flat — report before/after crops.
All four exposed as params; a `post 0` bypass for A/B. Budget: ≤ 1.5 ms
added at 1080p on the dev GPU (report the measurement; headless numbers
are indicative only).

## Task 3 — Framing motion

Applied to the whole composite (background + creature together, post on
top), so layers never shear apart:
1. Slow drift: camera translate on a Perlin path, amplitude ~1% of frame,
   period tens of seconds (`driftAmp`).
2. Beat zoom: 1–2% zoom pulse keyed to beatPhase with the same critically
   damped spring used for move offsets (no step at phase wrap), scaled by
   `smoothedLevel` and gated on `beatConfidence` (`zoomAmp`).
3. Optional bar-accent: an extra 0.5% on bar wraps when confidence is
   high (`barZoom`, default on, small).
Guard: total offset clamped so no canvas edge is ever exposed
(over-render the composite by the max drift+zoom margin).

## Task 4 — Capture gate

30 s per biped over the clean preset AND over one busy preset, post on;
plus a `post 0` A/B pair of stills. Report: budgets per pass, verify
table, and factual notes on: does the figure sit IN the scene (halo +
ambient pickup visible), does the frame breathe with the music, do
highlights still clip. STOP for GPU judgment.

Out of scope: material overhaul (SSS/fresnel/surface texture), audience
pipeline (Brief 11), move timing (user notes pending), scene schema.
