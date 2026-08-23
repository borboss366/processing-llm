# processing-llm — work brief

Repo: browser VJ tool. Audio features → local LLM director (qwen3:8b via Ollama)
picks Butterchurn presets + colour filters; p5 foreground modules are hot-loaded
from `web/app/loaded-modules/` by a registry with lifecycle interfaces. Express +
WS server in `src/controller/server.ts`. Vite app in `web/app/`.

Goal of this pass: turn a working prototype into something that can run a
20-minute set at a party and be iterated on without re-DJing every change.
Do the tasks in order. Stop after each and report before continuing.

## Ground rules

- Frames before frameworks. Prefer the ugly specific version over the elegant
  general one. No new abstractions unless two concrete modules already need them.
- Do not add new surfaces (pages, demos, endpoints) beyond what is listed here.
- Keep the live path (`server.ts` controller routes, `main.js`, `registry.js`,
  `audio.js`) boring. Slow or failure-prone things go in `tools/`.
- One repo. Directory layout after this pass:
  `web/app/src/core/` (live engine), `web/app/loaded-modules/` (modules),
  `tools/` (offline authoring), `experiments/` (dated, may be deleted).
- Git has history. Delete dead code; do not comment it out or move it to `_attic/`.
- Every experiment that stays must have a README paragraph: what it is, why it
  is isolated, what would promote it, or what conclusion would kill it.

## Task 1 — Repo hygiene

1. Delete `processing/motion_blur.pde` and `web/app/hue-demo.html` +
   `web/app/src/hue-demo.js` (conclusions known; browser stack is the stack).
2. Move module generation (`/modules/generate-js` route and
   `MODULE_GEN_PROMPT_HEAD`) out of `server.ts` into `tools/modgen/` as a CLI:
   `node tools/modgen/gen.mjs --id <kebab> "<prompt>"`. It writes
   `web/app/loaded-modules/<id>.js` and POSTs `module-load` to the running
   server if reachable. The server keeps only the static `/loaded/*` route and
   the `module-load` broadcast.
3. Extract the module ABI into a single `web/app/MODULE_ABI.md` (fields,
   `ctx` shape, interface configs, one worked example). `registry.js`,
   `interfaces.js` and the modgen prompt must reference it, not restate it.
4. Keep `nca.html` + `src/nca/` as-is; its README already meets the rule.
   Move `preview.html`/`preview.js` to `experiments/` with a dated README
   paragraph, or delete if it is superseded by `preset-snap.html`.
5. Write a top-level `README.md` with three sections: how to run a set
   (server, Vite, Ollama model, mic loopback), what is in `core/`, what is
   experimental. Replace the TypeScript-compiler `.gitignore` with one that
   matches this project.

Acceptance: `npm run server` and the Vite app start; director and pads still
work; `git ls-files | wc -l` goes down; README describes every top-level dir.

## Task 2 — Session record & replay

The director currently cannot be evaluated except by playing music and
watching. Add:

1. **Record.** On the controller, when Auto-Director is running, append to a
   session file (`sessions/<iso-timestamp>.jsonl`, served/written via a new
   `POST /session/append` route): per-window feature stats, the director
   request body, the raw LLM response, the parsed pick, the filter, latency,
   and the recent-slug list. Also log operator actions (pad triggers,
   preset-next/prev, manual overrides) with timestamps.
2. **Replay.** `node tools/replay.mjs sessions/<file>.jsonl [--prompt-variant X]`
   feeds the recorded feature windows through the director logic with no audio
   and prints a table: window → original pick → new pick → description →
   latency. Director prompt construction must be factored into a pure function
   (`buildDirectorPrompt(features, prev, catalogue)`) so replay and the live
   route share it exactly.
3. **Director memory.** Change the prompt from "pick what fits this section"
   to "given the last N picks and their feature profiles, pick what should
   follow". Pass the last 3 decisions (profile line + preset name + filter).
   Keep the recency blocklist. Make N and the catalogue window size
   parameters, not constants.

Acceptance: a recorded 10-minute session replays in under a minute; changing
the prompt variant changes picks visibly in the table; the live route is
unchanged in behaviour apart from the added memory.

## Task 3 — Beat phase in `core/audio.js`

Modules need a continuous beat phase, not an onset boolean.

1. Fix `bpmEstimate()`: it converts lag to BPM as `3600 / lag`, hardcoding
   60 fps. Measure the actual `tick()` interval (EMA of `performance.now()`
   deltas) and use it for lag→BPM and for the onset buffer duration.
