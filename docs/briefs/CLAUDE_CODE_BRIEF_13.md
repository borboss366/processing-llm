# processing-llm — brief 13: beat clocks + GPU-evening findings

Source: the user's first live GPU session (2026-08-25). Nine findings,
one architectural conclusion: causal beat tracking cannot sync tightly
enough for a rhythm-shifting DJ track (measured by ear: clicks lag tempo
changes and offbeat-lock on rolling basslines — expected PLL physics,
not a bug). The party runs on precomputed beatgrids; the PLL becomes the
fallback tier. Everything else from the session hangs off that spine.

Spider is postponed; this brief replaces it as 13. CLAUDE.md rules;
verify green; every task's report cites measurements.

## Task 1 — BeatClock interface + GridClock (the spine)

1. Extract a clock interface owning ONLY the phase fields of
   `audio.state`: `beatPhase, barPhase, bpm, beatConfidence`, plus
   `phaseAt(tFutureMs)` and `nextDownbeatIn()` (lookahead). Feature
   extraction (bands/RMS/flux/onsets) is untouched and always runs.
   Consumers change ONLY where they import phase from — no downstream
   branching on clock type, ever.
2. **PLLClock**: the current tracker behind the interface, unchanged.
   `phaseAt` = extrapolation (the click scheduler's existing math,
   formalized).
3. **GridClock**: for file playback with a sidecar
   `music/<track>.beatgrid.json` ({ bpm segments | beat times,
   firstBeatMs, downbeatEvery }). Phase derived from
   `element.currentTime` each tick; confidence 1; `phaseAt` exact.
4. **Selection**: file source with grid present → GridClock; else
   PLLClock; param override; the active clock + tier shown on the bench
   and in session events. Mid-set clock switches feed the existing
   capped-debt smoothing (they are phase discontinuities, same as
   re-acquisition).
5. **`tools/gridder.mjs`**: offline grid computation — run the existing
   detector NON-causally (full file, forward + backward pass, no
   real-time constraint), emit the sidecar + a confidence report per
   track; `--tap` mode accepts manual bpm+firstBeat for stubborn
   tracks. Grid all current music/ tracks. Acceptance: with GridClock
   on the techno mix and on a Brejcha-style rhythm-shifting track
   (user supplies), the bench click sits on the beat through tempo
   shifts (headless numeric proof: click-vs-grid error < 15 ms; the
   by-ear verdict is the user's).

## Task 2 — Music pauses (root cause; front of the reliability queue)

Symptom: playback audibly stops ~1 s then resumes, intermittently.
1. Instrument first: element events (stalled/waiting/suspend),
   AudioContext state changes, main-thread long-task observer, and
   wall-clock vs `currentTime` skips — all into the session stream.
   Reproduce (long soak with the set running; background-tab and
   focus-change scenarios explicitly tested — browser throttling is a
   prime suspect).
2. Report the mechanism with evidence, then fix or mitigate (element
   preload/buffer strategy, wake-lock, keep-visible guidance, or
   whatever the evidence names). Acceptance: 30-minute soak with zero
   audible gaps, plus the instrumentation staying in permanently.

## Task 3 — Dance robustness to clock/level events

1. **BPM slew limit**: the move clock consumes a rate-limited bpm
   (≤ ~1%/s drift toward the tracker's estimate); PLL tier only —
   GridClock bpm passes through (its changes are real).
2. **Catch-up caps by visibility**: locomotion states get a lower
   phase-debt cap; walk absorbs residual error ONLY at footfalls
   (slightly longer/shorter step), never mid-stance. Kills the
   "couple of steps faster" surges.
3. **Asymmetric level envelope**: fast attack, ~2 s release on the
   level that scales move amplitudes; floor at idle-breathing amplitude
   (Perlin layers never gate on audio). A 1 s dropout softens the dance
   instead of freezing it. Kills the stop-for-a-second freeze.
4. Acceptance: scripted torture run (tempo step, 1 s silence gap,
   confidence collapse/re-acquire) captured on both clock tiers;
   joint-speed spikes 0; a plot of move-clock rate + level envelope
   through the events in the report.

## Task 4 — Walk transitions + entry

1. Ease root speed over ~1 bar entering walk (lean into it),
   decelerate on exit; first foot plant derived from current foot
   positions, not the idealized stride.
2. Entry delay fix: creature may enter in `idle` immediately with the
   music (breathing needs no beat); beat-locked states remain gated on
   confidence — it visibly "catches the beat" when lock arrives. On
   GridClock the gate is instant anyway.
3. Acceptance: capture of enter→idle→catch-beat→walk→groove with no
   snaps (spike metric), on both tiers.

## Task 5 — FK pose propagation + honest placeholders

Session evidence: elbows "pull up" without rotating; armwave reads as a
flapping cartoon chicken; legs don't step — dy-offsets without chain
rotation.
1. Verify/implement hierarchical pose application: a joint's `rot`
   transforms all descendants (offsets compose down the chain). The
   workbench scrub is the test: scrubbing tstep's kick key must carry
   the ankle through space.
2. Re-author the three placeholder tables to USE rotations (kick =
   hip rot + knee counter-rot; wave = sequential shoulder/elbow/wrist
   rots with amplitudes big enough to survive the goo). Still
   `-placeholder` — the user's sculpting session follows.
3. Acceptance: scrub stills at the key phases showing ankle travel and
   a wave that visibly TRAVELS in the webm; spike metric 0.

## Task 6 — Visual beat calibration

`visualBeatOffsetMs` param applied to the phase CONSUMED BY VISUALS
(click stays raw): rhythm-game-style display/audio latency calibration,
set per machine, persisted, adjustable live (slider on the bench next
to the click controls). Include a calibration hint in the README
(nudge until the bounce impact sits on the click). The beat-impact
convention is part of this task: phase 0 must correspond to the
bounce's LOWEST (squash) point in all tables — verify and fix tables
if not.

## Deferred from the session

Puppet page (12.7 postponed by the user), armwave content quality
beyond FK (user sculpting), spider (now brief 14), ghost/phone/post
gates (user, still pending), dnb-174 (likely absorbed by 12.5 — run
12.5 before or after this brief; disjoint except audio.js seams —
if 12.5 has not run yet, Task 1 extraction should land AFTER its
fixed-rate tick to avoid double surgery on audio.js).

## Out of scope

Ableton Link / MIDI clock (interface slot exists, no implementation),
scene schema, field scene, GRA, mocap.
