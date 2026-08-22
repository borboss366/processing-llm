# STATUS

Browser VJ tool: Butterchurn background + hot-loaded p5 foreground modules,
steered live by audio features and a local LLM director (qwen3:8b via
Ollama) that picks presets + colour filters as the music changes. To run a
set: `npm run server`, `cd web/app && npm run dev`, Ollama running with
qwen3:8b pulled; open `localhost:5173/` (render, on the projector — click
once for mic, or `?audio=file:/music/x.mp3` for file input) and
`localhost:5173/controller.html` (pads, module list, Auto-Director). Full
guide in `README.md`.

## Verified

- **Beat tracking (PLL)**: 4-genre real-track matrix all ±2 BPM on confident
  samples — techno mix Δ0.03, 2-step garage Δ-1.37, DnB 174 Δ-1.44,
  Sandstorm Δ0.00 (`tools/beat-test-real.mjs`, solo runs; ground truth via
  `tools/wav-tempo.mjs`). Synthetic suite: 120@60Hz, 120@120Hz, 128, 174 all
  lock ≤0.033 beat phase error over 60 s (`tools/beat-test.mjs`).
- **Breakdown behaviour**: 22 s confidence dip in a recorded 12-min set; BPM
  held ~125 throughout, re-acquired conf >0.5 within ~20 s
  (`sessions/2026-08-22T18-23-29-150Z-beat.json`).
- **Director latency**: 4.3–4.9 s per pick warm, incl. the first (stable
  prompt prefix ~11.6k tokens warmed at boot; was ~26 s). Replay of a
  3-window session 13.7 s vs 79.8 s before (`tools/replay.mjs`).
- **Live pipeline end-to-end**: 12-min Auto-Director session recorded from
  file audio through the real stack — 38 picks, 0 errors, 0 off-list
  (`tools/record-session.mjs`; session + beat log in `sessions/`).
- **Replay determinism**: two `--seed 42` replays produce identical picks
  (`tools/replay.mjs`).
- **Module contract**: single spec in `web/app/MODULE_ABI.md`; modgen CLI
  embeds it verbatim (`tools/modgen/gen.mjs`).

## Open

1. **Pick cadence is far too fast for a set** — 38 picks in 12 min (~19 s
   apart) on minimal techno; target is a 1–3 min held look with changes on
   phrase boundaries. Fix specified as Brief 3 Task 1 (min-hold, hysteresis,
   director "hold" answer, bar-quantized commit, recency ≥10).
2. **Director memory unevaluated** — record/replay tooling ready; A/B blocked
   on the Task 1 re-record so it measures the fixed cadence (Brief 3 Task 3).
3. **Preset tags are vision-model-skewed** (majority "complexity 3 / calm /
   swirling"), blunting the complexity ceiling and candidate discrimination
   (Brief 3 Task 4).
4. **Low-tempo band (60–90 BPM) untested** after the DnB half-lag fix made it
   eager to double; needs the two regression tracks (Brief 3 Task 2, user
   supplies).
5. **Operational caveats**: any other Ollama call evicts the director's
   prefix cache; preset-description edits need a server restart; harness
   runs must be solo (parallel headless browsers skew BPM low).

## Next

Brief 3 Task 1 — pick rate, hold, and bar-quantized changes.
