# The engine, stage by stage

This document describes the creature engine. The text follows ASD-STE100
Simplified Technical English (STE): short sentences, one topic for each
paragraph, active voice, and the same headings for each stage. Function
names, parameters and formulas are technical names and technical data.

A version without formulas is in [ENGINE_PLAIN.md](ENGINE_PLAIN.md).

## How to use this document

1. Start the stack (`npm run server`, and `npm run dev` in `web/app`).
2. Run `npm run engine-report -- --move <name> --shape <shape> --open`.
3. Read each stage below with the engine explorer open.
4. Compare each statement with the explorer view that the stage names.
5. Write down each statement that the explorer does not show.

NOTE: The engine explorer is `reports/engine-<move>-<shape>.engine.explorer.html`.
The puppet page has the same views as a live "Engine view".

NOTE: All engine code is in one file: `web/app/loaded-modules/creature.js`.
This document gives function names and section comments as references.
Line numbers change with each edit, so this document does not use them.

## The joint convention

The engine FK turns the bone that goes INTO a joint by the theta of that
joint: `rot = P.accRot + J.theta`. The capture pipeline names each
rotation by the bone that goes OUT of a joint. Thus the two conventions
differ by one joint on each limb chain.

The function `remapCapturedTable` moves each limb rotation of a captured
table one joint down the chain when the table loads: hip→knee,
knee→ankle, ankle→foot, shoulder→elbow, elbow→hand. Spine channels use
the same name in the two conventions, so they do not move. The channels
`dx`, `dy`, `twist`, `depth` and `yaw` do not move.

CAUTION: Do not add a limb rotation to a captured table by hand without
this remap. If you do, the rotation turns the wrong bone. This was the
cause of the A7 failure (2026-10-03): a 1.8 rad knee turned the thigh,
and the leg was straight.

The explorer shows all values in the capture convention. For example,
the thigh angle is the sum of the hip and knee slots.

## Stage 1 · Table playback

**Function:** The stage reads the pose that the table gives for this
instant.

**Input:** The table (`moves/<name>.json`, keys in phase order). The move
clock `moveAcc`, in beats, which the beat grid drives.

**Output:** `mvPose`: one record of joint channels (`rot`, `dx`, `dy`,
`twist`, `depth`, `yaw`), the set of feet in contact, and the travel.

**Rule (`sampleMove`):**
- The loop phase is `moveAcc` modulo `beatsPerLoop`.
- The stage finds the two keys on each side of the phase.
- The `ease` of the first key sets the curve: `snap` completes in the
  first quarter of the segment, `smooth` is a smoothstep, `linear` is
  linear.
- Each channel is a linear interpolation between the two keys with
  this curve.

**Parameters:** `phaseDebt` spreads a sudden clock correction over one
beat or more. Thus a clock correction does not make the pose jump.

**Known failure:** The joint-convention error above (A7, 2026-10-03).

**How to examine:** The row `s1` in the trace is the output of this
stage. It is the reference for all other rungs of the ladder.

## Stage 2 · Blend and crossfade

**Function:** The stage changes from one move to the next move without a
jump.

**Input:** `mvPose` and, during a change, the table of the previous move.

**Output:** One blended `mvPose`. The overlay `ov` and the vertical
content `vc` also change on the same curve.

**Rule (comment "rhythm crossfade"):**
- The incoming channels are multiplied by `wIn`.
- The outgoing channels are multiplied by `1 − wIn`.
- `wIn` is a smoothstep over `XFADE_BEATS` = 4 beats.
- The change starts on the bar that started the rotation.
- A different blend (comment "pose blending") moves the joints from a
  snapshot over `blendBeats`. It operates when a move is forced in the
  middle of a bar.
- In manual scrub, the two blends complete immediately.

**Known failure:** Brief 14: the old blend changed only the positions.
The beat pattern of the new move started immediately, and the rhythm
jumped.

**How to examine:** The ladder rung `blend` is approximately 0.000 when
no change is active. A violet band in the flag strip shows each active
change.

## Stage 3 · Springs (rung R2)

**Function:** A spring smooths each table channel, so that a `snap` key
does not make a one-frame jump.

**Input:** Each table channel. **Output:** The same channels, with a
small delay.

