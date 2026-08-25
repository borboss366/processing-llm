# processing-llm — brief 12.6: test bench + move rotation

Two items from the user's live GPU session. CLAUDE.md rules.

## Task 1 — Bench page (observer surface for manual testing)

`bench.html`, served like the controller, READ-ONLY over existing state
(`audio.state` via the render window's WS relay + the session stream).
No new instrumentation in the live path beyond exposing already-computed
values; polling/pushing at ≤ 15 Hz is fine for everything but the click.

1. **Beat instrument**
   - Click track: a WebAudio blip scheduled at predicted beatPhase=0
     (schedule from bpm + phase, lookahead ~100 ms so it does not ride
     rAF), toggle button, volume slider. Downbeat (barPhase wrap) gets a
     higher-pitched blip. THIS IS THE CENTERPIECE — the user judges
     tracking by ear.
   - BPM readout + 60 s sparkline; beatConfidence gauge; bar dot 1-2-3-4.
   - Onset-vs-phase strip: each onset plotted at its signed phase error
     vs the predicted grid, scrolling last 30 s, zero line marked. Tight
     cluster at 0 = locked; ±0.5 cluster = octave/offbeat.
   - Tap-along: hold focus, user taps spacebar on beats; taps drawn on
     the same strip in a second colour; running median offset shown.
2. **Audio strip**: 8 band bars, RMS, flux with onset flashes, centroid;
   the director's energy z-score with zLow/zHigh bands drawn.
3. **Creature strip**: FSM state + active move + move-local phase wheel
   (spokes at key phases); 60 s state/move ribbon; blend indicator; live
   joint-target speed sparkline with spike flags (same metric as the
   harness).
4. **Decision log**: scrolling tail of session events (state changes,
   director picks + latency, quantized commits, holds, audience-shape
   events).
5. No aggregate "score" widgets. Keep the page one screen, dark, legible
   from a metre away.

Acceptance: a webm of the bench running against file audio with the
creature cycling; the click track audible in the capture and sitting on
the beat of the techno mix; tap-along demonstrated; README section
"bench" (how to open, what each strip means).

## Task 2 — Move rotation (the gap the user found)

The FSM maps groove-state → groove move only; tstep/armwave are
unreachable except by force. Fix:
1. Sidecar/gait-table level: a state may declare a move REPERTOIRE with
   weights, e.g. groove: [groove 0.5, tstep 0.3, armwave 0.2] (biped
   defaults; ghost keeps its single table).
2. Rotation: on entering the state and every `moveHoldBars` (default 4)
   bar wraps, pick the next move — weighted random, never the same move
   twice in a row when the repertoire has ≥ 2 entries; switch through
   the existing blend layer.
3. `move` param forcing still overrides everything (workbench
   unaffected). Log move switches to the session stream (they feed the
   bench ribbon).
4. Captures: 60 s FSM-driven with the rotation visibly cycling all three
   moves; spike metric 0.

Out of scope: armwave amplitude/visibility rescue (user is trying the
workbench first — pending his verdict), tstep/armwave timing content,
brief 12.5 items if not yet run (this brief may be executed before or
after 12.5; they touch disjoint files except STATUS).
