# The capture pipeline, stage by stage (brief 18 Task 2)

**How to run this:** `npm run capture -- <video> [--window A-B]` — the
owner command: extract → distill → stitch into `moves/<name>-captured
.json`, prints the stage summary, opens the explorer; window and
mirror are read from MOTION_SOURCES.md when omitted; `--help` for all
flags, and it prints every underlying command it hides. One further
step, `npm run move -- <video> …`, chains capture + the engine report
on both bipeds.

Written for the owner, to be read WITH a clip's explorer open
(`corpus/<clip>.explorer.html` — written by every extract run). One page
per stage: what goes in, what comes out, the actual formula, the
parameters, the failure we hit and how it was caught, and where the
code lives. Return every sentence you cannot verify in the explorer —
each becomes a revision.

**How to read a stage since 18.2:** every stage is also DRAWN ON THE
VIDEO — the explorer's "OV" section. Overlay 1 (rig-on-source) is
stages 1–5 as one picture; overlay 2 (rest ghost) is stage 4's
reference; overlay 4 is the depth channel; overlay 5 is stage 7's
contacts; overlay 8 (table ghost) is stage 8 played back. The DIAG
section's bone×time heatmap answers "which bone, when" for any of
round-trip / smoothing / foreshortening / score / table-vs-raw; the
flag filmstrip marks gates, clamps, sign decisions, dropped cycles and
keys on the timeline.

---

## 0 · Input

**In:** the video file + the logged loop window (MOTION_SOURCES.md).
**Out:** one BGR frame per video frame inside the window.
**How:** a scout pass detects the dancer per frame and takes the UNION
bounding box over the whole window (+25 % margin); the window is then
re-read CROPPED to that fixed box, upscaled so the short side ≥ 512 px.
Two pose streams run on it — the crop and its horizontal mirror
(test-time augmentation) — and are averaged after flipping the mirror
back.
**Parameters:** `--enhance on|off` (off = legacy full-frame single
pass); MARGIN 0.25 and MIN_SIDE 512 are constants in `pose_worker.py`.
**Failure we hit:** a per-frame MOVING crop looked smarter but broke
MediaPipe's temporal tracking — jitter went UP (4.52 vs 3.75 px
second-difference). Caught by measuring jitter both ways; the fixed
union crop keeps the tracker's prior. (Also: vertical Shorts crop feet
— check stage 0's picture before trusting anything downstream.)
**Code:** `tools/mocap/pose_worker.py` (whole file, ~180 lines).

## 1 · Landmarks

**In:** frames. **Out:** per frame, the 21-point PIPELINE SCHEMA
(`lib/landmarks.mjs`) in IMAGE space `[x, y, score]`; MediaPipe also
emits WORLD space `[x, y, z]` (debug-only channel).
**How:** DEFAULT `--estimator rtmpose` (rtmlib Wholebody, COCO-
WholeBody 133 → schema; real 3-point feet, occlusion-honest scores —
user verdict 2026-09-27). `--estimator mediapipe`
(pose_landmarker_heavy, VIDEO mode) is kept for FAST passes: ~3× faster
and 25–35 % smoother raw, but its smalltoes are a bigtoe copy at score
0 and its occluded-limb scores are optimistic. Both run on CPU (CPU =
deterministic: same clip, byte-identical output — verified by diff).
The 2D image landmarks are essentially direct observation; the 3D
world landmarks are the NETWORK'S INFERENCE of metric 3D from one
camera — the z was never measured, it is a learned guess (weakest
exactly where visibility is low). We only flip the y-axis and draw it.
Since 18.1 nothing downstream consumes the 3D guess — depth (twist/
yaw) is derived from 2D foreshortening; world stays a debug overlay.
**Failure we hit:** the OCCLUDED far limb in profile — the running
man's far leg came out at 25–50 % of the near leg's amplitude. Not
fixable at this stage; it surfaced as "only one leg moves" on stage and
was ultimately handled by `stitch --symmetrize`. The visibility colors
in the explorer show where the estimator was guessing.
**Code:** worker as above; parsing in `tools/mocap/extract.mjs` stage 1.

## 2 · Smoothing

**In:** raw landmark positions. **Out:** smoothed positions — never
smoothed ANGLES (angles wrap; a filter across ±π invents rotations).
**Formula:** Savitzky–Golay: each sample replaced by the center value
of a least-squares polynomial fit over a symmetric window —
`x'ᵢ = Σₖ cₖ·xᵢ₊ₖ`, k ∈ [−4..4], coefficients from the pseudoinverse of
the polynomial design matrix. Symmetric ⇒ ZERO phase lag.
**Parameters:** `--filter savgol|oneeuro|none`, `--sg-window 9`,
`--sg-order 3`. One Euro (`--min-cutoff`, `--beta`) is kept ONLY for
future live capture — it is causal and lags.
**Failure we hit:** One Euro's 46–60 ms velocity-DEPENDENT lag (drifted
between window thirds). Caught by cross-correlating the filtered
pipeline against a raw parallel path (the "lag vs raw" number in the
explorer — should read ~0 now).
**Code:** `tools/mocap/lib/smooth.mjs` (savgolKernel/savgolSmooth).

