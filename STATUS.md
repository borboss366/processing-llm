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
| Zero-phase smoothing (lag fix) | retarget lag 47–60 ms drifting (One Euro) → −0.7/+1.6 ms constant (Savitzky–Golay) | extract.mjs lag diagnostic |
| Ankle stance re-centering | −1.6/+1.1 rad profile-vs-frontal offsets removed; 0 wrap jumps, 0 foreshortened frames; footYaw channel recorded | ankle-diag + extract.mjs |
| Extraction hardening (16.2) | foot gate holds 9+8 noise frames; jitter 3.75→3.37 px (fixed-crop VIDEO ×2 TTA); depth channels footYaw+twist emitted; determinism byte-identical | extract.mjs + self-test 9/9 |
| Move #2 running man (economics) | ~15 min/move wall time; 2/2 cycles, lag 0.9 ms; fk + moves-x-shapes PASS; knee-lift lost to de-yaw (side-view source) — plane-select finding for 17 | extract + harnesses |
| --view as-filmed experiment | hip span ×3–5, knee ×3; thigh twist 0.40→0.16 (collapsed as predicted); foot gate 90→0 held; stickman tracks the lift | asfilmed report |
| Mirror-rest bug (fixed) | --mirror chains were off by rest(L)−rest(R) (worst 132° real-data); roots verified spine-based (chest sd 1.7° in profile); mirror round-trip now 4.4e-16 | root-diag + self-test |
| Measured-rest calibration | planted/quiet-frame medians replace declared rests (elbow guess was off −1.2 rad); round-trip 0.00°, clamp hits 16→0; feet heel→toe (tiptoes gone); self-test 11/11 | root-diag + self-test |
| Per-side sign (far-side flip) | flipped side erred at exactly 2× deviation (worst 128.6°) → 0.0° all bones both sides; profile lift self-test L/R 0.00°; self-test 13/13 | root-diag + self-test |
| Canonical views (brief 17 A) | front↔profile switch ≈1 bar, 0 spikes, components 1 forced+move-driven; profile walk 899 px / 9 turns / 0 spikes; --view auto frontness 2°/82° correct | view-switch-check + moves-x-shapes |
| Body roll A8 (spine wave) | wave TRAVELS: hip→chest +59°, chest→neck +160°, amp 0.32→0.47 rad — two torso DOFs suffice; --cycles prior fixed a ×6.9 period error | extract + phase analysis |
| Twist channel (brief 17 B) | cos-bend exact (−0.9→−0.326 @ tw 1.2); foreshorten exact (65→24 px); stress row range 0.073 u, max step 0.021 (no popping); fk + capture green | probes + rotation-stress |
| Drop reactivity (brief 17 C) | 4 drops precomputed on Darude; pre-arm 3.27 beats out; boundary re-pick < 1 bar; fillKey snap declared; 0 spikes | drop-check |
| FK contacts + stance-lock yield | occluded-foot contacts were image-derived garbage (planted all 16 keys) → FK-derived, alternating; lock yields at 0.025 u table lift; both legs track at every scrub | scrub probe + view-switch-check |
| Mocap on real clip (T-step L) | 58/58 posed; 0.63 s loop; 16 keys; determinism byte-identical | extract.mjs + diff |
| Hip DOF (brief 16.1) | hip ±0.9 clean static+beat+snap; boneDev 0.0%; free-leg knee variance −47% on re-extraction; walk pixel-identical (gait A=0) | rotation-stress + fk-check |
| Moves × shapes matrix (brief 16 T2) | 6 moves × 2 stage shapes: 0 spikes, components 1, hips articulate (0.47/0.53) | moves-x-shapes |
| De-yaw removal + reinterpretation | 2D "rotation" = x·cos(yaw) squash → stage 3 selects view only; front-from-profile = rot→twist reinterpretation (159 twist keys, 0 in-plane leak; synthetic knee-lift 0.7 → twist 0.7) | extract.mjs self-test + integration run |
| Estimator default = rtmpose (18.1 T4 verdict) | post-SavGol jitter gap 3–10 % (was 25–35 % raw — a filter property); R0 re-extracted ×3 clips; runningman 4/4 cycles, drift −0.0001 u/loop, halves symmetric pre-symmetrize (L 1.13/R 1.14 vs mediapipe 0.84/1.45) | extract batch log + stitch |
| A/B explorer + fore-vs-world (18.1 T3/T2.3) | 3 A/B pages (summary card, A/B/overlay toggle) + section 3b twist overlay; headless smoke 5 pages 0 errors | explorer-ab.mjs + puppeteer smoke |
| QA stickman view-correct (user catch) | profile QAs FK'd the FRONT body (fake-front look) → FK over biped-profile; knee lift/planted leg now track the dancer 1:1; tables byte-identical | reports/2026-09-28-qa-profile-body.md + strip |
| ABSOLUTE retarget (root cause: collapsed arms) | measured rest erased habitual pose (elbows −1.4 rad!) → theta = obsAbs − rigRestAbs(view); arms-forward anti-test renders 0.00° abs; QA overlay panel tracks dancer bone-for-bone; 0 clamps (runningman) | reports/2026-09-28-absolute-retarget.md + self-test |
| Brief 18.2 overlays + diagnostics | 8 on-frame layers (rig/rest/gonio/foreshorten/contacts/raw/velocity/table) + heatmap/onion/filmstrip/key-ghosts; PNG+webm export; smoke 0 errors; 3 acceptance stills | reports/2026-09-28-brief-18-2-overlays.md + 182-still-*.png |
| Weight signal (17.6 T1) | weight ∈ [−1,1] per frame from FK feet → per key, contacts derived; runningman alternates ±1 per step, 0 keys with no foot planted (was 14); round-trip 141 authored keys exact; mirrored clip negates; profile foot zero restored | reports/2026-10-15-weight-t1.md + self-test |
| Weight T1 owner check (rating page, before/after) | runningman side ✓ front ✓ (wants a bob); tstep ~ (tilt flips too fast); bodyroll ✗ (feet still leave the floor — root, not contacts: every key now plants a foot); kick ✗ expected | reports/2026-10-18-user-gates.md |
| Weight continuity + parity guard (17.6 addendum A/B) | weight-rate (max Σ\|Δweight\| per 0.1 beat ≤ 1.5): 12 captured tables PASS, worst 1.22; tstep 2.00 → 0.70 (stitch seam cut on weight agreement; pose jump 0.82 → 0.57 rad, still open); runningman 1.55 → 1.11 (lift must agree with pelvis or persist 4 frames); guard judges θ + weight + depth — kick does not double (no repeat in the window) | tools/weight-rate.mjs (verify) + reports/2026-10-19-weight-addendum-ab.md |
| Move roster (captured-only stage) | moves/roster.json `active: captured` — puppet list = 12 captured tables, groove rotation = 6 natural-view captures (equal weight); authored tables kept on disk (harnesses), `active: all` restores; live probe 60 s: only the 6 played, spikes 0; drop-check + view-switch PASS | /moves-list + roster probe |
| Depth stress + ladder (17.5 T3) | depth-stress PASS at slow/beat/snap (spikes 0, components 1, no pop at zero, overlap ≤4 flips/loop); depth reaches the engine within 0.002–0.005; kick shin toward camera 76/77 lifted frames; runningman right leg reads up to 0.2 (open, Task 4) | tools/depth-stress.mjs + reports/2026-10-13-depth-t3-stress-fidelity.md |
| Depth cues (17.5 T2) | size/draw-length/brightness/arm-overlap from depth, gains on the shape, `exaggerateDepth` dial; depth-0 tables exactly neutral at dials 0/1/2; module 2.1 ms; engine-fidelity/mxs/fk/transition PASS | reports/2026-10-13-depth-cues-t2.md |
| Depth channel (17.5 T1) | one signed out-of-plane channel ∈ [−1,1] replaces twist in captured tables; collapsed bones (<0.35 rest length) retarget to REST, motion in depth — sole-to-camera self-test: in-plane 0.0000, depth 0.954; fk-check PASS, module 2.1 ms on power; tstep foot clamps 46/52 → 32/45 | extract self-test + engine-fidelity (fresh) |
| Front-view ankle reference | dancer's standing foot = ankle zero (front only): basic_kick engine clamps 185/69 → 0, fidelity PASS; tstep 83/28 → 46/52 (residual = floor-plane fan, depth; whitelist kept) | reports/2026-10-13-front-foot-reference.md + self-test |
| Plain explainers (owner prompt) | docs/{ENGINE,PIPELINE}_PLAIN.md — every stage in 5 plain parts (what/why/analogy/the real bug as a story/how I'd notice), one-breath openers, explorer-reading guides; cross-linked both ways | docs/*_PLAIN.md |
| Owner CLI (19.2 follow-up) | npm run fetch / capture / engine-report / move — full chains with sane defaults, MOTION_SOURCES window+mirror lookup, stage summaries, ladder + fidelity verdict, explorers auto-open; every hidden command printed | tools/{capture,engine-report,move}.mjs + doc headers |
| Engine legibility (19.2 T1/T3/T4) | docs/ENGINE.md (10 stages, formulas, failure modes, explorer taps) + docs/MAP.md (whiteboard view); explain-it gate in CLAUDE.md + docs/explained/ (backfill queue); moveSpringWn knob for prediction 1 | docs/ENGINE.md + MAP.md + review template |
| Engine explorer (19.1) | taps after every stage → ladder/heatmap/filmstrip explorers ×7 + live puppet view; ladder names R2 springs 0.355 rad (elbowL 0.588); knee fix verified in-tool (BEFORE amp 0.25/1.66 dead → 1.04); engine-fidelity verify row + clamp whitelist (caught tstep feet) | reports/2026-10-03-brief-19-1-engine-explorer.md |
| A7 engine knees (FAIL → fixed same day) | captured-table FK convention one slot off + stance lock rewrote real legs → load-time remap + ground-plane-only lock; kneeL 1.785→1.761 on stage (was −0.134); amplitude rung in moves-x-shapes | reports/2026-10-03-a7-engine-knees.md + knee-fix-ab.png |
| R1 rung: distill fidelity (19 3.1) | octave/parity guard restored the stride (kneeL loop 0.70→1.75 rad); budgeted keys + constant channels → distill adds ≤0.011 rad all clips (PASS); floor = rep variation, DTW = next rung | table-vs-raw.mjs + reports/2026-09-28-r1-distill-fidelity.md |
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

**Brief 17.6 Task 2 — the engine weight layer**, on the owner's go
(addendum A/B done, fk-check PASS on AC; report the root's
vertical range after 2.1, before the sink — addendum C):
the root solved from the support foot (the body-roll "feet leave the
floor" verdict is its first test), pelvis shift + tilt blended through
zero (the T-step "tilt flips immediately" verdict sets the rate check),
spine counter, sink on transfer (the front running man's missing bob),
one `exaggerateWeight` dial; then Task 3 (weight-ground verify row,
stress row) and Task 4 (owner judgment + docs/explained/weight.md).

Owner items still open: the kick window has no repeating kick (addendum B
— the standing leg changes irregularly; no period fits), finding 6
(left-forearm depth sign stuck on the kick);
goo exaggeration "like in cartoons" (idea, not a brief yet); A7
rotation polish (low priority); explain-it backfill (director, clocks,
goo render, authored moves, FSM, audience pipeline); phone gate E11;
the 19.2 reading loop.
