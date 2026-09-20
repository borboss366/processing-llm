# processing-llm — brief 16.2 (patch): extraction hardening, depth data now

Dictated by the user at the T-step gate (2026-09-20). Context: the gate
verdict is BLOCKED ON DEPTH — the T-step's foot fan is a floor-plane
rotation the 2D rig cannot show (toes freeze, heels over-press: the
projection, not the pipeline). tstep-captured is PARKED as a table; the
clip is kept and becomes the depth channel's acceptance test (brief 17).
No further T-step polishing. This patch is EXTRACTION ONLY, no
aesthetics, no re-judging.

1. **Foot-length gating**: when the projected heel→toe length falls
   below a threshold, hold the last valid ankle angle instead of taking
   atan2 of noise; log gated frames.
2. **Depth channels, emitted now, unused by the rig until brief 17**:
   `footYaw` per foot (floor-plane angle of the 3D heel→toe vector
   after de-yaw) and per-bone `twist` (out-of-plane angle of each child
   bone relative to the projection plane).
3. **pose_worker input enhancement**: track a bounding box,
   crop-then-upscale before inference, horizontal-flip test-time
   augmentation averaged; report landmark jitter before/after.
4. **QA video**: draw the extracted pelvis drift as a moving ground
   marker under the rig stickman so travel capture is visible.
5. **Distill/stitch**: per-part exaggeration map from the shape sidecar
   (feet/arms/head scaled separately) replacing the single ×1.35 global
   variant.
6. **Acceptance**: self-test green; T-step re-extracted with no
   regression in the pipeline numbers (lag, cycles, determinism) —
   NOT re-judged.

Out of scope: the depth/axial-rotation channel itself (17), any rig or
live-path change beyond parking the table, move #2.
