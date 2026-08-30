# USER_GATES — the human half of verify

Everything measurable runs in `npm run verify`. This file is the rest:
judgments only the user's eyes/ears can make. Protocol: run a session,
answer each open item in one or two sentences, save the filled copy as
`reports/<date>-user-gates.md`. Claude Code: keep this file current —
every brief that adds a judgment item adds it here; every recorded
verdict moves to the report and gets a ✓ + date here.

## Setup (once per session)

- Real GPU, real speakers/headphones, render window fullscreen on its
  own display (or side-by-side — never fully covered).
- `npm run server`, vite dev, Ollama up; file audio with a gridded
  track (`?audio=file:` — tier badge on bench must say GRID).
- Open `bench.html` (click + instruments) and `puppet.html` (rig).

## A. Calibration (do first — everything after depends on it)

1. Bench: click track ON over the gridded techno mix. Ears only:
   does the click sit dead on the kick through the whole track,
   including tempo shifts? (Expected: yes; this re-verifies grid tier
   on your hardware.) → verdict: ____
2. Trigger the biped, groove forced. Watch bounce vs click. Nudge
   `visualBeatOffsetMs` (slider on bench/puppet) until the SQUASH
   (lowest point) lands on the click to your eyes. Note the final
   value — it is per-machine and persists. → offset: ____ ms

## B. Post & compositing (Brief 10 gate, still open)

3. Dark preset, creature up. Toggle `post 0` ↔ on. Better with post?
   Grain/vignette/chroma defaults: taste verdict, adjust via
   `/osc /post/*`, note any changed defaults. → verdict: ____
4. Framing motion: does the drift/beat-zoom breathe with the track,
   or wobble? (zoomAmp/driftAmp to taste.) → verdict: ____
5. bgDim check: BRIGHT preset, trigger creature — does the background
   visibly step down and restore on exit? (If not: report it — known
   risk since the compositor.) → works: ____
6. Highlight knee: white cores still clip flat anywhere? → ____

## C. Creature & moves (Brief 9 + FK re-check)

7. Groove, tstep, armwave via puppet (rotation now also cycles them):
   with true FK + re-authored tables — does tstep read as a shuffle
   step (ankle travels)? Does the wave TRAVEL through the arm (chicken
   gone)? One line each. → ____
8. From 3 m back: does the figure read as dancing WITH the music (post
   calibration)? → ____

## D. Ghost (Brief 12 gate, still open)

9. Ghost shape, dark preset, halloween palette: reads as a sheet
   ghost? Float/swoop behavior right? Butter-yellow head accent —
   keep or change? Placeholder art good enough, or will you redraw?
   → ____

## E. Audience pipeline (Brief 11 gate, still open)

10. Desktop: draw → validate (try one bad drawing too — message
    sensible?) → approve → creature performs via puppet. → ____
11. Phone (5 min, cannot be skipped — touch UX + reachability are
    untestable elsewhere): open /e/<token> on the actual phone, draw
    with a finger (viewport fights? brush ok?), submit, approve.
    Take the photo-of-phone; screenshot the stage → save the pair to
    reports/. → ____

## F. Live-session watch items (passive, note if seen)

12. Any audible music pause? (Instruments log it — note wall time.)
13. Any dance speed-surge or freeze? (Should be gone post-13/13.1.)
14. Figure ever disappears? (13.1 should self-heal + log
    module-error/recovered — check bench log if it happens.)

## Recorded verdicts

- Grid sync by ear — ✓ 2026-08-2x ("synched to the beats", pre-13.1
  session). Re-confirm via A1 after any audio-path change.
