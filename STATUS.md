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

- **Beat clocks (brief 13)**: `core/clock.js` — the active clock owns the
  four public phase fields; PLL always runs as the fallback tier
  (`state.pll`), GridClock takes over when file playback finds a
  `music/<file>.beatgrid.json` sidecar (confidence 1, exact `phaseAt`,
  currentTime-quantization-smoothed). `tools/gridder.mjs` grids tracks
  offline (non-causal DP + least-squares smoothing; `--bpm`/`--tap` for
  stubborn ones — Pendulum needed `--bpm 174`); all 5 tracks gridded.
  Bench click vs grid: **median 0.9 ms** (`tools/grid-check.mjs`, verify
  --full). Music-pause instrumentation permanent (element/ctx events,
  long tasks, skip detector, visibility) — 30-min soak: ZERO gaps, live
  mechanism still unreproduced (user session will name it). Dance
  robustness: 1%/s bpm slew (PLL tier), 0.12× locomotion catch-up cap,
  asymmetric level envelope with idle floor — torture runs (tempo step,
  1 s gap, 4 s collapse) 0 spikes on BOTH tiers with plots. Walk eases
  in/out over a bar on a shared eased stride; the creature now enters in
  idle immediately and visibly catches the beat on lock (instant on
  grid). TRUE hierarchical FK (accRot composes down the chain): tstep's
  kick carries the ankle 34 px, armwave's peaks travel elbow→hand
  (`tools/fk-check.mjs`); tables re-authored to rotations, still
  placeholders. `visualBeatOffsetMs` display-latency calibration (bench
  slider, persisted; click stays raw); phase-0 = squash impact verified
  everywhere (`reports/2026-08-26-beat-clocks.md`).

- **Bench + move rotation (brief 12.6)**: `bench.html` — read-only
  observer over a 15 Hz `bench-state` WS feed: click track (WebAudio,
  lookahead-scheduled, downbeat-pitched; 92 clicks at 56 ms median vs
  the live PLL estimate in the headless acceptance, `tools/bench-check.mjs`
  in verify --full), BPM/confidence/bar instruments, onset-vs-grid strip
  with spacebar tap-along, audio strip with FSM z-thresholds, creature
  state/move ribbon + phase wheel + spike sparkline, decision log.
  Move rotation: per-state weighted repertoire at gait-table level
  (sidecar-overridable), rotates every `moveHoldBars` (4) bar wraps, no
  immediate repeats, blend-layer switches, `creature-move` events to
  session + bench; 60 s FSM capture cycled all three moves with 0 spikes
  (`reports/2026-08-25-bench-rotation.md`). Env findings logged: vite
  auto-restart breaks the /ws proxy (restart vite manually), background
  tabs freeze in headless (one browser per window).

- **Desktop draw + move workbench + ghost (brief 12)**: the drawing page
  works with a mouse (pointer events, `Draw` button in the controller via
  loopback-only `/api/info`; mouse-drag E2E case green). Move workbench:
  `moves/*.json` hot-reload (server fs.watch validates BEFORE broadcast —
  parse errors go to the director log, creature keeps the last good
  table), `clockMode manual` + `phaseScrub` freeze the clock and
  procedural overlays for pose inspection, play-from-here resumes live
  with zero spikes (`tools/workbench-check.mjs`, verify --full: hot edit
  moved the pose by exactly its delta, 0/0 spikes; found+fixed: blends
  freeze under a pinned clock, so manual edits now apply instantly).
  Ghost flagship: `shapes/ghost-placeholder` (structure is the
  deliverable), `grounded:false` float set via the existing hasFeet gate,
  two-axis Perlin stage wander + bar-accent swoops, 3 hem tips with
  tentacle phases, ghost gait table, big sidecar eyes, halloween palette
  presets on the phone page. 30 s dark-preset gate green (components 1,
  0 spikes, 2.15 ms/frame) — awaiting GPU judgment
  (`reports/2026-08-24-workbench-ghost.md`). Open finding: an idle page
  runs rAF at 120 Hz and the PLL loses confidence (pre-existing,
  logged).

