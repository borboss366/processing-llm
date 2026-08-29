# processing-llm — brief 12.5: cleanup before the spider

Purpose: close every agent-actionable open item before Brief 13, so the
board is only user items + new content. CLAUDE.md rules; verify green.

## Task 1 — Decouple audio analysis from display rate (the PLL family fix)

Three measured symptoms, one cause: feature extraction runs per rAF, so
statistics depend on display rate — (a) the original 60 fps lag→BPM
hardcode, (b) the dnb-174 bistable, (c) brief 12's idle-page confidence
collapse at ~120 Hz rAF.

1. Move the analysis tick (FFT read, flux, onset, PLL, feature windows)
   onto a fixed-rate clock independent of rendering: an AudioWorklet-
   driven cadence or a drift-corrected timer at 50–60 Hz — implementer's
   choice, but the rate must be constant across display refresh, page
   visibility, and headless/software-GL. `audio.state` remains a plain
   object consumers read each frame (interpolation not required; the
   move clock's caps already smooth deltas).
2. Re-run the FULL beat matrix (synthetic + all real tracks) at
   simulated 30 / 60 / 120 Hz render rates AND with rendering fully
   idle. Acceptance: identical BPM/lock results (±0.5) at every rate;
   the brief-12 idle scenario holds confidence ≥ 0.5.
3. Re-test dnb-174 specifically. If the bistability persists at fixed
   rate, it is a genuine tempo-prior issue: report the evidence and
   leave it a known item — do not tune the prior in this brief.
4. Delete the now-dead rate-compensation code paths (measured tick EMA
   in lag conversion etc.) once redundant.

## Task 2 — Measured preset tags (brief 4 Task 4, parked twice)

As originally specified, updated to the current pipeline: during
bootstrap capture ~2 s per preset (8 frames), compute mean luminance,
RMS chroma, Sobel edge density, mean |frame diff|; normalise to 1–5
quantiles over the catalogue; REPLACE the vision-judged
complexity/energy/brightness/motion tags in the catalogue (keep the
prose description); prefilter and prompt use the measured tags. Script
rerunnable, skips existing unless `--redo`, refuses to run while the
controller is live unless `--force` (KV-cache eviction). Acceptance:
tag histograms no longer single-bin dominated; a replay A/B (same
session, old vs new tags) shows changed picks; report the histograms.

## Task 3 — Housekeeping

1. STATUS rewrite reflecting 12 + 12.5; Open list must carry ONLY:
   user gates (9/10/11/ghost), user move play + placeholder retirement,
   low-tempo tracks (user), field-scene choice (user), spider (13).
2. `verify --full` green top to bottom on the dev machine except items
   explicitly blocked on user input — each such item's check reports
   SKIP with the blocking reason, not FAIL.
3. `docs/briefs/` gains 12.5 (this file); ARCHITECTURE note triggers
   reviewed — still unmet until the field scene, state that in STATUS.

## Out of scope

Spider/gait groups (13), field scene (14), move timing content, ghost
art replacement, memory A/B rerun (optional; only after Task 2 tags
exist and only if cheap).
