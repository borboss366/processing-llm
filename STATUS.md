# STATUS

Browser VJ tool: Butterchurn background + hot-loaded p5 foreground modules,
steered live by audio features and a local LLM director (qwen3:8b via
Ollama) that picks presets + colour filters as the music changes. To run a
set: `npm run server`, `cd web/app && npm run dev`, Ollama running with
qwen3:8b pulled; open `localhost:5173/` (render, on the projector — click
once for mic, or `?audio=file:/music/x.mp3` for file input) and
`localhost:5173/controller.html` (pads, module list, Auto-Director with
min-hold control). Full guide in `README.md`.

## Verified

- **Umbrella verification runner**: `node tools/verify.mjs` (fast tier:
  synthetic PLL, module ABI check, prompt-prefix byte-stability — ~1 s) and
  `--full` (adds the real-track genre matrix, a seeded replay of the latest
  session, and a headless creature run with frame-cost + foot-slide budgets).
  All 6 checks PASS as of 2026-08-23; harnesses emit machine-readable
  VERIFY:PASS/FAIL lines. Checks run sequentially by design (parallel
  headless browsers skew BPM).
- **Creature face + grounding (brief 8 Task 3)**: sidecar-defined eyes
  anchored to head tissue (blink 4–7 s, saccades on head-look reorients,
  walk-direction lead) and a contact shadow on its own layer under the
  shaded body (feet-spread width, squash-coupled, fades at hop apex).
  1.13 ms/frame total (`reports/2026-08-23-creature-7-face-shadow.md`).
- **Creature shapes are drawn silhouettes (brief 8 Task 2)**: PNG + JSON
  sidecar in `web/app/shapes/` is the authoring interface (documented in
  MODULE_ABI.md); limbs ring-fitted along PCA axes; capsule shapes deleted.
  Shipped: the user's two bipeds with a new `biped` gait (anti-phase feet,
  counter-swinging arms). 0.88 ms/frame at 585 nodes, slide 0.02 px
  (`reports/2026-08-23-creature-6-drawn-shapes.md`).
- **Creature shaded render (brief 8 Task 1)**: the goo threshold is now a
  WebGL2 shading pass — density-gradient normals, Lambert key light, colour
  ramp, rim, specular, ±6% surface simmer; reads as a lit translucent body.
  Module JS 1.0 ms/frame; shade pass 0.8 ms wall (GPU number pending real
  display — swiftshader's 27 ms is software GL)
  (`reports/2026-08-23-creature-5-shaded.md`).
- **Creature v4: locomotion + behaviour (brief 7)**: world-space walking
  with planted feet (max stance slide 2.78 px ≈ 0.6% body height, phase-
  locked odometry), bar-wrap state machine idle/walk/groove/hop on an energy
  z-score (observed live: idle on the breakdown, groove on peaks), Perlin
  idle (breath/sway/head-look), two-hue palette + accent, connected neck,
  no torso holes; 0.34 ms/frame at ~598 nodes; `creature-state` events flow
  to the session stream (`reports/2026-08-23-creature-4-locomotion.md`).
  Gooey metaball render from v3 underneath
  (`reports/2026-08-22-creature-3-gooey.md`). Awaiting judgment.
- **Pick cadence**: 1.14 picks/min on a 12-min techno set (was 3.17), 14/14
  unique presets, 13/14 commits within 0.1 of a bar boundary
  (`reports/2026-08-22-pick-cadence.md`).
- **Director memory A/B**: seeded replays tie on all counted metrics;
  default is `no-memory` (−1.6 s/pick), memory selectable
  (`reports/2026-08-22-memory-ab.md`).
- **Beat tracking (PLL)**: 4-genre real-track matrix all ±2 BPM on confident
  samples (`reports/2026-08-22-pll-genre-matrix.md`); synthetic suite locks
  ≤0.033 beat phase error over 60 s at 60/120 Hz (`tools/beat-test.mjs`).
- **Director latency**: ~4.5 s median per pick warm (stable prompt prefix
  warmed at boot; was ~26 s).
- **Replay determinism**: `--seed` pins candidate sampling + generation
  (`tools/replay.mjs`).
- **Live pipeline end-to-end**: two 12-min Auto-Director sessions recorded
  from file audio, 0 errors, 0 off-list picks (`tools/record-session.mjs`).
- **Module contract**: single spec in `web/app/MODULE_ABI.md`; creature is
  the reference `beatPhase` user.

## Open

1. **Creature v4 verdict pending** — judged on a real GPU. Known
   trade-offs: leg pairs still fuse into chunky columns at the default goo
   threshold; `hop` rarely triggers on this mix (z > 1.5 is a high bar).
   Next after the gate (per brief 7): bitmap silhouettes, then
   director-driven behaviour.
2. **Director never holds** — leading-question tail prompt + threshold below
   the mix's natural drift; z-score calibration specified as Brief 4 Task 3.
3. **Preset tags are vision-model-skewed** — Brief 4 Task 4.
4. **Low-tempo band (60–90 BPM) untested** — Brief 4 Task 5, waiting on the
   two tracks (~93 hip-hop, ~81 stomp-clap) in `music/`.
5. **Operational caveats**: any other Ollama call evicts the director's
   prefix cache; preset-description edits need a server restart; harness
   runs must be solo (verify.mjs enforces this by running sequentially).
   The 2-step garage track is marginal for the PLL (confident-median wanders
   ±2.5 across runs; documented ±3 tolerance in the matrix).

## Next

Brief 8 Task 4 — gate capture (30 s per shape over Butterchurn across the
breakdown) and STOP for real-GPU judgment.
