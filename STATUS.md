# Status — brief execution (as of 2026-08-22)

What got done against `CLAUDE_CODE_BRIEF.md`, what's still open. Tasks 1–3 are
complete, committed, and pushed; Task 4 (creature module) has not been started.

## Done

### Repo & history

- Repo is public at `github.com/borboss366/processing-llm`.
- `music/Prodigy - Girls.mp3` (copyrighted audio) purged from the entire git
  history via `git filter-repo` + force push; the local file is kept on disk,
  untracked. Pack size 31 → 23.5 MiB. All commit hashes changed — re-clone
  rather than pull if another checkout exists anywhere.
- `npx tsc --noEmit` is clean (was 16 errors; they lived in code that Task 2
  extracted and rewrote).

### Task 1 — repo hygiene

- Deleted: `processing/motion_blur.pde`, `hue-demo.html/.js`,
  `preview.html/.js` (nothing referenced them; the controller's module list +
  test pane supersedes preview's sandbox — *not* `preset-snap.html`, which is
  a headless bootstrap driver, contrary to the brief's premise).
- Module generation moved out of the live server into
  `tools/modgen/gen.mjs` (`npm run modgen -- --id <id> "<prompt>"`); the
  `/modules/generate-js` route is gone.
- `web/app/MODULE_ABI.md` is the single module-contract spec; `registry.js` /
  `interfaces.js` headers point at it, and the modgen prompt embeds it
  verbatim.
- Top-level `README.md` (run-a-set guide, layout, experimental surfaces) and
  a project-matched `.gitignore` (the old TypeScript-compiler one had been
  silently ignoring `package-lock.json`; lockfiles are now tracked).

### Task 2 — session record & replay + director memory

- `src/director/director.ts` — shared director core: pure
  `buildDirectorPrompt` (variants `memory` / `no-memory`), catalogue
  prefilter (recency blocklist kept, complexity ceiling, parameterised
  window), response parsing/clamping, Ollama call. The live route and replay
  share this code exactly; `tools/replay.mjs` imports the `.ts` directly via
  Node's native type stripping (keep the file erasable-syntax-only).
- Recording: while Auto-Director runs, the controller streams to
  `sessions/<iso>.jsonl` via `POST /session/append` — session config, every
  director decision (feature window, request, raw LLM response, pick, filter,
  latency, recent slugs), hold ticks, and all operator actions (captured at
  the mapping engine's emit hook). Fire-and-forget; cannot break the live path.
- Director memory: the prompt shows the last 3 decisions (profile + preset +
  filter) and asks for a progression; `historyN` and `catalogue_window` are
  parameters. Falls back to the old prompt shape when history is empty.
- Replay: `node tools/replay.mjs sessions/<f>.jsonl [--prompt-variant ...]
  [--history-n N] [--catalogue-window N] [--model m]` — accumulates its own
  recency/memory, prints original vs new pick per window. Verified end-to-end
  against real qwen3:8b; variants produce visibly different picks.

### Task 3 — beat phase in `core/audio.js`

- Tick interval measured (EMA of deltas); lag→BPM and the ~4 s
  autocorrelation window derive from it — works at any refresh rate.
- Onset strength = half-wave-rectified spectral flux weighted toward
  sub/kick/low bins.
- BPM: parabolic peak interpolation + refinement against the real
  onset-event span + octave disambiguation (half-lag check).
- PLL exposing `beatPhase` / `barPhase` / `beatConfidence`; ±0.25 window,
  gain 0.15, plus an acquisition mode (hard snap while confidence < 0.4) —
  the brief's nudge rule alone deadlocks on a constant out-of-window offset.
- `MODULE_ABI.md` documents the fields; `stick-dancer` bounces from
  `beatPhase × beatConfidence` as the reference usage.
- `tools/beat-test.mjs` (synthetic clock + kick spectrum): 120 BPM @ 60 Hz,
  120 @ 120 Hz, 128 @ 60 Hz, 174 @ 60 Hz all pass — BPM Δ0.00, phase error
  ≤ 0.033 beats over 60 s.

## Unsolved problems

1. **Director latency.** ~26 s per pick live with qwen3:8b at catalogue
   window 60 (Ollama prompt-eval bound), ~12 s at window 25. Means: (a) live
   picks land ~25 s after the music changes — arguably the biggest set-quality
   issue right now; (b) the brief's "10-minute session replays in under a
   minute" acceptance is unreachable on this machine (2–5 min realistic).
   Levers: smaller catalogue window, shorter descriptions, a smaller model,
   or a two-stage pick (cheap prefilter → tiny final prompt).
2. **PLL validated only synthetically.** Clean-kick harness passes; real DJ
   audio (syncopated basslines, off-beat bass, four-on-the-floor with strong
   snares) is untested. `beatConfidence` is the on-stage indicator — watch it
   during the next real-music session before trusting `beatPhase` for
   anything load-bearing.
3. **Memory prompt unevaluated on real data.** The record/replay tooling
   exists, but only a 3-window smoke session has been recorded
   (`sessions/smoke-test.jsonl`). Needs a real 10-minute set recorded, then a
   memory vs no-memory replay comparison to judge whether memory actually
   improves progression.
4. **Preset tag skew (pre-existing).** The llava-generated catalogue tags are
   heavily biased (majority "complexity 3 / calm / swirling"), which blunts
   both the complexity ceiling and the director's discrimination. Options:
   re-bootstrap with a calibrated prompt, hand-curate the worst entries, or a
   larger vision model.
5. **Task 4 not started.** Creature module (SDF shapes → spring tissue →
   skeleton gait driven by `beatPhase`). Per the brief it ends with a capture
   and a human judgment call: does it read as a creature?
6. **Brief corrections worth folding back in** (so the document stays true):
   preview was superseded by the controller, not preset-snap; browser
   experiments must live under `web/app/` (Vite root), not top-level
   `experiments/`; the PLL nudge rule needs the acquisition mode.
7. **Minor.** Render-window JS bundle is ~2 MB minified (butterchurn presets
   dominate — code-splitting would help if load time ever matters); the
   server has no auth (fine on a private LAN, worth remembering it's an open
   relay + file-append endpoint); director history/session reset on every
   Auto-Director stop by design.
