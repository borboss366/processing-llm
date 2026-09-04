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
| True FK propagation (enriched rig) | kick 31 px; heel pivot toe 0.0/ankle 7.3 px; wave lag 0.025+0.025 | fk-check |
| Move workbench loop | hot edit = exact delta; manual→live 0 spikes | workbench-check |
| Move rotation | all 3 tables cycle, no repeats, 0 spikes | capture-creature 60 s |
| Transition quality (brief 14) | turn plateau 413→81 ms; glide 111→0.0 px; rhythm ramp 0.63→0.14 | transition-check |
| bgDim (brief 14) | step-down 0.48 of undimmed (design 0.45); restores 1.02 on exit | bgdim-check |
| Weld fix (union-by-max) | 26–39% flash removed vs additive | weld-sweep |
| Creature health envelope | ≤6 ms/frame, slide ≤0.72 px, components 1 | capture-creature |
| Compositor A/B + budget probe | active, A/B differs, 0 page errors | post-ab |
| Bench click scheduler (PLL tier) | 56 ms median vs live estimate under load | bench-check |
| Puppet page flow | enter/rig/scrub/params/snapshot round-trip | puppet-check |
| Audience pipeline E2E | 8 validation verdicts + moderation green | audience-e2e |
| Audience soak | 50/50 accepted, frame cost flat | audience-soak |
| Director latency / prefix | ~4.5 s warm; prefix byte-stable | replay --check-prefix |
| Low-tempo band (93 + 81 BPM) | Dre 93.49 (±2); Queen octave-documented | low-tempo-check |
| Liveness layer (brief 15A) | amp-drift ratio ≥1.8 at 0.25 gain; fk+transition green with it ON | liveness-check |
| Arm envelope (brief 15B) | shoulder ±π, elbow ±2.4 signed — clean static+beat+snap | rotation-stress |
| Arm vocabulary (brief 15B) | peaks 0.2%/0.6% of authored; wrist orbit 99 px; 0 spikes | fk-check |
| Feet (brief 15C) | heel-pivot swing 7.3→14.8 px, toe 0.0; components 1; walk stretch 62→38% | fk-check + capture |
| Mocap pipeline math (brief 16 T1) | round-trip 6.1e-16 rad incl. hips; period ×1/×2 both correct; distill err 0.044 rad | mocap self-test |
| Mocap on real clip (T-step L) | 58/58 posed; 0.63 s loop; 16 keys; determinism byte-identical | extract.mjs + diff |
| Hip DOF (brief 16.1) | hip ±0.9 clean static+beat+snap; boneDev 0.0%; free-leg knee variance −47% on re-extraction; walk pixel-identical (gait A=0) | rotation-stress + fk-check |
| Moves × shapes matrix (brief 16 T2) | 6 moves × 2 stage shapes: 0 spikes, components 1, hips articulate (0.47/0.53) | moves-x-shapes |
| Shape-load degrade (live path) | bad shape name resumes old body (was: frozen at n=0 forever) | moves-x-shapes (found) + probe |

Known-items (documented, not tuned — the grid tier owns file playback):
dnb-174 stays bistable on the PLL tier at fixed rate (confident medians
167–172 across runs); Queen's 81 BPM stomp-clap confidently
octave-doubles to ~161 (the 120-centred prior takes the upper octave —
sidecar grid is exact at 81.3). Both are prior physics, gated
mod-octave so regressions still surface.

## Open (user)

- **Phone gate E11** (deferred twice; web UI suffices for testing —
  must run before a real event). Protocol in `docs/USER_GATES.md`.
- **For the reviewer** (sculpt session #4,
  reports/2026-09-01-sculpt-session.md — R4 DECISION: all other shapes
  postponed until the human is done properly): (1) axial-rotation /
  pseudo-depth channel — foot fan, arm-raise elbow flip, convex-elbow,
  one mechanism; (2) anatomy priors — pose-dependent couplings, rules
  vs data (Route B's extracted motion carries them for free);
  (3) music-structure reactivity (drops → immediate move re-pick,
  pairs with the unimplemented fillKey). Spider/field WAIT per R4.

## Architecture note

The layer-manager refactor trigger (docs/ARCHITECTURE.md) fires with
the FIELD SCENE (brief 16): it is the second concrete customer for
z-ordered scene composition. Do not start that refactor before then.

creature.js math/render/telemetry split: trigger = spider brief

## Next

BRIEF 16 Task 1 + 16.1 COMPLETE. Task 2: all machine-side done-bar
items green — tstep-captured in the groove rotation (weight 0.15),
moves-x-shapes matrix PASS, capture + transition re-verified,
tstep-captured-x (×1.35) staged for the workbench pass. WAITING on the
user's gate (USER_GATES item 2): recognizably her move / 3 m / vs
placeholder / plain-vs-exaggerated / promotion word. After the gate:
move #2 (body roll) for the economics number, then Task 3 anatomy
stats + lint.
