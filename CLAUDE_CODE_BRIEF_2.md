# processing-llm — follow-up brief (after Tasks 1–3)

Read `STATUS.md` first. Tasks 1–3 of `CLAUDE_CODE_BRIEF.md` are done and the
status file is accurate. This brief addresses the open problems it lists and
corrects the original brief. Do the tasks in order; stop and report after each.

Ground rules from the original brief still apply: frames before frameworks,
no new surfaces, live path stays boring, one repo, delete don't attic.

## Task A — Fold corrections into the original brief

Edit `CLAUDE_CODE_BRIEF.md` so it matches the repo as built:

- `preview.html` was superseded by the controller's module list + test pane,
  not by `preset-snap.html` (which is the headless bootstrap driver).
- Browser experiments live under `web/app/` (the Vite root), not a top-level
  `experiments/`.
- The PLL needs an acquisition mode; the nudge-only rule deadlocks on a
  constant out-of-window offset.
- Replay acceptance ("10-minute session under a minute") is conditional on
  Task B below, not on hardware.

Acceptance: the brief and `STATUS.md` do not contradict each other.

## Task B — Director latency: stable prefix, cacheable prompt

Diagnosis: ~26 s/pick at catalogue window 60 is Ollama prompt-eval time. Every
call pays full prompt eval because `director.ts` shuffles the catalogue per
call, so the prompt prefix is never identical and the KV-cache prefix reuse
(`keep_alive: -1`) never applies.

Change `buildDirectorPrompt` to a **stable prefix + variable tail**:

1. Prefix (byte-identical across calls): role line, filter spec, and the
   **full** catalogue — all presets, fixed order (sort by slug), fixed text.
   Load once and memoize the formatted string; do not rebuild per call.
2. Tail (varies): history lines, current profile, and the candidate filter
   expressed as `Choose only from these preset numbers: [12, 34, 57, ...]`
   — this replaces the shuffled window as the "fresh subset" mechanism.
   Recency blocklist and complexity ceiling produce this number list.
3. Remove the shuffle entirely. Keep `catalogue_window` as the size of the
   candidate number list, not as a truncation of the catalogue text.
4. Instrument: log Ollama's `prompt_eval_count` and `prompt_eval_duration`
   from the response for every call into the session JSONL. The first call
   should show full prompt eval; subsequent calls should show only the tail.
5. If qwen3:8b handles a 104-entry list badly (picks off-list or ignores the
   number constraint), keep the design and shorten descriptions to one
   clause each before reaching for a smaller model.

Acceptance: second and later live picks under 5 s on the same machine that
measured 26 s; `prompt_eval_count` on warm calls is a small fraction of the
first call; replay of the smoke session is proportionally faster. Report the
numbers.

## Task C — File-based audio input (for reproducible validation)

Add a second start path to `core/audio.js`: `startFromFile(url)` creates a
`MediaElementAudioSourceNode` (or `AudioBufferSourceNode`) feeding the same
analyser graph as `start()`. Expose it in the render window behind a dev-only
control (query param `?audio=file:<path>` is enough; no new page). The file
must also be routed to `audioCtx.destination` so it is audible.

Then:

1. Extend `tools/beat-test.mjs` (or add `tools/beat-test-real.mjs`) to run the
   PLL against real tracks via the file path in headless Chrome, given a list
   of `{ file, bpm }` pairs. Report BPM error and phase stability for each.
   Use at least one four-on-the-floor track, one syncopated/off-beat bassline,
   one with strong snares, one with a breakdown. The local
   `music/Prodigy - Girls.mp3` is one of them; the user supplies the rest.
   Never commit audio files.
2. Record a full-length session from a file (10+ minutes of continuous
   audio) into `sessions/`, so Task D has real data.

Acceptance: the real-track harness runs and reports; at least one recorded
session longer than 10 minutes exists; `beatConfidence` behaviour through the
breakdown is described in the report (it is expected to drop; the question is
whether phase re-acquires cleanly afterwards).

## Task D — Evaluate director memory on real data

With the Task C session recorded and Task B latency fixed:

1. Replay it with `--prompt-variant memory` and `--prompt-variant no-memory`.
2. Produce a side-by-side table (window, profile summary, pick A, pick B) and
   a short written judgment: does memory reduce repeats, does it produce
   progression, does it produce worse section fit? Keep it to facts visible
   in the table; the aesthetic call is the user's.
3. Whichever variant is worse becomes non-default. Do not delete the other;
   replay A/B is the point of keeping both.

Acceptance: the table and judgment are in `STATUS.md`.

## Task E — Replace vision-judged preset tags with measured ones

The llava/moondream tags are skewed (majority "complexity 3 / calm /
swirling") and blunt the director's discrimination. The screenshot pipeline in
`scripts/visual-bootstrap.mjs` already renders each preset headlessly.

1. During bootstrap, capture ~2 s of frames per preset (e.g. 8 frames at
   250 ms) and compute numeric tags: mean luminance, colourfulness (RMS
   chroma), edge density (Sobel magnitude mean), and motion (mean absolute
   frame difference). Normalise each across the whole catalogue to quantiles
   (1–5).
2. Keep the LLM prose description; drop LLM-judged `complexity`, `energy`,
   `brightness`, `motion` in favour of the measured quantiles. Keep `density`
   only if it maps to a measurement; otherwise drop it.
3. Update `formatCatalogue` to print the numeric tags and the prefilter to use
   measured complexity (edge density × motion, or whichever combination
   separates the catalogue best — report the distribution).
4. Re-run bootstrap for all presets. Script must be rerunnable and skip
   presets whose measurements already exist unless `--redo`.

Acceptance: tag histograms are no longer dominated by one bin; the director
prompt shows the new tags; a replay before/after shows different picks.

## Task F — PLL documentation caveat

In `MODULE_ABI.md`, state explicitly: `barPhase` is a consistent 4-beat clock
anchored to whichever onset the PLL first acquired, **not** to the musical
downbeat. Modules must not assume `barPhase === 0` is the "one". Downbeat
tracking is a separate, future signal. Also document the recommended fallback
for modules: when `beatConfidence < 0.4`, free-run an oscillator at the last
confident BPM rather than stopping.

Acceptance: the ABI doc says this; `stick-dancer` implements the fallback.

## Then

Task 4 of the original brief (creature module) — unchanged, plus the
`beatConfidence` fallback from Task F. Do not start it until Tasks B and C
are done, because it needs fast director picks to test against a set and
file-based audio to test repeatably.

## Still out of scope

Downbeat detection, smaller/different director models, two-stage director,
code-splitting the bundle, auth on the relay, anything GRA/Lenia/evolution.
