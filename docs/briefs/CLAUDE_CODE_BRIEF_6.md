# processing-llm — brief 6: creature rendering pivot

Verdict on Brief 5 captures: mechanics are solved (body moves, feet solid,
limbs continuous), but the creature still reads as a wireframe diagram
over a fully-rendered background. The cause is the rendering language,
not the parameters: we are drawing the simulation graph. The tissue
nodes should be invisible metaball centres; the visible creature is the
thresholded union of soft blobs — a smooth, glowing soft body with a clean
silhouette. Physics stays exactly as is.

Do Task 1 first and capture before anything else. It is a one-hour
experiment that decides whether Tasks 2–4 are worth doing.

## Task 1 — Gooey test (fast path, CSS/SVG filter)

1. Give the creature its own canvas layer between Butterchurn and the p5
   fg canvas (same pattern the NCA readme describes). Transparent
   background, sized with the window.
2. Render each tissue node as a soft radial sprite (pre-rendered
   `createGraphics` sprite with a Gaussian falloff, radius ≈ 1.4× mean
   edge length), additive, tinted by part hue. No edges, no outline, no
   node dots.
3. Apply an SVG filter to that canvas: `feGaussianBlur stdDeviation≈6`
   followed by `feColorMatrix` on alpha (e.g. `0 0 0 18 -7`) — the
   standard gooey/metaball filter. Expose blur and threshold as params.
4. Capture both shapes over Butterchurn, 20 s, commit
   `reports/<date>-creature-3-gooey.md` with stills and a one-paragraph
   factual description. STOP for judgment.

If the body looks like a continuous glowing soft body with a readable
silhouette, continue. If it looks like a blurred mess, report that and
stop; the next attempt would be Task 2's shader path with a hard-edged
threshold.

## Task 2 — Proper surface render (if Task 1 passes)

Replace the CSS filter with an offscreen pass: blobs accumulated into a
half-resolution buffer, thresholded in a fragment shader (WebGL2 or p5
WEBGL on that layer) into a body mask with an inner glow and a thin rim
light; final composite at full resolution. Faint interior wireframe
optional as texture at α≤0.08. Keep module cost ≤ 6 ms/frame.

## Task 3 — Background yields

When any creature instance is in `entering`/`active`, the render window
dims the Butterchurn layer (brightness ×0.45, saturation ×0.7, ease over
the fade time) and restores on `exiting`. Use the existing filter
pipeline. Param `bgDim` on the module, default on.

## Task 4 — Squash and stretch

Root bounce 8–10% of body height; body scale (1+0.05·s, 1−0.05·s) with
`s = sin(4π·beatPhase)` (stretch on rise, squash on landing); leg
extension 20% past rest at stride end. Jelly: bell ±30%, tentacles lag
0.3 behind the bell. All amplitudes scale with `smoothedLevel`.

## Task 5 — Silhouette authoring (after 1–4 are judged)

Replace capsule unions with a bitmap silhouette: `shapes/<name>.png`
(128×128, white = inside), loaded once, points sampled by rejection
against the bitmap, skeleton still hand-placed in a sidecar
`shapes/<name>.json` (joints, parents, pin radius, part label regions as
circles). Ship one quadruped and one jelly drawn by the user. Capsule
shapes are deleted once the bitmap path works.

## Not in this brief

GRA, growth, LLM shapes, director work, measured tags. STOP after Task 1
regardless of outcome.
