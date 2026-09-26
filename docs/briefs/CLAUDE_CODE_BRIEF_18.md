# processing-llm — brief 18: the stage explorer (deblackboxing capture)

Purpose: the capture pipeline is a black box to its owner. This brief
makes every stage visible, with its numbers and its known failure
modes, and is ACCEPTED BY THE USER'S UNDERSTANDING, not by a metric:
done when he can follow a clip through every stage, predict what a
parameter change will do, and point at where a past bug lived. That is
iterative by nature — expect several rounds of "I can't follow this
part" → revise. No deadline pressure; brief 19 (fidelity) waits on it.

## Task 1 — `<clip>.explorer.html`, written by extract.mjs beside poses.json

Static, self-contained (inline data, no server), one section per stage
in pipeline order. Each section: the PICTURE, the NUMBERS that stage
produced for this clip, the PARAMETERS it used, and a "what can go
wrong here" note tied to the real bug that lived at that stage.

 0. **Input frames** — the crop/upscale exactly as the estimator saw it
    (fixed bbox, upscale factor, flip-TTA on/off). Hazard: feet cropped
    by vertical video.
 1. **Landmarks** — 2D points over the frame (scrubbable); the 3D world
    skeleton beside it, orbitable (drag); per-landmark VISIBILITY as
    color. Hazard: occluded far limbs (running man far leg at 25–50%).
 2. **Smoothing** — raw vs filtered traces per joint, filter named,
    measured lag. Hazard: One Euro's velocity-dependent drift
    (46–60 ms, fixed by Savitzky–Golay).
 3. **Yaw & view** — yaw trace over time, frontness score, the chosen
    canonical view, the skeleton before/after rotation. Hazard: de-yaw
    to front erasing a sagittal move.
 4. **Measured rest** — which frames were planted/slow, the rest
    stickman derived from them, per-bone rest angles. Hazard: hand-
    declared rests (mirror-rest, view-rest, foot slope — all lived
    here).
 5. **Retarget** — per bone, per frame (scrub): observed angle, rest,
    parent acc, side sign, resulting theta, ROUND-TRIP ERROR; errors
    color-coded, any clamp hit flagged. Hazard: the 2× side-sign
    signature.
 6. **Period & cycles** — the autocorrelation curve with candidate
    peaks and the chosen period marked; cycles overlaid phase-
    normalized, dropped ones red; the `--cycles` prior shown. Hazard:
    octave/harmonic errors (body roll ×6.9).
 7. **Distill** — keys drawn on the averaged curves per joint, key
    count, RMS vs raw. Hazard: averaging + few keys smearing accents.
 8. **Table** — the emitted move table (view, contacts per key, twist/
    yaw channels), and a link to load it in the judgment view.

Scrubbing one time slider moves every stage's picture together.

## Task 2 — `docs/PIPELINE.md`

One page per stage, in this order: what goes in, what comes out, the
actual formula (e.g. theta = (observed − restMeasured − parentAcc) ×
sideSign), the parameters and their defaults, the failure mode we hit
and how it was detected, and the function pointer (file:line). Written
for the owner, not for a paper. The user reads it against a clip's
explorer and returns a list of sentences he cannot verify or follow;
each becomes a revision. Repeat until the list is empty.

## Task 3 — Reading assignment (user, with the explorer open)

The three functions that ARE the pipeline: retarget core, measureRest,
distill (~300 lines total). Read once with the explainer beside them.
Acceptance for the brief as a whole: the user can (a) point at the stage
where the T-step's foot fan lives, (b) point at where the running man's
far leg went weak, (c) predict what changing `--cycles`, the smoothing
window, or the key-count budget will do BEFORE running it.

## Acceptance

Explorer generated for all three current clips; PIPELINE.md revised to
an empty "can't follow" list; Task 3's three predictions made and
confirmed by one run each. Then brief 19 starts, followed through this
tool.

## Out of scope

Any pipeline fix beyond what the explorer needs to display (those are
brief 19); the judgment-view itself (already specced under 17 A7b).
