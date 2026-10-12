# processing-llm — brief 17.5: depth as cues (the cartoon answer)

Finding: a forward kick's foot (basic_kick_1, sole to camera) has no 2D
in-plane angle — the heel→toe projection is a few pixels, its angle is
noise. The ankle-reference fix was right for splay but cannot recover
an angle that isn't there. Decision: stop computing what can't be
measured; render depth the way 2D animation always has — as CUES
(size, draw length, brightness, overlap) driven by one measured signal.
Engine stays 2D; physics/contacts/fidelity rows untouched.

GENERALITY GUARD (the point of the brief): one rule, zero per-move
parameters. The depth signal exists for every clip (foreshortening is
measured on every bone, every frame). Stylization constants live on
the SHAPE (per-part ranges + one dial), never on a table. Acceptance
runs on ALL captured and authored tables with the same constants.

## Task 1 — The signal: `depth` per bone

1. Extractor emits `depth ∈ [−1, 1]` per bone per frame:
   magnitude = 1 − (projected / rest length), clamped; sign = toward (+)
   / away (−) from the existing continuity + keypoint-score resolution;
   hold sign through ambiguous frames. (It is signed `twist` normalized
   — unify; do not keep two channels for one quantity.)
2. Distill keeps it like any channel (extrema exact); blend/springs
   treat it like any channel; captured `followWn` applies.
3. Degenerate in-plane: when a bone's projected length is below the
   foreshortening gate, its in-plane deviation is REST (no last-valid
   hold); the motion lives in `depth`. Self-test: a synthetic sole-to-
   camera foot must retarget to ankle in-plane 0 and depth ≈ +1.

## Task 2 — The cues (render-only, per-part ranges from the shape sidecar)

Driven by `depth`, interpolated through zero with no pop:
1. **Size**: part goo radius × (1 + depthGain·depth). Defaults by part
   role: feet/hands 0.6 (→ 1.6× toward, 0.4× away is too small — floor
   at 0.8×), shins/forearms 0.35, thighs/upper arms 0.2, torso/head 0.
2. **Draw length**: bone draw length × (1 − |depth|·k) — B's
   foreshortening, kept; toward and away both shorten (size
   disambiguates the sign for the eye).
3. **Brightness/rim**: core brightness and rim intensity × (1 +
   0.35·depth); away dims.
4. **Overlap**: a limb with depth > +0.3 draws OVER the torso channel;
   depth < −0.3 draws BEHIND. Reuse the union-by-max channel ordering;
   switch at a hysteresis band so it never flickers.
5. One dial on the puppet: `exaggerateDepth` (0 = all cues off, 1 =
   defaults, up to 2). Shape sidecars carry the per-part gains; a
   standing figure (depth ≈ 0) must render identically to today at any
   dial value.

## Task 3 — Stress + fidelity

- Render stress row: sweep depth −1→+1 on each limb at slow/beat/snap;
  assert no popping at zero crossings, components 1, no NaN; the
  overlap switch never oscillates (count flips).
- Engine fidelity rows unchanged (angles); add `depth` to the table-vs-
  engine ladder so the channel is measured like the others.
- Sign sanity: on basic_kick_1 the kicking foot's depth must be
  positive during the kick (sole to camera); on runningman (profile)
  depth on legs ≈ 0 throughout. Both printed in the report.

## Task 4 — Judgment (owner)

Goo+bones at 3 m, `exaggerateDepth` 0 / 1 / 1.5:
- basic_kick_1: does the kick read as a foot thrown at the audience?
- runningman (profile): unchanged — depth cues must not touch an
  in-plane move.
- an authored `punchcam` table (two keys: fist in-plane → fist depth
  +0.9, snap): the move we declared impossible in front view, as a
  cartoon punch. Does it read?
Record in reports/ with stills at the dial values; USER_GATES item.

## Out of scope

3D anything; recovering in-plane angles that don't exist (LIMIT,
recorded); per-move tuning (forbidden by the guard); sign resolution
beyond continuity + score (if sign errors are common, that is a
separate finding with its own number).
