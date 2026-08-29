# Brief 13.1 — survive occlusion, never die silently

Date: 2026-08-29. Source: the user's 14:19–14:25 live log — creature move
events stopped permanently after a visibility flip while audio-health
kept logging.

## Diagnosis note (the brief asked for this plainly)

**The giant-dt exception was NOT reproduced.** Twenty real 2–8 s
main-thread gaps (no rAF, no timers, then one giant dt) produced ZERO
thrown errors — the brief-9 dt clamps already protect every integrator.
The silent-death mechanism is therefore not "first giant dt throws".

What the reproduction DID surface: freezing the page via CDP
(`Page.setWebLifecycleState 'frozen'`) put it into the back-forward
cache, **killing both its WebSockets and never cleanly returning** —
navigation-freeze semantics, not occlusion, but it demonstrates the
failure class where page-level freezing kills a loop while others
survive. The live symptom (module events dead, audio-health alive) is
consistent with the **p5 rAF loop dying alone** — p5 runs its own rAF,
separate from the main render loop that emits audio-health. That exact
mode is now covered by a watchdog (below). The fix layers stand
regardless of which precise trigger the user's machine produced.

## Task 1 — exceptions are events, modules self-heal

- Registry: every draw dispatch reports failures as `module-error`
  events (message + stack → session stream + bench log), marks the
  module failed, and **recovers it after a 2 s backoff** — teardown,
  state wipe, re-enter through the normal fade, `module-recovered`
  logged. Two failures inside 60 s → stays down with the error visible
  (retry only after the window expires). No crash-loops, no silent
  skips.
- NaN tripwire: ~32-sample position scan + world/clock check after
  integration; a poisoned frame throws deliberately and rides the same
  recovery path.
- p5-loop watchdog (main.js): if p5's own rAF stops for >2 s while the
  page is visible, `p5-loop-stalled` goes to audio-health and
  `p5Instance.loop()` restarts it — the exact silent mode from the live
  session.

## Task 2 — time discipline under throttling

- The registry stamps `ctx.resumeGapMs` when wall dt exceeds 1 s (one
  frame only) and broadcasts `resume-after-gap`; interface advancement
  stays capped at 80 ms.
- The creature's resume path: latch the move clock to current phase
  (zero debt), zero all tissue velocities, re-anchor the pose through
  the blend layer (the clock-switch path), announce `creature-resume`.
- The PLL never integrates a gap (step capped at 100 ms + health
  event); GridClock is exact by construction. Rotation bar-counting
  cannot accumulate while hidden (no ticks = no counting; at most one
  wrap fires on resume).

## Task 3 — reproduction + acceptance

`tools/occlusion-check.mjs` (verify --full at 8 gaps): 20 randomized
2–8 s synchronous busy-loop gaps over ~5 min, FSM auto, grid tier:

- **resumed 20/20** (loop phase advancing within ~3 s of every resume)
- components 1 in the post-run capture
- **0 flagged spikes** — every re-anchor rode a declared blend window
- 20 `creature-resume` events, **0 module-errors** (nothing to recover
  — the armor is belt-and-braces over already-sound dt handling)

30-min pause soak re-run with occlusion gaps mixed in (~19 injected):
**PASS — zero non-startup gap-class events** across 19 injected 3–6 s
gaps in 30 minutes of playback (only load-time seek artifacts and
progressive-buffer suspends). One refinement fell out: the p5 watchdog
fired on every SHARED gap (a busy-loop freezes both rAF loops) — it now
requires the main loop to have run continuously through the window, so
it only triggers on the real p5-died-alone mode.

## Session guidance

Second display / side-by-side remains comfort, not correctness: gaps
now cost one blend re-anchor, errors are loud, and a dead p5 loop
restarts itself.
