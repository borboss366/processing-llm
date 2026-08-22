# Status — brief execution (as of 2026-08-22)

What got done against `CLAUDE_CODE_BRIEF.md`, what's still open. Tasks 1–3 are
complete, committed, and pushed; Task 4 (creature module) has not been started.
`CLAUDE_CODE_BRIEF_2.md` is in progress: Task A (errata folded into the
original brief), Task F (barPhase caveat + `lastConfidentBpm` fallback,
implemented in stick-dancer), Task B (director latency), and Task C
(file-based audio + real-track validation; 4-genre matrix still pending
user-supplied tracks) are done. Next: Task D (memory A/B on the recorded
session), Task E (measured tags).

### Brief 2, Task B — director latency (stable prefix + cacheable prompt)

- The prompt is now STABLE PREFIX (role + full 104-preset catalogue, sorted
  by slug and memoized + filter/output spec) + VARIABLE TAIL (history,
  current profile, `Choose ONLY from these preset numbers: [...]`). The
  shuffle is gone; the fresh subset lives in the candidate number list.
- Explicit `num_ctx: 16384` (the prefix is ~11.6k tokens — the default
  context would silently truncate it). Server warms the prefix at boot.
- Off-list picks are corrected deterministically (nearest allowed number)
  and flagged (`off_list`) in the response + session log. None observed yet.
- `prompt_eval_count/duration` + `eval_count/duration` logged everywhere;
  replay gained `--seed` (pins candidate sampling + Ollama generation —
  verified: two seeded runs produce identical picks).
- **Measured**: prefix warm-up 11,639 tokens / 42 s once at boot; live picks
  4.3–4.9 s each including the first (was ~26 s); warm prompt-eval 2.0–2.6 s
  vs 42 s cold; smoke-session replay 13.7 s vs 79.8 s (5.8×). Note: this
  Ollama build reports cached tokens in `prompt_eval_count`, so the
  *duration* is the honest cache signal, not the count.
- Caveats: any other Ollama call in between (modgen, bootstrap) evicts the
  prefix cache; editing preset descriptions now needs a server restart to
  reach the director prompt.

### Brief 2, Task C — file-based audio + real-track validation

- `core/audio.js startFromFile()`; render window `?audio=file:/music/x.mp3`
  `[&seek=N]`; controller server serves gitignored `music/` at `/music`.
- `tools/beat-test-real.mjs` (headless-Chrome PLL harness) and
  `tools/record-session.mjs` (full-stack session recorder; render and
  controller in SEPARATE browsers — a backgrounded headless tab gets 0 rAF).
- Real audio immediately caught a half-tempo octave lock (62.5 on a ~125 BPM
  techno mix) → tempo estimation now uses a log-normal prior centred
  ~120 BPM + half-lag preference; synthetic harness still passes all 4.
  After the fix the mix reads 124.93 BPM, confidence 0.80 over a 60 s probe.
- **Recorded 12-minute session** (`sessions/2026-08-22T18-23-29-150Z.jsonl`,
  Brejcha-style minimal techno mix, seek 60 s): 38 director picks (21 unique
  presets), 146 hold ticks, 0 errors, 0 off-list picks, median pick latency
  6.4 s. Beat log sidecar `...-beat.json`.
- **beatConfidence through the set**: mean 0.60; 7 dips below 0.4, all 2–4 s
  except one 22 s dip at ~440 s file-time (a breakdown). Through that dip the
  BPM estimate held ~124–127 (did not collapse), `lastConfidentBpm` stayed
  119–127 (the module fallback would have kept visuals dancing at a sane
  tempo), and confidence re-acquired to >0.5 within ~20 s of the beat
  returning. Phase re-acquisition after breakdowns works as designed.
- **Live-path bug found by the recording**: the director double-fired ~4 s
  after every pick — the LLM call (~6.4 s) outlives the 4 s poll and the
  overlapping tick saw the stale anchor/cooldown. Fixed with an in-flight
  guard in `controller.js`. (Also explains median 6.4 s vs the 4.5 s bench:
  paired calls were queueing on Ollama.)
- Remaining for full Task C acceptance: the 4-genre track matrix
  (four-on-the-floor ✓ via the mix; syncopated bassline, strong snares,
  isolated breakdown track still pending — user supplies).

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

1. **Director latency — residual.** Solved to ~4.5 s/pick (see Task B above);
   what remains is generation time (~2 s) + tail eval (~2.5 s). If sub-2 s
   ever matters, the levers are a shorter output format and a smaller model.
2. **PLL real-audio validation is one-genre deep.** Validated on the
   four-on-the-floor techno mix (locked, breakdowns recover — see Task C
   above); syncopated basslines, strong-snare material, and other genres
   still untested until more tracks arrive. `beatConfidence` remains the
   on-stage indicator.
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
6. **Minor.** Render-window JS bundle is ~2 MB minified (butterchurn presets
   dominate — code-splitting would help if load time ever matters); the
   server has no auth (fine on a private LAN, worth remembering it's an open
   relay + file-append endpoint); director history/session reset on every
   Auto-Director stop by design.
