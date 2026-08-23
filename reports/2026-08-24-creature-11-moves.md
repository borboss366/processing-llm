# Brief 9 — move tables, welding fix, acquisition hardening

Date: 2026-08-24. Music: Boris Brejcha minimal-techno mix (seek 300 s),
clean pinned preset, headless Chromium (swiftshader ~20 fps — module
ms/frame is the perf number, not fps).

## Task 0a — union-by-max density groups (welding fix)

Density now accumulates on a second half-res canvas in per-group channels
(R = torso+head+legs, G = armL/limb2, B = armR/limb3; node sprites AND
bone splats route to their group's channel via pure-channel radial
sprites). The shader thresholds, ramps and takes normals from
`d = max(R,G,B)`; the colour buffer is unchanged (premultiplied
accumulation, normalised by summed density). The density texture uploads
premultiplied-passthrough — un-premultiplying would divide each channel by
the summed alpha and deflate every channel exactly where groups overlap.

**Winning-channel colour weighting was NOT needed** (the brief's
prediction held: arms and torso share the primary hue, so the summed
colour at a crossing is the same hue).

`weldUnion 0` keeps the legacy additive field as an A/B diagnostic path
(one uniform; production default 1).

### Acceptance (deviation documented)

The brief's metric — "max shaded luminance in the overlap window within
5% of the no-overlap baseline" — is vacuous on this render: specular +
core saturate at 255 in EVERY frame, overlap or not (measured: all 17
sweep steps max=255 before the fix). Welding here is an AREA effect (the
summed field pushes the mid-density band over the core threshold in a
wide wash), so the acceptance was reformulated as a paired A/B at
identical poses:

`tools/weld-sweep.mjs` drags an arm across the torso over 4 s (16 steps,
`sweep` param). Each step renders the same pose twice (additive vs
union) and compares mean shaded luminance inside the *flash band* — the
pixels where the summed density materially exceeds the max density
(sum − max ≥ 0.15, computed in one frame from the two accumulation
canvases, so no registration noise). The additive path brightens that
band; the union render of the identical pose is the flash-free reference:

- biped-1: peak additive-vs-union brightening **26.2%** (20.6% on the
  initial Task 0a run; steps range 10–29%)
- biped-2: peak **36.3%** (38.8% initial run)

PASS requires ≥10% divergence — which simultaneously proves the harness
sees welding AND that the union path is engaged; if the shader ever
regresses to the additive field the two renders become equal and the
check FAILS. Registered in `verify --full`.

Stills: `reports/weld-weld-biped-{1,2}-t{0.00,0.50,1.00}-{add,max}.png` —
in `-add` the crossing arm melts into the torso as one pale inflated
blob; in `-max` it slides over as a distinct surface with a crease.
Even at rest the shoulder junction welded on the legacy path (11.5%
brightening at t=0) — also gone.

Frame budget: unaffected (clean-path ~2 ms/frame in the 30 s gates,
budget 6 ms; the doubled sprite draws are half-res 2D blits).

## Task 0b — acquisition snap smoothing + entry gating

The move clock is now an exported pure function `stepMoveClock`
(creature.js) — everything pose-facing (moves, odometry, feet, blends)
consumes it; nothing reads raw `beatPhase`:

- catch-up headroom tightened 1.6× → **1.45× nominal**: the observed
  0.46-beat acquisition snap now drains over **1.03 beats** (was 0.77)
- backward snaps (< 0.5 beat) hold the clock — never rewind
- **beatSec is low-passed (0.8 s)** for move consumers: a 120→174 BPM
  re-estimate used to step `strideU` in one frame even though phase was
  capped; now the beat length moves ≤3.2 ms/frame (raw jump 155 ms)

`tools/move-clock-test.mjs` (fast tier, no browser) drives the four
scenarios frame-by-frame: VERIFY:PASS — applied delta never exceeds the
cap, spread ≥1 beat, no rewind, smoothed convergence.

**Entry gate**: the creature holds its entry fade until
`beatConfidence ≥ 0.5` sustained 1 s (`entryConf`/`entrySec` params;
latch resets when the lifecycle returns to idle), then fades in over
0.9 s. No more dancing to an unlocked clock during the first seconds.

