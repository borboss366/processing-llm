# Brief 17.6 T2 revision (owner directives 2026-10-19, before Task 3)

## What changed
1. **Free-foot clamp + its knee solve removed.** Grounding measures the
   support leg on its REST bone lengths (re-walked from the hip with the
   FK angles), so a depth cue drawing the leg shorter cannot lower the
   body. *Interpretation, stated:* the knee re-solve that the pelvis
   SHIFT needs (support ankle/foot stay while the pelvis moves) is kept;
   only the clamp's solve is gone. Say so if both were meant.
2. **One spring on weight** = the table's `followWn` (captured 60,
   authored 10) — `WEIGHT_WN` and the fast grounding spring deleted.
3. **Tilt by the shape's view** (`state.view`): front shapes tilt,
   profile shapes don't; sign from the shape's rest hips. The 0.008
   hip-overlap constants deleted.
4. **wSupport / wTransfer deleted** — no per-table flags on the move
   objects. Consequences: grounding runs on every table; the bounce no
   longer ducks ×0.5 under transferring tables, it only yields to the
   sink.
5. **weight-rate bound in ms, derived once:** the extractor confirms a
   contradicting lift only after ⌊SG window/2⌋ = 4 frames at 29.97 fps =
   **133.5 ms**, so no full transfer (Σ|Δw| = 2) may fall inside 133.5 ms
   of SOURCE time. Tables now carry `provenance.loopSec` + `fps` (extract;
   stitch sums the halves) to map it to phase. Old fitted bound (1.5 per
   0.1 beat) deleted.
6. Task 3's engine-fidelity at dial 1 with the root transform factored
   out — recorded as Task 3's spec in STATUS, not started.
- **Stitch seam crossfade:** around each join the outgoing half plays on
  past its cut and the incoming one starts before its own, blended with
  the engine's move blend (smoothstep, `blendBeats` 0.75 beat); samples
  every 0.05 beat, contacts from the blended weight. tstep: the 0.573 rad
  one-step pose jump is gone — inside the join windows the pose changes
  at most 2.88 rad rms/beat, below the table's own fastest original step
  (10.45, R-half data).
- **Kick: no longer looped.** `moves/roster.json` gains `exclude`
  (basic_kick_1-captured, -front) with the reason; `/moves-list` drops
  excluded tables from the move list and the rotation (server change —
  **the running server needs a restart to pick it up**). Tables stay on
  disk; a forced `move` still plays them. "One-shot move" (played once on
  a cue) noted as a future table kind in docs/PIPELINE.md, not built.

## weight-rate (re-extracted, all with source time) — PASS
    ok   runningman-captured-front          Σ|Δw| 1.70 in 133 ms @ phase 0.212 (weight)
    ok   runningman-captured-x              Σ|Δw| 1.70 in 133 ms @ phase 0.212 (weight)
    ok   runningman-captured                Σ|Δw| 1.70 in 133 ms @ phase 0.212 (weight)
    ok   tstep-captured-x                   Σ|Δw| 1.48 in 133 ms @ phase 0.959 (weight)
    ok   tstep-captured                     Σ|Δw| 1.48 in 133 ms @ phase 0.959 (weight)
    ok   running_man_3-captured-front       Σ|Δw| 1.31 in 133 ms @ phase 0.888 (weight)
    ok   running_man_3-captured             Σ|Δw| 1.31 in 133 ms @ phase 0.888 (weight)
    ok   running_man_4-captured-front       Σ|Δw| 1.31 in 133 ms @ phase 0.888 (weight)
    ok   running_man_4-captured             Σ|Δw| 1.31 in 133 ms @ phase 0.888 (weight)
    ok   bodyroll-captured                  Σ|Δw| 1.17 in 133 ms @ phase 0.728 (weight)
    ok   basic_kick_1-captured-front        Σ|Δw| 0.72 in 133 ms @ phase 0.739 (weight)
    ok   basic_kick_1-captured              Σ|Δw| 0.72 in 133 ms @ phase 0.739 (weight)
    [weight-rate] PASS: 12 tables with weight + source time; no full transfer (Σ|Δw| ≥ 2) inside 133.5 ms of source time; worst runningman-captured-front 1.70 @ 0.212

