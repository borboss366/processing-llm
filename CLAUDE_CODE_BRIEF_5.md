# processing-llm — brief 5: creature polish

Verdict on Brief 4 Task 2: YES, it reads as a creature. Concept proven.
The problems are scale, rendering, root motion, feet, and limb sampling —
none of them are the tissue physics. This brief is a polish pass on
`loaded-modules/creature.js`. Task 3 (change-detector) waits until after.

Ground rules unchanged. Keep the module ABI; all new knobs are params.

## Task 1 — Scale and framing

- Default creature height = 65% of canvas height; param `scale`.
- Param `ground` (canvas fraction, default 0.82): a floor line the creature
  stands on. Rest position is placed so feet/tentacle tips touch it.

## Task 2 — Rendering

Goal: a glowing body, not a graph figure.

1. Faces: fill triangles at alpha 0.25–0.4, colour by part hue, brightness
   modulated by `bands.kick` (body) / `bands.mid` (limbs).
2. Edges: interior edges thin and dim; boundary edges (edges belonging to
   exactly one triangle) 2–3× thicker and brighter.
3. Nodes: draw only near joints (within 1.5× pin radius); elsewhere omit.
4. Additive blending (`blendMode(ADD)`) so it composites over Butterchurn.
   Capture with the background ON for the report; keep the black-background
   capture as a secondary diagnostic only.
5. Optional cheap glow: draw the boundary twice, once wide at low alpha.

## Task 3 — Root motion

The root joint is static; the body must move.

1. Root vertical bounce: `0.03·H·sin(4π·beatPhase)` (2× beat) — amplitude
   param `bounce`, scaled by `smoothedLevel`.
2. Stride lean: root rotation `±0.04 rad·sin(2π·beatPhase)` in trot.
3. Head bob amplitude doubled; neck joint gets its own phase offset (0.25
   behind the root bounce).
4. Jelly: bell scale pulse increased to ±20%, and a vertical drift
   `0.02·H·sin(2π·beatPhase − 0.25)` so it "swims" up on contraction.

## Task 4 — Armature and feet

1. Mid-limb pins: each quadruped leg gets a knee joint (between hip/shoulder
   and tip) with its own phase offset (0.1 behind the tip) so legs bend.
2. Tip pin clusters: 8–10 nodes per tip (was 3–5) so feet are rigid paws.
3. Floor constraint: after integration, clamp free nodes to `y ≤ ground`,
   with a small friction damping on contact.
4. Springs: stiffness param `stiffness` default raised; 3 relaxation
   iterations.

## Task 5 — Limb/tentacle sampling

For parts labelled `limb[i]` (quadruped) and tentacles (jelly), replace
random-point + k-nearest with a ring chain: rings along the capsule axis
every ~1/12 of its length, 2–3 nodes per ring, edges within each ring and
to the next ring (and one diagonal per pair for shear stiffness). Body and
head keep the current sampling. Connect the first ring to the nearest
body nodes. This removes the bead-cluster fragmentation.

## Acceptance

- New captures for both shapes, background ON, 20 s each, from the
  file-audio techno mix, plus stills. Commit under
  `reports/2026-xx-xx-creature-2.md` with the same performance table.
- Module cost stays under 5 ms/frame at ~600 nodes.
- Report must state, factually: is the whole body visibly moving on the
  beat; are feet solid; are tentacles continuous.
- Then STOP. The user judges on a real GPU with Butterchurn behind it.

## Not in this brief

Growth-in animation, LLM shape design, GRA, Task 3 change-detector,
measured tags. All deferred until the creature is judged good on a real
display.
