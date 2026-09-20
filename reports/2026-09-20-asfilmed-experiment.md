# Pipeline experiment: --view as-filmed (de-yaw disabled) on running man

User diagnosis confirmed by test: the clip is filmed in profile; de-yaw
rotates every pose to front view, sending the sagittal knee lift into z
where the orthographic projection discards it. Re-ran the extraction
with the new `--view as-filmed` flag (project onto the camera plane as
filmed, no rotation; yaw trace still recorded for provenance). QA
stickman rendered in the same plane. Pipeline experiment only — no
table in web/app/moves, no staging, per instruction.

## Does the stickman track her knee lifts and foot slides? YES.

Visually (corpus/runningman-asfilmed.qa.mp4): the retargeted rig's leg
lifts with the dancer's, bent-knee profile matching the silhouette
frame by frame; foot slides track along the ground. The de-yawed run's
stickman showed near-static legs.

Quantitatively — theta span (rad, whole window), de-yawed → as-filmed:

| joint | de-yawed | as-filmed | factor |
|---|---|---|---|
| hipL | 0.22 | **1.14** | ×5.2 |
| hipR | 0.37 | **1.07** | ×2.9 |
| kneeL | 0.60 | **1.71** | ×2.9 |
| kneeR | 0.56 | **1.69** | ×3.0 |
| shoulderL | 0.60 | 1.85 | ×3.1 |
| shoulderR | 0.84 | 1.73 | ×2.1 |

## Per-bone twist RMS (rad) — the motion moved between channels

| bone | de-yawed | as-filmed |
|---|---|---|
| hipL / hipR | 0.40 / 0.35 | **0.16 / 0.11** |
| kneeL / kneeR | 0.58 / 0.49 | **0.13 / 0.22** |
| elbowL / elbowR | 1.16 / 0.97 | **0.18 / 0.26** |
| ankleL / ankleR | 0.93 / 0.97 | 0.48 / 0.28 |
| neck | 0.49 | **0.77** (went UP) |

The thigh/shank twist collapses exactly as predicted — the lift left
the invisible out-of-plane channel and entered the visible theta
channel. The one channel that got MORE off-plane is the neck: he faces
the camera while dancing in profile, so in the camera plane the HEAD is
now the off-plane part. The twist channel correctly identifies which
segment is depth-blocked in every projection choice.

## Supporting signals, de-yawed → as-filmed

- foot gate held frames: 32+58 of 82 → **0** (feet live in the camera plane)
- motion autocorrelation: 0.23 → **0.62** (the periodicity is IN this plane)
- cycles: 2/2 → 3 found, kept 2, dropped 1 (the instructor's most
  exaggerated demo cycle — visible red-tinted in the QA)
- ankle stance offsets: −0.29 for the near foot (profile source ≈
  profile rig rest — almost no correction needed) vs −2.49 for the far
  foot (in profile BOTH feet point the same screen direction; the rig's
  mirrored rest is ~π away — a real constraint plane-select must handle:
  one side of a profile capture wants a flipped-foot mapping)

## Conclusion for brief 17

Plane selection is worth a first-class mechanism: pick the projection
plane per clip (max motion variance, or the logged camera view) instead
of always de-yawing to frontal; the twist channel then says which
segments still need the depth fake. The T-step (fan = floor-plane, no
flat view holds it) and the running man (sagittal, the filmed view
holds it) are the two poles of the same decision.
