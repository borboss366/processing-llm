# 2026-08-30 — brief 14 Task 2: transition quality

All four C8/gate findings addressed in the creature engine, measured
before/after with a new scripted harness (`tools/transition-check.mjs`,
registered in verify --full): walk → edge turns → groove → armwave →
tstep → walk → idle over the gridded techno mix, sampling bench
observables + key joints at ~35 ms. "Before" = the Task-1 commit's
engine (same rig, same tables) with only the three read-only bench
observables patched in, so the numbers are directly comparable.

## Before / after (tool-produced, same script, same mix)

| metric | before (Task 1 engine) | after (Task 2) | assert |
|---|---|---|---|
| turn: worst near-zero worldX-velocity plateau | **413 ms** (full halt) | **81 ms** (sweep through mirror) | ≤ 250 ms |
| walk→idle: body drift AFTER feet stop cycling | **111.1 px** (moonwalk glide) | **0.0 px** | ≤ 4 px |
| walk→idle: moving-without-stepping windows | 4 | **0** | 0 |
| walk→idle: feet keep stepping until | +0.4 s (snap to idle) | +2.0 s (decel completes) | — |
| groove→armwave: early/settled shoulder envelope | 0.63 (partially masked by pose blend) | **0.14** (true ramp) | ≤ 0.5 |
| spikesFlagged over the whole script | 0 | 0 | 0 |

Turns observed: 8/8 in both runs. Webms: `reports/transition.webm`
(after) and `reports/transition-before.webm`.

## The four fixes

1. **Rhythm crossfade (2.1)** — the pose blend snapshots a frozen pose,
   so rhythm switched instantly even while positions interpolated. On a
   move switch the OUTGOING table now keeps being sampled and its
   amplitude ramps down over 4 beats (bar-aligned — rotation fires on
   bar wraps) while the incoming table's amplitude ramps up; overlay and
   verticalContent blend on the same smoothstep envelope. Manual scrub
   completes any crossfade instantly (a pinned/rewound move clock would
   freeze or sign-flip the envelope).
2. **Bounce ducking (2.2)** — move tables declare `verticalContent`
   (0–1; documented in MODULE_ABI): tstep 0.7, groove 0.5, armwave 0.15.
   The global beat bounce scales by (1 − vc), envelope-blended across
   switches. Kills the tiring constant bounce under every move.
3. **Walk→idle keeps stepping (2.3)** — new effective pose state
   `stEff`: while the walk stride is easing out, gait swing, feet cycle,
   move-table resolution and procedural layers ALL stay in walk; the
   state pose-blend fires only when stEff flips (stride ≈ 0). stEff is
   also now the single blend trigger for every state change (the FSM
   edge no longer blends). Hop is exempt (airborne pose takes over
   immediately).
4. **Turn carries motion (2.4)** — during the 400 ms mirror sweep, root
   velocity follows facingVis (smoothly reversing through zero instead
   of halting), the feet keep cycling (no neutral snap; world-anchored
   slide measurement is suspended mid-turn since the mirror sweep makes
   it meaningless), and both turn-edge pose blends are gone — the gait
   never stops, so there is nothing to blend.

## Regression sweep after the changes

fk-check PASS (kick 31 px, heel pivot toe 0.0/ankle 7.3 px, wave lags
0.025/0.025), workbench-check PASS (manual/hot-edit flow with the
crossfade guard), capture-creature PASS (components 1, slide ≤ 0.80 px,
bone rot-dev 0.0%, flagged spikes 0, ≤ 1.80 ms/frame), puppet-check
PASS, verify fast tier 4/4. Frame budget unchanged: the crossfade adds
one extra `sampleMove` only during the 4-beat window of a switch.

## For the user

The C8 re-check is subsumed by the scripted webm and the next live
session: transitions should now read as breathing, walks stop on their
feet, turns flow. `verticalContent` values are authoring constants —
tune by feel.
