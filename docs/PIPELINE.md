# The capture pipeline, stage by stage (brief 18 Task 2)

Written for the owner, to be read WITH a clip's explorer open
(`corpus/<clip>.explorer.html` — written by every extract run). One page
per stage: what goes in, what comes out, the actual formula, the
parameters, the failure we hit and how it was caught, and where the
code lives. Return every sentence you cannot verify in the explorer —
each becomes a revision.

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

**In:** frames. **Out:** per frame, 33 BlazePose landmarks twice over:
IMAGE space `[x, y, visibility]` (normalized to the frame) and WORLD
space `[x, y, z]` (metric, hip-origin).
**How:** MediaPipe pose_landmarker_heavy, VIDEO mode, CPU (CPU =
deterministic: same clip, byte-identical output — verified by diff).
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

## 3 · Yaw & view

**In:** world landmarks. **Out:** the 2D projection everything
downstream uses, plus the yaw trace.
**Formula:** yaw per frame = atan2 of the summed shoulder+hip
left→right vector in the xz plane. FRONTNESS = median over frames of
`min(|yaw|, 180° − |yaw|)` — facing the camera reads |yaw| ≈ 180°, not
0° (the first auto rule assumed 0 and sent the T-step to profile).
`--view auto`: frontness < 45° → FRONT (rotate each frame by −yaw, drop
z); else → PROFILE (project the camera plane as filmed, no rotation).
**Parameters:** `--view auto|front|profile` (`--emit-views a,b` runs
the whole rest of the pipeline once per view from one capture).
**Failure we hit:** de-yawing a profile clip to front rotates the
sagittal motion into z and the orthographic projection DELETES it — the
running man's knee lift (hip span ×3–5 smaller). Caught by the twist
channel: thigh out-of-plane angle 0.40 rad de-yawed vs 0.16 as-filmed.
**Code:** `lib/retarget.mjs` frameYaw/deYaw/deYaw3; view choice in
`extract.mjs` ("canonical view selection").

## 4 · Measured rest

**In:** the projected frames. **Out:** the dancer's own NEUTRAL angle
per bone — the reference every theta is measured from.
**Formula:** calibration frames = the quietest 30 % (whole-body
velocity) for torso/arms; for each leg's bones, frames where THAT foot
is planted (within 10 % of its lowest point). Rest per bone = circular
median of the observed bone angle over its calibration frames.
< 5 qualifying frames → the DECLARED rest (sidecar geometry / profile
overrides) as fallback, logged.
**Failure we hit:** every hand-declared rest shipped a bias — the
mirror-rest bug (rest of the wrong SIDE: every mirrored chain off by
exactly rest(L)−rest(R), worst 132°), the profile view-rest guesses,
and the ankle→toe foot slope (~27° "plantarflexion" on flat feet →
tiptoes). All replaced by measurement; the explorer's measured-vs-
declared Δ column shows what the guesses would have cost (the elbow
was off −1.2 rad — his bent-arm carriage).
**Code:** `lib/retarget.mjs` calibMasks + measureRest (~50 lines).

## 5 · Retarget

**In:** projected frames + measured rests. **Out:** per frame, a theta
for each of the 12 articulated rig joints.
**Formula (the line that IS the pipeline):**
`acc(bone) = sideSign × wrap(observed − restMeasured)`
`theta(joint) = wrap(acc(bone) − acc(parentBone))`
where `observed` is the atan2 angle of the landmark segment (feet:
HEEL→TOE — horizontal when flat), and `sideSign` is −1 in profile for
the side whose rig rest foot points AGAINST the facing (that side's
human→rig mapping is a reflection = orientation-reversing).
The engine replays it in reverse: rendered bone = rigRest + acc — so
the calibration pose renders AS the rig's rest pose.
**Failure we hit:** the 2× SIDE-SIGN signature — before the sign, every
far-side bone erred at exactly TWICE its deviation (hipL 95.4° on a
47.7° lift) while near-side bones read 0. The explorer's round-trip
column recomputes the transfer in-page; anything non-green is a
mismapping (yellow on ankles during held foot-gate frames is the gate,
not a bug). A CLAMP flag here is a rest-reference smell first.
**Code:** `lib/retarget.mjs` retargetFrame + sideSigns (~40 lines).

## 6 · Period & cycles

**In:** theta series. **Out:** the loop period + phase-normalized
cycles with outliers dropped.
**Formula:** autocorrelate the summed |dθ/dt|; base period = smallest
local peak ≥ 0.85 × the global max, then SUBHARMONIC DESCENT (halving
is safe — the ×2 test corrects it; doubling is not). Loop = base × 2 if
folding the SIGNED channels at 2× matches consecutive cycles clearly
better (L/R-alternating moves: |speed| erases the asymmetry, signed
channels keep it). Cycles binned to 64, outliers dropped at 2.5× the
median RMS distance to the median cycle.
**Parameters:** `--bpl`, `--cycles N` (logged cycle count → search only
±43 % of window/N and OWN the octave), `--anchor`.
**Failure we hit:** octave lock — the body roll's search latched a
0.217 s micro-bounce on a 1.486 s roll (×6.9) and 27 wrong-period
cycles averaged the move to a single surviving joint. Caught by "joints
1+" in the table log; fixed by the `--cycles` prior. The explorer draws
the whole autocorrelation with every candidate peak — the chosen dot
should sit on YOUR count of the move.
**Code:** `lib/timing.mjs` detectPeriod/decideLoop/binCycles/
averageCycles (~120 lines).

## 7 · Distill

**In:** the averaged 64-bin loop. **Out:** ≤ maxKeys keys.
**Formula:** candidates at every extremum AND inflection of every
kept joint (range ≥ 0.06 rad); greedily remove the candidate whose
removal costs the least linear-interp reconstruction error until the
budget holds. Contacts from the RIG'S OWN FK foot height (planted =
within 25 % of the foot's own swing range of its lowest point + slow;
range < 0.04 u = pivot foot, always planted). Twist emitted as
DEVIATION from the bone's habitual plane (mean-removed) where the
oscillation is real (> 0.15 rad). Travel from the pelvis drift
derivative.
**Parameters:** `--max-keys 16`, `--keep-drift`, `--foot-gate`.
**Failures we hit:** image-space contacts flagged the occluded foot
planted through its whole swing (the stance lock then ATE the lift on
stage — "only the far leg moves"); and averaging + few keys smears
accents (watch the RMS number and the key dots against the curve).
**Code:** `lib/distill.mjs` (~150 lines).

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
