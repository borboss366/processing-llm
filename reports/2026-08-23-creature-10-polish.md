# Brief 8.2 — debris, palette, hiccups

## Task 1 — the debris: one-line answer

**It is Butterchurn.** The wiry tangle appears in a background-only capture
with the creature never loaded — it is the default preset's waveform
scribbles (the initial preset is the first `/Geiss/` match), not anything
the creature draws. The brief's premise ("not Butterchurn fluid") was
wrong. Fix: the capture harness pins a clean named preset
(`Flexi - mindblob [shiny mix]`) for reproducible captures; nothing to
change in the creature. Acceptance: current captures show a clean
background around the figure (and the diag stills are pure black).

## Task 2 — palette rule

Enforced: **primary** colours body + limbs (edge band darkens/saturates it),
**secondary** only tints the whitened core (`mix(white, secondary, 0.45)`
before the kick-band brightening — never a region hue), **accent** does
head + rim. Sidecars now carry `{primary, secondary, accent}`
(biped-1: 190/150/315; biped-2: 275/205/45); module params
`huePrimary/hueSecondary/hueAccent` override when explicitly set. Diag
captures render the three swatches top-left (`swatches` param, set by the
harness) — the biped-2 diag shows purple/blue/gold swatches matching its
json and a two-hue figure. Deviation: the brief says to update "the
quadruped/jelly" — those shape files do not exist (capsule shapes were
deleted in Brief 8 Task 2; only the two bipeds shipped), so this is a
no-op.

## Task 3 — the hiccup: diagnosis, fixes, before/after

Diagnosis from the spike trace (per-frame joint-target speed vs rolling
median, spike log with state/phase context):

- FSM transitions did snap (in-window spikes), but were NOT the dominant
  source.
- **The head-look "quick reorient" was a step function** — +0.35 rad
  toggling frame-to-frame while the noise sat near its threshold: a literal
  head twitch, worst in idle.
- **The groove bounce used `max(0, sin)`** — root velocity stepped from 0
  to ~1.8 u/s instantly at every zero crossing, twice per beat: the
  regular-interval slam, and the last surviving spike before the fix.
- PLL nudges/clock-switch steps contributed via raw-phase consumption
  (option (c) in the brief); same-state re-entry (option (b)) was already a
  no-op — verified, no phase resets or re-latches exist.

Fixes, all in:
- **Pose blending**: on any FSM change *and turn boundaries*, previous pose
  → new move stream over `blendBeats` (0.75, smoothstep) while phase runs
  on. Stance re-anchors during blends (no false slide).
- **Continuous move-local phase**: accumulates from beatPhase deltas with a
  1.6×-nominal per-frame cap and debt-based catch-up; all moves + the
  walk odometry consume it (one clock — foot planting invariant preserved).
- **Smooth motion sources**: head-look low-passed toward its target
  (~150 ms); groove bounce is `sin²` (same twice-per-beat period,
  zero-velocity touchdowns).

Metric (permanent in `capture-creature.mjs --verify`), with two refinements
found necessary and documented: a spike must be a *discontinuity* (>3×
rolling median AND >2.5× the previous frame's speed — the plain 3×-median
rule flagged 60+ legitimate frames when loud audio ramped the groove
amplitude faster than a 6 s median), and velocity uses the unclamped frame
delta (the 80 ms dt clamp inflated stall frames into false spikes).
Bone-length assert is exempt inside declared blend windows
(position-lerp blending bends lengths ~5% transiently, by construction).

**Before**: 3 flagged spikes / 30 s (first trace; up to 73 under the raw
metric in loud passages). **After**: 0 flagged spikes on both shapes over
30 s with the full FSM cycling (`VERIFY:PASS creature-capture shapes=2
seconds=30`). File-writing captures (3 s settle) can still show 1–2 flags
in the first seconds — PLL acquisition snaps (one logged at dPhase 0.46)
inside the known BPM-settling transient that the acceptance runs' 10 s
settle excludes.

## Gate captures (fresh, for the Brief 8 judgment)

`creature4-biped-1.png/.mp4`, `creature4-biped-2.png/.mp4` + `-diag.png`
(swatches on) — 30 s over Butterchurn (pinned clean preset), walk/groove/
idle/hop cycling, components 1, ~1.0–1.3 ms/frame, slide ≤0.34 px.

## npm run verify

```
pll-synthetic             PASS    scenarios=4 (0.3s)
module-load               PASS    modules=8 (0.1s)
director-prompt-stable    PASS    bytes=57585 (0.1s)
creature-capture          PASS    shapes=2 seconds=30   (verify mode: 0 spikes, comps 1)
```
(full tier: known bistable dnb-174 item unchanged)

STOP — user judges on a real GPU: lit body, two-hue palette, no debris,
no hiccups.