## 3 · View select (no rotation exists in 2D)

**In:** 2D image landmarks. **Out:** the chosen canonical view; the
table is ALWAYS built from the camera plane.
**Why no rotation:** with 2D-only landmarks a "rotation by yaw" reduces
to scaling x by cos(yaw) — a squash, not a view change. The old de-yaw
step was removed 2026-09-27; nothing downstream rotates anything.
**Formula:** FRONTNESS = median shoulder width / median spine length
(pure 2D width foreshortening); front ≥ 0.35, else profile — that is
the clip's NATURAL view, and the analysis always runs in it. A facing-
camera front clip additionally gets an x-FLIP (mirror canonicalization
so the person's left→right runs along +x — orientation, not rotation).
**Reinterpretation:** requesting the OTHER view (`--view front` /
`--emit-views profile,front` on a profile clip) does not re-project —
it reinterprets at the table level: that view's in-plane deviations are
unobserved (≈ 0), so every rot key becomes a TWIST key (clamped ±2,
rendered by the engine's cos-foreshortening); positional channels and
travel (natural-plane quantities) drop; contacts/ease pass through.
The table carries `reinterpreted: "from-<view>"`; its explorer's stage
3 plots the twist traces it produced.
**Parameters:** `--view auto|front|profile`, `--emit-views a,b` (first
= primary).
**Failure we hit:** de-yawing a profile clip "to front" squashed the
sagittal motion toward zero — the running man's knee lift (hip span
×3–5 smaller). The fake front view is exactly what reinterpretation
replaces. Self-test: a synthetic profile knee-lift emitted as front
must round-trip through twist, never through the in-plane angle.
**Code:** frontness in `lib/foreshorten.mjs` (frontnessRatio); view
choice + `reinterpretKeys` in `extract.mjs` stage 3/8.

## 4 · Rest reference (absolute, 2026-09-28)

**In:** the projected frames. **Out:** two things kept firmly apart:
the RIG'S OWN rest angles (the reference every theta is measured from)
and the dancer's measured HABITUAL pose (a diagnostic + bone lengths —
NEVER subtracted).
**Formula:** reference = the angle of each bone in the VIEW shape's
sidecar geometry (profile clips → `biped-profile.json`: arms hang
~93°, legs down, feet flat toward the +x facing; front clips → the
front sidecar). Habitual pose = circular median of the observed bone
angle over calibration frames (quietest 30 % whole-body; per-leg,
frames where that foot is planted) — shown in the explorer's stage-4
pair of stickmen; its lengths calibrate the foreshortening channel.
**Failure we hit (both directions):** hand-DECLARED human rests
shipped biases (mirror-rest 132°, tiptoe slope) — so 2026-09-21
switched the reference to the MEASURED pose… which then subtracted
every sustained posture: a dancer holding his arms pumped forward all
clip retargeted to deviations ≈ 0 and the rig showed its own rest
(collapsed arms / paralytic legs, root-caused 2026-09-28). The Δ
column (habitual − rig ref) is exactly what that scheme erased — the
runningman's elbows read −1.4 rad there. Overlay 2 vs overlay 1 is
this stage's picture: the ghost is the reference, the rig is the
dancer's pose ON that reference.
**Code:** `buildRig` rest geometry + `measureRest` (diagnostic) in
`lib/retarget.mjs`.

## 5 · Retarget (absolute angles vs gravity)

**In:** projected frames + the view shape's rest angles. **Out:** per
frame, a theta for each of the 13 articulated rig joints.
**Formula (the line that IS the pipeline):**
`acc(bone) = sideSign × wrap(observedAbs − rigRestAbs(view))`
`theta(joint) = wrap(acc(bone) − acc(parentBone))`
where `observedAbs` is the atan2 angle of the landmark segment against
gravity (feet: HEEL→TOE — horizontal when flat). The dancer's habitual
pose TRANSFERS: only the rig-vs-human skeleton difference is removed.
Profile clips are x-flipped so the dancer faces +x like the profile
shape — on a same-facing shape `sideSign` resolves to identity by
construction (the far-side-flip machinery self-neutralizes).
**Failure we hit:** the 2× SIDE-SIGN signature (mirrored-rest era) and
the habitual-pose erasure (measured-rest era) — both are stage-4/5
reference choices, and both are visible as the rig sitting AT the rest
ghost while the dancer isn't. The explorer's stage-5 table recomputes
the transfer in-page (observed abs / reference abs / theta /
round-trip); anything non-green is a mismapping. Self-test: an
arms-forward clip must render arms forward (0.00° abs), never the rig
rest.
**Code:** `lib/retarget.mjs` retargetFrame + sideSigns (~40 lines).