Evidence from file-writing captures with spikes counted from frame one
(30 s, both bipeds): **0 spikes**, while real acquisition snaps occurred
in-run — `maxRawDelta` 0.37–0.52 vs `maxAppliedDelta` ≤0.28 (the
20 fps-headless per-frame cap), printed by the capture harness from the
`window.__creaturePhase` seam.

## Task 1 — move table format + playback

`web/app/moves/<name>.json` (documented in MODULE_ABI.md):
`{ name, beatsPerLoop, overlay, keys: [{ phase, joints: {name: {dx, dy,
rot}}, contacts: [names], ease }] }`. Piecewise interpolation over the
move-local clock, wrapping; `ease` (smooth/snap/linear) belongs to the
segment starting at its key; `snap` completes in the first quarter,
still smoothstepped. Offsets are relative to the neutral pose: `rot`
joins the FK chain (children inherit; bone lengths hold by
construction), `dx/dy` are shape units for roots and kicks. The table
layers UNDER the procedural bounce/lean/Perlin/simmer — they stay on,
scaled by the move's `overlay`. `contacts` plants ground tips (knees
follow geometrically). FSM groove cycles the tables two bars each; the
`move` param forces one; switches ride the existing blend layer.

Two mechanisms were REQUIRED to meet the zero-spike bar (both measured,
not theorized):

1. **Critically damped springs (~100 ms) on every table offset and on
   the contact-lock weight.** Hard contact toggles at key boundaries
   stepped a foot from plant to its table offset in one frame (v≈1–2
   u/s — 7 spikes in the first tstep run), and `snap` attacks are
   sub-4-frame at capture fps. A first-order filter still steps
   velocity on frame one; a spring builds velocity from zero, bounding
   growth at any frame rate. After: groove 0, armwave 0, tstep 0 spikes.

2. **Two spike-metric refinements** (same spirit as brief 8.2's
   discontinuity test — kill sampling artifacts, keep true jumps):
   an acceleration bound (>20 u/s²) so the 2.5×-prev growth test can't
   fire on smooth dance motion sampled 3 frames per swing (measured
   false positive: handL 0.81 u/s building at 7.6 u/s²; a true hiccup
   is ≥25 u/s² even at 15 fps), and velocity measured over a fixed
   ≥40 ms window instead of per-frame (a lone 17 ms frame among 50–67 ms
   frames divided normal jitter into a phantom 0.97 u/s spike).

## Task 2 — three moves

- `groove` — ported from code to a 2-beat table: twice-per-beat dip
  (pelvis dy), chest rock, arm pump; overlay 0.35.
- `tstep-placeholder` — Melbourne-shuffle weight shifts: single-foot
  contacts alternating per beat, side kicks with snap attacks, pelvis
  lean; overlay 0.3.
- `armwave-placeholder` — 8-beat wave shoulder→wrist, one bar per
  direction, travelling rot bumps along elbow/hand/chest; overlay 0.25.

**USER INPUT STILL REQUIRED**: the quarter-speed timing notes for tstep
and armwave were not provided; both placeholders use tutorial-standard
timing and are named `*-placeholder` per the brief.

## Task 3 — capture gate

30 s per biped, behaviour auto (FSM cycling walk/groove/idle/hop across
the section; groove cycles all three tables two bars each), palette rule
on, Butterchurn clean preset under:

| shape | ms/frame | slide px | components | bone dev rot | spikes | move clock raw→applied |
|---|---|---|---|---|---|---|
| biped-1 | 2.21 | 0.18 | 1 | 0.0% | **0** | 0.37 → 0.25 |
| biped-2 | 1.96 | 0.08 | 1 | 0.0% | **0** | 0.40 → 0.26 |

Media: `reports/creature4-biped-{1,2}.png/.webm` + `-diag.png` (swatch
chips). Verify: fast tier 4/4 PASS (move-clock, pll-synthetic,
module-load, director-prompt-stable); creature-capture PASS (both
shapes, 30 s); weld-sweep PASS both shapes on the final code (26.2% /
36.3% — biped-2 run manually, the registry entry covers biped-1). `pll-real-tracks` retains the known
dnb-174 bistable open item (unchanged by this brief); replay-smoke
unchanged.

## Open

1. **User's quarter-speed timing notes** for tstep + armwave → replace
   the placeholders.
2. **Real-GPU judgment** of the gate captures (this STOP).
3. dnb-174 bistable PLL lock — pre-existing, needs its dedicated item.
