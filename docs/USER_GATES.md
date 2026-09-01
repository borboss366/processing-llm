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

## After brief 15 lands (fold into the same or next session)

6. **V1 — arm vocabulary (15 B)**: cycle armpump / sidepunch /
   elbowcircles / upgraded armwave on the puppet. Do the arms read as a
   DANCER'S — overhead raises, full-extension punches, visible wrist
   circles, elbows bending BOTH ways? (`reports/fk-moves.webm`
   previews.) → ____


7. **R1 — performer vs loop**: from 3 m, variation+swing+accents ON —
   does it read as a performer rather than a loop? (A/B toggle exists;
   the OFF state is the old feel.) → ____
8. **R2 — swing to taste**: `swingPct` slider against the straight
   click — where does it groove for your ears? Note the value. → ____
9. **R3 — accent/phrase to taste**: downbeat accent ×1.15 and the
   8-bar variation — present but not cartoonish? → ____
10. **R4 — SCULPTING SESSION + ROUTE B DECISION**: sculpt tstep +
    armwave timing in the workbench (sculptMode ON). Verdict per the
    standing rule: session pleasant + two moves good → Route B pilot
    waits past Halloween; slow or underwhelming → pilot jumps the
    spider. Tables lose `-placeholder` on your word. → ____

## Standing re-check triggers

- **C7a tstep legibility** — re-judge after the FEET brief lands
  (dedicated foot sampling + drawn heel/toe geometry; see
  reports/2026-08-31-user-gates.md). The mechanism is verified; only
  geometry blocks the read.

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
`reports/2026-08-31-user-gates.md` (#3).

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
