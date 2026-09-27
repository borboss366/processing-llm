# Brief 18.1 Task 4 — estimator comparison cards (all three clips)

Both estimators run END-TO-END through the unchanged downstream stages
(schema in, tables out). Numbers from identical windows/flags; wall
time includes the 3-pass worker (scout + two TTA streams).

## Card: running man (profile — THE occluded-leg test)

| | MediaPipe | RTMPose (balanced) |
|---|---|---|
| far-leg score / near-leg score | **0.654 / 0.938** (knows it's guessing) | **0.825 / 0.855** (near-symmetric) |
| arms score | 0.685 | 0.743 |
| small-toe keypoints | none (score 0) | **real, 0.887** |
| jitter (2nd-diff, raw) | **6.64 px** | 6.89 px |
| jitter POST-SMOOTHING (stage-2 output) | 3.74 px | 3.85 px (+3 %) |
| wall time (2.7 s window) | **17 s** | 54 s |
| downstream hip span far/near | 1.16/1.03 (113 %) | 1.14/1.02 (112 %) |

**Headline finding:** the brief's premise — "far leg at 25–50 %" — is
GONE on both estimators: that weakness was the old de-yaw + declared-
rest era, already fixed upstream (as-filmed projection + measured
rest). The estimators now produce nearly IDENTICAL theta spans; they
differ in score honesty, feet, smoothness, and cost.

## Card: T-step (frontal — the feet test)

| | MediaPipe | RTMPose |
|---|---|---|
| leg scores L/R | 0.822 / 0.768 | 0.862 / 0.870 |
| arms | 0.905 | 0.887 |
| small toes | none | 0.863 |
| jitter (raw) | **3.08 px** | 4.14 px |
| jitter POST-SMOOTHING | 2.00 px | 2.19 px (+10 %) |
| wall (2.5 s) | **13 s** | 48 s |

## Card: body roll (profile, second dancer)

| | MediaPipe | RTMPose |
|---|---|---|
| leg scores L/R | **0.617** / 0.940 | 0.831 / 0.865 |
| arms | 0.663 | 0.797 |
| small toes | none | 0.898 |
| jitter (raw) | **1.47 px** | 1.97 px |
| jitter POST-SMOOTHING | 0.68 px | 0.70 px (+3 %) |
| wall (6 s) | **31 s** | 113 s |

## The trade, in one paragraph

RTMPose: symmetric, higher confidence on occluded limbs (+0.17..+0.21
on the far leg), real 3-point feet (small toes ~0.87–0.90 — the foot
fan and contacts get a third point to lean on), slightly better arms.
MediaPipe: consistently SMOOTHER raw landmarks (its VIDEO-mode temporal
tracker; 25–35 % lower jitter) and ~3× faster — but the raw-jitter edge
does NOT survive stage 2: post-SavGol the gap collapses to 3–10 %
(3.74/3.85, 2.00/2.19, 0.68/0.70 px — measured 2026-09-27 on the
stage-2 output, same windows). Smoothness was a filter property, not an
estimator property. Downstream tables are
near-identical on today's clips — the difference will matter most on
harder clips (more occlusion, faster feet).

## Decision — RECORDED (T4)

**VERDICT 2026-09-27: estimator chosen: rtmpose** (mediapipe kept for
fast passes via `--estimator mediapipe`). Default flipped in
extract.mjs; recorded in PIPELINE.md stage 1, MOTION_SOURCES.md header,
USER_GATES item 4. All three clips re-extracted on rtmpose 2026-09-27 =
brief 19's R0 baseline (runningman even improved: 4/4 cycles kept vs
3/3, net loop drift −0.0264 → −0.0001 u/loop). The post-smoothing
jitter rows above close the one open question: mediapipe's smoothness
edge was a filter property.

## Status of the remaining brief items

- T1: DONE both backends (setup.sh --check lists runnable estimators;
  rtmlib 0.0.13 + onnxruntime 1.19.2 pinned; rtmlib model cache in its
  default location, not corpus/.models — deviation, noted).
- T2: DONE (foreshortening twist/yaw + signs + 2D-only view/gate);
  the acceptance overlay in the explorer is still the compact traces —
  fore-vs-world per-bone toggle lands with T3.
- T3: DONE 2026-09-27 — `tools/mocap/explorer-ab.mjs` combines two
  `--explorer-json` dumps into one page: summary card (both jitters,
  limb scores, frontness, period, cycles, keys/RMS, lag) + page-wide
  A/B/overlay toggle (overlay ghosts B at 45 % over every stage).
  Pages: corpus/{runningman,tstep-L,bodyroll}.explorer-ab.html.
  T2.3 fore-vs-world twist overlay: DONE — explorer section 3b (per-
  bone, 2D channel vs estimator world z; world absent on rtmpose).
  Headless smoke: 5 pages, toggle+scrub+select, 0 errors.
