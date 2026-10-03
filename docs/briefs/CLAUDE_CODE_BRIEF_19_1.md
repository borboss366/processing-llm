# processing-llm — brief 19.1: the engine explorer

The capture pipeline is instrumented stage by stage (briefs 18–18.2);
the engine — table → pixels — is not, and the A7 knee failure lived
there unseen. Build the same instrument for the engine: a tap after
every stage, the same three views (superimposed skeletons, joint×time
heatmap, flag filmstrip), the same UI idioms, so brief 19's remaining
rungs (R2 springs, R3 liveness, R4 goo) are LOOKED at, not read.
Offline + headless first (deterministic), live puppet view second.

## Task 1 — Engine taps

A per-frame, per-joint record of theta (and where relevant position /
flags) after each stage, in this order; taps are cheap, bounded, and
off in production unless `engineTrace` is on:

 1. table playback (phase sample + easing)
 2. blend / crossfade (+ envelope value, active window flag)
 3. springs / follow
 4. liveness (variation, lead-lag, swing, accent; each contribution
    separately recoverable)
 5. limits & signs (rotLimits clamp hit per joint, side sign applied,
    view convention) — CLAMPS LOGGED HERE
 6. stance lock / contacts / odometry (pin state per foot, yields,
    root travel)
 7. FK → joint positions
 8. depth mapping (twist/yaw → draw lengths, dim, foot-fan width)
 9. tissue (pinned-node offsets, bone-splat positions — summarized)
10. density & goo (threshold, per-part radii actually used)

Reference stream alongside: the TABLE's theta at the same phase (the
ground truth the engine should follow).

## Task 2 — `engine-trace.json` + `<move>-<shape>.engine.explorer.html`

The headless capture harness (deterministic) runs a move on a shape
and dumps the trace; a generator writes a self-contained explorer
beside it, same look and scrub as the capture explorer:
- **Superimposed skeletons**: table-pose ghost vs the engine skeleton
  AFTER a selectable stage, on the stage canvas; bones colored by
  deviation from the table (the engine's rig-on-source).
- **Joint × time heatmap**: x = frame, y = joint, color = |engine
  theta after stage N − table theta|; stage selectable; click → scrub.
  (The knee would read as a red row at stage 5.)
- **Per-stage ladder**: RMS vs table after each stage, per joint and
  total — R1..R4 as a staircase; the rung that eats the radians is the
  tallest step.
- **Flag filmstrip**: clamp hits, stance-lock yields, blend windows,
  spike flags, sign decisions; click → scrub.
- **Render-mode strip**: bones / silhouette / goo thumbnails at the
  scrubbed frame (R4 judged in the same place).
Generated for runningman (profile), tstep (front), armpump, groove on
both bipeds; committed under reports/ as stills + one webm each.

## Task 3 — Live view on the puppet page

A "draw as of stage N" selector on the puppet canvas (bones mode): the
skeleton as the engine had it after that stage, with the table ghost
underneath; the joint×time heatmap as a live strip of the last 10 s;
clamp/yield flags in the readout. Export the current strip as PNG.

## Task 4 — Verify rows

- `engine-fidelity`: per joint, per stage, |engine − table| RMS over a
  loop ≤ per-stage budget (stage 1 ≈ 0; stage 5 must add 0 except
  logged, justified clamps; stage 3/4 within their declared envelopes).
  Replaces the chain-travel version of the fidelity row.
- Any clamp hit on a captured table fails unless whitelisted with a
  reason in the table header (the knee bug could not have shipped).

## Acceptance

- The knee fix verified IN THE TOOL: stage-5 heatmap row for kneeL/R
  flat on runningman after the fix, red before (keep the before trace
  as the report's exhibit).
- R2/R3/R4 numbers per clip from the ladder view; the user judges R4 in
  the render-mode strip and names the rung that still hurts.
- USER_GATES: "engine explorer: can you find the stage that loses a
  given joint without a report?"

## Out of scope

Fixes beyond the knee (named rungs become their own tasks under 19),
the live-path cost (traces are opt-in), capture-side tooling.
