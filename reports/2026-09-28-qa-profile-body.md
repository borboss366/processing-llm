# QA stickman on the view-correct body (user catch, 2026-09-28)

**The flaw (user's, from watching runningman.qa.mp4):** the QA video's
"retargeted rig" panel FK'd every capture over `biped-1.json` — the
FRONT body. Profile deviations painted on the front body's rest pose
read as a fake front view, so the main capture-fidelity judging
instrument misrepresented every profile capture (running man, body
roll). The code even claimed "this is what the stage will do" — true
only for front captures; the stage has played profile tables on the
profile shape since brief 17 A1.

Not a pipeline flaw: tables, poses, explorers, and the stage were
unaffected. A judging-instrument flaw — the kind the whole
deblackboxing effort exists to surface.

**Fix:** stage 9 selects the QA rig by view — `vk === "profile"` FKs
over `web/app/shapes/biped-profile.json` (bones + ground from the same
sidecar), else the front rig as before. One code path, no table
change: re-extraction after the fix produced byte-identical table
numbers (16 keys, drift −0.0001 u/loop, 4/4 cycles).

**Evidence:** `2026-09-28-qa-profile-body-after.png` — four frames of
the re-rendered running man QA: sideways stickman, knee lift / hip
flexion / planted leg tracking the dancer 1:1, pass-through pose
matching his upright moment. Both profile QAs re-rendered
(`corpus/runningman.qa.mp4`, `corpus/bodyroll.qa.mp4`); front-view QAs
(t-step) unchanged by construction.

**Answered in the same exchange:** no, the pipeline does NOT build a
front view and rotate it sideways — no rotation exists anywhere since
the de-yaw removal (2026-09-27). The fake-front look was purely this
QA rendering artifact.

## Addendum — regression check (same day)

A collapsed-to-vertical-line profile stickman was reported, suspecting
the rot→twist reinterpretation firing on a MATCHED view. Checked as
directed; **the regression does not reproduce in the current
artifacts**:

1. **Exact strings:** poses view `"profile"` · table view `"profile"`
   · `reinterpreted: null`. The front emission carries `"front"` /
   `"from-profile"`. The gate fired only on the mismatched view.
2. **QA source:** the QA renders the PRIMARY (matched-view) pass's
   per-frame thetas FK'd over the profile body — it never touches any
   table, so it cannot render the reinterpreted front table.
3. **Amplitudes, measured:** in-plane theta ranges hipL 1.14 / kneeL
   1.80 rad; FK input to the QA renderer spans kneeL x 0.147 u, footL
   y 0.187 u, handL x 0.205 u. The profile table holds kneeL rot span
   0.825 (twist 0.251, foreshortening-sourced); the front table shows
   the complement (rot 0.000, twist 0.825) — reinterpretation confined
   to where it belongs.

Hardened anyway: the gate is now a function (`viewDecision`) and
self-test 7 asserts BOTH branches — profile-as-profile is strict
identity (`outM === profileKeys`, rot AND foreshortening-twist
untouched, dx/travel intact; front-as-front also no-reinterpret), and
profile-as-front moves the sagittal deviations into twist with zero
in-plane leak. Re-render after the change: table diff-identical,
VERIFY:PASS.

Likely source of the report: the pass-through phase (~0.2) where the
figure is legitimately near-vertical for a beat, or a stale cached
mp4. The current runningman.qa.mp4 shows the knee lift sideways
throughout (evidence strip in this report's PNG).
