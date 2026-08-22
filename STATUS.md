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

- **Creature module, polish pass done**: verdict on v1 was YES; v2 adds
  scale/framing (65% canvas, ground line), glow rendering (SDF boundary
  outline + additive flesh pass), root motion, knees + 9-node paws + floor,
  ring-chain limbs — whole body moves on the beat, feet solid, tentacles
  continuous; 4.3 ms/frame at ~596 nodes (≤5 ms budget)
  (`reports/2026-08-22-creature-2.md`). Awaiting judgment on a real GPU.
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

1. **Creature v2 verdict pending** — judged on a real GPU with Butterchurn
   behind it. Known nits: head outline partly broken (sparse sampling on a
   small circle), near/far leg pairs can visually cross in side view. No
   further creature work (growth, LLM shapes) until judged.
2. **Director never holds** — leading-question tail prompt + threshold below
   the mix's natural drift; z-score calibration specified as Brief 4 Task 3.
3. **Preset tags are vision-model-skewed** — Brief 4 Task 4.
4. **Low-tempo band (60–90 BPM) untested** — Brief 4 Task 5, waiting on the
   two tracks (~93 hip-hop, ~81 stomp-clap) in `music/`.
5. **Operational caveats**: any other Ollama call evicts the director's
   prefix cache; preset-description edits need a server restart; harness
   runs must be solo.

## Next

User judgment on the creature v2 captures (real GPU); then Brief 4 Task 3
(change-detector calibration + hold).
