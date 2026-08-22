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

- **Pick cadence**: 1.14 picks/min on a 12-min techno set (was 3.17), 14/14
  unique presets, 13/14 commits within 0.1 of a bar boundary, the one
  mid-bar commit being the designed low-confidence fallback
  (`reports/2026-08-22-pick-cadence.md`). Min-hold (UI, default 45 s) +
  2-window hysteresis + bar-quantized commit in the render window.
- **Beat tracking (PLL)**: 4-genre real-track matrix all ±2 BPM on confident
  samples (`reports/2026-08-22-pll-genre-matrix.md`); synthetic suite locks
  ≤0.033 beat phase error over 60 s at 60/120 Hz (`tools/beat-test.mjs`).
  Breakdowns: BPM holds, confidence dips honestly, re-acquires.
- **Director latency**: ~6.2 s median per pick live (stable prompt prefix
  ~11.7k tokens warmed at boot; was ~26 s). Director can answer
  `"preset":"hold"` (parse unit-verified; not yet exercised live).
- **Replay determinism**: `--seed` pins candidate sampling + generation;
  identical picks across runs (`tools/replay.mjs`).
- **Live pipeline end-to-end**: two 12-min Auto-Director sessions recorded
  from file audio through the real stack, 0 errors, 0 off-list picks
  (`tools/record-session.mjs`; sessions + beat logs in `sessions/`).
- **Module contract**: single spec in `web/app/MODULE_ABI.md`; modgen CLI
  embeds it verbatim (`tools/modgen/gen.mjs`).

## Open

1. **Director memory unevaluated** — A/B tooling ready and the post-cadence
   session exists; run memory vs no-memory seeded replays (Brief 3 Task 3).
2. **Preset tags are vision-model-skewed** (majority "complexity 3 / calm /
   swirling"), blunting the complexity ceiling and candidate discrimination
   (Brief 3 Task 4).
3. **Low-tempo band (60–90 BPM) untested** and eager to double after the DnB
   half-lag fix — needs the two regression tracks (~93 hip-hop, ~81
   stomp-clap) in `music/` (Brief 3 Task 2, user supplies).
4. **Director never held** in the recorded session — every hysteresis-gated
   call produced a change. Watch whether holds appear once calls fire on
   quieter signals; if not, the prompt's hold bar may need raising.
5. **Operational caveats**: any other Ollama call evicts the director's
   prefix cache; preset-description edits need a server restart; harness
   runs must be solo (parallel headless browsers skew BPM low).

## Next

Brief 3 Task 2 (low-tempo regression) once the two tracks land in `music/`;
Task 3 (memory A/B) is unblocked and can run first.
