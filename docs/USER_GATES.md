# USER_GATES — the human half of verify

Everything measurable runs in `npm run verify`. This file is the rest:
judgments only the user's eyes/ears can make. Protocol: run a session,
answer each open item in one or two sentences, save the filled copy as
`reports/<date>-user-gates.md`. Claude Code: keep this file current —
every brief that adds a judgment item adds it here; every recorded
verdict moves to the report and gets a ✓ + date here.

## Setup (once per session)

- Real GPU, real speakers/headphones, render window fullscreen on its
  own display (or side-by-side — never fully covered; occlusion freezes
  rendering, confirmed live 2026-08-30).
- `npm run server`, vite dev, Ollama up; file audio with a gridded
  track (`?audio=file:` — tier badge on bench must say GRID).
- Open `bench.html` (click + instruments) and `puppet.html` (rig).

## Open items — session order matters where numbered

1. **E11 — phone gate** (deferred 2026-08-30 and again 2026-08-31 —
   user: web UI enough for testing for now; cannot be skipped before a
   real event — touch UX + reachability are untestable elsewhere): open
   `/e/<token>` on the actual phone (boot log prints the LAN URL),
   finger-draw, submit, approve, perform. Photo-of-phone + stage
   screenshot → reports/. → ____

## Standing re-check triggers

- **Tstep fan + arm-raise legibility** — re-judge after the
  axial-rotation/pseudo-depth brief lands (the session's wall: floor-
  plane foot fan and humeral-rotation elbow flip are depth phenomena).

- **B3 post tuning** — re-judge grain/vignette/chroma when custom
  puppet appearances exist (user's own trigger, 2026-08-30).
- **A1 grid sync by ear** — re-confirm after any audio-path change.

## Watch items (passive, every live session)

- Audible music pauses, dance speed surges/freezes, silent
  disappearances (bench log has evidence if seen; all clean 2026-08-30).
- Controller Perform ▶: CLOSED 2026-08-31 — reproduced, root-caused
  (registry hot-reload reset params mid-sequence), fixed (params carry
  forward across reloads).

## Recorded verdicts

Sessions: `reports/2026-08-30-user-gates.md` (#2),
`reports/2026-08-31-user-gates.md` (#3),
`reports/2026-09-01-sculpt-session.md` (#4, brief 15 D).

- C7a ✓ 2026-09-01 — tstep "resembles" within 2D limits (travel channel
  added; true fan needs the depth axis — re-check trigger above).
- V1 ~ 2026-09-01 — armwave/sidepunch/elbowcircles serviceable;
  armpump parked on the axial-rotation wall.
- R1 ✓ 2026-09-01 — performer (+ drop-reactivity request queued).
- R2 ✓ 2026-09-01 — swingPct 0.2 baked as default.
- R3 ✓ 2026-09-01 — accent/phrase present, not cartoonish.
- R4 ✓ 2026-09-01 — DECISION: all other shapes postponed until the
  human is done properly; no tables promoted yet.

- G1 ✓ 2026-08-31 — fresh 15-joint drawing performs, wave reads; three
  live fixes (validation, Perform race, region cut-off); FEET
  workstream named for the next brief.
- C7a ✓ 2026-08-31 — mechanism right; legibility blocked on foot
  geometry (re-check trigger above).
- C7b ✓ 2026-08-31 — wave travels; elbow convex/concave flex queued.
- T1 ✓ 2026-08-31 — transitions all good for now.
- B5 ✓ 2026-08-31 — bgDim depth approved as shipped.

- A1 ✓ 2026-08-30 — click on the kick, grid tier, real hardware.
- A2 ✓ 2026-08-30 — visual offset 0 ms (no perceptible offset).
- B3 ✓ 2026-08-30 — post ON, defaults; tuning deferred (trigger above).
- B4 ✓ 2026-08-30 — framing breathes; sliders on puppet, defaults kept.
- B5 ✗ 2026-08-30 — bgDim missing → reimplemented in brief 14 (item 5).
- B6 ✗ 2026-08-30 — source-LDR clipping; cosmetic, wontfix at MVP.
- C7a ✗ 2026-08-30 — no ankle joints → rig enriched in 14 (item 2).
- C7b ✗ 2026-08-30 — no shoulder joints → rig enriched in 14 (item 3).
- C8 ✓ 2026-08-30 — dances, well synced; findings fixed in 14 (item 4).
- D9 ✓ 2026-08-30 — ghost good for now; biped-first strategy.
- E10 ✓ 2026-08-30 — desktop pipeline works; fidelity deferred.
- Grid sync by ear ✓ (pre-13.1) — re-confirmed by A1.
