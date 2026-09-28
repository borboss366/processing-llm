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
