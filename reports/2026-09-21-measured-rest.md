# Measured-rest calibration (tiptoes fix; supersedes declared-rest guesses)

User diagnosis: the observed foot bone was ankle→toe, which slopes
~25–30° down-forward even when flat (the ankle sits above the foot), so
planted frames read as plantarflexion — the stickman tiptoed and the
floor-drop lifted the heels.

## What changed

1. **Feet observed as heel→toe** (horizontal when flat); profile
   declared rest is now exactly horizontal in the facing direction.
2. **Measured-rest calibration** (the general fix): median observed
   bone angle over PLANTED, LOW-VELOCITY frames becomes the human's
   own rest per clip and view — leg bones calibrate on their own
   side's planted frames (within 10% of that foot's lowest point),
   everything else on the lowest-30%-velocity frames; < 5 qualifying
   frames → declared rest as fallback (logged). Thetas are deviations
   from the measured neutral, applied onto the rig's rest by FK — the
   calibration pose renders AS the rig's rest pose, which is exactly
   what the stage does.

This one mechanism retires three shipped hacks/biases in the retarget
path: the ankle stance re-centering (2026-09-20), the profile view-rest
guesses as primary reference (now fallback only), and the QA render
adjust (deleted — rig-anchored rendering needs none).

## Numbers (running man, as-filmed, mirror)

- Calibration: global 25, legL 16, legR 27 frames; **0 fallbacks**.
- Measured−declared deltas: elbows **−1.07/−1.20 rad** (his habitual
  bent-arm pump carriage — the biggest guess-error of all, invisible
  until measured), neck 0.57 (head-forward), hips −0.42/+0.33 (crouch),
  ankles 0.10/0.11 (small — the heel→toe switch already fixed the foot).
- **Round-trip worst-bone error: 0.00°** (rig-anchored identity,
  including foot bones; the chest row now checks chest→neck — in FK a
  bone rotates by its parent's acc, so pelvis→chest is rest-fixed and
  checking it would re-measure the single-bend semantics as fake error).
- **rotLimit clamp hits: 0** — including the hip: yesterday's 16
  hipL hits were the declared-rest offset, not anatomy; measured
  against his crouch the lift fits inside ±0.9. The clamp-smell
  heuristic holds: every hit so far WAS a rest-reference problem.
- Self-test grows two checks (11 total, PASS): profile foot rests
  (0.20 rad under view vs 2.66 declared-front control) and
  measured-rest self-calibration (static clip on itself → max |theta|
  2.2e-16, no fallbacks).

## QA (corpus/runningman-asfilmed.qa.mp4)

Stickman stands feet-flat on the ground line, legs vertical at rest,
knee lifts and arm pumps tracking as deviations. Note the semantics
change: the stickman is RIG-anchored (shows what the stage will do),
not source-anchored — it resembles the rig's carriage with his motion,
by design.

Pipeline experiment: no tables rebuilt, nothing staged. USER_GATES
item 3 hold stands (tables predate the mirror-rest fix AND this).
