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

## Open items

1. **E11 — phone gate** (deferred 2026-08-30, phone not at hand;
   cannot be skipped — touch UX + reachability are untestable
   elsewhere): `npm run submit`, open `/e/<token>` on the actual phone
   (boot log prints the LAN URL), draw with a finger (viewport fights?
   brush ok?), submit, approve, perform. Photo-of-phone + stage
   screenshot → reports/.

## Re-check triggers (answered, but conditionally)

- **C7a-recheck (brief 14)** — tstep on the enriched rig: does the
  weight-side heel visibly pivot while the toe stays planted — does it
  read as a shuffle now? (`reports/fk-moves.webm` for a preview; judge
  live.)
- **C7b-recheck (brief 14)** — armwave: does the wave TRAVEL
  shoulder→elbow→wrist? Lag is authored at 0.2 beat/link — tunable.

- **B3 post tuning** — post stays ON at defaults; re-judge
  grain/vignette/chroma when custom puppet appearances exist
  (user's own trigger, 2026-08-30).
- **A1 grid sync by ear** — re-confirm after any audio-path change.
- **F watch items** — every live session: audible pauses, speed
  surges/freezes, silent disappearances (bench log has the evidence
  if seen).

## Recorded verdicts

Full detail in `reports/2026-08-30-user-gates.md`.

- A1 ✓ 2026-08-30 — click on the kick, grid tier, real hardware.
- A2 ✓ 2026-08-30 — visual offset 0 ms (no perceptible offset).
- B3 ✓ 2026-08-30 — post ON, defaults; tuning deferred (trigger above).
- B4 ✓ 2026-08-30 — framing breathes; sliders added to puppet, defaults kept.
- B5 ✗ 2026-08-30 — bgDim MISSING from code (lost in compositor
  rewrite) → work item.
- B6 ✗ 2026-08-30 — white cores clip flat; source-LDR limitation, knee
  works but can't recover; cosmetic, wontfix at MVP.
- C7a ✗ 2026-08-30 — tstep reads as stepping: no ankle joints in rig.
- C7b ✗ 2026-08-30 — armwave doesn't travel: no shoulder joints +
  table never opens the elbow. C7 verdict class: RIG DEPTH → next
  creature brief = rig enrichment.
- C8 ✓ 2026-08-30 — dances, well synced; MVP-ok. Findings queued:
  bounce fatigue, snap transitions, walk→idle slide, turn stutter.
- D9 ✓ 2026-08-30 — ghost good for now; biped-first strategy.
- E10 ✓ 2026-08-30 — desktop pipeline works; rejection message fine;
  blob fidelity deferred until after animation work.
- Grid sync by ear — ✓ 2026-08-2x ("synched to the beats", pre-13.1
  session); re-confirmed by A1 above.
