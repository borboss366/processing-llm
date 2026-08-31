# 2026-08-31 — brief 15 Section A: liveness layer

The uniformity killers, all master-gated by `params.liveness` (default
ON; the OFF state is the pre-15 feel, which is gate R1's A/B):

- **A1 cycle variation**: per-joint amplitude (±varyAmp, default 10%)
  and phase (±varyPhase, 0.02 loop) wander on slow Perlin, periods
  20–60 s per joint. Two deviations from a literal reading, both
  load-bearing: (1) amplitude wander scales the WHOLE dance stream
  (gait + table offsets) — applied to the procedural layer alone it is
  invisible under table moves (the gait share there is ~0.04 rad);
  phase wander stays on the procedural sinusoid (a true per-joint
  table time-shift needs per-joint resampling — not worth the frame
  cost). (2) the raw Perlin deviation is renormalized ×5: p5 noise
  clusters tightly around 0.5 (practical |n−0.5| ≲ 0.2), so unscaled
  "±10%" was really ±4%.
- **A2 baked asymmetry**: sidecar `dominantSide` (default R, audience
  template inherits by copy): dominant-suffix joints ×1.08, off-side
  ×0.94, head-look bias +0.06 rad toward the dominant side.
- **A3 chain lead–lag**: spine (rootMid) trails by spineLagMs (30),
  head by headLagMs (60) — the pose STREAM is delayed through a
  time-indexed buffer (table content whips too, and arms inherit the
  delayed chest via FK). Walking exempt via stEff (trunk must agree
  with feet/odometry).
- **A4 swing**: `swingPct` (default 0.08, per-table override, 0–0.25)
  warps each beat's second half late — applied ONCE at the clock
  source, so tables, procedural layers, feet cycle and odometry all
  read the same warped clock and can never disagree. Identity in
  manual (scrubbing stays linear). Slider on the bench (the click
  stays straight by design, so swing is judged against it) and on the
  puppet (auto-enumerated param).
- **A5 downbeat accent + phrase**: grid tier only (PLL barPhase is
  unanchored). The "one" scales bounce + move amplitude by
  1+accentAmt (0.15), ~80 ms eased attack, half-beat decay. Every
  `phraseBars` (8) one bar doubles the variation ("lifted"). DEVIATION:
  the brief's alternative `fillKey` mechanism is not implemented — no
  table declares one; lifted variation is the shipped phrase form.

## Numbers (tools/liveness-check.mjs, verify --full "liveness")

Same music segment (seek 300), groove table, procedural amplitude
zeroed both runs (the music's level envelope would swamp the wander):

| metric | liveness ON | OFF | assert |
|---|---|---|---|
| per-loop amplitude drift V (scale-fit vs mean cycle) | **6.5%** | 3.3% | ratio ≥ 1.8 (got 1.95), V_on ≤ 30% ✓ |
| phase-paired dissimilarity D | 0.0042 rad | 0.0029 rad | reported |
| joint-speed spikes | 0 | 0 | 0 ✓ |

Measurement honesty: the first three estimator attempts (coarse loop
bins ×2, raw peak-to-peak) measured their own sampling noise at
headless ~12 frames/loop and could not see a ±10% slow wander; the
per-loop least-squares scale fit against an interpolated mean cycle
uses every sample and separates cleanly. All four estimator iterations
are in the tool's history; the current one is documented in its header.

**A6 caps (liveness ON at defaults): fk-check PASS (heel pivot toe
0.0 px, wave lags 0.025/0.025), transition-check PASS (rhythm ramp
0.17, glide 0.0 px, plateau ≤ 250 ms), spikes 0 everywhere.**

A/B webms: `reports/liveness-{on,off}.webm` (same segment; "same seed"
approximated — a fresh page reseeds p5 noise, but the OFF run uses no
noise on the measured path).

Frame cost: 2 noise calls per joint (15 joints), one small ring buffer
for 2 joints — no new passes; capture stays ≤ 1.9 ms/frame envelope.

## For the user

R1–R3 in docs/USER_GATES.md are now judgeable: performer-vs-loop from
3 m (A/B via `/creature/liveness 0/1`), swing slider on the bench
against the straight click, accent/phrase taste on the grid tier.