**Rule (`springStep`):** Each channel is a critically damped spring:
`a = wn²·(target − x) − 2·wn·v`. The function divides each frame into
substeps, so the spring is stable at a high `wn`.

**Parameters:**
- The header field `followWn` of a table sets `wn` for that table.
- If a table has no `followWn`, the value comes from its source.
- Captured tables use 60 (approximately 17 ms).
- Authored tables use the param `moveSpringWn` (default 10,
  approximately 100 ms).
- The stance-lock weight (stage 6) uses `moveSpringWn` for all tables.

**Known failure:** Captured tables are already smooth. The 100 ms spring
made them soft: on the running man, this rung was 0.346 rad. With
`followWn` 60, it is 0.034 rad, and the spike count stays 0.

**How to examine:** The ladder rung `spring` and the heatmap at stage
`s3`. To examine the effect, set `moveSpringWn` to 5 on the puppet page
for an authored table. The rung increases.

## Stage 4 · Liveness

**Function:** This stage adds small variations, so that a loop does not
look mechanical.

**Input:** The sprung channels and the procedural gait. **Output:**
`J.theta` for each joint.

**Rule (comment "liveness layer"):**
- `dance = (gaitSin + tRot·accentK)·cos(parentTwist)`. Then `J.theta =
  dance × vA`.
- `vA` is a slow amplitude variation for each joint (Perlin noise,
  period 20–60 s).
- A phase variation applies to the gait sine only.
- The dominant side is 8 % larger. The other side is 6 % smaller.
- `accentK` adds the downbeat accent and the drop burst.
- The spine and the head follow the pelvis with a delay
  (`spineLagMs`, `headLagMs`). The walk state does not use this delay.

**Parameters:** The param `liveness` turns all of these on or off.

**Known failure:** The head turn was once a step at a noise threshold.
It caused a twitch. Now the head turns smoothly to its target.

**How to examine:** The ladder rung `+gait/liveness`. This rung is
small by design (approximately 0.03–0.15 rad).

## Stage 5 · Limits and signs

**Function:** The stage limits each joint rotation to its anatomical
range.

**Input:** The table rotation of each slot. **Output:** The same value,
limited to ± the limit.

**Rule (comment "rotLimits clamp"):**
- The limit comes from `rotLimits` in the shape sidecar.
- Each joint family has one limit: `hip`, `knee`, `ankle`, `shoulder`,
  `elbow`, `wrist`, `toe`.
- For a remapped captured table, the slot holds the value of the next
  joint up the chain. Thus the stage uses the limit of that joint.
- The stage counts each clamp in `__creatureBench.clampHits`.

**Known failure:** A clamp on a captured table shows a convention error
or a real difference between dancer and rig. The t-step feet clamp on
many frames, because the toes turn in the floor plane. The table header
lists these feet in `clampWhitelist`, with a reason.

**How to examine:** The ladder rung `limits` must be 0.000 for joints
that are not in the whitelist. A red band in the flag strip shows each
clamp. The verify row `engine-fidelity` fails on a clamp that is not in
the whitelist.

## Stage 6 · Stance lock, contacts and travel

**Function:** The stage keeps a planted foot on the floor.

**Input:** The FK pose and the contact set of the segment. **Output:**
The feet that the table marks as planted stay down. The root moves by the
travel.

**Rule (comment "table-move stance lock"):**
- For each ground foot, a lock weight `w` moves to 1 when the segment
  lists the foot.
- If the table pose lifts the foot by more than 0.025 units, the lock
  releases the foot (the yield).
- For a captured table, the lock moves the foot to the floor height
  only. The table data controls all other values.
- For an authored table, the lock also sets the foot at its rest
  position.
- It turns the ankle about the toe (the heel pivot).
- It puts the knee between the hip and the ankle.
- The travel moves `world.x` by `mvPose.travel × dPhase`. The walk state
  uses its own travel.

**Known failure:**
- Brief 17: wrong contacts kept a moving foot on the floor, and the lift
  was lost.
- A7: the authored-table rule made a captured leg straight. The yield
  did not operate, because the foot of the running man stays low while
  the knee bends.

**How to examine:** The ladder rung `lock+FK` (budget 0.15). In the flag
strip, green shows an active lock and yellow shows a yield. The puppet
page shows `w` for each foot.

