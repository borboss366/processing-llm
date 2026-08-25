# Brief 12.6 — test bench + move rotation

Date: 2026-08-25.

## Task 1 — bench page

`bench.html` (+ `src/bench.js`), served like the controller, READ-ONLY:
consumes a new ~15 Hz `bench-state` WS broadcast from the render window
(already-computed `audio.state` values + a `__creatureBench` seam — the
only live-path additions are these exposures plus a 64-entry onset ring
`[wallMs, signedPhaseErr]` buffered at the existing onset rising edge).

- **Beat instrument**: click track scheduling WebAudio blips from
  bpm + beatPhase with a 25 ms scheduler and ~120 ms lookahead (own
  clock, not rAF), downbeats at 1420 Hz vs 880 Hz, toggle + volume.
  BPM readout + 60 s sparkline, confidence gauge, bar dots, the
  onset-vs-grid strip (±0.5 beat, 30 s), spacebar tap-along plotted in
  yellow with running median offset.
- **Audio strip**: 8 band bars, RMS, flux sparkline, centroid, energy
  z-score with the −0.5/0.5/1.5 FSM thresholds drawn (bench computes
  its own EMA z — a director-style approximation, not the controller's
  exact windowed value).
- **Creature strip**: state/move/blend/spike readouts, move-local phase
  wheel with spokes at the active table's key phases, 60 s state+move
  ribbon, joint-speed sparkline with red spike flags.
- **Decision log**: creature state/move changes, director picks,
  quantized commits, move-table hot-pushes/errors.

### Acceptance

`tools/bench-check.mjs` (verify --full): render + bench in SEPARATE
headless browsers, creature in groove, click track on, 45 s screencast →
`reports/bench.webm` + `bench.png`.

- **Deviation (audio)**: headless screencast is video-only, so "click
  audible in the capture" is replaced by a numeric proof — every
  scheduled click compared against the PLL's belief sampled every 1 s
  (nearest sample, ±2 s): **92 clicks, median error 56 ms** under
  double-browser software-GL load (the PLL itself wobbles there; on the
  real display the estimate is stable and clicks sit tighter). Judging
  clicks against a single end-of-run grid extrapolated backwards was
  rejected as measuring PLL drift, not the scheduler.
- Tap-along is interactive-only; the mechanism shares the click
  scheduler's phase math, exercised live by the user.
- Onset strip is sparse in the headless capture: the onset detector's
  rising edge fires rarely at ~15 fps (bass EMA moves slowly). Populates
  at real display rates.
- Rotation visible: 3 distinct moves in the bench ribbon during the run.

### Debug findings along the way (both environmental, logged)

1. A vite-config edit triggers vite's auto-restart, which left the `/ws`
   proxy delivering only the handshake replay and dropping all later
   frames. Clean manual vite restart fixes it; symptom is a silent bench.
2. A second TAB in the same headless browser is frozen (0 rAF, throttled
   events — even its WebSocket sat silent). Same lesson as the capture
   harnesses: one browser per window; bench-check now does that.

## Task 2 — move rotation

The FSM's groove state only ever played `groove`; tstep/armwave were
unreachable except by force. Now:

- Repertoire declared at gait-table level:
  `GAITS.biped.repertoire = { groove: [[groove 0.5], [tstep 0.3],
  [armwave 0.2]] }` (trot shares it; ghost has none — its joints don't
  match the biped tables, it stays procedural — the brief's "ghost keeps
  its single table" maps to "no table" since ghosts never had one).
  Sidecar `repertoire` field overrides per shape.
- Rotation: weighted-random pick on state entry and every
  `moveHoldBars` (default 4) bar wraps, never the same move twice in a
  row with ≥2 entries, switching through the existing blend layer.
  `move` param forcing still overrides everything (workbench untouched).
- Switches broadcast as `creature-move` on the WS relay: the controller
  writes them to the session stream; the bench ribbon/log consume them
  live.

### Acceptance

60 s FSM-driven capture (`--behavior groove`, default 4-bar holds):

```
moves groove → tstep-placeholder → groove → armwave-placeholder
      → tstep-placeholder → armwave-placeholder → groove
      → armwave-placeholder → groove
```

All three moves cycle, no immediate repeats, **0 joint-speed spikes**,
1.36 ms/frame, slide 0.00 px. VERIFY:PASS.

## Open

- The bench's by-ear verdict (click on the music, tap-along feel) is the
  user's — the page is built for exactly that session.
- Still pending: brief 12 ghost GPU verdict, brief 11 phone gate,
  brief 10 post verdict, placeholder move timing, dnb-174 + idle-page
  PLL frame-rate family.
