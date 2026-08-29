# processing-llm — brief 13.1 (patch): survive occlusion, never die silently

Live session evidence (user's decision log, 14:19–14:25): Chrome window
occlusion fires paired visibility hidden/visible flips throughout a
working session; after the 14:24:29 flip the creature's move events stop
permanently while audio-health keeps logging — the module's tick died,
silently, almost certainly on the first giant/burst dt after rAF
throttling. Three layers of fix; the module must be un-killable and
loud about near-death.

## Task 1 — Exceptions are events, and modules self-heal

1. Wrap every module tick/draw dispatch in the registry with try/catch.
   A thrown error → session stream + bench decision log
   (`module-error: <id> <message>` with stack in the session file), and
   the module is marked failed — not silently skipped forever.
2. Auto-recovery: a failed creature re-inits (same shape, params,
   palette, behavior) after a short backoff, entering through the
   normal fade; recovery logged (`module-recovered`). Two failures
   within 60 s → stay down, keep the error visible (no crash-loop).
3. NaN tripwire: after integration, a cheap any-NaN check on positions;
   trip → treated as a caught error (log + re-init). Cheaper to detect
   than to render a ghost of nothing.

## Task 2 — Time discipline under throttling

1. Global dt clamp at the module-services level: wall dt is delivered
   to physics/clocks capped at 100 ms; anything longer is a RESUME
   event, not a timestep.
2. On resume (visibility visible, or any dt > 1 s): do not integrate
   the gap — snap the clock forward (GridClock is exact anyway; PLL
   re-anchors), zero tissue velocities, re-anchor pose through the
   existing blend layer (same path as a clock switch), log
   `resume-after-gap: <ms>`.
3. While hidden: stop scheduling work that assumes cadence (move
   rotation bar counting pauses rather than accumulating).

## Task 3 — Reproduce and pin it

Headless harness: emulate visibility flips (CDP
Emulation/lifecycle or a test-mode rAF gap injector param — 
implementer's choice, but the gap must be real to the module: no ticks
for 2–8 s, then resume). Script: 20 randomized gaps over 5 min with
FSM auto + file audio.
Acceptance: creature visible and moving after all 20 (component count 1
in a post-run capture), zero unrecovered module-errors, move events
resume after every gap, spike metric 0 outside declared resume
re-anchors. Also re-run the 30-min pause soak with occlusion flips
mixed in.

## Report note

State plainly whether the giant-dt exception was reproduced and what
the actual thrown error was (this confirms or corrects the diagnosis;
if the module death has a different mechanism, name it with the trace —
the fix layers above stand regardless).

## Out of scope

Move realism (user sculpting), 12.5-slim (tags + fixed-rate PLL tick),
puppet page, spider. Session guidance meanwhile: keep the render window
unoccluded (second display or side-by-side) — but after this brief that
is comfort, not correctness.