## Stage 7 · FK (forward kinematics)

**Function:** The stage calculates the joint positions from the joint
angles.

**Input:** `J.theta` for each joint. **Output:** The joint positions
`ax`, `ay`.

**Rule (comment "TRUE hierarchical FK"):**
- `rot = P.accRot + J.theta`.
- The offset from the parent to the joint comes from the rest shape. The
  stage turns this offset by `rot`.
- `accRot` accumulates down the chain. Thus a hip rotation also moves
  the knee, the ankle and the foot.
- `dx` and `dy` are added after the chain.

**Known failure:** Before brief 13, each joint followed only its direct
parent, with a factor of 0.35. The elbow moved up but did not turn.

**How to examine:** The skeleton panel at stage `fkP`. Compare it with
stage `lockP` to see the change that the lock makes. The ladder row
`FK position` gives the distance between the table skeleton and the
engine skeleton.

## Stage 7a · Weight (brief 17.6)

**Function:** The stage puts the body on the foot that carries it.

**Input:** The FK pose and the `weight` of the table (−1 = all on the
left foot, +1 = all on the right foot). An authored table without
`weight` gets it from `contacts`. **Output:** New joint positions. The
stance lock (stage 6) operates after this stage.

**Rule (comment "weight layer"):** The stage operates only when the dial
`exaggerateWeight` is more than 0 (default 0 — the explain-it gate). All
lengths are fractions of the leg length `L` of the shape (sidecar
`weightLayer`).
- One spring smooths the weight: the table's own follow spring
  (`followWn` — 60 for a captured table, 10 for an authored table), the
  same spring as every other channel.
- **Grounding:** The whole body moves vertically until the lowest point
  (ankle or toe) of the support foot is on the floor. The stage measures
  the support leg with its REST bone lengths and the FK angles. Thus a
  depth cue that draws a leg shorter cannot lower the body. In shared
  stance (|weight| < 0.3) the stage uses the weighted average of the two
  feet. The root is solved from the foot. The feet are not pulled to a
  root.
- **Tilt:** The support hip goes up by `tilt` (4°) × weight. The view of
  the SHAPE decides: a front shape tilts, a profile shape does not.
- **Spine counter:** The upper body turns by (1 + `counter`) × tilt, with
  `counter` = −0.5. The head stays over the base.
- **Shift:** The pelvis moves toward the support foot by `shift` (0.06) ×
  L × |weight|, along the axis of the view. The support ankle and foot
  stay. The knee is solved again from the hip and the ankle.
- **Sink:** When the support side changes, the body drops by `sink` (0.03)
  × L into the landing foot over about 0.3 beat.
- The beat bounce returns after the grounding. During a sink, the bounce
  decreases by the same amount as the sink increases.
- The rules are the same for all tables. No table has a flag that
  changes this stage.

**Known failure:** Before this stage, the root did not follow the feet.
A captured table can lift both feet in FK; the lock held only the planted
foot, and the body seemed to hang (body roll: support foot up to 0.2 L
above the floor).

**How to examine:** `node tools/weight-probe.mjs` gives the support-foot
height, the foot below the floor, the root range and the displacement of
the layer, at each dial value. The trace row `wl` gives `w`, the tilt,
the shift, the grounding and the sink for each frame.

## Stage 8 · Depth

**Function:** The stage shows the movement toward or away from the
camera as visual cues. The engine stays 2D.

**Input:**
- `depth` ∈ [−1, 1] for each bone, from captured tables. Positive is
  toward the camera.
- `twist` (±2.0 rad) and `yaw` (±0.6 rad) from authored tables.

**Output:** Factors for the drawing only. The physics does not change.

**Rule for depth (comment "depth cues"):**
- Size: the radius of the bone is multiplied by `max(0.8, 1 +
  gain·depth·dial)`.
- Draw length: the length of the bone is multiplied by `1 −
  |depth|·drawK·dial`, with a minimum of 0.25.
- Brightness: the stage adds white (toward) or black (away) to the color
  of the part. The density does not change.
- Overlap: an arm with `depth` > +0.3 is in front of the torso. An arm
  with `depth` < −0.3 is behind the torso. The arm goes back to neutral
  only when `depth` is 0.1 nearer to zero. This prevents a flicker.

