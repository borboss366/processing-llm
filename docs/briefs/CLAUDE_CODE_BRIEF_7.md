# processing-llm — brief 7: locomotion and behavior

Verdict on Brief 6 Task 1: gate PASSED — the gooey render is the right
visual language; keep it. New problem, confirmed from frames: the creature
has no world-space motion. Everything oscillates around a fixed rest pose,
so it reads as a static blob. This brief adds locomotion, contact-locked
feet, and a behavior state machine. Brief 6 Tasks 2 (shader threshold) and
5 (bitmap silhouettes) stay deferred; Task 4's squash/stretch folds into
this brief where noted.

## Task 1 — World-space locomotion with planted feet

1. The creature root gets a world position and velocity along the ground
   line. Param `speed` (body-heights per second, default ~0.35 when
   walking).
2. Gait couples to translation: stride length = speed × beat period ×
   beatsPerStride (param, default 1). Each leg's cycle splits into stance
   (~60%) and swing (~40%). During stance the foot pin target is FIXED in
   world coordinates while the root passes over it. During swing the foot
   arcs (simple half-ellipse) to the next plant point. Foot PLANT lands at
   `beatPhase = 0` for the lead diagonal pair (trot: diagonal pairs
   alternate, phase 0 and 0.5).
3. Direction: walk right until the root reaches an 18% screen margin, then
   turn (mirror via a 0.4 s scaleX tween through 0) and walk the other way.
4. Squash/stretch from Brief 6 Task 4 lands here: squash 5% on plant,
   stretch on the airborne part of the cycle; root bounce follows the gait
   (lowest at mid-stance, not a free sine).
5. Jelly locomotion: slow horizontal drift + the existing swim pulse;
   turns are a lazy arc, no mirror flip.

## Task 2 — Behavior state machine

States: `idle`, `walk`, `groove` (bounce-in-place, current behavior),
`hop` (bigger airborne bounce, both diagonals together). Transitions only
on bar boundaries (barPhase wrap), with hysteresis:

- energy z-score < −0.5 for 2 bars → idle
- −0.5..+0.5 → walk
- > +0.5 → groove; > +1.5 → hop
- beatConfidence < 0.4 → idle (free-run breathing still on)

Params: `behavior` = `auto` | forced state. Log state changes to the
session stream (type `creature-state`) so replay can see them.

## Task 3 — Idle is a moving hold

In `idle` (and layered faintly under all states): breathing (body scale
±2% at ~0.2 Hz), weight shift (root sways ±2% of body width, Perlin, not
sine), head look (head joint yaw wanders via low-freq Perlin, occasional
quick reorient), tail/rear micro-bob. Nothing on screen is ever perfectly
still, and none of it is periodic.

## Task 4 — Palette and body fixes

1. Two hue families per creature + one accent (head/tail), params.
   Audio drives brightness/glow only, not hue.
2. Fix torso threshold holes: per-part sprite-radius floor for `body`.
3. Add a neck: 2–3 rings between head and torso so the head is connected
   flesh, not a pinned satellite.

## Task 5 — Capture and gate

30 s capture per shape over Butterchurn, using a section of the mix that
includes a breakdown, so the capture shows: walk → groove/hop on high
energy → idle on the breakdown → walk again. Report states observed, feet
sliding (should be none during stance), and fps. Stills + mp4 under
`reports/<date>-creature-4-locomotion.md`. STOP for judgment.

## Not in this brief

Mocap-derived joint curves, CPG gait coupling, shader threshold, bitmap
silhouettes, LLM/director control of behavior, GRA/growth. Next after the
gate passes, in order: bitmap silhouettes (Brief 6 Task 5), then
director-driven behavior.
