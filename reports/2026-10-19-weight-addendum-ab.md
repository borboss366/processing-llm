# Brief 17.6 addendum — A (weight continuity) and B (parity guard)

Order per the addendum: A → B → re-extract, verify → STOP. Every captured
table rebuilt with one script, same constants: `tools/mocap/rebuild-captured.sh`
(new — the exact batch the T1 rebuild ran, now in one place).

## A — weight continuity

### What the repo showed (deviation from the addendum's diagnosis)
The tstep pop at phase 0.49 → 0.50 is the **stitch seam**, not the lift
branch. `tstep-captured` = the L half (keys 0…0.5) + a separately captured
R half (0.5…1). `stitch.mjs` rotated R to start at **mirror(L[0])** — but
each half is a cycle-averaged closed loop that ends at L[0], not its
mirror. Both joins (0.5 and the wrap) popped the whole pose:

| seam | rms rot jump | weight |
|---|---|---|
| 0.5 (before) | 0.824 rad | −0.97 → +1.00 |
| wrap (before) | 0.841 rad | +1.00 → −0.70 |
| typical neighbour-key step | median 0.090, max 0.326 | — |

The lift-branch problem the addendum describes is ALSO real, on other
clips: the running man's frame series had −1 → +0.78 → −1 excursions
inside one stance (a heel/toe clearing 0.06·L for a few frames). Both
fixed:

1. **Sign agreement (weight.mjs).** The pelvis branch is always measured.
   A lift that agrees with it (same sign, or pelvis in the dead band)
   gives ±1 at once; a lift that CONTRADICTS a pelvis outside the dead
   band counts only after it has persisted `persist` frames =
   ⌊SG window / 2⌋ = 4 — from the smoothing window, not a clip.
   Self-test (e): a 2-frame flick → no flip; a held lift → flips at frame 4.
   Frames overruled per clip: runningman 8, tstep L 9 / R 11, kick 13,
   running_man_3 7, bodyroll 0.
2. **Seam search (stitch.mjs).** Both rings are cut where the halves are
   most alike: candidates must keep |Δweight| ≤ 0.5 (a pose match with the
   weight on the other foot is not a match), then angles + weight on the
   angles' scale pick. First try (weight as one scaled channel among 13)
   still cut mid-transfer (−0.98 → +0.73) — the gate replaced it.
   Result for tstep: cut L @0.734 · R @0.953, weight 0.06 → 0.42,
   **pose jump 0.573 rad rms** (was 0.824).

### Contract row `weight-rate` (tools/weight-rate.mjs, in verify, fast tier)
Samples weight the way the engine plays the loop (same per-segment ease),
max Σ|Δweight| over any 0.1-beat window. **Bound 1.5**, one global
number, set from data: every real captured transfer measured ≤ 1.25, the
seam pops 1.72–2.00.

| table | max swing / 0.1 beat BEFORE (3e0a8cf) | AFTER | weight range | keys with no planted foot |
|---|---|---|---|---|
| tstep-captured (+ -x) | **2.00 @0.47 FAIL** | 0.70 @0.03 | −0.98…1.00 | 0 of 43 |
| runningman-captured (+ -x, -front) | 1.55 @0.06 FAIL | 1.11 @0.26 | −1.00…1.00 | 0 of 32 |
| running_man_3 / _4 (both views) | 1.21 | 1.22 @0.85 | −0.94…1.00 | 0 of 21 |
| bodyroll-captured | 0.82 | 0.82 | −0.95…0.59 | 0 of 14 |
| basic_kick_1 (both views) | 0.19 | 0.26 | −0.21…0.22 | 0 of 24 |

`node tools/weight-rate.mjs` → `PASS: 12 weight-carrying tables, bound
1.5 per 0.1 beat; worst running_man_3-captured-front 1.22`.

**Deviation — authored tables are INFO, not gated.** The addendum says
"every table". Authored tables carry contacts only; their weight is a
step function of those discrete flags by construction. `tstep-placeholder`
swaps footR → footL on a snap key: 2.00. Gating it would force editing an
authored table to satisfy a signal check; smoothing an authored transfer
is the engine blend's job (Task 2, "blended through zero with no pop").
The row prints it every run.

**Still open (A).** tstep's seam pose jump 0.573 rad rms is 6× a normal
key step: the two real halves never pass through the same pose with the
same weight. A cut cannot fix that; a short crossfade across each join
can. Not done (beyond A); named here for Task 2/3 or a reviewer call.

## B — parity guard sees weight and depth

