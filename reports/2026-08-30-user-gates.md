# 2026-08-30 — user gates session #2 (filled copy of USER_GATES.md)

Live session, real GPU + speakers, gridded techno mix on the grid tier
(bench badge GRID confirmed). All verdicts are the user's; diagnoses and
in-session fixes are Claude Code's. Fixes landed during the session:
creature turn-freeze (a855206), puppet param-grid CSS, framing sliders,
move-selector live-follow + Enter state re-assert, controller Perform
enable (this commit).

## A. Calibration

- **A1 ✓ — click by ear**: "in sync with music and with puppet."
  Grid tier re-confirmed on real hardware.
- **A2 ✓ — visual offset: 0 ms**. No perceptible display/audio offset;
  squash-on-click looks right untouched. Slider stays (bench + puppet);
  0 is already the default.

## B. Post & compositing

- **B3 ✓ — post ON**, defaults kept. Deeper taste tuning deferred until
  custom puppet appearances exist to judge against (re-check trigger
  recorded in USER_GATES.md).
- **B4 ✓ — framing breathes** ("effect is quite good"). zoom/drift
  sliders added to the puppet on request; user left defaults
  (0.015 / 0.01) — could not tell much difference, consistent with the
  subtle-by-design intent.
- **B5 ✗ — bgDim is MISSING from the code.** Confirmed by inspection:
  no background step-down exists in compositor/butterchurn/main — lost
  in the brief-10 compositor rewrite (the gate's own "known risk").
  Work item for a future brief.
- **B6 ✗ (explained) — white cores clip flat.** The post knee works
  (1.0 → ~0.88, no clip in the pass) but Butterchurn's canvas is
  already clipped at the source, so flat patches stay flat — a post
  curve cannot recover destroyed gradation. No tunable fixes it;
  mitigations are preset choice (b5 tags are now measured) or an HDR
  render path (not MVP). Ranked cosmetic.

## C. Creature & moves

- **C7a ✗ — tstep**: "looks just like stepping — not like tstep."
  Root cause: the leg chain is knee→foot with no ankle/toe joint, so
  the foot can translate but never pivot (no heel-pivot shuffle).
- **C7b ✗ — armwave**: "arms constantly bent at one angle… better than
  before, but far from a wave." Two causes: (1) the rig has NO shoulder
  joints (arm chain is elbow→hand only — a wave cannot originate at the
  shoulder); (2) within that limit the placeholder table never opens
  the elbow (0.7–1.3 rad) and has no consistent elbow→hand phase lag.
- **Verdict class: rig depth, not timing.** Both placeholder moves fail
  on missing joints. This is the scrub test brief 12.7 deferred FK work
  for; its conclusion: the next creature brief should be RIG
  ENRICHMENT (shoulder + ankle in the auto-rig/shape spec, re-authored
  tables that use them). Table sculpting alone cannot pass C7.
- **C8 ✓ (MVP)** — "looks like it is dancing — and quite well synced."
  Findings for future work: (1) constant beat-locked bounce under every
  movement is tiring (candidate: duck bounce during moves with their
  own vertical content); (2) state/move transitions read artificial —
  the 0.75-beat pose blend reads as a snap and rhythm switches
  instantly (candidate: rhythm crossfade / transition moves);
  (3) walk→idle can slide sideways without stepping (decel glide keeps
  odometry moving while the pose has already blended to idle — feet
  and ground disagree); (4) turning stutters (motion halts for the
  400 ms turn and two pose blends fire back-to-back; spec: carry
  motion through the turn, single blend).

## D. Ghost

- **D9 ✓ (deferred)** — "good for now." Strategic call: next briefs
  concentrate on the biped; other shapes get attention later.

## E. Audience pipeline

- **E10 ✓ — desktop flow works end-to-end** (draw → validate →
  approve → perform). Bad-drawing rejection message "makes sense for
  now, easy to improve later." Fidelity finding: the metaball render
  blobs the drawing — only its most prominent features survive.
  Deliberately deferred until after animation improvements.
- **E11 — DEFERRED (phone not at hand).** The one open gate. Setup
  preserved: `npm run submit`, phone on LAN →
  `http://<lan-ip>:3210/e/<token>` (boot log prints it), finger-draw,
  submit, approve, perform; photo-of-phone + stage screenshot to
  reports/.

## F. Live-session watch items

- **Turn-freeze found and fixed**: after one side-to-side turn the
  figure stood edge-on ("thin"). The 400 ms facingVis interpolation
  only advanced while st === 'walk'; a walk→idle/groove transition
  inside the window froze the mirror mid-turn. Turn now completes
  unconditionally (a855206).
- **Controller Perform ▶ failed to land once** (creature stayed
  biped-1/idle); the identical REST sequence server-side worked
  minutes later. Not reproduced — logged as a watch item; grab the
  controller console if it recurs. Hardening applied: perform() now
  also POSTs enable, so a toggled-off module can't swallow a Perform.
- **Render-window occlusion froze rendering twice** during the session
  (expected browser behavior — rAF freezes when fully covered; the
  13.1 armor keeps audio/clock alive but nothing can draw). Operator
  note: the render window must keep a visible display.
- No audible music pauses, no dance speed-surges, no silent
  disappearances observed across the session.

## Work items produced (for the reviewer's next briefs)

1. Rig enrichment: shoulder + ankle joints, re-authored wave/shuffle
   tables (C7 — the FK follow-up 12.7 was waiting on).
2. Transition quality: rhythm crossfade, bounce ducking, walk→idle
   decel keeps stepping, turn carries motion (C8/F).
3. bgDim reimplementation in the compositor (B5).
4. Audience shape fidelity — after animation work (E10).
5. B6 stays wontfix at MVP (source LDR clipping, cosmetic).
