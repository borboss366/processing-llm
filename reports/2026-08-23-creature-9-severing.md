# Limb severing — Brief 8.1

**Fixed. Components = 1 for both bipeds across 30 s captures with the full
move set** (walk/groove/idle/hop, arm swings included), verified by
per-second connected-component counts on the thresholded density mask
(`tools/capture-creature.mjs --verify`):

```
biped-1: components max 1 · clean-path 1.03 ms/frame · slide 0.79 px
biped-2: components max 1 · clean-path 0.98 ms/frame · slide 0.20 px
VERIFY:PASS creature-capture shapes=2 seconds=30
```

## The actual root cause (found by node-level forensics, not the brief's hypothesis)

The severed "mitts" were **orphan spring-graph islands**: the drawn fists
poke slightly outside the sidecar's limb-region circles, so their periphery
was grid-sampled as *body* tissue — far from the torso, those nodes'
k-nearest neighbours were only each other. A clump with no springs to the
main body is free-floating from birth: unpinned, unanimated, it hovers at
its rest position and separates the moment the arm swings away. An atomic
severed-frame capture identified the blob as 32 consecutive body-labelled
grid nodes, which settled it.

Two fixes:
1. **Build-time invariant (general)**: connected components of the spring
   graph are computed after sampling; only the largest survives, with a
   console warning naming the dropped count ("check the shape's part
   regions cover all extremities"). A disconnected graph can never stay
   visually connected, so this kills the entire bug class for any future
   shape.
2. **Sidecar data**: arm regions enlarged/moved to cover the fists
   (biped-1 limb2/3 → (0.27/0.73, 0.55) r 0.145; biped-2 → (0.255/0.745,
   0.56) r 0.155), so mitt tissue is ring-chained into the arm as intended.

## The brief's numbered steps — what each contributed

1. **Bone splats**: implemented and kept (default on) — necessary but not
   sufficient. With splats off, components hit 2–3 during arm swings even
   after steps 3–4; with them on, the skeleton density is guaranteed. Two
   deviations from the spec, both measured: splat count scales with bone
   length ÷ radius (fixed N=5 leaves sub-threshold gaps on long bones —
   the chain itself was dotted), and splats run at 2× alpha / 1.2× radius
   (a single chain peaks ~0.25–0.30 after gradient/downsample losses,
   marginal against the 0.18 threshold). Tip bones additionally bridge
   joint → live pin-cluster centroid (pin offsets rotate with the joint, so
   fists orbit sideways off the bone line).
2. **Bone-length preservation**: asserted in the harness. Rotation-driven
   bones: max deviation 0.0% (< 3% ✓, every run). Ground-chain bones
   (hip→knee→foot in stance/swing) stretch 17–27% BY DESIGN — that is the
   walk — and are reported separately, excluded from the 3% assert
   (explicit deviation from the brief's blanket wording).
3. **Pin audit**: joints now grab only nodes of their own part label, and
   paws (feet + hands, `paw: true` in the sidecars) pin *every* node of
   their part within the paw radius — a 9-node cap left distal fist rings
   free to whip off on springs.
4. **Per-part radius floors**: limbs raised to 2.1× median edge length with
   accumulation alpha 0.42 — swings stretch ring spacing ~2×, and at-rest
   margins must survive max excursion. Measured min density along limb
   tissue, at excursion, across 30 s: 0.46–0.69 (threshold 0.18, required
   ≥ 0.27): biped-1 {limb0 0.62, limb1 0.62, limb2 0.62, limb3 0.46},
   biped-2 {limb0 0.54, limb1 0.46, limb2 0.53, limb3 0.48}.

## Harness/infrastructure findings (kept)

- **Any canvas readback demotes the accumulation canvas to CPU for the
  session** (~1 → 7-9 ms/frame) — getImageData, or even being drawImage'd
  repeatedly. Production therefore does zero readbacks; the density probe
  is gated behind a `densityProbe` param, and the verify harness runs a
  clean budget phase (no reads) before the probe phase, with a fresh page
  per shape (the demotion had polluted the second shape's numbers).
- Component counting, bone-deviation asserts, and the density table are now
  part of `capture-creature.mjs --verify` permanently.
- Non-verify (file-writing) captures use a 3 s settle and show the known
  BPM-settling slide transient (~10-12 px in the first seconds); the
  acceptance runs use the 10 s settle and pass at ≤0.8 px.

## npm run verify

```
pll-synthetic             PASS    scenarios=4 (0.3s)
module-load               PASS    modules=8 (0.1s)
director-prompt-stable    PASS    bytes=57585 (0.1s)
creature-capture          PASS    shapes=2 seconds=30   (components=1, budgets green)
```
(full tier: pll-real-tracks retains the known bistable dnb-174 open item —
unrelated to this patch; replay-smoke last green 2026-08-23)

Captures: `creature4-biped-1.png/.mp4`, `creature4-biped-2.png/.mp4`
(+ `-diag.png`). STOP.