- **Audience pipeline (brief 11)**: `npm run submit` starts the ONLY
  phone-facing process (`services/submit/`, :3210): phone drawing page
  at `/e/<token>` (ghost template underlay, brush/eraser/undo, 3-swatch
  palette, ~11 KB), server-side re-encode to a 256×256 mask + validation
  (coverage 8–60%, ≥95% connected, template joints covered) with
  human-readable rejections, 128 KB/20-per-min/token limits, disk spool.
  Controller's Audience panel moderates the queue; Perform hot-swaps the
  creature to `audience:<id>` (new swapEnv fade); every submission
  reuses `shapes/biped-front.json` joints. `qr-overlay` module shows the
  event QR on stage; README documents cloudflared/tailscale one-liners.
  Verified: `tools/audience-e2e.mjs` (verify --full) — all 7 validation
  verdicts + moderation green; `tools/audience-soak.mjs` — a synthetic
  audience shape performs (587 nodes, 1.9 ms/frame,
  `reports/audience-stage.png`) and 50 submissions over a 10-min set
  left frame cost flat (1.59 ms soak vs 1.95 baseline)
  (`reports/2026-08-24-audience-pipeline.md`). Deviation: no
  pre-existing safe-scene existed — the panel's Panic button (bg off +
  default shape) is the minimal one the brief assumed.
- **Compositor: staging + post (brief 10)**: one WebGL2 canvas
  (`core/compositor.js`) composites bg/shadow/creature/p5 with bloom
  bleed of the creature's bright pixels (1/8-res separable blur),
  contact shadow multiplied toward the local background colour, ambient
  pickup in the creature shader (dark edge band leans to a 64×36 bg
  sample, shadow side strongest), then post (luminance-weighted grain,
  vignette, edge-only chromatic aberration, highlight knee) and framing
  (Perlin drift 1%, confidence-gated beat-zoom spring 1.5%, bar accent
  0.5%; base zoom always covers the motion margin so edges can't
  expose). Params `/osc /post/*`; `post 0` bypasses to DOM compositing.
  Director colour grade rides the composite while active. Evidence:
  30 s per biped over clean AND busy presets post-on all green, A/B
  still pairs, `tools/post-ab.mjs` in verify --full
  (`reports/2026-08-24-post-staging.md`). Springs everywhere substep
  (wn·h ≤ 0.5) after the zoom spring measurably diverged at the 80 ms
  stall clamp. Spike metric: tempo-scaled acceleration bound + sampling-
  adequacy gate (3× consecutive clean verify runs). ≤1.5 ms post budget
  judged on the dev GPU — awaiting real-GPU verdict.
- **Brief 9 gate captures done (Task 3)**: 30 s per biped, FSM cycling
  walk/groove/idle/hop with groove rotating all three move tables two
  bars each, palette rule on, over the clean Butterchurn preset —
  0 spikes, components 1, slide ≤0.18 px, ~2 ms/frame, weld sweeps
  26.2%/36.3% flash removed (`reports/creature4-biped-{1,2}.png/.webm`,
  `reports/2026-08-24-creature-11-moves.md`). Two spike-metric
  refinements shipped en route (both measured false positives of
  sampling, not motion): an acceleration bound (>20 u/s²) so 3-frame
  dance swings at capture fps can't trip the growth test, and velocity
  measured over a fixed ≥40 ms window so a lone 17 ms frame can't divide
  jitter into a phantom spike. Awaiting real-GPU judgment.