## 6 · Period & cycles

**In:** theta series. **Out:** the loop period + phase-normalized
cycles with outliers dropped.
**Formula:** autocorrelate the summed |dθ/dt|; base period = smallest
local peak ≥ 0.85 × the global max, then SUBHARMONIC DESCENT. Loop =
base × 2 if folding the SIGNED channels at 2× matches consecutive
cycles clearly better. Then three consistency defenses (19 3.1):
(1) OCTAVE GUARD — re-bin at period×2; if the theta-channel cycle
spread collapses (< 0.6×), the "loop" was a single half; when the
window fits only one doubled cycle, the PARITY test decides (same-
parity halves agree, cross-parity don't → the loop is evenMean ++
oddMean). (2) ALIGNMENT — each cycle circularly shifted to the SSE-
argmin against the median (full circle) before averaging, so tempo
drift and half-swaps can't smear amplitude. (3) outliers dropped at
2.5× the median RMS distance.
**Parameters:** `--bpl`, `--cycles N` (prior owns the octave),
`--anchor`.
**Failures we hit:** octave lock — the body roll latched a 0.217 s
micro-bounce on a 1.486 s roll (×6.9, fixed by `--cycles`); and the
runningman's 0.665 s "loop" was ONE STEP — L-steps averaged with
R-steps and the stride halved (kneeL 1.8 rad raw → 0.70 in the loop;
the parity guard restored 1.75). The DIAG onion-skin shows the cycles
at any phase; alternating strong/weak ghosts on one joint IS the
octave signature.
**Code:** `lib/timing.mjs` detectPeriod/decideLoop/binCycles/
averageCycles (~120 lines).

## 7 · Distill

**In:** the averaged 64-bin loop. **Out:** an ADAPTIVE key set under
an error budget.
**Formula:** candidates at every extremum AND inflection of every
moving joint (range ≥ 0.06 rad), emitted EXACTLY (key value = curve
value); greedily remove the least-damaging key only while the
worst-bone reconstruction RMS stays ≤ the budget (`--err-budget`
0.04 rad; `--max-keys` 32 is a hard cap). Ease interpolates only
between keys. A bone with a LARGE habitual offset but tiny oscillation
becomes a CONSTANT key (|mean| ≥ 0.15 rad) — excluding it would replay
the rig rest (the habitual-erasure reborn; caught by R1 at 0.94 rad on
the tstep shoulder). Contacts from the RIG'S OWN FK foot height;
twist as mean-removed deviation (> 0.15 rad); travel from pelvis
drift.
**Measurement (the R1 rung):** `tools/mocap/table-vs-raw.mjs` — per-
bone RMS of the table sampled at each frame's phase vs the raw
retarget, decomposed into the AVERAGING FLOOR (cycle-to-cycle
variation, irreducible for a loop) and what DISTILL adds (the
controllable part — ≤ 0.012 rad on all three clips). The heatmap's
"table vs raw" metric shows the loss per bone per phase; overlay 8 vs
overlay 1 is the same thing on the video.
**Failures we hit:** image-space contacts flagged the occluded foot
planted (stance lock ate the lift); the fixed 16-key cap smeared
accents; and the constant-channel exclusion above.
**Code:** `lib/distill.mjs` (~200 lines).

## 8 · Table

**Out:** `moves/<name>.json` — view tag, keys with rot/dx/dy/twist/yaw,
contacts, ease, travel, fillKey, provenance (clip sha, window, mode).
What the stage does with each field is MODULE_ABI.md's chapter; the
judgment loop is capture-variants / the stage itself.
**Failure class:** everything correct up to here can still die at
PLAYBACK — contacts drive the stance lock; a wrongly-planted foot loses
its lift even with perfect thetas. The engine yields when the table's
own pose lifts a flagged foot > 0.025 u.

---

## Task 3 — the reading assignment (yours)

The three functions that ARE the pipeline, with the explorer beside
them: `retargetFrame` + `measureRest` (lib/retarget.mjs),
`distillMove` (lib/distill.mjs) — ~300 lines total.

You're done with the brief when you can: (a) point at the stage where
the T-step's foot fan lives; (b) point at where the running man's far
leg went weak; (c) predict — BEFORE running — what changing
`--cycles`, `--sg-window`, or `--max-keys` will do to a table.
