# processing-llm — brief 3

State: Brief 2 Tasks A, B, C, F done; PLL passes a 4-genre matrix; director
picks in ~4.5 s. Remaining from Brief 2: D (memory A/B), E (measured tags).
This brief adds a pick-rate fix that must precede D, a status-file rule, one
PLL regression case, and finally the creature module (original Task 4).

Ground rules unchanged: frames before frameworks, no new surfaces, live path
stays boring, delete don't attic, stop and report after each task.

## Task 0 — STATUS.md is a snapshot, not a log

Rewrite `STATUS.md` from scratch at the end of every task. Structure:

1. One paragraph: what the system does today and how to run a set.
2. "Verified" — bullet per capability, with the number that verifies it and
   the tool that produced it (e.g. "PLL: 4-genre matrix ±2 BPM,
   `tools/beat-test-real.mjs`").
3. "Open" — current problems only, ordered by user-visible impact.
4. "Next" — the next task by name.

Nothing historical. The current file contradicts itself (Open #3 says no real
session exists; Task C above it describes a 12-minute one). Git is the
history; a reader of STATUS should never have to reconcile sections.

Replay tables and harness outputs that serve as evidence get committed under
`reports/<date>-<topic>.md`; sessions and audio stay gitignored.

## Task 1 — Pick rate, hold, and bar-quantized changes

The 12-minute session produced 38 picks — one every ~19 s on minimal techno.
That is far too fast; a held look is 1–3 minutes and changes should land on
phrase boundaries. Fix before Task D, or the A/B measures the wrong thing.

1. **Minimum hold.** Controller-side: no new director call within
   `minHoldMs` (default 45 000) of the last committed pick, regardless of the
   change score. Expose in the controller UI next to the Auto-Director
   button.
2. **Hysteresis on the change detector.** Whatever statistic triggers a
   director call, require it to exceed the threshold for two consecutive
   windows before firing, and reset the anchor only on a committed pick.
   Document the statistic and threshold in `director.ts`.
3. **Director may hold.** Add `"preset": "hold"` as a valid output. The
   prompt says: if the current section does not warrant a change, answer
   hold. Holds are logged as decisions (not as tick holds) so replay can
   count them.
4. **Bar-quantized commit.** When a pick arrives, do not apply it
   immediately; apply it at the next `barPhase` wrap (or after 4 s if
   `beatConfidence < 0.4`). Log both arrival and commit timestamps.
5. **Recency.** Raise the recency blocklist to cover at least the last 10
   picks; 21 unique out of 38 means revisits within minutes.

Acceptance: re-record the same techno mix from the same seek; report picks
per minute (target ≤ 1.5), hold decisions, and commit-to-bar alignment
(histogram of `barPhase` at commit). Commit the report.

## Task 2 — PLL regression: low-tempo band

The DnB fix raised the half-lag preference to 0.55, which makes the 60–90 BPM
band eager to double. No track in the matrix exercises it.

1. Add a ~93 BPM hip-hop track (user supplies; e.g. Dr. Dre – Still D.R.E.)
   and a ~81 BPM stomp-clap track (Queen – We Will Rock You, no kick drum)
   to `tools/beat-test-real.mjs`. Expected reads: 93 and 81, not 186/162.
2. If they double: make the tempo prior centre a controller setting
   (`tempoCentreBpm`, default 120) and re-test with centre 90. Do not widen
   the prior globally to pass the test.
3. Make the prior centre part of the session config so replay knows it.

Acceptance: matrix table now has 6 rows, all ±2 BPM; synthetic suite still
passes. Report in `reports/`.

## Task 3 — Brief 2 Task D: memory A/B on real data

As specified in Brief 2, on the session re-recorded in Task 1 (post
pick-rate fix). Both variants replayed with the same `--seed`. Table plus a
factual judgment (repeat count, distinct-preset count, hold count, any
off-list picks). Commit to `reports/`. The worse variant becomes non-default.

## Task 4 — Brief 2 Task E: measured preset tags

As specified in Brief 2. Add: the bootstrap must not run while a set is live
(it evicts the director's prefix cache — already noted in STATUS; make the
script refuse if the controller server is up unless `--force`).

Acceptance unchanged: tag histograms not dominated by one bin; replay
before/after shows different picks; report in `reports/`.

## Task 5 — Creature module (original Task 4)

`loaded-modules/creature.js`. A dancing creature with a generated armature.
No graph growth, no LLM, no GRA. The question this task answers is whether
the idea reads as a creature at all.

1. **Shape.** Union of 3–5 circles/capsules as a 2D SDF, with labelled
   parts: `body`, `head`, `limb[i]`. Two hardcoded shapes selectable by
   param: a quadruped-ish and a jellyfish-ish.
2. **Tissue.** 300–600 points inside the SDF (jittered grid or Poisson
   disc), edges by k-nearest (k=3–4) or Delaunay (a small inline
   Bowyer–Watson is fine; no new dependency). Typed arrays throughout:
   `Float32Array` positions/velocities, `Int32Array` edges, rest length =
   initial distance.
3. **Skeleton.** Hardcoded joints per shape (4–6, with parent links) in
   shape coordinates. Each joint pins its nearest 3–5 tissue nodes.
4. **Gait.** Per joint: angle offset = `A·sin(2π(beatPhase + phaseOffset))`.
   Archetype tables for `A` and `phaseOffset`: quadruped trot (diagonal
   limbs in phase), jellyfish pulse (all limbs in phase + body scale pulse).
   `A` scales with `smoothedLevel`. Archetype is a param. When
   `beatConfidence < 0.4`, free-run at `lastConfidentBpm` (the Task F
   fallback), never stop.
5. **Physics.** Per frame: pinned nodes move to joint targets; the rest
   integrate springs + damping (Verlet) + a weak centering force. Must hold
   60 fps at 600 nodes; batch drawing with `beginShape`/`vertex`, not
   per-edge `line()`.
6. **Render.** Filled triangles at low alpha, edges on top, node size by
   distance to nearest joint, colour from band energies.
7. Implements `triggerable` + `fadeable`; listed in `MODULE_ABI.md` as the
   reference for `beatPhase` use.

Acceptance: a screenshot and a 20 s capture (use the file-audio path with the
techno mix) committed under `reports/`. Then STOP and ask the user whether it
reads as a creature. Do not proceed to growth or LLM shape design without
that answer. If the answer is no, the first things to try are the shape
(clearer limbs, less body mass) and the armature (more pins, stiffer
springs) — not the tissue.

## Out of scope

Downbeat detection, alternative director models, two-stage director,
code-splitting, auth, GRA/Lenia/evolution, LLM-generated shapes.
