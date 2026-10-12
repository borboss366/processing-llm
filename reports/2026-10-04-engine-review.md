# Engine review — the owner's reading loop (brief 19.2 Task 2)

Protocol: engine explorer open on the running man
(reports/engine-runningman-captured-biped-profile.engine.explorer.html),
ENGINE.md beside the code. Fill; sentences you can't verify go in the
list below; the list drives ENGINE.md revisions until empty.

## Predictions (write BEFORE running)

1. moveSpringWn 10 → 5 (puppet param). Predicted s3 ladder step: ____
   Ran: `node tools/engine-trace.mjs --move runningman-captured
   --shape biped-profile --no-webm` → actual: ____
2. rotLimits.knee one-signed/tightened (edit biped-profile.json).
   Predicted stage-5 heatmap: ____ → actual: ____
3. contacts forced planted on the lifted leg (table copy with footL
   in every key). Predicted stage-6/lock view: ____ → actual: ____

## Can't-verify / can't-follow list (ENGINE.md revisions)
1. The FK seem to cause more problems, than it solves.
- ____

## Capture-side list (brief 18 Task 3 — still open, closes here too)

- ____

## Owner's findings (raw → sorted)

Tags: FIX = engine/pipeline change (becomes a brief task) · DOC =
ENGINE.md/PIPELINE.md revision · MINE = parameter/shape change I make
myself · LIMIT = representational boundary, recorded once · TOOL =
explorer/CLI addition.

### 1. Stride amplitude decays across the stages — FIX (+ prediction 1)

What I see: the running man's step gets shorter and shorter from the
video to the stage, on both the capture and the engine side.

Where it actually goes (from the ladders):
- Capture: R0→R1 (distill) ≈ 0.011 rad — near-lossless since the
  octave/parity fix. Remaining capture residual ≈ 0.1 is the averaging
  floor (rep-to-rep variation), i.e. honest, not loss.
- Engine: the spring/follow rung is the tall step — +0.355 rad RMS on
  runningman (worst elbowL 0.588); blend 0.000, liveness 0.027, limits
  0.000, lock 0.003. The spring is where the stride goes.
Exhibit: engine explorer, stage-3 heatmap, knee/hip rows; ladder
staircase.
Decision: engine fix — captured tables need a stiffer/faster follow
than authored ones (per-table `follow`, or moveSpringWn tuned for
captured). Prediction 1 above IS the before/after test for this.
→ next engine brief, task 1.

**FIXED 2026-10-13.** Table-header field `followWn` (spring frequency for
the table channels); default by provenance — captured tables (provenance
tools/mocap/*) 60 ≈ 17 ms, authored tables keep `moveSpringWn` 10 ≈ 100 ms.
Kept a spring rather than bypassing: it still builds velocity from zero, so
`snap` keys can't land a one-frame step. Stance-lock weight keeps the old
rate (unchanged behaviour there).

| engine ladder s3 (spring) step | before | after |
|---|---|---|
| runningman-captured × biped-profile | 0.346 (worst elbowL 0.581) | **0.034** (elbowL 0.058) |
| basic_kick_1-captured-front × biped-1 | 0.191 (elbowL 0.317) | **0.017** (elbowL 0.029) |
| basic_kick_1-captured-front × biped-2 | 0.194 (elbowR 0.330) | **0.016** (elbowL 0.028) |

Hiccups: spikes +0 during every trace above; captured↔captured and
captured↔authored live switches (kick → armwave → kick → runningman →
kick → tstep) +0; `transition-check` PASS (spikesFlagged 0);
`moves-x-shapes` PASS (runningman engine/table amplitude now ~1.0, e.g.
kneeL 1.70/1.59). Position rung: runningman 0.039 → 0.018 u.

Exhibit: `reports/2026-10-13-kick-arms-after-spring.png` — kick-arm frame
(f56): left = after spring, all bones green (arm deviation ≤ 0.005 rad);
right = final, arms green/yellow (≤ 0.095, liveness wander) — the red is
the FEET (ankle clamps, below).

Still open on basic_kick_1 (not this finding): fidelity FAILs on the foot
clamps (footL 185 / footR 69 frames) — the front-view foot-convention gap;
with the spring no longer masking it, the lock+FK delta reads 0.153/0.169
(> 0.15 budget), all of it ankleL. Owner's call per table (whitelist vs
raise rotLimits.ankle) until the front-view ankle reference is fixed.

### 2. Rig proportions ≠ dancer proportions; step reads even shorter — MINE + TOOL

What I see: the biped is elongated in Y compared to the man (torso
tall relative to legs). The retarget transfers ANGLES and takes bone
LENGTHS from the rig (by design), so the same hip angle produces a
stride that is shorter relative to body height than his.
Decision:
- MINE: redraw biped-profile's silhouette with a leg/torso ratio closer
  to the dancer's (placeholder art was never judged for proportions).
- TOOL: capture explorer stage 4 shows the dancer's measured bone-length
  ratios beside the rig's, flagged when they differ by > N %; stitch
  gains `--match-proportions` (scale the rig's bone lengths per captured
  table) so judgment isn't confounded by proportions. Small; rides along
  with the spring task.
Exhibit: rig-on-source overlay at a stride-apart frame (green vs the
man's legs).

### 3. spring is a low-pass at the move's own frequency; 
attenuates stride ~50% and amplifies step asymmetry; exhibit s2 vs s3 overlay

## Sorting summary (fill as findings are tagged)

- FIX → brief tasks: 1 (spring/follow for captured tables)
- TOOL → rides along: 2b (proportion card + --match-proportions)
- MINE → owner does: 2a (redraw profile proportions), hip limit ±0.9 →
  ±1.6 on biped-profile (running_man_3, 17/136 frames — real pose,
  tight limit)
- DOC → can't-follow list above
- LIMIT → ____