## weight-probe, dials 0 / 1 / 2 (headless, AC) — max penetration per table = "foot below floor"
| move (played) | dial | weight range | support-foot hang max / mean (L) | foot below floor max (L) | root range (L) | before sink (L) | layer max move (L) | spikes | ms/frame |
|---|---|---|---|---|---|---|---|---|---|
| none () | 0 | 0…0 | 0.186 / 0.043 | 0.061 | 0.183 | — | 0 | 0 | 2.01 |
| none () | 1 | 0…0 | 0.112 / 0.033 | 0.02 | 0.274 | 0.276 | 0.0808 | 0 | 2.25 |
| none () | 2 | 0…0 | 0.105 / 0.029 | 0.024 | 0.295 | 0.294 | 0.0893 | 0 | 1.87 |
| groove | 0 | 0…0 | 0.043 / 0.011 | 0 | 0.059 | — | 0 | 0 | 2.09 |
| groove | 1 | 0…0 | 0 / 0 | 0.003 | 0.075 | 0.075 | 0.0998 | 0 | 2.1 |
| groove | 2 | 0…0 | 0 / 0 | 0 | 0.072 | 0.07 | 0.0907 | 0 | 2.1 |
| runningman-captured | 0 | -0.98…1 | 0.125 / 0.014 | 0.037 | 0.017 | — | 0 | 0 | 2.4 |
| runningman-captured | 1 | -0.99…1 | 0.091 / 0.008 | 0.064 | 0.264 | 0.248 | 0.1506 | 0 | 2.51 |
| runningman-captured | 2 | -0.98…1 | 0.091 / 0.001 | 0.064 | 0.332 | 0.299 | 0.2263 | 0 | 2.51 |
| runningman-captured-front | 0 | -0.98…1 | 0.314 / 0.07 | 0.007 | 0.013 | — | 0 | 0 | 2.51 |
| runningman-captured-front | 1 | -0.98…1 | 0.321 / 0.054 | 0.029 | 0.115 | 0.114 | 0.0974 | 0 | 2.51 |
| runningman-captured-front | 2 | -0.98…1 | 0.377 / 0.054 | 0.043 | 0.131 | 0.111 | 0.1613 | 0 | 2.51 |
| tstep-captured | 0 | -0.97…1 | 0.056 / -0.008 | 0.046 | 0.016 | — | 0 | 0 | 2.51 |
| tstep-captured | 1 | -0.97…1 | 0.095 / 0.026 | 0.118 | 0.344 | 0.345 | 0.2785 | 0 | 2.51 |
| tstep-captured | 2 | -0.97…1 | 0.095 / 0.028 | 0.102 | 0.337 | 0.34 | 0.324 | 0 | 2.51 |
| bodyroll-captured | 0 | -0.82…0.48 | 0.186 / 0.061 | 0.003 | 0.017 | — | 0 | 0 | 2.51 |
| bodyroll-captured | 1 | -0.81…0.36 | 0.007 / 0.001 | 0.014 | 0.217 | 0.218 | 0.1886 | 0 | 2.51 |
| bodyroll-captured | 2 | -0.84…0.42 | 0.024 / -0.001 | 0.041 | 0.22 | 0.219 | 0.1851 | 0 | 2.51 |
| basic_kick_1-captured-front | 0 | -0.15…0.22 | 0.111 / 0.047 | 0.007 | 0.016 | — | 0 | 0 | 2.51 |
| basic_kick_1-captured-front | 1 | -0.16…0.22 | 0.196 / 0.133 | 0 | 0.17 | 0.17 | 0.1627 | 0 | 2.51 |
| basic_kick_1-captured-front | 2 | -0.18…0.22 | 0.2 / 0.134 | 0 | 0.167 | 0.164 | 0.1704 | 0 | 2.51 |
| tstep-placeholder | 0 | -0.99…0.99 | 0.17 / 0.036 | 0.088 | 0.02 | — | 0 | 0 | 2.51 |
| tstep-placeholder | 1 | -0.99…0.99 | 0.229 / 0.019 | 0.223 | 0.275 | 0.245 | 0.2011 | 0 | 2.51 |
| tstep-placeholder | 2 | -0.99…0.99 | 0.223 / 0.021 | 0.226 | 0.305 | 0.254 | 0.2548 | 0 | 2.51 |

## What the numbers say (consequences of the directives, measured)
- **Penetration per table, dial 1 (max, L):** tstep-placeholder 0.223 ·
  tstep 0.118 · runningman 0.064 · front 0.029 · none 0.020 · bodyroll
  0.014 · groove 0.003 · kick 0. With the clamp removed, a free foot
  lower in FK than the support foot goes under (tstep, authored tstep).
- **The drawn support foot floats where depth shortens the leg:** front
  running man hang mean 0.054 L (max 0.32), kick 0.133 mean. The probe
  measures the DRAWN foot; grounding now puts the REST-length foot on the
  floor, so the depth cue's shortening shows as a lifted foot instead of
  a lowered body — the directive's intent; flagged for the owner's eye.
- **Weight-free figures move:** none / groove are displaced up to
  0.08–0.10 L at dial 1 (they were exactly 0 with the per-table gate).
  The brief's T2.5 identity no longer holds — direct consequence of (4).
- Bodyroll, the motivating case, still stands: hang 0.186 → 0.007 L.
- Root range (addendum C, before sink) at dial 1: runningman 0.248 L,
  front 0.114, tstep 0.345, bodyroll 0.218, kick 0.17.
- Spikes 0 at every dial; 2.5 ms/frame at every dial (no measurable cost).

## Checks
verify --only creature-capture, transition, view-switch, drop,
depth-stress, weight-rate, engine-fidelity, moves-x-shapes: **8 PASS**;
mocap self-test PASS; fk-check PASS (toe drift 0.0).