**Rule for authored twist and yaw:**
- The child bend is multiplied by `cos(parent.twist)`.
- A twisted bone is shorter: `max(0.25, cos(twist))`.
- A twisted limb is dimmer, and a twisted foot is wider.
- Pelvis and chest `yaw` make the limb roots narrower and move the eyes.

**Parameters:**
- The shape sidecar holds `depthCues`: `gains`, `sizeFloor`, `drawK`,
  `brightness`, `overlapOn` and `overlapHyst`.
- The gains for each part are: feet and hands 0.6, shins and forearms
  0.35, thighs and upper arms 0.2, torso and head 0.
- The dial is the param `exaggerateDepth`: 0 is off, 1 is the shape
  values, 2 is the maximum.

**Known failure:** A foot that points at the camera has almost no 2D
length. Its 2D angle is noise. The capture pipeline gives this bone its
rest angle and puts the movement into `depth`.

**NOTE:** Overlap operates for the arms in front view only. The legs and
the torso use the same density channel.

**NOTE:** When `depth` is 0, all cues have a factor of 1. Thus a standing
figure has the same image at each value of the dial.

**How to examine:** The ladder rungs `depth: spring` and `depth: final`.
The verify row `depth-stress`. On stage, use the render mode
`goo-bones` and change the dial.

## Stage 9 · Tissue

**Function:** A cloud of soft nodes follows the skeleton and makes the
body.

**Input:** The joint positions. **Output:** The node positions.

**Rule:**
- Each joint holds its nearest nodes of the same part (comment
  "J.pins"). The offsets turn with the joint. A hand (paw) holds all the
  nodes in its radius.
- The other nodes move with Verlet integration and edge springs (3
  iterations, param `stiffness`). The floor stops them.
- The spine-bow nodes move to a curve through pelvis, chest and neck
  (param `spineBow`).
- Bone splats put sprites along each bone (comment "bone splats").
  Thus a limb cannot come apart.

**Known failure:**
- A wrist held forearm nodes and pulled the chain (brief 8.1).
- A fist that only springs held came off during a fast swing.

**How to examine:** The components metric in each harness must be 1.
One connected body has one component.

## Stage 10 · Density and goo

**Function:** The stage makes one smooth, lit body from the nodes.

**Input:** The node and splat sprites. **Output:** The pixels.

**Rule:**
- The density accumulates in three channels: red is torso, head and
  legs; green is the left arm; blue is the right arm.
- The shader uses the maximum of the channels (union by max). Thus an
  arm that crosses the body does not make a bright flash.
- The shader shows the body where the density is more than
  `gooThreshold` (0.18).
- The shader calculates the light from the density gradient. It adds a
  rim, a specular light and a tint from the background.
- The render modes are `goo`, `goo-bones`, `bones`, `silhouette` and
  `wire`. Press `m` to change the mode. Press `o` to show the last
  poses as ghosts.

**Known failure:**
- Additive density made a bright flash where two parts touched. Union by
  max removed it.
- A read of the accumulation canvas made each frame 9 times slower.

CAUTION: Do not call `getImageData` on the accumulation canvas. Copy it
to a scratch canvas first.

**How to examine:** The render-mode strip of the engine explorer. The
`limbDensity` probe in `__creaturePerf`.

## Reading procedure (brief 19.2 Task 2)

The pose path is in three code sections. Read each section with its stage
in this document and its explorer view open.

1. Read `sampleMove` and the crossfade block (stages 1 and 2).
2. Read `springStep` and the liveness loop (stages 3 and 4).
3. Read the clamp, the FK and the stance lock (stages 5, 6 and 7).

Do these three tests. Write your prediction before you run each test.

1. Set `moveSpringWn` to 5 on the puppet page. Run
   `npm run engine-report -- --move tstep-placeholder --shape biped-1`.
   Read the `spring` rung.
2. Change `rotLimits.knee` in `web/app/shapes/biped-profile.json`. Run
   the same report for `runningman-captured` on `biped-profile`. Examine
   the stage-5 heatmap and the flag strip.
3. Copy a table. Add `"footL"` to the contacts of each key. Load the copy
   by name. Examine the stage-6 views.

NOTE: For test 1, use an authored table. A captured table uses
`followWn` 60, and `moveSpringWn` does not change it.
