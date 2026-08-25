# Brief 13 — beat clocks + GPU-evening findings

Date: 2026-08-26. Deviation up front: brief 12.5 is referenced ("run
before or after; Task 1 should land after its fixed-rate tick") but was
never delivered to the repo — Task 1 landed on current audio.js; a future
12.5 rebases on the clock interface instead.

## Task 1 — BeatClock interface + GridClock (the spine)

`core/clock.js`: a clock owns ONLY `beatPhase, barPhase, bpm,
beatConfidence` (+`clockTier`), plus `phaseAt(wallMs)` and
`nextDownbeatIn()`. Features and the PLL always run — the PLL now writes
its own closure, published verbatim by **PLLClock** (fallback tier,
diagnostics at `state.pll`) and replaced by **GridClock** when file
playback finds a `music/<file>.beatgrid.json` sidecar: phase from
`element.currentTime` (through a wall-advanced estimate that rejects
Chrome's 10–25 ms currentTime quantization), confidence 1, `phaseAt`
exact. `?clock=pll` forces the tracker; tier goes to the session stream
and the bench header. Consumers read the same fields — zero tier
branching; clock switches drain through the move clock's capped debt.

`tools/gridder.mjs` — offline NON-causal gridding (headless page): full
decode, dual-band log-energy flux envelope, autocorrelation tempo with
the ~125 log-normal prior, Ellis-style DP with full backtrack (the
forward+backward pass), then sliding least-squares smoothing (the DP
jitters ±2–3 hops toward syncopated onsets; a beatgrid is the smooth
underlying pulse). `--bpm` constrains stubborn tracks (keeps DP phase
alignment); `--tap` for fully manual grids. All five tracks gridded:

| track | bpm | onset-z | ibi-spread | dp-jitter |
|---|---|---|---|---|
| Brejcha mix (57 min) | 125.0 | 3.40 | 1.2% | 46 ms |
| Sandstorm | 136.4 | 2.95 | 2.1% | 67 ms |
| MJ Cole – Sincere | 132.7 | 3.03 | 1.8% | 64 ms |
| Prodigy – Girls | 124.7 | 3.62 | 2.9% | 84 ms |
| Pendulum (—bpm 174) | 173.4 | 2.66 | 2.5% | 51 ms |

Pendulum's unconstrained autocorrelation picked 123.5 — exactly the
predicted stubborn case; `--bpm 174` fixed it. dp-jitter is a
syncopation read (how far raw DP beats sat from the smooth grid), not a
grid-quality number.

**Acceptance** (`tools/grid-check.mjs`, verify --full): GridClock
auto-selected on the mix; bench click vs the sidecar grid **median
0.9 ms, p90 1.4 ms** (target < 15 ms). The user's rhythm-shifting extra
track wasn't supplied yet — the 57-min Brejcha-style mix (which shifts
across its internal tracks) stood in; gridding a new track is one
`gridder` run. En route, two measurement fixes: the media-time estimate
above, and tick-paired media↔wall stamps (`state.mediaWallMs`) — an
unpaired Date.now() at evaluate time sat a headless frame away from the
tick and faked ~24 ms of error.

## Task 2 — music pauses (instrument first)

Permanent instrumentation, all → session stream + bench decision log:
element events (stalled/waiting/suspend/pause/playing), AudioContext
statechange, PerformanceObserver long tasks > 200 ms, a wall-vs-media
skip detector (|Δmedia − Δwall| > 250 ms while playing), and visibility
flips. Mitigations applied proactively: `preload=auto` (already set) and
a screen wake-lock on start.

**30-minute soak** (`tools/pause-soak.mjs`): ZERO gap-class events —
no media-skips, no stalls, playback never froze. Observed and
classified as benign: startup `waiting`/`suspend`/`ctx running` (load
mechanics, first 3 s), four progressive-buffer `suspend`s, one 259 ms
long-task at page boot. **The user's live symptom did not reproduce
headless** — the mechanism report stays open; the instruments are
permanent, so the next real-display session will name it (visibility
throttling remains the prime suspect and is now directly logged).

## Task 3 — dance robustness

1. **BPM slew**: PLL tier feeds the move clock through a ≤1%/s limiter;
   GridClock passes through (its changes are real).
2. **Catch-up caps by visibility**: locomotion states get 0.12×nominal
   headroom (vs 0.45 elsewhere) — residual error drains as a couple of
   slightly longer steps over ~2 strides, never a mid-stance surge.
   (Interpreted "absorb at footfalls" as the low continuous cap: the
   stride timing IS the absorption; a discrete at-plant drain was
   rejected as a spike generator.)
3. **Asymmetric level envelope**: 0.12 s attack, 2 s release, floored at
   idle-breathing amplitude; raw level still feeds the FSM z-score.

**Torture run** (`tools/torture-check.mjs`, both tiers): tempo step
×1.08 → back, 1 s silence gap, 4 s confidence collapse + re-acquire —
**0 flagged spikes on both tiers**; envelope + move-clock rate +
confidence plots in `reports/torture-{grid,pll}.svg` (the envelope
glides through the 4 s collapse to its floor and recovers).

## Task 4 — walk transitions + entry

- Stride ramps over ~1 bar entering walk and decays out of it (the body
  glides to a stop); feet and odometry share the SAME eased stride —
  they can never disagree (the original slide-bug family). First plants
  derive from current positions via the existing blend re-anchor.
- The entry latch no longer hides the creature: it enters and breathes
  in idle immediately; beat-locked states stay gated on the latch
  (instant on GridClock), so it visibly catches the beat when lock
  arrives.

Captures (20 s, both tiers, FSM auto): 0 spikes, slide ≤ 0.72 px,
components 1, both PASS.

## Task 5 — FK pose propagation + honest placeholders

The chain used `J.theta + 0.35·P.theta` (immediate parent only, damped)
— elbows "pulled up" without rotating, kicks never carried the foot.
Now TRUE hierarchical FK: accumulated rotation (`accRot`) composes down
the chain; pins, blends, stance locks and overrides all ride the
accumulated frame; bone lengths still hold by construction. Tables
re-authored to rotations: tstep kick = thigh rot + shin counter-rot
(no more dx-only foot offsets), armwave = sequential shoulder/elbow
rotations with goo-surviving amplitudes (all chain joints keyed in every
key so bases don't dip).

**Acceptance** (`tools/fk-check.mjs`): scrubbing tstep kick→return
carries the ankle **34 px** through space (stills
`reports/fk-tstep-{kick,return}.png`); armwave rotation peaks travel
elbowL@0.19 → handL@0.38 of the loop (a wave, not a flap —
`reports/fk-armwave.webm`); 0 spikes. Still `-placeholder`: the user's
sculpting session follows.

## Task 6 — visual beat calibration

`visualBeatOffsetMs`: visuals (creature phase/bar, compositor zoom)
consume `visualBeatPhase` led by the offset; the click and bench stay
raw. Persisted per machine (render-side localStorage), adjustable live
from the bench slider next to the click controls; README carries the
calibration hint. **Beat-impact convention verified**: phase 0 = lowest
squash point — walk squash peaks at 0 (cos), groove bounce is at ground
at 0/0.5 (sin², lifts between beats), groove table dips at 0.25/0.75
(up between beats), tstep kicks hit at 0/0.5. Convention documented in
MODULE_ABI (tables must keep it or calibration is meaningless).

## Verify

Fast tier 4/4; workbench, grid-check, both tortures, fk-check, both
entry captures, 5-min soak (classifier-refined) all PASS after the full
change set.

## Open

- Music-pause mechanism: not reproduced headless; awaiting the user's
  next live session with the instruments on.
- User items: bench by-ear verdict with GridClock, visual-offset
  calibration on the real display, move sculpting, ghost/phone/post
  gates.
- dnb-174 (PLL tier only now — the party runs on grids; still worth the
  12.5 pass when it lands).
