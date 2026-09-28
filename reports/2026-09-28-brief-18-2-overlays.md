# Brief 18.2 — every stage drawn back onto the frame

All three tasks built; explorers regenerated for the three clips (plus
front-reinterpretation pages and the three A/B pages, which inherit
everything). Headless smoke: all 8 overlays toggled, all 5 heatmap
metrics, heatmap + filmstrip click-to-scrub, 0 page errors.

## Task 1 — on-frame overlays (section "OV" in every explorer)

Eight composable layers over the video frame, one shared scrub, any
subset on; compact index under the page title lists the active set.
1 rig-on-source (bones colored by round-trip bucket, hip-anchored,
hip→shoulder normalized) · 2 rest ghost · 3 goniometers (arc from
reference-abs to observed-abs + θ label) · 4 foreshortening heat
(bone color = projected/rest ratio, ⊙/⊗ twist sign) · 5 contacts
(ground marker per foot from the SAME fk-height bins the stance lock
believes + inset trace) · 6 raw-vs-smoothed dots · 7 velocity arrows ·
8 table ghost (the distilled table sampled at the clip's phase — R1 on
the video). Export buttons: current composite → PNG, whole clip →
webm (both land in the browser's downloads; move to reports/ to keep).

## Task 2 — whole-clip diagnostics (section "DIAG")

9 bone×time heatmap — metric selectable (round-trip / R1-vs-raw /
foreshortening / score / |θ|), FIXED absolute color scales (severity,
not rank — a clean clip stays dark), worst cell named, click → scrub.
10 onion-skin cycles at the scrubbed phase (dropped = red).
11 flag filmstrip — 40 thumbnails, per-frame markers (gate held /
clamp / twist-sign source / dropped cycle / distill key), click →
scrub. 12 key-pose ghosts — every table key FK'd as a mini pose.

## Task 3 — plumbing

`poses.json` gains `debug` (sign sources per bone/frame, gate masks,
contact bins) and `restRef`; the explorer dataset gains signSrc,
restLens, imgRaw, gateMasks, contactDebug, the rig tree (in-page FK),
loop timing, full-skeleton cycle data, 40 frame thumbs (pages 0.7–0.8
MB single, 1.3–1.5 MB A/B — bounded). Stage 1 caption names the ACTUAL
estimator and says when the 3D world is absent. Live path untouched.

## Acceptance stills

- `182-still-1-rig-on-source.png` — knee-lift frame (f49): the rig
  tracks the dancer bone-for-bone, every bone green (round-trip
  < 0.02 rad), lifted knee + planted-foot contact marker + fk-height
  inset. This is overlay 1+5.
- `182-still-2-heatmap.png` — running man bone×time, round-trip
  metric on the absolute scale: near-uniform dark = the retarget
  replication agrees with the pipeline everywhere; the faint warm
  cells on elbows are the documented chest-projection residue.
- `182-still-3-rest-ghost.png` — same frame, rig vs rest ghost: the
  ghost hangs its arms and stands straight; the rig holds arms
  forward-bent with the knee up. Under the measured-rest bug the rig
  sat AT the ghost — this pair of skeletons IS that bug, visible.

## Acceptance walk (what the user can now point at without reports)

(a) worst round-trip bone+frame: heatmap `worst:` label (elbowR @ 56
for the running man — chest-projection residue). (b) a wrong contact
flag: overlay 5's marker vs the dancer's actual foot at any frame,
with the fk-bin trace showing why. (c) dropped cycles and why: onion-
skin reds + filmstrip red markers at the frames where they diverge.
