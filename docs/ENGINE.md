# The engine, stage by stage (brief 19.2 Task 1)

Plain-words version (no math, same stages): [ENGINE_PLAIN.md](ENGINE_PLAIN.md).

**How to run this:** `npm run engine-report -- --move <name> --shape
<shape> [--open]` — captures a live trace, prints the per-stage ladder
(the rung that eats the radians, worst joint, clamps/yields) and the
fidelity verdict, opens the engine explorer; `--help` for flags, and
it prints the underlying engine-trace command.

Written for the owner, to be read WITH an engine explorer open
(`reports/engine-<move>-<shape>.engine.explorer.html`, written by
`tools/engine-trace.mjs`) or the puppet page's live Engine view. One
page per stage in the 19.1 tap order. Everything lives in ONE file:
`web/app/loaded-modules/creature.js` — line numbers are from the
2026-10-03 revision and drift with edits; the section comments quoted
here are stable search anchors. Return every sentence you cannot
verify in the explorer — each becomes a revision.

The one convention to hold in your head: the engine's FK rotates the
bone ENTERING a joint by that joint's theta (`rot = P.accRot +
J.theta`). Captured tables name rotations by the bone LEAVING the
joint, so they are shifted one joint down each limb chain AT LOAD
(`remapCapturedTable`, ~line 854) — hip→knee, knee→ankle, ankle→foot,
shoulder→elbow, elbow→hand. Spine channels are distal-named in both
conventions and pass through. This is the A7 knee bug's grave; the
explorer reports everything in EXTRACTOR semantics (thigh = hip+knee
slots summed) so you never juggle it while reading.

## 1 · Table playback

**In:** the table (`moves/<name>.json`, keys sorted by phase) + the
move clock `moveAcc` (beats, driven by the beat grid; `phaseDebt`
spreads clock snaps over ≥1 beat so acquisition can't step the pose).
**Out:** `mvPose` — one joints{rot,dx,dy,twist,yaw} record + contacts
set + travel for this instant.
**Formula** (`sampleMove`, ~894): loop phase = moveAcc mod
beatsPerLoop; find the key pair bracketing it; `u` eased by the
SEGMENT's ease — `snap` completes in the first quarter (smoothstepped),
`smooth` is a full smoothstep, `linear` is linear; channels lerp.
**Failure we hit:** the one-slot convention shift above — 1.8 rad of
knee swung the thigh and the leg drew straight (A7 FAIL, 2026-10-03).
**Explorer:** s1 row IS this stage's output; the ladder's zero rung.

## 2 · Blend / crossfade

**In:** mvPose + the previous move's table during a switch.
**Out:** one blended mvPose; `ov`/`vc` (overlay, verticalContent)
crossfade on the same envelope.
**Formula** (~1466): incoming channels × `wIn`, outgoing × `1−wIn`,
`wIn` = smoothstep over XFADE_BEATS=4, phase-aligned to the bar wrap
that fired the rotation. A separate POSITION blend (~1878, "pose
blending") lerps joints from a snapshot over `blendBeats` when a move
is forced mid-bar. Manual scrub completes both instantly (a frozen
envelope would scale the scrubbed pose).
**Failure we hit:** rhythm switched instantly under the old
position-only blend (brief 14) — the pose was continuous but the BEAT
pattern stepped.
**Explorer:** s2 vs s1 on the ladder — ≈ 0.000 when settled; the
filmstrip's violet band marks active windows.

## 3 · Springs / follow — THE R2 RUNG

**In:** every table channel. **Out:** the same channels, one
critically-damped spring late.
**Formula** (`springStep` ~946, applied ~1536): per channel,
`a = wn²(target−x) − 2·wn·v`, default `moveSpringWn` 10 ≈ 100 ms
response. Exists so `snap` keys can't land a one-frame velocity step
(the spike metric's old top source).
**Measured cost (19.1 ladder):** 0.355 rad RMS on the running man
(worst elbowL 0.588), 0.235 on the t-step — the LARGEST engine rung
by an order of magnitude. This is the "softness" that survives a
perfect table.
**Knob:** `moveSpringWn` (puppet param; halve to 5 to feel the lag
double, raise toward 20 to chase the table — watch the spike count).
**Explorer:** the s3 ladder step; s3−s1 per joint in the heatmap.

## 4 · Liveness

**In:** sprung channels + the procedural gait. **Out:** J.theta per
joint: `dance = (gaitSin + tRot·accentK)·cos(parentTwist)`, then × vA.
**Formula** (~1607–1700): per-joint amplitude wander vA (slow Perlin,
20–60 s, ±varyAmp·5), phase wander on the gait sinusoid only,
dominant-side ±8 %, downbeat accent + drop burst (accentK), spine/head
lead-lag via a time-indexed buffer (spineLagMs/headLagMs; walk
exempt). All UNDER the table, master-gated by `liveness`.
**Measured cost:** +0.027 rad over s3 — pennies, by design.
**Explorer:** s4−s3; wander is visible as slow breathing of the step.

## 5 · Limits & signs

**In:** table rot per slot. **Out:** the same, clamped to the shape
sidecar's `rotLimits` by chain family; ±symmetric.
**Formula** (~1640): family = role (knee slot → 'knee' …), one slot
PROXIMAL for remapped captured tables (the slot holds the
next-proximal bone's value). Clamp hits are counted
(`__creatureBench.clampHits`) and warned once per joint.
**Failure class:** a clamp on a captured table is either a convention
smell or a real anatomy-vs-engine finding — tstep's feet clamp 83/106
frames (front-view heel→toe vs foot-splay rest; whitelisted in the
table header, fix owned by the depth re-run). The knee bug would have
been caught here had the fidelity row existed.
**Explorer:** s5−s3 ladder (must be 0.000 outside the whitelist); red
filmstrip band = clamp hits; `engine-fidelity` fails unwhitelisted.

## 6 · Stance lock / contacts / odometry

**In:** the FK'd pose + the segment's contacts set. **Out:** flagged
feet held down; root travel.
**Formula** (~1846): per ground tip, a critically damped lock weight
`w` springs toward 1 when the segment lists the foot AND the table
pose doesn't lift it > 0.025 u (the yield). CAPTURED tables: the lock
only pulls the tip to the GROUND PLANE (y) — the chain is real data.
Authored tables (no leg content) keep the old machinery: tip pinned at
rest x/y, ankle heel-pivot about the toe (phi = the authored ankle
rot — the t-step mechanism), knee at the hip↔ankle midpoint. Travel:
`mvPose.travel × dPhase` glides world.x; walk owns its own odometry.
**Failure we hit (twice):** image-space contacts planted the occluded
foot through its whole swing (stance lock ate the lift, brief 17);
then the authored-era rewrite straightened REAL captured legs (A7 —
the running man's foot slides low while the knee bends, so the yield
never fired and the midpoint knee erased 1.8 rad).
**Explorer:** lock−s4 on the ladder (≤ 0.15 budget); filmstrip green
= lock engaged, yellow = lift-yield; puppet readout shows live w per
foot.

## 7 · FK

**In:** J.theta per joint. **Out:** joint positions (ax, ay).
**Formula** (~1708): `rot = P.accRot + J.theta`; the parent→J offset
(from the SHAPE's rest geometry) rotates by `rot`; `accRot` chains.
True hierarchy — a hip theta carries the ankle through space. dx/dy
add AFTER chaining (authoring guidance: rot on chained limbs).
**Failure we hit:** the pre-13 "0.35-damped immediate-parent"
inheritance left elbows pulling up without rotating.
**Explorer:** the fkP skeleton panel; compare with lockP to see what
the lock moved.

## 8 · Depth mapping

**In:** twist/yaw channels (±2.0 / ±0.6, accent-scaled). **Out:**
draw-time factors only — no physics.
**Formula** (~1660–1760): child bend flips by `cos(parent.twist)`
(the un-chicken mechanism: an arm raise passes through straight and
re-emerges bent the other way); a twisted bone DRAWS shorter
(`max(0.25, cos(twist))` on the child offset); per-limb dim ≤ 0.15
and foot-fan splat widening from `|sin(twist)|`; pelvis/chest yaw
cos-squeezes limb-root offsets + eye parallax.
**Explorer:** depth.twistFx per frame in the trace; on stage the
capture explorer's overlay 4 is the same channel upstream.

## 9 · Tissue

**In:** joint positions. **Out:** the node cloud following them.
**Formula** (~2111): each joint hard-pins its ≤4 nearest same-part
nodes (offsets rotate with accRot; paws pin everything in radius);
everyone else is verlet + edge springs (3 iterations, stiffness
param) + ground clamp; spine-bow nodes pull onto the pelvis/chest/
neck quadratic (spineBow, 2026-09-28). Bone splats (~2475) lerp
sprites along every bone so a limb can NEVER sever whatever the
springs do.
**Failure we hit:** wrist pinning forearm nodes dragged the chain
(pin audit, 8.1); fists whipped off on springs (paw pins).
**Explorer:** tissue summary in the trace; components metric (=1) in
every harness.

## 10 · Density & goo

**In:** node + splat sprites accumulated per part-channel. **Out:**
pixels.
**Formula** (~2446): density accumulates per group (R = torso+head+
legs, G/B = arms), UNION-BY-MAX across groups (no weld flash);
shader thresholds at `gooThreshold` 0.18, shades by density gradient
(normal from 4-tap), rim + specular + ambient pickup from the
background; `silhouette` mode is the same field flat-filled; render
modes goo/goo-bones/bones/silhouette/wire + onion ghosts (hotkeys
m/o).
**Failure we hit:** additive density weld-flash (26–39 % removed by
union-by-max); readback mode flipping the accum canvas (9× frame
cost — never getImageData the accum).
**Explorer:** the render-mode strip (R4 is judged THERE); goo.d0 in
the trace; limbDensity probe in `__creaturePerf`.

---

## The reading assignment (yours — brief 19.2 Task 2)

The three code stretches that ARE the pose path, each beside its page
and its explorer tap:
1. `sampleMove` + the crossfade block (stages 1–2, ~120 lines).
2. `springStep` + the liveness/dance loop (stages 3–4, ~150 lines).
3. The clamp + FK + stance lock (stages 5–7, ~150 lines).

Prediction knobs (write the prediction FIRST, then run):
- `moveSpringWn: 5` via the puppet params → re-run
  `node tools/engine-trace.mjs --move runningman-captured --shape
  biped-profile --no-webm` and read the s3 ladder step.
- rotLimits.knee edit in `web/app/shapes/biped-profile.json` → same
  run, stage-5 heatmap + filmstrip.
- contacts forced planted: copy the table, add `"footL"` to every
  key's contacts, load by name → stage-6/lock views.
