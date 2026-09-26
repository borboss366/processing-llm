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
| jitter | **3.08 px** | 4.14 px |
| wall (2.5 s) | **13 s** | 48 s |

## Card: body roll (profile, second dancer)

| | MediaPipe | RTMPose |
|---|---|---|
| leg scores L/R | **0.617** / 0.940 | 0.831 / 0.865 |
| arms | 0.663 | 0.797 |
| small toes | none | 0.898 |
| jitter | **1.47 px** | 1.97 px |
| wall (6 s) | **31 s** | 113 s |

## The trade, in one paragraph

RTMPose: symmetric, higher confidence on occluded limbs (+0.17..+0.21
on the far leg), real 3-point feet (small toes ~0.87–0.90 — the foot
fan and contacts get a third point to lean on), slightly better arms.
MediaPipe: consistently SMOOTHER raw landmarks (its VIDEO-mode temporal
tracker; 25–35 % lower jitter) and ~3× faster. Downstream tables are
near-identical on today's clips — the difference will matter most on
harder clips (more occlusion, faster feet).

## Decision — USER'S (T4)

Default `--estimator` awaits the user's pick from these cards +
explorers. Gut recommendation if asked: **rtmpose** for offline capture
quality (occlusion honesty + feet; jitter is post-smoothed anyway and
SavGol handles it), keep mediapipe for quick iteration passes. Recorded
in PIPELINE.md/MOTION_SOURCES once chosen; USER_GATES gains the
"estimator default chosen; far leg now usable?" item.

## Status of the remaining brief items

- T1: DONE both backends (setup.sh --check lists runnable estimators;
  rtmlib 0.0.13 + onnxruntime 1.19.2 pinned; rtmlib model cache in its
  default location, not corpus/.models — deviation, noted).
- T2: DONE (foreshortening twist/yaw + signs + 2D-only view/gate);
  the acceptance overlay in the explorer is still the compact traces —
  fore-vs-world per-bone toggle lands with T3.
- T3: comparison explorer (A/B toggle + summary card in-page) NOT yet
  built — the cards above carry the decision data meanwhile.
