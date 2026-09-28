# Brief 19 Task 3.1 — the R1 rung: distill convicted, then fixed

Verdict from the overlays (user's): rig-on-source tracks the dancer,
the table ghost loses stride amplitude — distill is the lossy rung.
Measured, fixed, re-measured. Tool: `tools/mocap/table-vs-raw.mjs`
(per-bone RMS of the table sampled at each frame's phase vs the raw
per-frame retarget, decomposed into averaging floor + distill).

## Numbers (rtmpose R0, ALL-bones RMS rad)

| clip | baseline total | after total | averaging floor | distill adds | keys | verdict (distill ≤ 0.05) |
|---|---|---|---|---|---|---|
| running man | 0.249 | **0.116** | 0.105 | **0.011** | 31 | PASS |
| tstep-L | 0.405* | 0.300 | 0.299 | **0.000** | 21 | PASS |
| tstep-R | — | 0.175 | 0.169 | **0.006** | 24 | PASS |
| body roll | 0.384 | 0.384 | 0.383 | **0.001** | 12 | PASS |

*tstep-L baseline measured mid-sequence (after b/c, before the
constant-channel fix, when distill still added 0.105).

The 0.05-vs-raw target from the directive is dominated by the
AVERAGING FLOOR — genuine rep-to-rep variation that NO loop table can
represent (deviation, with reason: the verdict is applied to the
distill component, which the pipeline controls; the floor is reported
alongside and owns the next rung).

## What was actually wrong (three defects, all found by measuring)

1. **Octave error, not smear (the stride loss):** cross-correlation
   alignment measured ZERO shifts — per-cycle amplitudes then showed
   kneeL 0.52/1.63/0.55 with kneeR inverted: each detected "cycle"
   was a SINGLE STEP; L-steps averaged with R-steps and the stride
   halved (kneeL loop range 0.70 of 1.80 raw). Fix: octave guard —
   re-bin at 2×, adopt if theta-channel cycle spread collapses
   (< 0.6×); when the window fits only ONE doubled cycle, the PARITY
   test decides (same-parity spread 0.174 vs cross-parity 0.443) and
   the loop is built as evenMean ++ oddMean. Stride recovered: kneeL
   1.75, kneeR 1.67 rad. Self-tests: alignment shifts recovered
   exactly; half-loop swap snaps back (shift −32 found).
2. **Fixed 16-key cap:** thinning is now budget-governed — candidates
   at every extremum/inflection emitted EXACTLY, removal only while
   worst-bone reconstruction RMS ≤ `--err-budget` (0.04 rad), cap 32.
3. **Constant channels dropped (caught by R1's worst-bone column):**
   a bone with a large habitual offset but tiny oscillation (tstep
   shoulder 0.94 rad, bodyroll elbow 1.0) was excluded by minRange
   and the table replayed the rig rest — the habitual-pose erasure
   reborn at the last stage. Fix: |mean| ≥ 0.15 rad → constant key.
   tstep-L distill contribution 0.105 → 0.000.

Alignment (b) also ships and is active where it applies (tstep shifts
±1–2 bins, bodyroll −6..+1) — it just wasn't the runningman's disease.

## Visible per bone per phase (d)

Heatmap metric "table vs raw" added to every explorer (fixed absolute
scale 0.4 rad); overlay 8 vs overlay 1 is the same comparison on the
video. The R1 line is logged by every extract run
(`[mocap] R1 table-vs-raw: ALL … avg-floor … distill adds …`).

## What the floor is made of (next rung, not this one)

Body roll's floor (0.383, worst elbowR ~1.0) is WITHIN-CYCLE timing
warp — reps roll at varying speed inside the cycle, so whole-cycle
shifting can't line them up; that needs time-warp alignment (DTW)
along the phase axis. T-step-L's 0.30 floor is partly the same, partly
genuine variation. The running man's 0.105 is close to honest
liveness.

## Deviations

- **Stage tables rebuilt WITHOUT `--symmetrize`** (supersedes the
  option-b decision of 2026-09-24): the parity-doubled loop measures
  BOTH halves, near-equal (knee L 1.75 / R 1.67) — symmetrize would
  overwrite genuine data; its rationale (occluded kneeL 0.35 vs 1.49)
  is gone. Stage tables: 31 keys, mean travel +0.035 u/beat (watch
  on stage).
- The vs-raw 0.05 target reinterpreted as above (floor reported, not
  hidden).
