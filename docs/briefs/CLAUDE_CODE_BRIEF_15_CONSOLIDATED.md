# processing-llm — brief 15 (consolidated): liveness, arms, feet

Supersedes the separate 15 and 15.1 drafts; folds in the 2026-08-31
gate-session findings (reports/2026-08-31-user-gates.md). Theme: raise
the expressiveness ceiling, then let the user sculpt on it. Order
matters: geometry (C) and range/vocabulary (B) precede the sculpting
session (D); the liveness layer (A) is independent. CLAUDE.md rules;
verify green; USER_GATES updated per section.

## A. Liveness layer (kills uniformity; no data needed)

A1. Cycle variation: per-joint amplitude/phase wander on slow Perlin
    (±10% amp, ±0.02 loop phase, 20–60 s periods; params varyAmp/
    varyPhase), applied UNDER tables, envelope-blended.
A2. Baked asymmetry: sidecar `dominantSide` (default R) — dominant limb
    amps ×1.08, off ×0.94; head-look bias. Audience template inherits.
A3. Chain lead–lag on the pose STREAM: root leads; spine +~30 ms; head
    +~60 ms (params). Walk/turn exempt where odometry must agree with
    feet (stEff decides).
A4. Swing: `swingPct` (0–0.25, default 0.08) warps each beat's second
    half late; exact on grid tier; per-table override; slider on
    bench/puppet; click stays straight so swing is visible against it.
A5. Downbeat accent (grid tier): "one" gets bounce+move amplitude
    ×1.15, eased; PLL tier off (barPhase unanchored). Phrase variation:
    every `phraseBars` (8) one bar of lifted variation or a declared
    `fillKey`.
A6. Caps: fk-check, transition-check, spike metric all green WITH
    variation ON — liveness must never break a mechanism.

## B. Arm range + vocabulary (the "stroke"/convex-elbow fix)

B1. Rotation stress harness FIRST (`tools/rotation-stress.mjs`,
    verify --full): shoulder ±π; elbow FULL SIGNED −2.4→+2.4 (the
    zero-crossing straight-arm must not pop/thin/weld); slow/beat/snap
    speeds; arm-across-body paths; a hands-up "W" hold (elbows bent
    opposite to rest). Assert components=1, no NaN, densities, bones,
    spikes clean outside declared snaps. Deliverable = the actual safe
    envelope; if smaller than ±π shoulder / ±1.8 elbow at beat speed,
    fix the mechanism (pins, splats, arm-ring stiffness) until it
    isn't.
B2. Range as data: sidecar `rotLimits` per role — shoulder ±π, elbow
    ±2.4 SIGNED, wrist ±1.2, knee ±2.0 signed (2D design: a 3D hinge's
    apparent bend flips with pose in projection — "always convex" was
    the one-signed bug). Tables clamp with a logged warning. Remove the
    defensive FK-accumulation amplitude scaling; tables own their
    numbers.
B3. Vocabulary (all -placeholder, workbench-editable):
    - `armpump`: overhead "W" on the downbeat (shoulder ~−2.6; elbows
      OPPOSITE sign from rest — the signed-elbow proof, keys on both
      signs), pump on beats, drop through zero over the bar.
      verticalContent 0.2.
    - `sidepunch`: alternating full-extension side punches (shoulder
      ~±1.4, elbow snap-open 0.1→2.2), torso counter-rotation.
    - `elbowcircles`: elbow sweeps continuous rotation on a raised
      shoulder base; wrist traces visible orbits; solo then both at
      half-loop offset.
    - `armwave` upgrade: shoulder base raised to chest height; range
      widened per limits.
    - groove repertoire gains the three (modest weights); hop/high
      energy prefers armpump.

## C. FEET (gate headline: tstep legibility bounded by geometry)

C1. Foot as a first-class part: sidecar foot region with its OWN axis
    (perpendicular to the shin); the sampler fits foot rings along the
    FOOT's axis and welds the chain at the ankle — an L that can
    pivot, replacing "wider bottom rings on a vertical chain".
C2. Built-in biped art: feet redrawn with real heel-toe length and a
    visible heel step (silhouette asymmetry front/back) so a pivot
    reads. Elongated foot draw-radii profile (toe slimmer than heel)
    rather than a ball.
C3. Audience template: foot sub-regions added; validation unchanged
    (inside-ink only for mid-chain joints, per the live fix); template
    ghost hints feet ("draw feet sticking out"). Service restart
    documented (memoization).
C4. Re-verify heel pivot on the new geometry (fk-check) and capture
    tstep close-ups for the user's C7a legibility re-check.

## D. Sculpting session + Route B decision (human task)

D1. `sculptMode`: forces variation/swing/accents OFF while editing;
    restores on exit.
D2. The user sculpts tstep + armwave (+ any of B3 he likes) on the
    finished rig; agent fixes workbench friction in-session; tables
    lose `-placeholder` on his word.
D3. Gate carries the ROUTE B decision per the standing rule (pleasant
    + two moves good → pilot waits past Halloween; else pilot jumps
    the spider). `docs/MOTION_SOURCES.md` is created if absent; first
    entry: TakeSomeCrime — Catgroove (Parov Stelar), ~108 BPM electro-
    swing, style smooth/glide-wave — user adds timestamps.

## Acceptance

- A/B webm (liveness off/on, same seed) + cycle-dissimilarity number
  (>0 on, 0 off, bounded).
- Stress-harness envelope table; fk-check extended per new table (peak
  angles within 5% of authored; wrist orbit radius for elbowcircles;
  heel pivot on new feet).
- Webm cycling the full arm vocabulary + tstep on new feet over the
  gridded mix; spike/transition metrics green.
- USER_GATES: replaces stroke/convex/feet findings with — "arms read
  as a dancer's (raises, punches, circles, both elbow signs)?",
  "tstep legible as a t-step now?", plus R1–R4 (performer-vs-loop,
  swing/accent taste, sculpting + Route B decision).

## Out of scope

Toward-camera motion (front-view by design), Route B extractor
(decision at this gate), spider (16), field scene (17), audience blob
fidelity (post-animation), style packs.