The octave guard now judges θ **plus** weight and depth, each on the
angles' scale (`lib/channel-scale.mjs`: median angle spread / channel
spread; one factor for weight, one for the whole depth family from its
most active channel, so quiet depth noise is not blown up). Applied to
both branches — cycle-consistency (×2 re-bin) and parity (even vs odd) —
because with `cycles 14` the kick never reaches the parity branch (the
doubled loop fits 7 times, so the consistency branch decides first).
Every run now prints its guard numbers.

### basic_kick_1 — the addendum's expectation does NOT hold
Expected "loop DOUBLED by parity, 7 pairs, weight ±1 per kick". Measured:

    octave/parity guard channels: θ ×1 · weight ×0.80 · depth ×1.55
    octave guard: spread ×1 0.581 vs ×2 0.600 (doubles below 0.348)
    support runs ·R·L·L·R·R·L·R·R·R·L·R

Doubling makes the cycles agree LESS. The per-cycle weight shows why — the
standing leg does not alternate per 0.333 s cycle nor per pair:

    cycle 0  + + + + + + + + +        cycle 7  + + + + . − − − − −
    cycle 1  + . − − − − − − − −      cycle 8  − − − − − − − − − −
    cycle 2  − − − − − − − − − −      cycle 9  − + + + + . . + + +
    cycle 3  . . . . . − − − − .      cycle 10 + + + . . . + + + +
    cycle 4  + + + + . . . . . +      cycle 11 + + . . − − − . . .
    cycle 5  + + + + + + + + + +      cycle 12 . . . . − − − − . .
    cycle 6  + + + + + + + + + +      cycle 13 + + + + + + + + + +

(+ right, − left, . shared). The right leg stands for 2–3 cycles at a
time, the left for 1–2; the pattern is irregular. Re-running with
`--cycles 7 / 5 / 4 / 3 / 2` finds no period where the window repeats
(≥ 1.16 s leaves 2 cycles or none). The 0.333 s "loop" is a bounce inside
the kicking, not the kick. No guard (×2 or ×k) can produce an
alternating table from this window, because the alternation is not in it.
Kick table unchanged in substance (weight −0.21…0.22, both feet planted).
"Recapture with a one-kick window" is dropped from STATUS as the
addendum directs; what the kick needs is a window where the kicks
actually repeat — that is a property of the clip, for the owner/reviewer.

### Finding 6 — constant left-forearm depth on the kick (survives)
`basic_kick_1-captured-front` elbowL depth 0.27–0.42 on all 24 keys,
elbowR −0.14…−0.01. The left forearm's projected/rest ratio over the
clip: median 0.65 (p10 0.31, p90 0.97); the RIGHT forearm: median 0.68
(p10 0.34, p90 0.93) — equally foreshortened. Not a rest-length error,
not motion: **a depth-SIGN error.** elbowL's sign is held by continuity
(115 of 140 frames) and stays + on all 118 nonzero frames → mean +0.34;
elbowR's sign splits 62 + / 62 − → mean −0.02. Both arms are held
toward/away from the camera the whole clip; only one side's sign
survived averaging. This is the owner's "one arm fat, the other not"
(2026-10-14). Sign resolution is out of 17.6's scope (brief: "a separate
numbered finding") — numbered here, not fixed.

## Other facts from the rebuild
- running_man_4 is extracted from the running_man_3 video with the same
  window (there is no running_man_4 video in corpus/): a duplicate table.
  Kept; noted in the rebuild script header.
- runningman now reads `L·L·R·L·L·R·L`: the old false excursion inside
  the left stance is gone; the left stance's mid dip (−0.49) splits the run
  string. One left and one right stance per loop: the step alternation
  holds (Task 3's sign-sanity row will test it formally).
- Doubling: runningman and running_man_3 are doubled by parity as before
  (cross 0.42 / 0.45 vs same 0.21).

## Checks
`extract.mjs --self-test` PASS (new test e) · verify `--only`
moves-x-shapes, transition, view-switch, drop, engine-fidelity,
depth-stress, weight-rate: **7 PASS**. `fk-check` FAIL — planted toe drift
7.0 px > 6 on `tstep-placeholder` (authored). None of its inputs changed
(engine, shapes, that table identical to HEAD); the machine was on
battery at 17% (the 2026-10-13 battery run failed this same check the same
way). Re-run on AC before Task 2; its captures were not committed.

**Re-run on AC (same day):** `fk-check` PASS — heel-pivot toe drift
0.0 px, ankle swing 11.7 px, spikes 0. The battery failure was
throttling, not a regression.
