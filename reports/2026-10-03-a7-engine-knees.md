# A7 verdict FAIL → root cause: FK convention slot-shift (+ stance-lock rewrite)

**Verdict (user, 2026-10-03):** A7 FAIL — on stage the knees don't bend
and hyperextend slightly while the table carries 1.8 rad knee bend
(overlay 8 confirmed table-side). Engine-side.

## Instrumentation built first (directive 1)

- `__creatureBench.jointTrace` — per-joint {t: table, e: engine} in
  EXTRACTOR semantics; engine value derived from FINAL positions (post
  lock/blend), since the lock rewrites positions and zeroes theta.
- `clampHits` counter per joint (rotLimit clamps, loud and countable).
- Both flow through bench-state → puppet/session log.

**Evidence at the knee-lift phase (0.68):** kneeL table 1.785 →
engine −0.134 (flat + slight hyperextension — the user's exact words);
clamps 0; signs clean. rotLimits and bend-sign (directive 2) exonerated.

## Root cause 1 — FK convention slot-shift (the big one)

The ENGINE's FK rotates the bone ENTERING a joint by that joint's
theta (`rot = P.accRot + J.theta` applied to the parent→J offset); the
EXTRACTOR's convention bends the bone LEAVING it. Spine channels are
distal-named in both (torso always worked); LIMB channels are one slot
off — the captured kneeL swung the THIGH, the shin followed the ankle
channel, the leg drew straight. Verified numerically: R(kneeAcc)·
(hip→knee offset) lands exactly on the live knee position. Authored
tables never exposed it (tuned on the engine's own convention).

**Fix:** `remapCapturedTable` at table load (ensureMove + hot reload):
tables with `provenance.pipeline tools/mocap/*` shift limb rots one
joint distally (hip→knee→ankle→foot, shoulder→elbow→hand); spine/dx/
dy/twist/yaw stay. Clamp families shift with the slot; the heel-pivot
reads the foot-bone slot. Authored tables pass through untouched.

## Root cause 2 — stance lock rewrote real leg data

With contacts flagged, the lock pinned the foot to its REST x/y and
drew the knee at the hip↔ankle midpoint (+0.02) — a straight leg that
ignores bone lengths. The contacts were RIGHT (the running man's foot
genuinely stays low — it slides back / toe-drags while the knee
bends); the rewrite was the bug. For captured tables (which carry the
full leg chain incl. the foot bone) the lock now only holds a flagged
foot to the GROUND PLANE (y, spring-weighted) — FK is authoritative.
Authored tables keep the old machinery (they have no leg content).

## After (same probe)

phase 0.58: kneeL 0.716→0.708 · kneeR 0.170→0.165 · hips ≤0.02 off
phase 0.68: kneeL 1.785→1.761 · kneeR 0.361→0.373 · hipL −0.707→−0.662
Engine tracks the table within 0.04 rad at both locked and free
phases; 0 clamps; `2026-10-03-knee-fix-ab.png` = goo+bones before/after
at the lift phase (straight swept leg vs thigh-up shin-folded).

## Harness (directive 4)

moves-x-shapes extended from chain travel to PER-JOINT ANGLE AMPLITUDE:
samples jointTrace over ~2 loops; any joint with table amplitude
> 0.3 rad must render ≥ 60 %. Current: runningman e/t ≈ 1.0–1.3 all
six tracked joints, PASS. The stale raw-hip-slot check now reads the
trace. fk-check PASS (authored path byte-identical behavior:
kick 250 px, heel pivot 0.0 px drift, armpump 0.0 % err).

**Note for the re-view:** the planted knee now takes its bend from the
table (no IK straightening) — stance reads springier; and tstep's
heel-pivot under its CAPTURED table changes semantics with the remap
(parked move, flagged for its depth re-run).
