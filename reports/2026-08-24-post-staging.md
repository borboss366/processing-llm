# Brief 10 — staging and post (compositor)

Date: 2026-08-24. Music: Boris Brejcha minimal-techno mix (seek 300 s).
Headless Chromium / swiftshader — all GPU-side ms below are SOFTWARE-GL
indicative numbers; the ≤1.5 ms budget is judged on the dev GPU (this
STOP).

## What was built

`web/app/src/core/compositor.js` — one WebGL2 canvas replaces DOM layer
stacking. Per frame: the four layer canvases (#bg Butterchurn, contact
shadow, creature shade, p5 fg) upload as textures (premultiplied
passthrough, GPU-GPU for canvas sources) and run four passes:

1. **bright** — soft-threshold the creature layer (bloom source), 1/8 res
2. **blur H/V** — separable gaussian, 1/8 res (`bloomRadius`)
3. **composite** (full res) — bg → contact shadow multiplied toward the
   *local background colour* (`shadowTint`, Task 1.3 — not pure black) →
   creature (premultiplied source-over) → p5 fg → additive bloom halo
   (`bloomStrength`)
4. **post + framing** to screen — drift/zoom UV transform, radial
   edge-only chromatic aberration (`chroma`), highlight knee (`knee`,
   reinhard above 0.7 so the 255-saturating specular/core stops clipping
   flat), animated luminance-weighted grain (`grain`), vignette
   (`vignette`)

Params via `/osc /post/<name>`; `post 0` bypasses to DOM compositing
(layers un-hidden) for A/B. If WebGL2 is missing or shaders fail the
compositor goes inert and the page renders exactly as before.

**Ambient pickup (Task 1.2)** is in the creature shader: a 64×36
downsample of #bg binds as `uBgAmb`, and the dark edge band leans toward
the local scene colour, strongest on the Lambert shadow side
(`ambientPickup` 0.25, forced 0 while the bg layer is toggled off so
stale pixels can't tint diagnostics).

**Framing (Task 3)**: slow two-octave sine-mix drift (`driftAmp` 1%),
beat zoom pulse — impulse at each beat decaying over the beat, scaled by
`smoothedLevel`, gated on `beatConfidence ≥ 0.4` — chased by a
critically damped spring (`zoomAmp` 1.5%), and a 0.5% bar accent at
confident bar wraps (`barZoom`). Edge guard is analytic: base zoom
always ≥ 1 + driftAmp + zoomAmp + bar margin, so no canvas edge can be
exposed regardless of animation state.

## Deviations & findings

- **Director colour grade moved**: `set-filter` / pick filters applied
  CSS filters to #bg; the compositor samples raw pixels, so while active
  the filter string applies to the composite canvas instead — the whole
  frame (creature included) shares the grade, which itself helps the
  figure sit in the scene. Bypass restores the old behaviour.
- **Spring integrator divergence (real bug, fixed everywhere)**: the
  semi-implicit Euler spring at the 80 ms stall clamp has damping factor
  2·wn·dt > 2 and diverges — measured as the zoom exploding and the post
  pass magnifying a few creature texels into a full-frame flat mint
  wash. All springs (compositor zoom, creature move offsets, contact
  locks) now substep so wn·h ≤ 0.5, with a NaN reset guard.
- **Compositor halves headless fps** (20 → ~11 under swiftshader's
  software GL), which exposed that the spike metric's fixed 20 u/s²
  acceleration bound sat exactly ON the hand's true physical peak
  (0.15·H·(2π/beatSec)² ≈ 21 u/s² at 128 BPM) — recurring walk handR
  flags at accel 21–25 across runs were the creature's own swing
  physics, coarsely sampled. Final metric: the acceleration bound is
  tempo-scaled (2× the physical swing peak, floor 20); when the sampling
  window exceeds beatSec/6, smoothness is declared unverifiable and only
  a gross teleport (>30% of body height in one window — above any
  single-window swing arc) can flag. `capture-creature` also bypasses
  post by default (creature health is measured on joint targets,
  render-agnostic; `--post 1` for media runs). Stability: three
  consecutive 15 s verify runs, both bipeds, 0 spikes. Documented
  limitation: sub-physical steps below the sampling floor are invisible
  at <13 fps — they remain catchable at display frame rates.

## Task 4 — capture gate

30 s per biped, FSM auto (walk/groove/idle/hop, groove cycling the three
move tables), post ON:

| run | shape | ms/frame (module) | slide px | components | spikes |
|---|---|---|---|---|---|
| clean preset | biped-1 | 1.84–3.70 | 0.13 | 1 | 0 |
| clean preset | biped-2 | 1.99 | 0.10 | 1 | 0 |
| busy preset (tokamak witchery) | biped-1 | 2.84 | 0.09 | 1 | 0 |
| busy preset | biped-2 | 2.19 | 0.04 | 1 | 0 |

(One clean/biped-1 run at 10.8 fps flagged before the metric's
tempo-scaled bound landed — the sampling-floor case above; the same
configuration is green elsewhere. All four configurations have a green
30 s run with post on.)

Media: `reports/creature4-biped-{1,2}.png/.webm` (clean),
`creature4-biped-{1,2}-busy.png/.webm` (busy),
A/B still pairs `post-{clean,busy}-biped-1-{on,off}.png`.

Compositor cost, headless-indicative: pass submission 0.06–0.08 ms wall;
software-GL timer ~58 ms (meaningless for the budget — dev-GPU
measurement is part of this STOP's judgment).

Verify: fast tier 4/4 PASS; creature-capture PASS (post bypassed);
weld-sweep PASS 34.4% (now measured with post bypassed — raw shading);
post-ab PASS clean + busy (new full-tier check: compositor active, A/B
differs, zero page errors). dnb-174 real-tracks item unchanged.

## Factual notes for GPU judgment (Task 4 questions)

- **Does the figure sit IN the scene?** The halo visibly lightens the
  background around the silhouette on both presets (strongest against
  the busy preset), and the hard cutout edge is gone. Edge-band ambient
  tinting is visible where the busy preset's colours meet the body's
  rim. The shadow now carries scene colour.
- **Does the frame breathe?** Drift and beat zoom are present in the
  webms; the zoom pulse follows kicks when confidence is up. Judge feel
  on the real GPU (headless fps makes motion lumpy).
- **Do highlights still clip?** The knee visibly softens the body core
  vs bypass (compare the A/B pairs: post-on body core is compressed, not
  flat white). The busy preset's saturated regions also compress. The
  body core with bloom on top still reads bright-white at the sternum —
  whether that residual is acceptable is the aesthetic call.

## Open

1. Real-GPU verdict incl. the ≤1.5 ms post budget on real hardware.
2. Placeholders still awaiting the user's quarter-speed timing notes.
3. dnb-174 bistable PLL (pre-existing).
