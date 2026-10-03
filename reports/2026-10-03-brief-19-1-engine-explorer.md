# Brief 19.1 — the engine explorer (table → pixels, instrumented)

## Task 1 — taps (creature.js, `engineTrace` param, off in production)

Per frame when on: s1 table sample · s2 after blend/crossfade · s3
after the mvSpring · s4 after gait/liveness/lag · s5 table slots
post-clamp · FK positions (pre-lock) · post-lock positions + effective
thetas · depth factors (twistFx) · goo constants · flags (clamp counts,
lock weights + lift-yields, blend, accent, spikes). Everything reported
in EXTRACTOR bone semantics via one rule (engine slot J = bone entering
J, so thigh = hip+knee slots summed) — valid for captured AND authored
tables. Ring buffer 1200 frames; `__engineTraceDump/Reset`; the latest
row + rig meta ride `__creatureBench` into bench-state (15 Hz) when on.
Cost when off: one boolean test per frame.

## Task 2 — `tools/engine-trace.mjs` + engine explorers

Captures a move×shape live (8 s ≈ 2 loops), dumps the trace, writes a
self-contained explorer with the capture explorer's idioms: table-ghost
vs engine skeletons after a selectable stage (bones colored by |Δ|),
joint×time heatmap (click → scrub), per-stage RMS LADDER (the rung that
eats the radians), flag filmstrip, render-mode thumbs at the worst
frame. Generated: runningman(profile), tstep×biped-1/2,
armpump×biped-1/2, procedural groove×biped-1/2 — explorers committed;
webms kept for the two judged clips (runningman, tstep-biped-1;
deviation from "one webm each": 37 MB of regenerable screencasts
trimmed to 11 MB — one command recreates any of them).

**The ladder names the next rung (R2 = springs):** runningman blend
0.000 · spring 0.355 · +liveness 0.027 · limits 0.000 · lock 0.003 —
the mvSpring (MV_WN 10 ≈ 100 ms) costs 0.355 rad RMS, worst elbowL
0.588. Everything else is pennies. tstep: spring 0.235, same shape.

## Task 3 — live puppet view

"Engine view" section: skeleton as of a chosen stage over the table
ghost (bones colored by |Δ|), joint × last-10 s deviation strip with
clamp/yield marks, live lock/clamp readout, trace toggle, strip → PNG.
Verified live (191-puppet-engine-view.png): GRID tier, strip drawing,
flags "footR:0.63 · clamps 0" while the running man plays.

## Task 4 — verify rows

`engine-fidelity` (registered in tools/verify.mjs, full tier):
per-stage RMS budgets — blend ≤ 0.05, spring ≤ 0.50 (the declared R2
envelope), liveness Δ ≤ 0.20, limits Δ ≤ 0.02 on non-whitelisted
bones, lock Δ ≤ 0.15 (the A7 class). Any clamp on a captured table
fails unless the table header carries `clampWhitelist` + reason. First
run immediately caught tstep's foot-convention clamps (footL 83/106
frames) — whitelisted in tstep-captured.json with the reason pointing
at the depth re-run. PASS on both clips.

## Acceptance — the knee fix verified IN the tool

Before-trace kept as the exhibit (reports/engine-knee-BEFORE.*): the
unremapped table (provenance stripped) replayed through the same tool.
Same-file RMS cannot see this bug (the engine faithfully follows the
scrambled reference), so the exhibit compares BOTH runs against the
TRUE table by phase:
  kneeL  BEFORE rms 1.273, amp 0.25 of 1.66 (dead) → AFTER 0.370, amp 1.04
  kneeR  BEFORE 1.088, amp 0.22 → AFTER 0.391, amp 1.07
  elbowL BEFORE 1.282, amp 0.13 → AFTER 0.649, amp 1.07
The residual AFTER error is the spring rung, visible as such in the
ladder. USER_GATES gains the engine-explorer question.

## Ops note

A debugging detour found the headless-smoke blank-canvas cause: a
second TAB backgrounds the render page and freezes its rAF (the
documented occlusion constraint, now also the reason harnesses must
bringToFront the render page). The vite dev server was also restarted
after its WS proxy wedged under probe churn — live tabs need a refresh.
