# processing-llm — brief 17: views + twist (the representational wall)

Findings that force this brief:
- T-step (frontal clip): foot fan is a floor-plane rotation; the 2D
  front rig can't show it (twist 0.78 rad on the foot vs 0.13 thigh;
  gate verdict BLOCKED ON DEPTH).
- Running man (profile clip): after the mirror-rest fix the retargeted
  stickman IS him — but only as filmed, in profile. The front rig
  cannot hold a sagittal move; de-yawing it to front erases the motion.

Conclusion: the wall is "front-view only," not "2D." Standard 2D
animation answer: canonical VIEWS (front + profile), each fully 2D and
in-plane, with a view-switch transition; plus a small-angle TWIST
channel for depth phenomena inside a view (arm-raise elbow flip, foot
fan, convex elbows). Not full 3D — physics, goo renderer, harnesses,
audience drawings all stay 2D.

Order: A (views) is the unblocker for both captured moves; B (twist)
follows on the same rig. C rides along. CLAUDE.md rules; verify green;
USER_GATES updated.

## A. Canonical views

A1. **Profile shape**: `shapes/biped-profile.png` + sidecar — side
    silhouette, same 15-joint chains, rest pose in profile (arms hang
    along the body; both legs coincide in x, near leg drawn over far
    leg). Placeholder art from the implementer is acceptable
    (`-placeholder`); the user redraws when the mechanics are proven.
    Sidecar gains `view: front|profile` and `dominantSide` semantics
    become near/far in profile.
A2. **Near/far rendering in profile**: legs and arms are two channels
    each already (union-by-max); in profile the far limb renders
    slightly dimmer and behind (channel order), so the scissor reads.
    Reuse the existing group-channel machinery; no new shader concept
    beyond a per-channel dim factor.
A3. **View-tagged tables**: move tables carry `view`; the FSM repertoire
    per state lists moves per view; a move can only be selected when
    its view is active or reachable by a switch at the next bar.
A4. **View switching**: generalize `facingVis` from {left,right} to
    {front, profileL, profileR}: a squeeze-through-zero on the torso
    axis blending between shapes' rest poses (pose blend layer handles
    joint continuity; the shape swap happens at the zero-width instant
    the way the mirror does today). Transition ≤ 1 bar, bar-quantized,
    no spike outside the declared window. Turn direction chosen by
    which profile the next move wants.
A5. **Extractor** (transfer half DONE 2026-09-21: as-filmed
    projection, measured-rest calibration, heel→toe feet, per-side
    sign — self-test 13/13 is its acceptance). Remaining: `--view
    auto|front|profile` selects the NEAREST canonical view by yaw
    (front if |yaw| < 45°, else profile with side), never blindly
    front; tables tagged with `view`; distill gains `--emit-views
    profile,front` so ONE capture emits both projections (the front
    table expresses out-of-plane motion through B's twist/foreshortening
    once B lands; until then it is emitted but expected to read weaker).
    Both clips re-extracted: T-step → front, running man → profile (+
    front for comparison).
A6. **Locomotion in profile**: the walk cycle already exists for the
    quadruped-era side view; verify the biped's walk/turn/travel on the
    profile shape (stance lock, odometry, edge turns become view flips).
A7. Acceptance: running man performing on stage in profile (rebuilt
    through the 2026-09-21 pipeline), view switch front↔profile over
    the gridded mix with 0 spikes outside the transition window,
    moves-x-shapes extended with the profile shape, USER_GATES:
    "running man: recognizably him, legible at 3 m; profile vs front
    table — which is the rotation default?" — the first Route B stage
    verdict. STOP here.

A7b. **Rig inspector (added 2026-09-21, after A1–A7 landed; build
    BEFORE the user judges A7).** The goo hides mechanics and the 2D
    rig cannot be orbited, so the puppet page gains three synchronized
    panels driven by one yaw/pitch control (sliders + drag-orbit) and
    the move-phase scrub:
    (1) the captured 3D skeleton from the move's poses.json, rotated to
        that angle — ground truth, any perspective;
    (2) the rig's presentation at that yaw: nearest canonical view +
        the yaw-fake/twist as implemented so far, WIRE mode;
    (3) the goo render of the same.
    Wire is the default; frame-step and phase-scrub apply to all three;
    for authored (non-captured) moves panel 1 is empty with a label.
    The gap between panels 1 and 2 at intermediate yaw is the
    documented cost of the 2D rig and the spec for any future
    volumetric renderer ("make 2 look like 1"). Then re-arm A7 and hand
    the gate to the user.

    **Judgment view (extension, 2026-09-23):** the inspector doubles as
    the gate tool. Panel 0 = the source clip with landmark overlay;
    rig panels at yaw 0°, 45°, 90° (wire/goo toggle each), all
    phase-locked to the clip and playing at its frame rate with
    scrub/pause; variant dropdown (plain / exag / front table / profile
    table); one-click export of the composite as webm into reports/.
    Every Route B gate verdict from A7 on is given in this view and its
    export is the committed evidence. The 45° panel is the honest gap
    until B lands.

A8. **Body roll capture** (after A7, before B): `corpus/bodyroll-h264.mp4`
    is logged; extract with --emit-views profile,front. It is a
    sagittal wave and the first real move through the spine/chest
    chain — report whether the wave travels through the rig's torso in
    profile or the chest reads as a single hinge. That finding feeds
    B's design (whether the chest chain needs its own twist/lead-lag
    treatment). Different dancer/style: logged as its own family, not
    part of the shuffle pack. Wall time reported (economics number).

## B. Twist channel (small-angle depth inside a view)

B1. Tables gain per-bone `twist` (rad, bounded ±1.2) and per-foot
    `footYaw`; extractor already emits both (16.2). Render mapping, no
    physics:
    - child-joint apparent bend scales by cos(twist) — an arm raise
      passes through straight and re-emerges bent the other way;
    - child bone DRAW length foreshortens (physics length untouched);
    - out-of-plane component → depth cue (dim ~0.15 at max, slight
      scale), and for feet the density profile widens as toes come
      toward the viewer (foot fan).
B2. Body yaw pair `pelvisYaw`/`chestYaw` (±0.6): cos-squeeze of hips/
    shoulders width + parallax of limb roots + eye parallax — the
    Pulp-Fiction twist and 3/4 flavor within the front view.
B3. Stress rows: twist sweep per limb at three speeds; asserts as usual
    plus render-length continuity (no popping at cos crossings).
B4. Acceptance: T-step re-extracted with footYaw → foot fan visible on
    the front rig (the parked clip is the test); armpump un-parked and
    re-judged (arm raise no longer chicken); USER_GATES re-check items.

## C. Music-structure reactivity (rides along)

On the grid tier: a drop (energy z-score step at a phrase boundary,
known ≥1 bar ahead) pre-arms an immediate move re-pick / energy burst
at the boundary instead of waiting out moveHoldBars; implement the
long-unimplemented `fillKey`. Log as session events; bench shows the
pre-arm.

## Out of scope

Full 3D, sustained arbitrary angles, toward-camera motion, floor work,
Task 3 anatomy lint (after both clips are re-extracted under A5 — it
needs the corrected poses), style packs, spider/field scene (R4 holds).