- **Move tables (brief 9 Tasks 1–2)**: dance moves are data —
  `web/app/moves/<name>.json` ({name, beatsPerLoop, overlay, keys:
  [{phase, joints:{name:{dx,dy,rot}}, contacts, ease}]}, documented in
  MODULE_ABI.md). Playback interpolates piecewise over the move-local
  clock and layers UNDER the procedural bounce/lean/Perlin/simmer (scaled
  by the move's `overlay`); rot keys join the FK chain so bone lengths
  hold; `contacts` plants ground tips (stance lock). Every table offset
  and the contact-lock weight ride critically damped springs (~100 ms):
  raw key attacks and contact toggles stepped joints 1–2 u/s in one frame
  (7 spikes in the first tstep run) — springs build velocity from zero,
  0 spikes after. FSM groove cycles the three tables two bars each;
  `move` param forces one. Shipped: `groove` (ported from code),
  `tstep-placeholder`, `armwave-placeholder` — placeholders use
  tutorial-standard timing, USER'S QUARTER-SPEED NOTES STILL PENDING.
- **PLL acquisition snaps tamed + entry gating (brief 9 Task 0b)**: the
  move clock is now an exported pure function (`stepMoveClock`) verified
  frame-by-frame by `tools/move-clock-test.mjs` (fast tier): acquisition
  snaps drain through a 1.45×-nominal cap (the observed 0.46-beat case
  spreads over 1.03 beats), backward snaps hold instead of rewinding, and
  BPM re-estimates reach stride/blends only through an 0.8 s low-passed
  beat length (120→174 steps ≤3.2 ms/frame vs 155 ms raw). The creature
  holds its entry fade until beatConfidence ≥ 0.5 sustained 1 s
  (`entryConf`/`entrySec`, latch resets on lifecycle idle). Evidence in a
  file-writing capture with spikes counted from frame one: 0 spikes while
  a real 0.41-beat snap occurred (maxRawDelta=0.41 vs maxAppliedDelta
  =0.26, the headless-fps cap) — seam `window.__creaturePhase`, printed
  by the capture harness.
- **Metaball welding fixed (brief 9 Task 0a)**: density now accumulates in
  per-group channels (R torso+head+legs, G armL, B armR; bone splats route
  to their group) on a second half-res canvas, shaded on `d = max(R,G,B)` —
  additive stacking stays within a channel, a crossing arm slides over the
  body as a distinct surface (crease, no melt). Colour buffer unchanged
  (normalised by summed density; no winning-channel weighting needed —
  arms/torso share the primary hue as predicted). A/B evidence via the
  `weldUnion` diagnostic toggle: the legacy additive field brightens the
  flash band (pixels where summed density materially exceeds max) by up to
  20.6% (biped-1) / 38.8% (biped-2); `tools/weld-sweep.mjs` is in
  `verify --full` and FAILS if the union path stops diverging from
  additive. Frame budget unaffected (capture check PASS).
- **Umbrella verification runner**: `node tools/verify.mjs` (fast tier:
  synthetic PLL, module ABI check, prompt-prefix byte-stability — ~1 s) and
  `--full` (adds the real-track genre matrix, a seeded replay of the latest
  session, and a headless creature run with frame-cost + foot-slide budgets).
  All 6 checks PASS as of 2026-08-23; harnesses emit machine-readable
  VERIFY:PASS/FAIL lines. Checks run sequentially by design (parallel
  headless browsers skew BPM).
- **Brief 8.2 polish done**: debris identified as Butterchurn's own preset
  scribbles (harness pins a clean preset); palette rule enforced
  (primary body+limbs / secondary core-tint only / accent head+rim, swatch
  diag); hiccups eliminated — pose blending on FSM+turn changes,
  continuous move-local phase, low-passed head-look, sin² groove bounce
  (the max(0,sin) velocity kink was the regular-interval slam). Joint-speed
  spike metric permanent in the harness: 0 flagged over 30 s both shapes
  (`reports/2026-08-23-creature-10-polish.md`).
- **Limb severing fixed (brief 8.1)**: components = 1 across 30 s captures
  with the full move set, both bipeds. Root cause was orphan spring-graph
  islands (mitt tissue outside the sidecar limb regions, body-sampled into
  isolated k-NN clumps); build now drops disconnected components with a
  warning, regions cover the fists, bone splats guarantee skeleton density,
  paws pin their whole part region, limb floors sized for max-excursion
  stretch. Clean-path ~1.0 ms/frame; density probes and component counts
  are permanent harness checks (`reports/2026-08-23-creature-9-severing.md`).
- **Brief 8 gate captures done (Task 4)**: 30 s per biped over Butterchurn
  across the breakdown — lit translucent bodies with faces, walking/
  grooving/idling; ~1.0 ms/frame, slide ≤0.15 px
  (`reports/2026-08-23-creature-8-gate.md`). Awaiting real-GPU judgment.
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
4. **DnB beat lock is bistable across runs** — the 174 BPM track either
   locks correctly (solo Δ−0.19/−0.44) or settles a confidently-wrong ~154
   attractor (Δ−19.8, conf 0.69): the octave hysteresis makes early wrong
   locks sticky and refinePeriod self-confirms them. Fresh browsers and
   cool-downs don't fix it; needs a dedicated PLL work item, not a wider
   tolerance. Until then `verify --full` can fail on dnb-174.
5. **Low-tempo band (60–90 BPM) untested** — Brief 4 Task 5, waiting on the
   two tracks (~93 hip-hop, ~81 stomp-clap) in `music/`.
6. **Operational caveats**: any other Ollama call evicts the director's
   prefix cache; preset-description edits need a server restart; harness
   runs must be solo (verify.mjs enforces this by running sequentially).
   The 2-step garage track is marginal for the PLL (confident-median wanders
   ±2.5 across runs; documented ±3 tolerance in the matrix).

## Next

1. User's live GridClock session: click-on-beat by ear per track, the
   visual-offset calibration on the real display, and — with the pause
   instrumentation now permanent — reproducing the music pauses so the
   mechanism can be named and fixed.
2. Move sculpting on the workbench (tables are rotation-based now);
   ghost/phone/post judgment queue unchanged.
3. Brief 12.5 (never delivered) → rebase on the clock interface; spider
   is brief 14.
