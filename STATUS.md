# STATUS

Browser VJ rig: Butterchurn background + hot-loaded p5 modules
(flagship: the goo creature), composited with bloom/post/framing,
beat-synced by precomputed **beatgrids** (GridClock) with the causal PLL
as fallback, steered by a local LLM director (qwen3:8b) over
machine-measured preset tags, with a phone-audience draw-a-dancer
pipeline. To run a set: `npm run server`, `cd web/app && npm run dev`,
Ollama up; open `localhost:5173/` (render, `?audio=file:/music/x.mp3`
for file input — a `<file>.beatgrid.json` sidecar auto-selects the grid
tier), `controller.html` (pads, director, audience queue),
`bench.html` (click track + instruments), `puppet.html` (hands-on
creature rig). Full guide in `README.md`.

## Verified

| capability | number | tool |
|---|---|---|
| Grid beat sync (click vs sidecar) | median 0.9 ms, p90 1.4 ms | grid-check |
| Offline gridding, all 5 tracks | ibi-spread ≤ 2.9%; Pendulum via --bpm 174 | gridder |
| Fixed-rate PLL tick (worklet ~57 Hz) | idle-page conf 0.54–0.70 (was ≤0.19); matrix 4/4 ±2 | beat-test-real + idle probe |
| Synthetic PLL suite | 4 scenarios PASS, phase err ≤ 0.031 | beat-test |
| Occlusion survival | 20/20 gaps resumed, components 1, 0 spikes | occlusion-check |
| 30-min playback soak (+19 gaps) | 0 real gap-class events | pause-soak |
| Measured preset tags | 4 tags × perfect quintiles (20×5 over 100) | preset-measure |
| Tags change director picks | 14/14 seeded picks differ | replay A/B |
| Move-clock discipline | 0.46-beat snap → ≥1 beat spread, no rewind | move-clock-test |
| Torture (tempo step, gap, collapse) | 0 spikes on both clock tiers | torture-check |
| True FK propagation | kick carries ankle 34 px; wave lag 0.19 loop | fk-check |
| Move workbench loop | hot edit = exact delta; manual→live 0 spikes | workbench-check |
| Move rotation | all 3 tables cycle, no repeats, 0 spikes | capture-creature 60 s |
| Weld fix (union-by-max) | 26–39% flash removed vs additive | weld-sweep |
| Creature health envelope | ≤6 ms/frame, slide ≤0.72 px, components 1 | capture-creature |
| Compositor A/B + budget probe | active, A/B differs, 0 page errors | post-ab |
| Bench click scheduler (PLL tier) | 56 ms median vs live estimate under load | bench-check |
| Puppet page flow | enter/rig/scrub/params/snapshot round-trip | puppet-check |
| Audience pipeline E2E | 8 validation verdicts + moderation green | audience-e2e |
| Audience soak | 50/50 accepted, frame cost flat | audience-soak |
| Director latency / prefix | ~4.5 s warm; prefix byte-stable | replay --check-prefix |

Known-item (documented, not tuned): dnb-174 stays bistable on the PLL
tier at fixed rate (confident medians 167–172 across runs — a genuine
prior issue, per brief 13.2 left untouched). The grid tier owns that
track (173.4 exact).

## Open (user)

- **Gate evening #2**: visual-offset calibration value + GridClock
  click-by-ear verdicts, ghost judgment, phone gate (real drawing →
  perform), post/framing look.
- **Inputs owed**: brief files 12.5 + 12.7 for `docs/briefs/`
  (download-only deliveries — the agent cannot author them); two
  low-tempo tracks (~93 + ~81 BPM) — verify reports that regression as
  SKIP until they land; move-timing sculpting session (tables are
  rotation-ready).
- **Content briefs queued**: realism arc (14), spider (15), field
  scene (16).

## Architecture note

The layer-manager refactor trigger (docs/ARCHITECTURE.md) fires with
the FIELD SCENE (brief 16): it is the second concrete customer for
z-ordered scene composition. Do not start that refactor before then.

## Next

Brief 14 (realism arc).