2. Replace onset strength (delta of total amplitude) with half-wave-rectified
   spectral flux weighted toward the sub/kick/low bands.
3. Add a phase-locked loop: `state.beatPhase ∈ [0,1)` advances at the
   estimated BPM every tick; on a detected onset, nudge phase toward 0 by a
   gain (default 0.15) only if the onset lands within ±0.25 of a beat
   boundary, otherwise ignore it. Expose `beatPhase`, `barPhase`
   (4 beats), and `beatConfidence` (EMA of how close onsets land to phase 0).
4. Document the new fields in `MODULE_ABI.md`. Update `stick-dancer` to use
   `beatPhase` for its bounce instead of `onBeat` as the reference usage.

Acceptance: with a steady 120 BPM test track, `beatPhase` stays locked for
60 s without visible drift at both 60 Hz and 120 Hz refresh; `bpm` reads
within ±2 of truth on both.

## Task 4 — Creature module (`loaded-modules/creature.js`)

A dancing creature with a generated armature. No graph growth, no LLM, no
GRA in this task. The point is to find out whether the idea reads as a
creature at all.

1. **Shape.** A hand-authored 2D shape as a union of 3–5 circles/capsules
   (SDF), with labelled parts: `body`, `head`, `limb[i]`. Hardcode two shapes
   (a quadruped-ish and a jellyfish-ish) selectable by param.
2. **Tissue.** Sample ~300–600 points inside the SDF (Poisson-disc or jittered
   grid), connect with Delaunay or k-nearest (k=3..4), store as typed arrays
   (`Float32Array` positions, `Int32Array` edges). Springs at rest length =
   initial distance.
3. **Skeleton.** A hardcoded joint list per shape (4–6 joints with parent
   links), placed in shape coordinates. For each joint, pin the nearest
   3–5 tissue nodes.
4. **Gait.** Each joint gets an oscillator: angle offset =
   `A * sin(2π(beatPhase + phaseOffset))`, with per-archetype tables for
   `A` and `phaseOffset` (quadruped trot: opposite limbs in phase;
   jellyfish: all limbs in phase, body scale pulse). `A` scales with
   `smoothedLevel`; archetype switch is a param.
5. **Physics.** Per frame: move pinned nodes to their joint targets,
   integrate springs + damping for the rest (simple Verlet), a weak
   centering force. Must hold 60 fps at 600 nodes in p5 — if not, draw with
   `beginShape`/vertex batches rather than per-edge `line()`.
6. **Render.** Fill triangles (from Delaunay) with low alpha, edges on top,
   node size by distance from nearest joint. Colour from band energy.
7. Implements `triggerable` + `fadeable` so it can be pad-triggered; reads
   `beatPhase` from Task 3.

Acceptance: a screenshot and a 20 s capture. Then stop and ask whether it
reads as a creature. If yes, next tasks are (a) growth-in as intro animation,
(b) LLM shape designer emitting the SDF + labels as JSON. If no, the fix is
almost certainly in the shape or the armature (more pins, stiffer springs),
not in the tissue — try that before anything else.

## Out of scope for this pass

Graph-rewriting automata, soft rules, Lenia, evolutionary anything, moving
physics to WASM/GPU, new LLM-generated modules. These are all additions on
top of a working creature and a measurable director, which is what the tasks
above produce.

## Errata (2026-08-22, after Tasks 1–3 — see STATUS.md and CLAUDE_CODE_BRIEF_2.md)

- **Task 1.4 premise was wrong**: `preview.html` was superseded by the
  controller's module list + per-module test pane, not by `preset-snap.html`
  (which is the headless driver for the description bootstrap, a different
  tool). preview was deleted, not moved.
- **Layout rule correction**: browser experiments that import `core/` must
  live under `web/app/` (the Vite root) or they cannot run — which is why
  `nca.html` rightly stays there. Top-level `experiments/` is for offline
  (Node) experiments only.
- **Task 3.3 as specified deadlocks**: "nudge only within ±0.25, otherwise
  ignore" can never acquire lock when the initial phase offset is outside the
  window and the frequency estimate is exact — the error stays constant
  forever. The implementation adds an acquisition mode (hard snap to onsets
  while `beatConfidence < 0.4`), reverting to the gentle ±0.25 / gain-0.15
  regime once locked.
- **Task 2 acceptance correction**: "a recorded 10-minute session replays in
  under a minute" is bounded by Ollama prompt-eval latency, not by the replay
  harness; it becomes achievable only with the cacheable-prompt work
  (BRIEF_2 Task B), not on the original code on any hardware.
