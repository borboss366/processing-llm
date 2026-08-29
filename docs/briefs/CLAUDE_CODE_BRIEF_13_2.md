# processing-llm — brief 13.2: close the backlog

Purpose: clear every remaining agent item from briefs 12.5–12.7 so the
board is empty before the realism arc (14), spider (15), field scene
(16). CLAUDE.md rules; verify green; STATUS rewritten at the end.

## Task 1 — Measured preset tags (12.5 Task 2, unchanged in value)

As specified in 12.5: during bootstrap capture ~2 s per preset
(8 frames), compute mean luminance, RMS chroma, Sobel edge density,
mean |frame diff|; normalise to 1–5 quantiles across the catalogue;
REPLACE the vision-judged complexity/energy/brightness/motion tags
(keep the prose); prefilter + director prompt consume the measured
tags. Rerunnable, `--redo` to recompute, refuses while the controller
is live unless `--force` (KV-cache eviction). Acceptance: histograms no
longer single-bin; replay A/B (same session, old vs new tags) shows
changed picks; histograms + a picks-diff excerpt in the report.

## Task 2 — Fixed-rate PLL tick (12.5 Task 1, rebased on the clock)

The PLL family's last member: feature extraction + PLL still ride rAF.
1. Move the analysis tick (FFT read, flux, onset, PLL update, feature
   windows) onto a fixed-rate clock (~50–60 Hz, drift-corrected timer
   or AudioWorklet cadence), independent of display rate, visibility,
   and headless GL. GridClock/consumers unchanged — this lands entirely
   inside the PLL/feature side of the clock seam.
2. Re-run the full beat matrix at simulated 30/60/120 Hz render rates
   AND page-idle. Acceptance: identical results (±0.5 BPM) at every
   rate; the brief-12 idle-confidence collapse gone; the bench onset
   strip no longer thins at low frame rates (12.6 cross-check).
3. Re-test dnb-174. If still bistable at fixed rate it is a genuine
   prior issue: document as PLL-tier known-item, do NOT tune the prior.
4. Delete dead rate-compensation paths once redundant.

## Task 3 — Puppet page (12.7, updated for the current codebase)

As specified in 12.7, with two updates from what has landed since:
clock-tier and `visualBeatOffsetMs` belong on the page too (tier badge;
the calibration slider mirrors the bench one), and the snapshot JSON
includes the clock tier. Otherwise unchanged: cast & state (shape
selector incl. approved spool, enter/exit, behavior force, move rig
relocated from the controller), auto-enumerated param controls,
shared bench-widgets module (no duplicated widget code), snapshot to
clipboard + session stream. Controller sheds the Move section
(link in its place). Acceptance: the 12.7 webm script.

## Task 4 — Housekeeping

1. `docs/briefs/` complete through 13.2 (10, 11, 12, 12.5, 12.6, 12.7,
   13, 13.1, 13.2 — several were delivered as downloads only).
2. STATUS full rewrite: verified table (grid sync 0.9 ms, occlusion
   20/20, FK, torture runs...), Open = ONLY user gates + user inputs +
   the three content briefs, Next = brief 14.
3. ARCHITECTURE note trigger review in STATUS (layer-manager trigger
   fires with the field scene — state it).
4. `verify --full` green or explained-SKIP end to end; the low-tempo
   regression check reports SKIP with "awaiting user tracks
   (~93 + ~81 BPM)".

## Task 5 (optional, only if cheap) — memory A/B in tag space

With Task 1's numeric tags: re-run the brief-4 memory-vs-no-memory
replay and compare the two pick SEQUENCES as trajectories in tag space
(step distance, smoothness). One table + three sentences; no prompt
changes. Skip without ceremony if anything upstream makes it
non-trivial.

## Out of scope

Realism (14), spider (15), field scene (16), Link/Prolink tiers, mesh/
cutout skins, Route B. User items unchanged: gate evening #2
(calibration, ghost, phone, post/bgDim), two low-tempo tracks,
field-scene decision, sculpting session.
